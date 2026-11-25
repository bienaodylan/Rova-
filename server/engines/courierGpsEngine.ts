import {
  CityConfig,
  DEFAULT_CITIES,
  GeoCoordinate,
  haversineDistanceKm,
  isValidCoordinate,
  resolvePointCity,
} from './geospatialEngine.ts';

export type CourierAvailabilityState =
  | 'OFFLINE'
  | 'ONLINE'
  | 'AVAILABLE'
  | 'OFFER_PENDING'
  | 'ASSIGNED'
  | 'PICKUP_IN_PROGRESS'
  | 'DELIVERY_IN_PROGRESS'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'SUSPENDED';

export const ALLOWED_COURIER_AVAILABILITY_STATES = new Set<CourierAvailabilityState>([
  'OFFLINE',
  'ONLINE',
  'AVAILABLE',
  'OFFER_PENDING',
  'ASSIGNED',
  'PICKUP_IN_PROGRESS',
  'DELIVERY_IN_PROGRESS',
  'TEMPORARILY_UNAVAILABLE',
  'SUSPENDED',
]);

export interface CourierGpsSample {
  courierUid: string;
  lat: number;
  lng: number;
  accuracyMeters: number;
  heading?: number | null;
  speedMps?: number | null;
  recordedAtMs: number;
  deliveryId?: string | null;
}

export interface CourierStateContext {
  uid: string;
  cityId: string | null;
  approvalStatus: 'pending' | 'under_review' | 'approved' | 'suspended';
  isOnline: boolean;
  availabilityStatus: CourierAvailabilityState;
  lastLat?: number | null;
  lastLng?: number | null;
  lastGpsUpdatedAtMs?: number | null;
}

export type GpsValidationResult =
  | {
      ok: true;
      city: CityConfig;
      recommendedNextIntervalSec: number;
      telemetryWarning?: string;
    }
  | {
      ok: false;
      code:
        | 'COURIER_SUSPENDED_OR_UNAPPROVED'
        | 'COURIER_OFFLINE'
        | 'INVALID_COORDINATES'
        | 'POOR_GPS_ACCURACY'
        | 'STALE_GPS_SAMPLE'
        | 'OUTSIDE_OPERATING_CITY'
        | 'IMPOSSIBLE_GPS_JUMP';
      messageFr: string;
      messageEn: string;
    };

export const ACTIVE_TRACKING_DELIVERY_STATUSES = new Set([
  'driver_assigned',
  'driver_approaching_pickup',
  'at_pickup',
  'package_collected',
  'in_transit',
  'approaching_recipient',
  'arrived',
  'return_in_progress',
]);

export function isCourierGpsFresh(
  lastGpsUpdatedAtMs: number | null | undefined,
  maxStaleSeconds: number,
  nowMs = Date.now()
): boolean {
  if (!lastGpsUpdatedAtMs || !Number.isFinite(lastGpsUpdatedAtMs)) return false;
  const ageSec = (nowMs - lastGpsUpdatedAtMs) / 1000;
  return ageSec >= -30 && ageSec <= maxStaleSeconds;
}

/**
 * Adaptive battery-friendly GPS reporting cadence based on courier & delivery state.
 * Returns 0 when location tracking MUST STOP (offline or terminal delivery).
 */
export function getAdaptiveGpsFrequencySeconds(
  availabilityStatus: CourierAvailabilityState,
  activeDeliveryStatus?: string | null,
  city?: CityConfig | null
): number {
  const policy = city?.gpsPolicy || DEFAULT_CITIES[0].gpsPolicy;

  if (
    availabilityStatus === 'OFFLINE' ||
    availabilityStatus === 'SUSPENDED' ||
    availabilityStatus === 'TEMPORARILY_UNAVAILABLE'
  ) {
    return 0;
  }

  if (activeDeliveryStatus) {
    if (!ACTIVE_TRACKING_DELIVERY_STATUSES.has(activeDeliveryStatus)) {
      return 0;
    }
    if (
      activeDeliveryStatus === 'driver_approaching_pickup' ||
      activeDeliveryStatus === 'at_pickup' ||
      activeDeliveryStatus === 'approaching_recipient' ||
      activeDeliveryStatus === 'arrived'
    ) {
      return policy.approachingIntervalSec;
    }
    return policy.enRouteIntervalSec;
  }

  if (availabilityStatus === 'AVAILABLE' || availabilityStatus === 'ONLINE' || availabilityStatus === 'OFFER_PENDING') {
    return policy.idleIntervalSec;
  }

  return policy.enRouteIntervalSec;
}

/**
 * Validates incoming courier GPS telemetry strictly before storing or broadcasting.
 */
export function validateCourierGpsTelemetry(params: {
  sample: CourierGpsSample;
  courier: CourierStateContext;
  activeDeliveryStatus?: string | null;
  cities?: CityConfig[];
  nowMs?: number;
}): GpsValidationResult {
  const { sample, courier } = params;
  const cities = params.cities || DEFAULT_CITIES;
  const nowMs = params.nowMs ?? Date.now();

  if (courier.approvalStatus !== 'approved' || courier.availabilityStatus === 'SUSPENDED') {
    return {
      ok: false,
      code: 'COURIER_SUSPENDED_OR_UNAPPROVED',
      messageFr: 'Compte livreur non approuvé ou suspendu.',
      messageEn: 'Courier account is not approved or is suspended.',
    };
  }

  if (!courier.isOnline || courier.availabilityStatus === 'OFFLINE') {
    return {
      ok: false,
      code: 'COURIER_OFFLINE',
      messageFr: 'Le suivi GPS est désactivé lorsque le livreur est hors ligne.',
      messageEn: 'GPS telemetry is rejected while courier is offline.',
    };
  }

  if (!isValidCoordinate({ lat: sample.lat, lng: sample.lng })) {
    return {
      ok: false,
      code: 'INVALID_COORDINATES',
      messageFr: 'Coordonnées GPS invalides.',
      messageEn: 'Invalid GPS coordinates.',
    };
  }

  const resolvedCity = resolvePointCity({ lat: sample.lat, lng: sample.lng }, cities);
  if (!resolvedCity) {
    return {
      ok: false,
      code: 'OUTSIDE_OPERATING_CITY',
      messageFr: 'Position GPS hors des zones urbaines desservies par ROVA.',
      messageEn: 'GPS position is outside supported ROVA operating cities.',
    };
  }

  if (courier.cityId && resolvedCity.id !== courier.cityId) {
    return {
      ok: false,
      code: 'OUTSIDE_OPERATING_CITY',
      messageFr: `Le livreur est affecté à la ville « ${courier.cityId} » mais émet depuis « ${resolvedCity.name} ».`,
      messageEn: `Courier is registered in city "${courier.cityId}" but reported GPS in "${resolvedCity.name}".`,
    };
  }

  const maxAccuracy = resolvedCity.gpsPolicy.maxAccuracyMeters;
  if (!Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters <= 0 || sample.accuracyMeters > maxAccuracy) {
    return {
      ok: false,
      code: 'POOR_GPS_ACCURACY',
      messageFr: `Précision GPS insuffisante (${Math.round(sample.accuracyMeters)} m > ${maxAccuracy} m).`,
      messageEn: `GPS accuracy too poor (${Math.round(sample.accuracyMeters)}m exceeds ${maxAccuracy}m limit).`,
    };
  }

  const ageSec = (nowMs - sample.recordedAtMs) / 1000;
  if (ageSec > resolvedCity.gpsPolicy.maxStaleSeconds || ageSec < -30) {
    return {
      ok: false,
      code: 'STALE_GPS_SAMPLE',
      messageFr: 'Position GPS obsolète rejetée.',
      messageEn: 'Stale or future-skewed GPS position rejected.',
    };
  }

  // Teleportation / spoofing speed sanity check (> 180 km/h urban jump)
  if (
    typeof courier.lastLat === 'number' &&
    typeof courier.lastLng === 'number' &&
    typeof courier.lastGpsUpdatedAtMs === 'number' &&
    sample.recordedAtMs > courier.lastGpsUpdatedAtMs
  ) {
    const dtHours = (sample.recordedAtMs - courier.lastGpsUpdatedAtMs) / 3_600_000;
    const distKm = haversineDistanceKm(
      { lat: courier.lastLat, lng: courier.lastLng },
      { lat: sample.lat, lng: sample.lng }
    );
    if (dtHours > 0 && dtHours < 0.25 && distKm > 1 && distKm / dtHours > 180) {
      return {
        ok: false,
        code: 'IMPOSSIBLE_GPS_JUMP',
        messageFr: 'Déplacement GPS incohérent détecté et ignoré.',
        messageEn: 'Implausible GPS jump detected and rejected.',
      };
    }
  }

  const recommendedNextIntervalSec = getAdaptiveGpsFrequencySeconds(
    courier.availabilityStatus,
    params.activeDeliveryStatus,
    resolvedCity
  );

  return {
    ok: true,
    city: resolvedCity,
    recommendedNextIntervalSec,
  };
}

/**
 * Location privacy & lifecycle gate:
 * - Admins and the courier themselves can read telemetry.
 * - Customer (merchant) can view assigned courier GPS ONLY during active delivery states.
 * - Tracking MUST STOP immediately once delivery is delivered, cancelled, failed, or returned.
 */
export function canActorViewCourierLocation(params: {
  actorUid: string;
  isAdmin: boolean;
  delivery: {
    merchantUid: string;
    driverUid?: string | null;
    status: string;
  };
}): { allowed: boolean; reason?: string } {
  const { actorUid, isAdmin, delivery } = params;
  if (isAdmin) return { allowed: true };
  if (delivery.driverUid && delivery.driverUid === actorUid) return { allowed: true };

  if (delivery.merchantUid !== actorUid) {
    return { allowed: false, reason: 'UNAUTHORIZED_ACTOR' };
  }

  if (!delivery.driverUid) {
    return { allowed: false, reason: 'NO_COURIER_ASSIGNED' };
  }

  if (!ACTIVE_TRACKING_DELIVERY_STATUSES.has(delivery.status)) {
    return { allowed: false, reason: 'TRACKING_TERMINATED' };
  }

  return { allowed: true };
}
