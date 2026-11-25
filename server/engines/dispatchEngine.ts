import crypto from 'crypto';
import {
  CityConfig,
  DEFAULT_CITIES,
  GeoCoordinate,
  haversineDistanceKm,
} from './geospatialEngine.ts';
import {
  CourierAvailabilityState,
  isCourierGpsFresh,
} from './courierGpsEngine.ts';

export type OfferStatus =
  | 'CREATED'
  | 'SENT'
  | 'DELIVERED'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SUPERSEDED';

export const OPEN_OFFER_STATUSES = new Set<OfferStatus>([
  'CREATED',
  'SENT',
  'DELIVERED',
  'VIEWED',
]);

const VEHICLE_CAPACITY_KG: Record<string, number> = {
  motorcycle: 15,
  cargo_motorcycle: 45,
  tricycle: 250,
  cargo_van: 800,
  commercial_van: 1500,
  truck: 5000,
};

export interface DispatchCourierCandidate {
  uid: string;
  firstName: string;
  cityId: string;
  approvalStatus: 'pending' | 'under_review' | 'approved' | 'suspended';
  isOnline: boolean;
  availabilityStatus: CourierAvailabilityState;
  vehicleCategory: string;
  currentLat: number;
  currentLng: number;
  gpsAccuracyMeters?: number | null;
  gpsUpdatedAtMs: number;
  rating: number; // 0..5
  acceptanceRate: number; // 0..100
  activeDeliveryCount: number;
  maxConcurrentDeliveries: number;
}

export interface RankedDispatchCandidate {
  courier: DispatchCourierCandidate;
  pickupDistanceKm: number;
  pickupEtaMin: number;
  internalScore: number; // STRICTLY SERVER-ONLY
}

export interface DeliveryOfferRecord {
  id: string;
  deliveryId: string;
  cityId: string;
  courierUid: string;
  waveNumber: number;
  status: OfferStatus;
  internalScore: number;
  estimatedPickupDistanceKm: number;
  estimatedPickupEtaMin: number;
  offeredEarnings: number;
  currency: string;
  expiresAt: string;
  sentAt: string;
  respondedAt?: string | null;
  rejectionReason?: string | null;
}

export interface CourierFacingOffer {
  id: string;
  deliveryId: string;
  cityId: string;
  waveNumber: number;
  status: OfferStatus;
  estimatedPickupDistanceKm: number;
  estimatedPickupEtaMin: number;
  offeredEarnings: number;
  currency: string;
  expiresAt: string;
  sentAt: string;
}

export interface DispatchWavePlan {
  waveNumber: number;
  radiusKm: number;
  offers: DeliveryOfferRecord[];
  excludedReasons: Record<string, string>;
  exhausted: boolean;
}

/**
 * Strips server-only internal ranking scores before returning offers to courier apps.
 */
export function sanitizeOfferForCourier(offer: DeliveryOfferRecord): CourierFacingOffer {
  return {
    id: offer.id,
    deliveryId: offer.deliveryId,
    cityId: offer.cityId,
    waveNumber: offer.waveNumber,
    status: offer.status,
    estimatedPickupDistanceKm: offer.estimatedPickupDistanceKm,
    estimatedPickupEtaMin: offer.estimatedPickupEtaMin,
    offeredEarnings: offer.offeredEarnings,
    currency: offer.currency,
    expiresAt: offer.expiresAt,
    sentAt: offer.sentAt,
  };
}

/**
 * 4-Phase Dispatch Matching Engine:
 * Phase 1: Hard eligibility filters (approval, online, availability, capacity, city, GPS freshness/accuracy, vehicle compatibility, exclusions)
 * Phase 2: Candidate discovery inside current wave radius
 * Phase 3: Server-only weighted ranking model
 * Phase 4: Wave batch offer generation with strict expiration timestamps
 */
export function buildDispatchWaveOffers(params: {
  deliveryId: string;
  city: CityConfig;
  pickup: GeoCoordinate;
  requiredVehicle: string;
  weightKg: number;
  offeredEarnings: number;
  waveNumber: number;
  candidates: DispatchCourierCandidate[];
  excludedCourierUids?: Set<string>;
  nowMs?: number;
}): DispatchWavePlan {
  const { city, waveNumber } = params;
  const nowMs = params.nowMs ?? Date.now();
  const excludedUids = params.excludedCourierUids || new Set<string>();
  const excludedReasons: Record<string, string> = {};

  if (waveNumber > city.dispatchConfig.maxWaves) {
    return {
      waveNumber,
      radiusKm: 0,
      offers: [],
      excludedReasons,
      exhausted: true,
    };
  }

  const waveRadiusKm =
    city.dispatchConfig.waveRadiiKm[waveNumber - 1] ??
    city.dispatchConfig.waveRadiiKm[city.dispatchConfig.waveRadiiKm.length - 1] ??
    18;

  const requiredCapacity = Math.max(
    params.weightKg || 1,
    VEHICLE_CAPACITY_KG[params.requiredVehicle] ?? 15
  );

  const ranked: RankedDispatchCandidate[] = [];

  for (const c of params.candidates) {
    // Phase 1: Hard Eligibility Filters
    if (excludedUids.has(c.uid)) {
      excludedReasons[c.uid] = 'ALREADY_OFFERED_OR_REJECTED';
      continue;
    }
    if (c.approvalStatus !== 'approved') {
      excludedReasons[c.uid] = 'NOT_APPROVED';
      continue;
    }
    if (!c.isOnline || c.availabilityStatus === 'OFFLINE' || c.availabilityStatus === 'SUSPENDED' || c.availabilityStatus === 'TEMPORARILY_UNAVAILABLE') {
      excludedReasons[c.uid] = `UNAVAILABLE_${c.availabilityStatus}`;
      continue;
    }
    if (c.availabilityStatus !== 'AVAILABLE' && c.availabilityStatus !== 'ONLINE') {
      excludedReasons[c.uid] = `BUSY_${c.availabilityStatus}`;
      continue;
    }
    if (c.cityId !== city.id) {
      excludedReasons[c.uid] = 'WRONG_CITY';
      continue;
    }
    if (c.activeDeliveryCount >= Math.max(1, c.maxConcurrentDeliveries)) {
      excludedReasons[c.uid] = 'AT_CAPACITY';
      continue;
    }
    if (!isCourierGpsFresh(c.gpsUpdatedAtMs, city.gpsPolicy.maxStaleSeconds, nowMs)) {
      excludedReasons[c.uid] = 'STALE_GPS';
      continue;
    }
    if (
      typeof c.gpsAccuracyMeters === 'number' &&
      c.gpsAccuracyMeters > city.gpsPolicy.maxAccuracyMeters
    ) {
      excludedReasons[c.uid] = 'POOR_GPS_ACCURACY';
      continue;
    }

    const courierCap = VEHICLE_CAPACITY_KG[c.vehicleCategory] ?? 0;
    const vehicleCompatible =
      c.vehicleCategory === params.requiredVehicle || courierCap >= requiredCapacity;
    if (!vehicleCompatible) {
      excludedReasons[c.uid] = 'VEHICLE_INCOMPATIBLE';
      continue;
    }

    // Phase 2: Wave Proximity Discovery
    const pickupDistanceKm = Number(
      haversineDistanceKm(params.pickup, { lat: c.currentLat, lng: c.currentLng }).toFixed(2)
    );
    if (pickupDistanceKm > waveRadiusKm) {
      excludedReasons[c.uid] = `OUTSIDE_WAVE_RADIUS_${waveRadiusKm}KM`;
      continue;
    }

    // Phase 3: Server-Only Weighted Ranking Model
    const avgSpeedKmh =
      c.vehicleCategory === 'motorcycle' || c.vehicleCategory === 'cargo_motorcycle' ? 28 : 22;
    const pickupEtaMin = Math.max(2, Math.round((pickupDistanceKm / avgSpeedKmh) * 60));

    const exactVehicleBonus = c.vehicleCategory === params.requiredVehicle ? 20 : 5;
    const proximityScore = Math.max(0, 45 - pickupDistanceKm * (45 / Math.max(1, waveRadiusKm)));
    const ratingScore = (Math.min(5, Math.max(0, c.rating)) / 5) * 18;
    const acceptanceScore = (Math.min(100, Math.max(0, c.acceptanceRate)) / 100) * 12;
    const freshnessAgeSec = Math.max(0, (nowMs - c.gpsUpdatedAtMs) / 1000);
    const freshnessScore = Math.max(0, 5 - (freshnessAgeSec / city.gpsPolicy.maxStaleSeconds) * 5);
    const workloadPenalty = c.activeDeliveryCount * 15;

    const internalScore = Number(
      Math.max(
        0,
        exactVehicleBonus + proximityScore + ratingScore + acceptanceScore + freshnessScore - workloadPenalty
      ).toFixed(3)
    );

    ranked.push({
      courier: c,
      pickupDistanceKm,
      pickupEtaMin,
      internalScore,
    });
  }

  ranked.sort((a, b) => b.internalScore - a.internalScore);

  // Phase 4: Controlled Wave Batch Selection
  const batch = ranked.slice(0, city.dispatchConfig.waveBatchSize);
  const expiresAt = new Date(nowMs + city.dispatchConfig.offerTtlSeconds * 1000).toISOString();
  const sentAt = new Date(nowMs).toISOString();

  const offers: DeliveryOfferRecord[] = batch.map((item) => ({
    id: `off_${crypto.randomBytes(8).toString('hex')}`,
    deliveryId: params.deliveryId,
    cityId: city.id,
    courierUid: item.courier.uid,
    waveNumber,
    status: 'SENT',
    internalScore: item.internalScore,
    estimatedPickupDistanceKm: item.pickupDistanceKm,
    estimatedPickupEtaMin: item.pickupEtaMin,
    offeredEarnings: params.offeredEarnings,
    currency: city.currency,
    expiresAt,
    sentAt,
  }));

  return {
    waveNumber,
    radiusKm: waveRadiusKm,
    offers,
    excludedReasons,
    exhausted: false,
  };
}

// ============================================================================
// ATOMIC CONCURRENCY-SAFE OFFER LOCKING COORDINATOR
// Mirrors PostgreSQL `public.accept_delivery_offer` row-level locking semantics
// for unit/concurrency verification and single-node fallback safety.
// ============================================================================
export interface AtomicOfferStoreDelivery {
  id: string;
  cityId: string;
  status: string;
  driverUid: string;
  driverName?: string;
}

export interface AtomicAcceptResult {
  ok: boolean;
  idempotent?: boolean;
  code?:
    | 'OFFER_NOT_FOUND'
    | 'OFFER_UNAUTHORIZED'
    | 'OFFER_NOT_OPEN'
    | 'OFFER_EXPIRED'
    | 'DELIVERY_NOT_FOUND'
    | 'DELIVERY_ALREADY_ASSIGNED'
    | 'COURIER_NOT_ELIGIBLE'
    | 'COURIER_AT_CAPACITY';
  message?: string;
  deliveryId?: string;
  offerId?: string;
  supersededOfferIds?: string[];
}

export class AtomicDispatchCoordinator {
  private locks = new Map<string, Promise<void>>();

  private async withDeliveryLock<T>(deliveryId: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.locks.get(deliveryId) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.locks.set(deliveryId, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(deliveryId) === chained) {
        this.locks.delete(deliveryId);
      }
    }
  }

  async acceptOffer(params: {
    offerId: string;
    courierUid: string;
    offers: Map<string, DeliveryOfferRecord>;
    deliveries: Map<string, AtomicOfferStoreDelivery>;
    couriers: Map<string, DispatchCourierCandidate>;
    nowMs?: number;
  }): Promise<AtomicAcceptResult> {
    const initialOffer = params.offers.get(params.offerId);
    if (!initialOffer) {
      return { ok: false, code: 'OFFER_NOT_FOUND', message: 'Offer does not exist.' };
    }

    return this.withDeliveryLock(initialOffer.deliveryId, () => {
      const nowMs = params.nowMs ?? Date.now();
      const offer = params.offers.get(params.offerId);
      if (!offer) {
        return { ok: false, code: 'OFFER_NOT_FOUND', message: 'Offer does not exist.' };
      }

      if (offer.courierUid !== params.courierUid) {
        return { ok: false, code: 'OFFER_UNAUTHORIZED', message: 'Offer does not belong to this courier.' };
      }

      if (offer.status === 'ACCEPTED') {
        return { ok: true, idempotent: true, deliveryId: offer.deliveryId, offerId: offer.id };
      }

      if (!OPEN_OFFER_STATUSES.has(offer.status)) {
        return {
          ok: false,
          code: 'OFFER_NOT_OPEN',
          message: `Offer is no longer active (${offer.status}).`,
        };
      }

      if (Date.parse(offer.expiresAt) <= nowMs) {
        offer.status = 'EXPIRED';
        return { ok: false, code: 'OFFER_EXPIRED', message: 'Offer has expired.' };
      }

      const delivery = params.deliveries.get(offer.deliveryId);
      if (!delivery) {
        return { ok: false, code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found.' };
      }

      const assignableStatuses = new Set(['pending', 'searching_courier', 'unassigned', 'scheduled']);
      if (delivery.driverUid || !assignableStatuses.has(delivery.status)) {
        offer.status = 'SUPERSEDED';
        return {
          ok: false,
          code: 'DELIVERY_ALREADY_ASSIGNED',
          message: 'Delivery has already been claimed by another courier.',
        };
      }

      const courier = params.couriers.get(params.courierUid);
      if (!courier || courier.approvalStatus !== 'approved' || !courier.isOnline) {
        return { ok: false, code: 'COURIER_NOT_ELIGIBLE', message: 'Courier is not eligible.' };
      }

      if (courier.activeDeliveryCount >= Math.max(1, courier.maxConcurrentDeliveries)) {
        return { ok: false, code: 'COURIER_AT_CAPACITY', message: 'Courier reached max capacity.' };
      }

      // Atomic commit inside lock
      offer.status = 'ACCEPTED';
      offer.respondedAt = new Date(nowMs).toISOString();

      const supersededOfferIds: string[] = [];
      for (const other of params.offers.values()) {
        if (
          other.deliveryId === offer.deliveryId &&
          other.id !== offer.id &&
          OPEN_OFFER_STATUSES.has(other.status)
        ) {
          other.status = 'SUPERSEDED';
          supersededOfferIds.push(other.id);
        }
      }

      delivery.driverUid = courier.uid;
      delivery.driverName = courier.firstName;
      delivery.status = 'driver_assigned';

      courier.availabilityStatus = 'ASSIGNED';
      courier.activeDeliveryCount += 1;

      return {
        ok: true,
        deliveryId: delivery.id,
        offerId: offer.id,
        supersededOfferIds,
      };
    });
  }
}

export function getDefaultCityForTest(cityId = 'abidjan'): CityConfig {
  return DEFAULT_CITIES.find((c) => c.id === cityId) || DEFAULT_CITIES[0];
}
