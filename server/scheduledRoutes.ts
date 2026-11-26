import express from 'express';
import crypto from 'crypto';
import {
  getSupabaseAdmin,
  requireSupabaseAuth,
  SupabaseAuthRequest,
} from './supabaseAdmin.ts';
import {
  CityConfig,
  DEFAULT_CITIES,
  GeoCoordinate,
  getCityById,
  getCitySchedulingPolicy,
  isValidCoordinate,
} from './engines/geospatialEngine.ts';
import { EventNotificationEngine } from './engines/notificationEngine.ts';
import {
  AtomicReservationCoordinator,
  computeScheduledAvailability,
  deriveLegacyReservationStatus,
  generateScheduledQuote,
  ScheduledCourierSupply,
  ScheduledDurationType,
  ScheduledPaymentMethod,
  ScheduledReconciliationReport,
  ScheduledReservationEntity,
  validateScheduledLocations,
  verifyWebhookHmacSignature,
} from './engines/scheduledDeliveryEngine.ts';
import { logOperationalEvent } from './engines/observability.ts';

const ALLOWED_DURATION_TYPES = new Set<ScheduledDurationType>(['window', 'hours', 'full_day']);
const ALLOWED_PAYMENT_METHODS = new Set<ScheduledPaymentMethod>(['mobile_money', 'card', 'invoice', 'wallet']);

function cleanStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function cleanNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function parseCoords(raw: unknown): GeoCoordinate | null {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number((raw as Record<string, unknown>).lat);
  const lng = Number((raw as Record<string, unknown>).lng);
  if (!isValidCoordinate({ lat, lng })) return null;
  return { lat, lng };
}

function requireAdminMiddleware(
  req: SupabaseAuthRequest,
  res: express.Response,
  next: express.NextFunction
) {
  if (!req.isRovaAdmin) {
    return res.status(403).json({
      error: 'Accès administrateur requis.',
      errorEn: 'Administrator privileges required.',
      code: 'ADMIN_REQUIRED',
    });
  }
  return next();
}

function mapRowToScheduledEntity(row: Record<string, unknown>): ScheduledReservationEntity {
  const reservationStatus = (row.reservation_status ||
    (row.status === 'confirmed'
      ? 'confirmed'
      : row.status === 'cancelled'
      ? 'cancelled'
      : 'hold')) as ScheduledReservationEntity['reservationStatus'];
  const executionStatus = (row.execution_status ||
    (row.status === 'completed'
      ? 'completed'
      : row.status === 'in_progress'
      ? 'in_transit'
      : row.status === 'cancelled'
      ? 'cancelled'
      : 'scheduled')) as ScheduledReservationEntity['executionStatus'];

  const startIso = row.pickup_window_start
    ? String(row.pickup_window_start)
    : `${String(row.reservation_date || '2026-01-01')}T${String(row.start_time || '09:00')}:00Z`;
  const endIso = row.service_end_at
    ? String(row.service_end_at)
    : `${String(row.reservation_date || '2026-01-01')}T${String(row.end_time || '13:00')}:00Z`;
  const pickupEndIso = row.pickup_window_end ? String(row.pickup_window_end) : startIso;

  return {
    id: String(row.id || ''),
    reference: String(row.reference || `RV-SCH-${String(row.id || '').slice(0, 6).toUpperCase()}`),
    businessId: row.business_id ? String(row.business_id) : undefined,
    merchantUid: String(row.merchant_uid || ''),
    merchantName: String(row.merchant_name || 'Marchand ROVA'),
    cityId: String(row.city_id || 'abidjan'),
    cityName: String(row.city_name || 'Abidjan'),
    timezone: String(row.timezone || 'Africa/Abidjan'),
    vehicleCategory: String(row.vehicle_category || 'cargo_van'),
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : undefined,
    driverUid: String(row.driver_uid || ''),
    assignedDriverName: row.assigned_driver_name ? String(row.assigned_driver_name) : undefined,
    reservationDate: String(row.reservation_date || ''),
    startTime: String(row.start_time || '09:00'),
    endTime: String(row.end_time || '13:00'),
    pickupWindowStart: startIso,
    pickupWindowEnd: pickupEndIso,
    serviceEndAt: endIso,
    durationType: (ALLOWED_DURATION_TYPES.has(String(row.duration_type) as ScheduledDurationType)
      ? String(row.duration_type)
      : 'hours') as ScheduledDurationType,
    pickupAddress: String(row.pickup_address || ''),
    pickupLat: Number(row.pickup_lat || 0),
    pickupLng: Number(row.pickup_lng || 0),
    destinationAddress: row.destination_address ? String(row.destination_address) : undefined,
    destinationLat: typeof row.destination_lat === 'number' ? row.destination_lat : undefined,
    destinationLng: typeof row.destination_lng === 'number' ? row.destination_lng : undefined,
    destinationsSummary: row.destinations_summary ? String(row.destinations_summary) : undefined,
    cargoRequirements: row.cargo_requirements ? String(row.cargo_requirements) : undefined,
    estimatedWeightKg: typeof row.estimated_weight_kg === 'number' ? row.estimated_weight_kg : undefined,
    fragile: Boolean(row.fragile),
    quotedPrice: Number(row.quoted_price || 0),
    courierEarnings: Number(row.courier_earnings || 0),
    platformCommission: Number(row.platform_commission || 0),
    currency: String(row.currency || 'XOF'),
    pricingRuleVersionId: String(row.pricing_rule_version_id || 'v1'),
    quoteId: String(row.quote_id || ''),
    pricingBreakdown: Array.isArray(row.pricing_breakdown)
      ? (row.pricing_breakdown as ScheduledReservationEntity['pricingBreakdown'])
      : [],
    paymentMethod: (ALLOWED_PAYMENT_METHODS.has(String(row.payment_method) as ScheduledPaymentMethod)
      ? String(row.payment_method)
      : 'mobile_money') as ScheduledPaymentMethod,
    paymentReference: row.payment_reference ? String(row.payment_reference) : undefined,
    reservationStatus,
    paymentStatus: (row.payment_status || 'unpaid') as ScheduledReservationEntity['paymentStatus'],
    assignmentStatus: (row.assignment_status ||
      (row.driver_uid ? 'assigned' : 'not_requested')) as ScheduledReservationEntity['assignmentStatus'],
    executionStatus,
    status: deriveLegacyReservationStatus({ reservationStatus, executionStatus }),
    holdExpiresAt: row.hold_expires_at ? String(row.hold_expires_at) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    cancellationFee: typeof row.cancellation_fee === 'number' ? row.cancellation_fee : undefined,
    refundAmount: typeof row.refund_amount === 'number' ? row.refund_amount : undefined,
    cancellationReason: row.cancellation_reason ? String(row.cancellation_reason) : undefined,
    dispatchStartedAt: row.dispatch_started_at ? String(row.dispatch_started_at) : null,
    escalationReason: row.escalation_reason ? String(row.escalation_reason) : null,
    remindersSent: Array.isArray(row.reminders_sent) ? row.reminders_sent.map(String) : [],
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

// Shared singleton coordinator across requests (synchronized with Supabase whenever configured)
const scheduledNotificationEngine = new EventNotificationEngine();
export const sharedScheduledCoordinator = new AtomicReservationCoordinator({
  cities: DEFAULT_CITIES,
  usePolicyCapacityFallback: true,
  notificationEngine: scheduledNotificationEngine,
});

async function loadActiveCitiesFromSupabase(): Promise<CityConfig[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return DEFAULT_CITIES;
  try {
    const { data } = await admin.from('cities').select('*').eq('is_active', true);
    if (!data || data.length === 0) return DEFAULT_CITIES;
    return data.map((row) => {
      const fallback = getCityById(String(row.id), DEFAULT_CITIES) || DEFAULT_CITIES[0];
      return {
        ...fallback,
        id: String(row.id),
        name: String(row.name || fallback.name),
        countryCode: String(row.country_code || fallback.countryCode),
        countryName: String(row.country_name || fallback.countryName),
        currency: String(row.currency || fallback.currency),
        timezone: String(row.timezone || fallback.timezone),
        isActive: Boolean(row.is_active),
        serviceRadiusKm: Number(row.service_radius_km ?? fallback.serviceRadiusKm),
        maxDeliveryDistanceKm: Number(row.max_delivery_distance_km ?? fallback.maxDeliveryDistanceKm),
        maxDeliveryDurationMin: Number(row.max_delivery_duration_min ?? fallback.maxDeliveryDurationMin),
        allowedVehicles: Array.isArray(row.allowed_vehicles)
          ? row.allowed_vehicles.map(String)
          : fallback.allowedVehicles,
        operatingHours:
          row.operating_hours && typeof row.operating_hours === 'object'
            ? (row.operating_hours as CityConfig['operatingHours'])
            : fallback.operatingHours,
        schedulingPolicy:
          row.scheduling_policy &&
          typeof row.scheduling_policy === 'object' &&
          Object.keys(row.scheduling_policy as Record<string, unknown>).length > 0
            ? { ...getCitySchedulingPolicy(fallback), ...(row.scheduling_policy as Record<string, unknown>) }
            : fallback.schedulingPolicy,
      };
    });
  } catch {
    return DEFAULT_CITIES;
  }
}

async function syncFleetAndReservationsFromSupabase(): Promise<{
  cities: CityConfig[];
  fleetSupply: ScheduledCourierSupply[];
  existingReservations: ScheduledReservationEntity[];
}> {
  const cities = await loadActiveCitiesFromSupabase();
  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      cities,
      fleetSupply: [],
      existingReservations: sharedScheduledCoordinator.listReservations(),
    };
  }

  try {
    const [driversRes, reservationsRes] = await Promise.all([
      admin
        .from('drivers')
        .select('uid, full_name, vehicle_category, service_area, approval_status, is_online, rating')
        .eq('approval_status', 'approved')
        .limit(500),
      admin
        .from('reservations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const fleetSupply: ScheduledCourierSupply[] = (driversRes.data || []).map((d) => {
      const areaLower = String(d.service_area || '').toLowerCase();
      const matchedCity =
        cities.find((c) => areaLower.includes(c.id) || areaLower.includes(c.name.toLowerCase())) ||
        cities[0];
      return {
        uid: String(d.uid),
        name: String(d.full_name || 'Livreur ROVA'),
        cityId: matchedCity.id,
        vehicleCategory: String(d.vehicle_category || 'motorcycle'),
        approvalStatus: String(d.approval_status || 'approved') as ScheduledCourierSupply['approvalStatus'],
        isActive: true,
        rating: Number(d.rating || 5),
      };
    });

    sharedScheduledCoordinator.setFleetSupply(fleetSupply);
    // Use fleet_live strictly when real approved fleet exists, otherwise explicit policy fallback
    sharedScheduledCoordinator.setUsePolicyCapacityFallback(fleetSupply.length === 0);

    const dbReservations = (reservationsRes.data || []).map((r) =>
      mapRowToScheduledEntity(r as Record<string, unknown>)
    );
    for (const r of dbReservations) {
      sharedScheduledCoordinator.upsertReservation(r);
    }

    return {
      cities,
      fleetSupply,
      existingReservations: sharedScheduledCoordinator.listReservations(),
    };
  } catch {
    return {
      cities,
      fleetSupply: [],
      existingReservations: sharedScheduledCoordinator.listReservations(),
    };
  }
}

async function persistReservationToSupabase(entity: ScheduledReservationEntity): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    await admin.from('reservations').upsert(
      {
        id: entity.id,
        reference: entity.reference,
        business_id: entity.businessId || null,
        merchant_uid: entity.merchantUid,
        merchant_name: entity.merchantName,
        city_id: entity.cityId,
        city_name: entity.cityName,
        timezone: entity.timezone,
        vehicle_category: entity.vehicleCategory,
        vehicle_id: entity.vehicleId || null,
        driver_uid: entity.driverUid,
        assigned_driver_name: entity.assignedDriverName || null,
        reservation_date: entity.reservationDate,
        start_time: entity.startTime,
        end_time: entity.endTime,
        pickup_window_start: entity.pickupWindowStart,
        pickup_window_end: entity.pickupWindowEnd,
        service_end_at: entity.serviceEndAt,
        duration_type: entity.durationType,
        pickup_address: entity.pickupAddress,
        pickup_lat: entity.pickupLat,
        pickup_lng: entity.pickupLng,
        destination_address: entity.destinationAddress || null,
        destination_lat: entity.destinationLat ?? null,
        destination_lng: entity.destinationLng ?? null,
        destinations_summary: entity.destinationsSummary || null,
        cargo_requirements: entity.cargoRequirements || null,
        estimated_weight_kg: entity.estimatedWeightKg ?? null,
        fragile: Boolean(entity.fragile),
        quoted_price: entity.quotedPrice,
        courier_earnings: entity.courierEarnings,
        platform_commission: entity.platformCommission,
        currency: entity.currency,
        pricing_rule_version_id: entity.pricingRuleVersionId,
        quote_id: entity.quoteId || null,
        pricing_breakdown: entity.pricingBreakdown,
        payment_method: entity.paymentMethod,
        payment_reference: entity.paymentReference || null,
        reservation_status: entity.reservationStatus,
        payment_status: entity.paymentStatus,
        assignment_status: entity.assignmentStatus,
        execution_status: entity.executionStatus,
        status: entity.status,
        hold_expires_at: entity.holdExpiresAt || null,
        idempotency_key: entity.idempotencyKey || null,
        cancellation_fee: entity.cancellationFee ?? null,
        refund_amount: entity.refundAmount ?? null,
        cancellation_reason: entity.cancellationReason || null,
        dispatch_started_at: entity.dispatchStartedAt || null,
        escalation_reason: entity.escalationReason || null,
        reminders_sent: entity.remindersSent,
        updated_at: entity.updatedAt,
      },
      { onConflict: 'id' }
    );
  } catch (err) {
    // Graceful fallback if migration hasn't been applied yet — try minimal legacy columns
    logOperationalEvent('warn', 'scheduled.supabase_upsert_fallback', {
      reservationId: entity.id,
      error: err instanceof Error ? err.message : 'upsert_error',
    });
    try {
      await admin.from('reservations').upsert(
        {
          id: entity.id,
          business_id: entity.businessId || null,
          merchant_uid: entity.merchantUid,
          merchant_name: entity.merchantName,
          vehicle_category: entity.vehicleCategory,
          driver_uid: entity.driverUid,
          reservation_date: entity.reservationDate,
          start_time: entity.startTime,
          end_time: entity.endTime,
          duration_type: entity.durationType,
          pickup_address: entity.pickupAddress,
          pickup_lat: entity.pickupLat,
          pickup_lng: entity.pickupLng,
          destinations_summary: entity.destinationsSummary || null,
          cargo_requirements: entity.cargoRequirements || null,
          quoted_price: entity.quotedPrice,
          currency: entity.currency,
          status: entity.status,
        },
        { onConflict: 'id' }
      );
    } catch {
      // Non-fatal in preview/unmigrated environments
    }
  }
}

export async function reconcileAllScheduledReservations(): Promise<ScheduledReconciliationReport> {
  await syncFleetAndReservationsFromSupabase();
  const report = await sharedScheduledCoordinator.reconcileScheduledReservations(Date.now());
  for (const evt of report.events) {
    const res = sharedScheduledCoordinator.getReservation(evt.reservationId);
    if (res) {
      await persistReservationToSupabase(res);
    }
  }
  return report;
}

export function createScheduledRouter(): express.Router {
  const router = express.Router();

  // ============================================================================
  // 1. REAL AVAILABILITY, DATES, SLOTS & VEHICLE COMPATIBILITY
  // POST /api/v1/scheduled/availability
  // ============================================================================
  router.post('/scheduled/availability', async (req, res) => {
    try {
      const body = req.body || {};
      const pickup = parseCoords(body.pickup ?? { lat: body.pickupLat, lng: body.pickupLng });
      if (!pickup) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_PICKUP_COORDINATES',
          error: 'Veuillez indiquer un point de départ valide.',
          errorEn: 'Please provide valid pickup coordinates.',
        });
      }

      const destination =
        body.destination || (typeof body.destinationLat === 'number' && typeof body.destinationLng === 'number')
          ? parseCoords(body.destination ?? { lat: body.destinationLat, lng: body.destinationLng })
          : null;

      const durationType = ALLOWED_DURATION_TYPES.has(body.durationType)
        ? (body.durationType as ScheduledDurationType)
        : 'hours';

      const { cities, fleetSupply, existingReservations } = await syncFleetAndReservationsFromSupabase();

      const result = computeScheduledAvailability({
        pickup,
        destination,
        reservationDate: cleanStr(body.reservationDate, 20) || undefined,
        durationType,
        vehicleCategory: cleanStr(body.vehicleCategory, 40) || undefined,
        estimatedWeightKg: body.estimatedWeightKg !== undefined ? cleanNum(body.estimatedWeightKg, 5) : undefined,
        fragile: Boolean(body.fragile),
        cities,
        fleetSupply,
        usePolicyCapacityFallback: fleetSupply.length === 0,
        existingReservations,
      });

      if (!result.ok) {
        return res.status(result.httpStatus).json({
          ok: false,
          code: result.code,
          error: result.messageFr,
          errorEn: result.messageEn,
          details: result.details,
        });
      }

      return res.json(result);
    } catch (err) {
      console.error('POST /api/v1/scheduled/availability error:', err);
      return res.status(500).json({
        ok: false,
        code: 'AVAILABILITY_ENGINE_ERROR',
        error: 'Impossible de charger les disponibilités pour le moment.',
        errorEn: 'Unable to load scheduled availability right now.',
      });
    }
  });

  // ============================================================================
  // 2. SERVER-AUTHORITATIVE SCHEDULED QUOTE (SIGNED)
  // POST /api/v1/scheduled/quote
  // ============================================================================
  router.post('/scheduled/quote', async (req, res) => {
    try {
      const body = req.body || {};
      const pickup = parseCoords(body.pickup ?? { lat: body.pickupLat, lng: body.pickupLng });
      if (!pickup) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_PICKUP_COORDINATES',
          error: 'Coordonnées de départ invalides.',
          errorEn: 'Invalid pickup coordinates.',
        });
      }

      const destination =
        body.destination || (typeof body.destinationLat === 'number' && typeof body.destinationLng === 'number')
          ? parseCoords(body.destination ?? { lat: body.destinationLat, lng: body.destinationLng })
          : null;

      const cities = await loadActiveCitiesFromSupabase();
      const loc = validateScheduledLocations({ pickup, destination, cities });
      if (!loc.ok) {
        return res.status(loc.httpStatus).json({
          ok: false,
          code: loc.code,
          error: loc.messageFr,
          errorEn: loc.messageEn,
          details: loc.details,
        });
      }

      const durationType = ALLOWED_DURATION_TYPES.has(body.durationType)
        ? (body.durationType as ScheduledDurationType)
        : 'hours';

      const quoteRes = generateScheduledQuote({
        city: loc.city,
        vehicleCategory: cleanStr(body.vehicleCategory, 40) || 'cargo_van',
        durationType,
        reservationDate: cleanStr(body.reservationDate, 20),
        startTime: cleanStr(body.startTime, 12),
        endTime: cleanStr(body.endTime, 12),
        estimatedDistanceKm: loc.estimatedDistanceKm,
        estimatedWeightKg: body.estimatedWeightKg !== undefined ? cleanNum(body.estimatedWeightKg, 5) : undefined,
        fragile: Boolean(body.fragile),
      });

      if (!quoteRes.ok) {
        return res.status(quoteRes.httpStatus).json({
          ok: false,
          code: quoteRes.code,
          error: quoteRes.messageFr,
          errorEn: quoteRes.messageEn,
          details: quoteRes.details,
        });
      }

      return res.json({ ok: true, quote: quoteRes.quote });
    } catch (err) {
      console.error('POST /api/v1/scheduled/quote error:', err);
      return res.status(500).json({
        ok: false,
        code: 'QUOTE_ENGINE_ERROR',
        error: 'Impossible de calculer le tarif de réservation.',
        errorEn: 'Unable to calculate scheduled quote.',
      });
    }
  });

  // ============================================================================
  // 3. ATOMIC CAPACITY HOLD CREATION (AUTHENTICATED)
  // POST /api/v1/scheduled/holds
  // ============================================================================
  router.post('/scheduled/holds', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const body = req.body || {};
      const uid = req.supabaseUser!.id;
      const pickup = parseCoords(body.pickup ?? { lat: body.pickupLat, lng: body.pickupLng });
      const pickupAddress = cleanStr(body.pickupAddress, 300);
      if (!pickup || !pickupAddress) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_PICKUP',
          error: 'Adresse et coordonnées de prise en charge requises.',
          errorEn: 'Valid pickup address and coordinates are required.',
        });
      }

      const destination =
        body.destination || (typeof body.destinationLat === 'number' && typeof body.destinationLng === 'number')
          ? parseCoords(body.destination ?? { lat: body.destinationLat, lng: body.destinationLng })
          : null;

      const durationType = ALLOWED_DURATION_TYPES.has(body.durationType)
        ? (body.durationType as ScheduledDurationType)
        : 'hours';
      const paymentMethod = ALLOWED_PAYMENT_METHODS.has(body.paymentMethod)
        ? (body.paymentMethod as ScheduledPaymentMethod)
        : 'mobile_money';

      await syncFleetAndReservationsFromSupabase();

      const result = await sharedScheduledCoordinator.createHold({
        businessId: cleanStr(body.businessId, 128) || undefined,
        merchantUid: uid,
        merchantName: cleanStr(body.merchantName, 160) || req.supabaseUser?.email || 'Marchand ROVA',
        pickup,
        pickupAddress,
        destination,
        destinationAddress: cleanStr(body.destinationAddress, 300) || undefined,
        destinationsSummary: cleanStr(body.destinationsSummary, 400) || undefined,
        vehicleCategory: cleanStr(body.vehicleCategory, 40) || 'cargo_van',
        durationType,
        reservationDate: cleanStr(body.reservationDate, 20),
        startTime: cleanStr(body.startTime, 12),
        endTime: cleanStr(body.endTime, 12),
        estimatedWeightKg: body.estimatedWeightKg !== undefined ? cleanNum(body.estimatedWeightKg, 5) : undefined,
        fragile: Boolean(body.fragile),
        cargoRequirements: cleanStr(body.cargoRequirements, 300) || undefined,
        paymentMethod,
        idempotencyKey: cleanStr(body.idempotencyKey || req.headers['idempotency-key'], 128) || undefined,
        expectedPrice: typeof body.expectedPrice === 'number' ? body.expectedPrice : undefined,
      });

      if (!result.ok) {
        return res.status(result.httpStatus).json({
          ok: false,
          code: result.code,
          error: result.messageFr,
          errorEn: result.messageEn,
          details: result.details,
        });
      }

      await persistReservationToSupabase(result.reservation);

      return res.status(result.deduplicated ? 200 : 201).json({
        ok: true,
        deduplicated: result.deduplicated,
        reservation: result.reservation,
        quote: result.quote,
      });
    } catch (err) {
      console.error('POST /api/v1/scheduled/holds error:', err);
      return res.status(500).json({
        ok: false,
        code: 'HOLD_CREATION_FAILED',
        error: 'Impossible de réserver ce créneau pour le moment.',
        errorEn: 'Unable to hold this time slot right now.',
      });
    }
  });

  // ============================================================================
  // 4. CONFIRM RESERVATION & VERIFY PAYMENT SERVER-SIDE (AUTHENTICATED)
  // POST /api/v1/scheduled/reservations/:id/confirm
  // ============================================================================
  router.post(
    '/scheduled/reservations/:id/confirm',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const uid = req.supabaseUser!.id;
        const reservationId = cleanStr(req.params.id, 128);
        const body = req.body || {};

        await syncFleetAndReservationsFromSupabase();

        // Fetch real business wallet balance & verification status from Supabase when available
        let walletBalance: number | null = null;
        let businessVerified: boolean | undefined = undefined;
        const admin = getSupabaseAdmin();
        if (admin) {
          const { data: biz } = await admin
            .from('businesses')
            .select('wallet_balance, verification_status')
            .eq('owner_id', uid)
            .maybeSingle();
          if (biz) {
            walletBalance = Number(biz.wallet_balance ?? 0);
            businessVerified = String(biz.verification_status) === 'verified';
          }
        }

        const paymentMethod = ALLOWED_PAYMENT_METHODS.has(body.paymentMethod)
          ? (body.paymentMethod as ScheduledPaymentMethod)
          : undefined;

        const result = await sharedScheduledCoordinator.confirmReservation({
          reservationId,
          actorUid: uid,
          isAdmin: req.isRovaAdmin,
          paymentMethod,
          paymentCtx: {
            walletBalance,
            businessVerified,
          },
        });

        if (!result.ok) {
          return res.status(result.httpStatus).json({
            ok: false,
            code: result.code,
            error: result.messageFr,
            errorEn: result.messageEn,
            details: result.details,
          });
        }

        // Deduct wallet balance server-side atomically when paid via wallet
        if (
          admin &&
          result.reservation.paymentMethod === 'wallet' &&
          result.reservation.paymentStatus === 'paid' &&
          typeof walletBalance === 'number'
        ) {
          const nextBalance = Math.max(0, Number((walletBalance - result.reservation.quotedPrice).toFixed(2)));
          await admin
            .from('businesses')
            .update({ wallet_balance: nextBalance })
            .eq('owner_id', uid);
        }

        await persistReservationToSupabase(result.reservation);

        return res.json({
          ok: true,
          reservation: result.reservation,
          paymentOutcome: result.paymentOutcome,
        });
      } catch (err) {
        console.error('POST /api/v1/scheduled/reservations/:id/confirm error:', err);
        return res.status(500).json({
          ok: false,
          code: 'CONFIRM_RESERVATION_FAILED',
          error: 'Impossible de confirmer la réservation.',
          errorEn: 'Unable to confirm reservation.',
        });
      }
    }
  );

  // ============================================================================
  // 5. PAYMENT PROVIDER WEBHOOK (HMAC SIGNATURE VERIFIED + IDEMPOTENT)
  // POST /api/v1/scheduled/payments/webhook
  // ============================================================================
  router.post('/scheduled/payments/webhook', async (req, res) => {
    try {
      const secret = (
        process.env.ROVA_PAYMENT_WEBHOOK_SECRET ||
        process.env.PAYSTACK_SECRET_KEY ||
        process.env.STRIPE_WEBHOOK_SECRET ||
        ''
      ).trim();

      if (!secret) {
        return res.status(503).json({
          ok: false,
          code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
          error: 'La clé webhook paiement n’est pas configurée.',
        });
      }

      const signature = String(
        req.headers['x-rova-signature'] ||
          req.headers['x-paystack-signature'] ||
          ''
      );
      const rawBody = JSON.stringify(req.body || {});
      if (!verifyWebhookHmacSignature(rawBody, signature, secret)) {
        return res.status(401).json({
          ok: false,
          code: 'INVALID_WEBHOOK_SIGNATURE',
          error: 'Signature webhook invalide.',
        });
      }

      const webhookEventId = cleanStr(req.body?.eventId, 128);
      const reservationId = cleanStr(req.body?.reservationId, 128);
      const providerReference = cleanStr(req.body?.providerReference, 128);
      const status = cleanStr(req.body?.status, 20) as 'paid' | 'failed' | 'refunded';
      const amount = typeof req.body?.amount === 'number' ? req.body.amount : undefined;

      if (!webhookEventId || !reservationId || !['paid', 'failed', 'refunded'].includes(status)) {
        return res.status(400).json({ ok: false, code: 'INVALID_WEBHOOK_PAYLOAD' });
      }

      await syncFleetAndReservationsFromSupabase();
      const result = await sharedScheduledCoordinator.processPaymentWebhook({
        webhookEventId,
        reservationId,
        providerReference: providerReference || `wh_${crypto.randomBytes(4).toString('hex')}`,
        status,
        amount,
      });

      if (!result.ok) {
        return res.status(result.httpStatus).json({
          ok: false,
          code: result.code,
          error: result.messageFr,
        });
      }

      await persistReservationToSupabase(result.reservation);
      return res.json({
        ok: true,
        deduplicated: result.deduplicated,
        reservation: result.reservation,
      });
    } catch (err) {
      console.error('POST /api/v1/scheduled/payments/webhook error:', err);
      return res.status(500).json({ ok: false, code: 'WEBHOOK_ERROR' });
    }
  });

  // ============================================================================
  // 6. CANCELLATION POLICY PREVIEW & EXECUTION (OWNER OR ADMIN)
  // POST /api/v1/scheduled/reservations/:id/cancel
  // ============================================================================
  router.post(
    '/scheduled/reservations/:id/cancel',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const uid = req.supabaseUser!.id;
        const reservationId = cleanStr(req.params.id, 128);
        const preview = Boolean(req.body?.preview);
        const reason = cleanStr(req.body?.reason, 240);

        await syncFleetAndReservationsFromSupabase();
        const result = await sharedScheduledCoordinator.cancelReservation({
          reservationId,
          actorUid: uid,
          isAdmin: req.isRovaAdmin,
          reason,
          preview,
        });

        if (!result.ok) {
          return res.status(result.httpStatus).json({
            ok: false,
            code: result.code,
            error: result.messageFr,
            errorEn: result.messageEn,
            details: result.details,
          });
        }

        if (!preview) {
          await persistReservationToSupabase(result.reservation);
        }

        return res.json({
          ok: true,
          preview: result.preview,
          evaluation: result.evaluation,
          reservation: result.reservation,
        });
      } catch (err) {
        console.error('POST /api/v1/scheduled/reservations/:id/cancel error:', err);
        return res.status(500).json({
          ok: false,
          code: 'CANCEL_FAILED',
          error: 'Impossible de traiter l’annulation.',
        });
      }
    }
  );

  // ============================================================================
  // 7. RESCHEDULE / MODIFY RESERVATION WITH FULL BACKEND REVALIDATION
  // PATCH /api/v1/scheduled/reservations/:id/reschedule
  // ============================================================================
  router.patch(
    '/scheduled/reservations/:id/reschedule',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const uid = req.supabaseUser!.id;
        const reservationId = cleanStr(req.params.id, 128);
        const body = req.body || {};

        await syncFleetAndReservationsFromSupabase();

        const pickup =
          body.pickup || (typeof body.pickupLat === 'number' && typeof body.pickupLng === 'number')
            ? parseCoords(body.pickup ?? { lat: body.pickupLat, lng: body.pickupLng }) || undefined
            : undefined;

        const durationType = ALLOWED_DURATION_TYPES.has(body.durationType)
          ? (body.durationType as ScheduledDurationType)
          : undefined;

        const result = await sharedScheduledCoordinator.rescheduleReservation({
          reservationId,
          actorUid: uid,
          isAdmin: req.isRovaAdmin,
          reservationDate: cleanStr(body.reservationDate, 20) || undefined,
          startTime: cleanStr(body.startTime, 12) || undefined,
          endTime: cleanStr(body.endTime, 12) || undefined,
          durationType,
          vehicleCategory: cleanStr(body.vehicleCategory, 40) || undefined,
          pickup,
          pickupAddress: cleanStr(body.pickupAddress, 300) || undefined,
          cargoRequirements: body.cargoRequirements !== undefined ? cleanStr(body.cargoRequirements, 300) : undefined,
          estimatedWeightKg: body.estimatedWeightKg !== undefined ? cleanNum(body.estimatedWeightKg, 5) : undefined,
        });

        if (!result.ok) {
          return res.status(result.httpStatus).json({
            ok: false,
            code: result.code,
            error: result.messageFr,
            errorEn: result.messageEn,
            details: result.details,
          });
        }

        await persistReservationToSupabase(result.reservation);

        return res.json({
          ok: true,
          reservation: result.reservation,
          previousPrice: result.previousPrice,
          priceDelta: result.priceDelta,
        });
      } catch (err) {
        console.error('PATCH /api/v1/scheduled/reservations/:id/reschedule error:', err);
        return res.status(500).json({
          ok: false,
          code: 'RESCHEDULE_FAILED',
          error: 'Impossible de replanifier la réservation.',
        });
      }
    }
  );

  // ============================================================================
  // 8. ADMIN OPERATIONS: SCHEDULED OVERVIEW & CONFLICT-SAFE ASSIGNMENT
  // GET /api/v1/ops/scheduled
  // POST /api/v1/ops/scheduled/:id/assign
  // ============================================================================
  router.get(
    '/ops/scheduled',
    requireSupabaseAuth,
    requireAdminMiddleware,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const { existingReservations } = await syncFleetAndReservationsFromSupabase();
        const cityFilter = cleanStr(req.query.cityId, 40);
        const filtered = cityFilter
          ? existingReservations.filter((r) => r.cityId === cityFilter)
          : existingReservations;

        return res.json({
          ok: true,
          reservations: filtered,
          summary: {
            total: filtered.length,
            confirmed: filtered.filter((r) => r.reservationStatus === 'confirmed').length,
            activeHolds: filtered.filter(
              (r) =>
                (r.reservationStatus === 'hold' || r.reservationStatus === 'pending_payment') &&
                Boolean(r.holdExpiresAt && Date.parse(r.holdExpiresAt) > Date.now())
            ).length,
            unassignedConfirmed: filtered.filter(
              (r) => r.reservationStatus === 'confirmed' && !r.driverUid
            ).length,
            escalated: filtered.filter((r) => Boolean(r.escalationReason)).length,
            paymentIssues: filtered.filter(
              (r) => r.paymentStatus === 'failed' || r.reservationStatus === 'pending_payment'
            ).length,
          },
        });
      } catch (err) {
        console.error('GET /api/v1/ops/scheduled error:', err);
        return res.status(500).json({ ok: false, error: 'Unable to load scheduled operations overview.' });
      }
    }
  );

  router.post(
    '/ops/scheduled/:id/assign',
    requireSupabaseAuth,
    requireAdminMiddleware,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const reservationId = cleanStr(req.params.id, 128);
        const courierUid = cleanStr(req.body?.courierUid, 128);
        const courierName = cleanStr(req.body?.courierName, 120) || 'Livreur ROVA';
        const courierVehicle = cleanStr(req.body?.vehicleCategory, 40);
        const courierCityId = cleanStr(req.body?.cityId, 40);

        if (!courierUid) {
          return res.status(400).json({ ok: false, code: 'COURIER_UID_REQUIRED', error: 'Sélectionnez un chauffeur.' });
        }

        const { fleetSupply } = await syncFleetAndReservationsFromSupabase();
        const existing = sharedScheduledCoordinator.getReservation(reservationId);
        if (!existing) {
          return res.status(404).json({ ok: false, code: 'RESERVATION_NOT_FOUND', error: 'Réservation introuvable.' });
        }

        const fleetMatch = fleetSupply.find((c) => c.uid === courierUid);
        const courier: ScheduledCourierSupply = fleetMatch || {
          uid: courierUid,
          name: courierName,
          cityId: courierCityId || existing.cityId,
          vehicleCategory: courierVehicle || existing.vehicleCategory,
          approvalStatus: 'approved',
          isActive: true,
        };

        const result = await sharedScheduledCoordinator.assignCourier({
          reservationId,
          courier,
          actorUid: req.supabaseUser!.id,
          actorRole: 'admin',
        });

        if (!result.ok) {
          return res.status(result.httpStatus).json({
            ok: false,
            code: result.code,
            error: result.messageFr,
            errorEn: result.messageEn,
            details: result.details,
          });
        }

        await persistReservationToSupabase(result.reservation);
        return res.json({ ok: true, reservation: result.reservation });
      } catch (err) {
        console.error('POST /api/v1/ops/scheduled/:id/assign error:', err);
        return res.status(500).json({ ok: false, error: 'Unable to assign courier.' });
      }
    }
  );

  return router;
}
