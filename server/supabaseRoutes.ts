import express from 'express';
import crypto from 'crypto';
import {
  getSupabaseAdmin,
  requireSupabaseAuth,
  SupabaseAuthRequest,
} from './supabaseAdmin.ts';
import {
  DEFAULT_CITIES,
  validateDeliveryGeospatial,
} from './engines/geospatialEngine.ts';
import {
  generateAuthoritativeQuote,
  verifyQuoteForOrderConfirmation,
} from './engines/pricingEngine.ts';
import {
  generateScheduledQuote,
  ScheduledDurationType,
  validateScheduledLocations,
} from './engines/scheduledDeliveryEngine.ts';
import {
  buildDispatchWaveOffers,
  DispatchCourierCandidate,
} from './engines/dispatchEngine.ts';
import {
  ActorRole,
  CanonicalDeliveryStatus,
  CustodyStatus,
  validateDeliveryTransition,
} from './engines/stateMachineEngine.ts';
import { renderNotificationTemplate } from './engines/notificationEngine.ts';
import {
  computeServerRoadRoute,
  getRememberedServerQuote,
} from './operationsRoutes.ts';

// ============================================================================
// VALIDATION & FIELD MAPPING HELPERS (snake_case DB <-> camelCase App)
// ============================================================================
const ALLOWED_ROLES = new Set([
  'merchant',
  'business_owner',
  'business_employee',
  'independent_driver',
  'rova_driver',
  'fleet_partner',
  'fleet_manager',
  'recipient',
  'dispatcher',
  'operations_manager',
  'admin',
  'super_admin',
]);

const ALLOWED_VEHICLES = new Set([
  'motorcycle',
  'cargo_motorcycle',
  'tricycle',
  'cargo_van',
  'commercial_van',
  'truck',
]);

const ALLOWED_DELIVERY_STATUSES = new Set([
  'pending',
  'scheduled',
  'driver_assigned',
  'driver_approaching_pickup',
  'at_pickup',
  'package_collected',
  'in_transit',
  'approaching_recipient',
  'arrived',
  'delivered',
  'failed',
  'rescheduled',
  'cancelled',
]);

const ALLOWED_RESERVATION_STATUSES = new Set([
  'pending_approval',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
]);

const ALLOWED_INCIDENT_CATEGORIES = new Set([
  'failed_delivery',
  'damage',
  'delay',
  'dispute',
  'refund',
  'driver_report',
]);

const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

function cleanStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function cleanNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function validLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return null;
  }
  return { lat: la, lng: ln };
}

function mapUserRow(row: Record<string, unknown>) {
  return {
    uid: String(row.uid || ''),
    email: String(row.email || ''),
    displayName: String(row.display_name || ''),
    phone: row.phone ? String(row.phone) : undefined,
    role: String(row.role || 'merchant'),
    businessId: row.business_id ? String(row.business_id) : undefined,
    country: row.country ? String(row.country) : undefined,
    primaryAddress: row.primary_address ? String(row.primary_address) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBusinessRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    ownerId: String(row.owner_id || ''),
    name: String(row.name || ''),
    industry: row.industry ? String(row.industry) : undefined,
    city: String(row.city || 'Abidjan'),
    country: String(row.country || 'Côte d’Ivoire'),
    currency: String(row.currency || 'XOF'),
    verificationStatus: String(row.verification_status || 'pending'),
    walletBalance: Number(row.wallet_balance || 0),
    defaultPickupAddress: row.default_pickup_address ? String(row.default_pickup_address) : undefined,
    defaultPickupLandmark: row.default_pickup_landmark ? String(row.default_pickup_landmark) : undefined,
    defaultPickupDigitalAddress: row.default_pickup_digital_address ? String(row.default_pickup_digital_address) : undefined,
    defaultPickupLat: typeof row.default_pickup_lat === 'number' ? row.default_pickup_lat : undefined,
    defaultPickupLng: typeof row.default_pickup_lng === 'number' ? row.default_pickup_lng : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeliveryRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    reference: String(row.reference || ''),
    businessId: row.business_id ? String(row.business_id) : undefined,
    merchantUid: String(row.merchant_uid || ''),
    merchantName: String(row.merchant_name || ''),
    driverUid: String(row.driver_uid || ''),
    driverName: row.driver_name ? String(row.driver_name) : undefined,
    vehicleCategory: String(row.vehicle_category || 'motorcycle'),
    timingType: String(row.timing_type || 'instant'),
    scheduledFor: row.scheduled_for ? String(row.scheduled_for) : undefined,
    pickupAddress: String(row.pickup_address || ''),
    pickupLandmark: row.pickup_landmark ? String(row.pickup_landmark) : undefined,
    pickupDigitalAddress: row.pickup_digital_address ? String(row.pickup_digital_address) : undefined,
    pickupInstructions: row.pickup_instructions ? String(row.pickup_instructions) : undefined,
    pickupLat: Number(row.pickup_lat || 0),
    pickupLng: Number(row.pickup_lng || 0),
    packageType: String(row.package_type || ''),
    packageSize: String(row.package_size || 'small'),
    weightKg: Number(row.weight_kg || 1),
    quantity: Number(row.quantity || 1),
    fragile: Boolean(row.fragile),
    specialHandling: row.special_handling ? String(row.special_handling) : undefined,
    proofRequired: String(row.proof_required || 'otp'),
    status: String(row.status || 'pending'),
    isMultiStop: Boolean(row.is_multi_stop),
    stopCount: Number(row.stop_count || 1),
    completedStopCount: Number(row.completed_stop_count || 0),
    primaryDestinationLabel: row.primary_destination_label ? String(row.primary_destination_label) : undefined,
    stopIds: Array.isArray(row.stop_ids) ? row.stop_ids : [],
    totalDistanceKm: Number(row.total_distance_km || 0),
    estimatedDurationMin: Number(row.estimated_duration_min || 0),
    quotedPrice: Number(row.quoted_price || 0),
    currency: String(row.currency || 'XOF'),
    paymentMethod: String(row.payment_method || 'mobile_money'),
    paymentStatus: String(row.payment_status || 'authorized'),
    driverLat: typeof row.driver_lat === 'number' ? row.driver_lat : undefined,
    driverLng: typeof row.driver_lng === 'number' ? row.driver_lng : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStopRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    deliveryId: String(row.delivery_id || ''),
    merchantUid: String(row.merchant_uid || ''),
    driverUid: String(row.driver_uid || ''),
    sequence: Number(row.sequence || 1),
    recipientName: String(row.recipient_name || ''),
    recipientPhone: String(row.recipient_phone || ''),
    address: String(row.address || ''),
    landmark: row.landmark ? String(row.landmark) : undefined,
    digitalAddress: row.digital_address ? String(row.digital_address) : undefined,
    instructions: row.instructions ? String(row.instructions) : undefined,
    lat: Number(row.lat || 0),
    lng: Number(row.lng || 0),
    packageRef: row.package_ref ? String(row.package_ref) : undefined,
    status: String(row.status || 'pending'),
    otpCode: String(row.otp_code || ''),
    proofType: row.proof_type ? String(row.proof_type) : undefined,
    proofValue: row.proof_value ? String(row.proof_value) : undefined,
    proofNotes: row.proof_notes ? String(row.proof_notes) : undefined,
    trackingToken: String(row.tracking_token || ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrackingRow(row: Record<string, unknown>) {
  return {
    trackingToken: String(row.tracking_token || ''),
    deliveryId: String(row.delivery_id || ''),
    stopId: String(row.stop_id || ''),
    merchantUid: String(row.merchant_uid || ''),
    driverUid: String(row.driver_uid || ''),
    reference: String(row.reference || ''),
    recipientFirstName: String(row.recipient_first_name || ''),
    destinationLabel: String(row.destination_label || ''),
    destinationLat: Number(row.destination_lat || 0),
    destinationLng: Number(row.destination_lng || 0),
    status: String(row.status || 'pending'),
    driverFirstName: row.driver_first_name ? String(row.driver_first_name) : undefined,
    vehicleCategory: String(row.vehicle_category || 'motorcycle'),
    driverLat: typeof row.driver_lat === 'number' ? row.driver_lat : undefined,
    driverLng: typeof row.driver_lng === 'number' ? row.driver_lng : undefined,
    etaMinutes: typeof row.eta_minutes === 'number' ? row.eta_minutes : undefined,
    showLiveDriver: Boolean(row.show_live_driver),
    otpHint: row.otp_hint ? String(row.otp_hint) : undefined,
    updatedAt: row.updated_at,
  };
}

function mapRecipientRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    ownerId: String(row.owner_id || ''),
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    landmark: row.landmark ? String(row.landmark) : undefined,
    digitalAddress: row.digital_address ? String(row.digital_address) : undefined,
    instructions: row.instructions ? String(row.instructions) : undefined,
    lat: Number(row.lat || 0),
    lng: Number(row.lng || 0),
    createdAt: row.created_at,
  };
}

function mapReservationRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    reference: row.reference ? String(row.reference) : undefined,
    businessId: row.business_id ? String(row.business_id) : undefined,
    merchantUid: String(row.merchant_uid || ''),
    merchantName: String(row.merchant_name || ''),
    cityId: row.city_id ? String(row.city_id) : undefined,
    cityName: row.city_name ? String(row.city_name) : undefined,
    timezone: row.timezone ? String(row.timezone) : undefined,
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : undefined,
    vehicleCategory: String(row.vehicle_category || 'motorcycle'),
    driverUid: String(row.driver_uid || ''),
    assignedDriverName: row.assigned_driver_name ? String(row.assigned_driver_name) : undefined,
    reservationDate: String(row.reservation_date || ''),
    startTime: String(row.start_time || ''),
    endTime: String(row.end_time || ''),
    pickupWindowStart: row.pickup_window_start ? String(row.pickup_window_start) : undefined,
    pickupWindowEnd: row.pickup_window_end ? String(row.pickup_window_end) : undefined,
    serviceEndAt: row.service_end_at ? String(row.service_end_at) : undefined,
    durationType: String(row.duration_type || 'window'),
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
    currency: String(row.currency || 'XOF'),
    pricingBreakdown: Array.isArray(row.pricing_breakdown) ? row.pricing_breakdown : undefined,
    paymentMethod: row.payment_method ? String(row.payment_method) : undefined,
    reservationStatus: row.reservation_status ? String(row.reservation_status) : undefined,
    paymentStatus: row.payment_status ? String(row.payment_status) : undefined,
    assignmentStatus: row.assignment_status ? String(row.assignment_status) : undefined,
    executionStatus: row.execution_status ? String(row.execution_status) : undefined,
    holdExpiresAt: row.hold_expires_at ? String(row.hold_expires_at) : undefined,
    cancellationFee: typeof row.cancellation_fee === 'number' ? row.cancellation_fee : undefined,
    refundAmount: typeof row.refund_amount === 'number' ? row.refund_amount : undefined,
    escalationReason: row.escalation_reason ? String(row.escalation_reason) : undefined,
    status: String(row.status || 'pending_approval'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNotificationRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    title: String(row.title || ''),
    message: String(row.message || ''),
    eventType: String(row.event_type || ''),
    deliveryId: row.delivery_id ? String(row.delivery_id) : undefined,
    read: Boolean(row.read),
    createdAt: row.created_at,
  };
}

function mapDriverDispatchRow(row: Record<string, unknown>) {
  return {
    id: String(row.uid || ''),
    uid: String(row.uid || ''),
    firstName: String(row.first_name || ''),
    partnerType: String(row.partner_type || 'independent'),
    vehicleCategory: String(row.vehicle_category || 'motorcycle'),
    serviceArea: String(row.service_area || ''),
    approvalStatus: String(row.approval_status || 'approved'),
    isOnline: Boolean(row.is_online),
    currentLat: Number(row.current_lat || 0),
    currentLng: Number(row.current_lng || 0),
    rating: Number(row.rating || 5),
    completedDeliveries: Number(row.completed_deliveries || 0),
    acceptanceRate: Number(row.acceptance_rate || 100),
    activeDeliveryCount: Number(row.active_delivery_count || 0),
    updatedAt: row.updated_at,
  };
}

function mapPricingRuleRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    zoneName: String(row.zone_name || ''),
    city: String(row.city || ''),
    country: String(row.country || ''),
    currency: String(row.currency || 'XOF'),
    vehicleCategory: String(row.vehicle_category || 'motorcycle'),
    baseFee: Number(row.base_fee || 18),
    perKmRate: Number(row.per_km_rate || 4.5),
    minimumFare: Number(row.minimum_fare || 20),
    waitingFeePerMin: Number(row.waiting_fee_per_min || 0.5),
    scheduledFee: Number(row.scheduled_fee || 5),
    cargoSurcharge: Number(row.cargo_surcharge || 12),
    multiStopFee: Number(row.multi_stop_fee || 6),
    priorityMultiplier: Number(row.priority_multiplier || 1.25),
    peakMultiplier: Number(row.peak_multiplier || 1.15),
    fullDayRate: Number(row.full_day_rate || 320),
    active: Boolean(row.active),
    updatedAt: row.updated_at,
  };
}

function generateSecureOtp(): string {
  return String(crypto.randomInt(1000, 10000));
}

function generateSecureToken(): string {
  return `rtk_${crypto.randomBytes(12).toString('hex')}`;
}

export function createSupabaseRouter(): express.Router {
  const router = express.Router();

  // ==========================================================================
  // PUBLIC ROUTES (Strict validation, zero PII leak)
  // ==========================================================================

  // Isolated public tracking by unguessable tracking token
  router.get('/tracking/:token', async (req, res) => {
    try {
      const token = cleanStr(req.params.token, 128);
      if (!TOKEN_RE.test(token)) {
        return res.status(400).json({ error: 'Invalid tracking token format.' });
      }
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ error: 'Supabase not configured.' });

      const { data, error } = await admin
        .from('public_tracking')
        .select('*')
        .eq('tracking_token', token)
        .maybeSingle();

      if (error) {
        console.error('Supabase tracking query error:', error);
        return res.status(500).json({ error: 'Unable to fetch tracking record.' });
      }
      if (!data) {
        return res.status(404).json({ error: 'Tracking token not found.' });
      }
      return res.json({ tracking: mapTrackingRow(data) });
    } catch (err) {
      console.error('Tracking endpoint error:', err);
      return res.status(500).json({ error: 'Unable to load tracking status.' });
    }
  });

  // Public waitlist / contact submission
  router.post('/waitlist', async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ error: 'Supabase not configured.' });

      const name = cleanStr(req.body?.name, 120) || 'ROVA Contact';
      const email = cleanStr(req.body?.email, 200);
      const message = cleanStr(req.body?.message, 1000);
      const company = cleanStr(req.body?.company, 160);
      const city = cleanStr(req.body?.city, 100);
      const rawPlatform = cleanStr(req.body?.platform, 30);
      const platform = ['ios', 'android', 'partner', 'driver', 'contact'].includes(rawPlatform)
        ? rawPlatform
        : 'contact';

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required.' });
      }

      const { error } = await admin.from('waitlist').insert({
        name,
        email,
        company: company || null,
        city: city || null,
        platform,
        message: message || null,
      });

      if (error) {
        console.error('Waitlist insert error:', error);
        return res.status(500).json({ error: 'Unable to submit request right now.' });
      }
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Waitlist route error:', err);
      return res.status(500).json({ error: 'Unable to submit request right now.' });
    }
  });

  // ==========================================================================
  // AUTHENTICATED ROUTES (Verified via Supabase Bearer JWT)
  // ==========================================================================

  // User profile read & upsert
  router.get('/me', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const { data, error } = await admin
        .from('users')
        .select('*')
        .eq('uid', uid)
        .maybeSingle();

      if (error) {
        console.error('Fetch user profile error:', error);
        return res.status(500).json({ error: 'Unable to load profile.' });
      }
      return res.json({
        profile: data ? mapUserRow(data) : null,
        isAdmin: Boolean(req.isRovaAdmin),
      });
    } catch (err) {
      console.error('GET /me error:', err);
      return res.status(500).json({ error: 'Unable to load profile.' });
    }
  });

  router.put('/me', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const user = req.supabaseUser!;
      const displayName =
        cleanStr(req.body?.displayName, 120) ||
        cleanStr(user.user_metadata?.full_name, 120) ||
        'ROVA User';
      const phone = cleanStr(req.body?.phone, 40);
      const country = cleanStr(req.body?.country, 80);
      const primaryAddress = cleanStr(req.body?.primaryAddress, 300);
      const businessId = cleanStr(req.body?.businessId, 128);
      const requestedRole = cleanStr(req.body?.role, 40);

      // Only admins may self-assign privileged admin roles
      const safeRole =
        requestedRole && ALLOWED_ROLES.has(requestedRole)
          ? ['admin', 'super_admin', 'operations_manager', 'dispatcher'].includes(requestedRole) &&
            !req.isRovaAdmin
            ? 'merchant'
            : requestedRole
          : 'merchant';

      const upsertPayload: Record<string, unknown> = {
        uid: user.id,
        email: user.email || '',
        display_name: displayName,
        role: safeRole,
      };
      if (req.body?.phone !== undefined) upsertPayload.phone = phone || null;
      if (req.body?.country !== undefined) upsertPayload.country = country || null;
      if (req.body?.primaryAddress !== undefined) upsertPayload.primary_address = primaryAddress || null;
      if (req.body?.businessId !== undefined) upsertPayload.business_id = businessId || null;

      const { data, error } = await admin
        .from('users')
        .upsert(upsertPayload, { onConflict: 'uid' })
        .select('*')
        .single();

      if (error) {
        console.error('Upsert user profile error:', error);
        return res.status(500).json({ error: 'Unable to save profile.' });
      }
      return res.json({ profile: mapUserRow(data) });
    } catch (err) {
      console.error('PUT /me error:', err);
      return res.status(500).json({ error: 'Unable to save profile.' });
    }
  });

  // Bootstrap snapshot (single fast Vercel round-trip for workspace state)
  router.get('/workspace', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;

      const [bizRes, delRes, resvRes, recRes, drvRes, priceRes, notifRes] = await Promise.all([
        admin.from('businesses').select('*').eq('owner_id', uid).limit(1),
        admin.from('deliveries').select('*').eq('merchant_uid', uid).order('created_at', { ascending: false }).limit(100),
        admin.from('reservations').select('*').eq('merchant_uid', uid).order('created_at', { ascending: false }).limit(60),
        admin.from('saved_recipients').select('*').eq('owner_id', uid).order('created_at', { ascending: false }).limit(100),
        admin.from('driver_dispatch').select('*').eq('approval_status', 'approved').eq('is_online', true).limit(100),
        admin.from('pricing_rules').select('*').eq('active', true).limit(50),
        admin.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
      ]);

      return res.json({
        business: bizRes.data?.[0] ? mapBusinessRow(bizRes.data[0]) : null,
        deliveries: (delRes.data || []).map(mapDeliveryRow),
        reservations: (resvRes.data || []).map(mapReservationRow),
        recipients: (recRes.data || []).map(mapRecipientRow),
        onlineDrivers: (drvRes.data || []).map(mapDriverDispatchRow),
        pricingRules: (priceRes.data || []).map(mapPricingRuleRow),
        notifications: (notifRes.data || []).map(mapNotificationRow),
      });
    } catch (err) {
      console.error('GET /workspace error:', err);
      return res.status(500).json({ error: 'Unable to load workspace data.' });
    }
  });

  // Business profile upsert
  router.put('/business', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const name = cleanStr(req.body?.name, 160) || 'Entreprise ROVA';
      const city = cleanStr(req.body?.city, 100) || 'Abidjan';
      const country = cleanStr(req.body?.country, 80) || 'Côte d’Ivoire';
      const currency = cleanStr(req.body?.currency, 8) || 'XOF';
      const defaultPickupAddress = cleanStr(req.body?.defaultPickupAddress, 300);

      // Ensure user record exists first for FK constraint
      await admin.from('users').upsert(
        {
          uid,
          email: req.supabaseUser!.email || '',
          display_name: cleanStr(req.body?.displayName, 120) || name,
          ...(req.body?.phone ? { phone: cleanStr(req.body.phone, 40) } : {}),
        },
        { onConflict: 'uid' }
      );

      const payload: Record<string, unknown> = {
        id: uid,
        owner_id: uid,
        name,
        city,
        country,
        currency,
      };
      if (defaultPickupAddress) payload.default_pickup_address = defaultPickupAddress;
      if (typeof req.body?.defaultPickupLat === 'number' && Number.isFinite(req.body.defaultPickupLat)) {
        payload.default_pickup_lat = req.body.defaultPickupLat;
      }
      if (typeof req.body?.defaultPickupLng === 'number' && Number.isFinite(req.body.defaultPickupLng)) {
        payload.default_pickup_lng = req.body.defaultPickupLng;
      }

      const { data, error } = await admin
        .from('businesses')
        .upsert(payload, { onConflict: 'id' })
        .select('*')
        .single();

      if (error) {
        console.error('Business upsert error:', error);
        return res.status(500).json({ error: 'Unable to save business profile.' });
      }
      return res.json({ business: mapBusinessRow(data) });
    } catch (err) {
      console.error('PUT /business error:', err);
      return res.status(500).json({ error: 'Unable to save business profile.' });
    }
  });

  // Deliveries: authoritative server-side geospatial + quote validation, order creation & Wave-1 dispatch offers
  router.post('/deliveries', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const body = req.body || {};

      const pickupCoords = validLatLng(body.pickupLat, body.pickupLng);
      const pickupAddress = cleanStr(body.pickupAddress, 300);
      const rawStops = Array.isArray(body.stops) ? body.stops.slice(0, 50) : [];
      if (!pickupAddress || !pickupCoords || rawStops.length === 0) {
        return res.status(400).json({ error: 'Pickup location and at least one valid stop are required.' });
      }

      const vehicleCategory = ALLOWED_VEHICLES.has(String(body.vehicleCategory))
        ? String(body.vehicleCategory)
        : 'motorcycle';
      const timingType = cleanStr(body.timingType, 30) || 'instant';
      const reference = cleanStr(body.reference, 40) || `RV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      type PreparedStop = {
        id: string;
        sequence: number;
        recipientName: string;
        recipientPhone: string;
        address: string;
        landmark: string | null;
        instructions: string | null;
        packageRef: string | null;
        lat: number;
        lng: number;
        otpCode: string;
        trackingToken: string;
      };

      const deliveryId = crypto.randomUUID();
      const preparedStops: PreparedStop[] = rawStops
        .map((s: Record<string, unknown>, idx: number): PreparedStop | null => {
          const coords = validLatLng(s.lat, s.lng);
          const addr = cleanStr(s.address, 300);
          if (!coords || !addr) return null;
          return {
            id: crypto.randomUUID(),
            sequence: idx + 1,
            recipientName: cleanStr(s.recipientName, 120) || 'Destinataire',
            recipientPhone: cleanStr(s.recipientPhone, 40) || '+225 00 00 00 00',
            address: addr,
            landmark: cleanStr(s.landmark, 200) || null,
            instructions: cleanStr(s.instructions, 300) || null,
            packageRef: cleanStr(s.packageRef, 80) || null,
            lat: coords.lat,
            lng: coords.lng,
            otpCode: generateSecureOtp(),
            trackingToken: generateSecureToken(),
          };
        })
        .filter((s: PreparedStop | null): s is PreparedStop => s !== null);

      if (preparedStops.length === 0) {
        return res.status(400).json({ error: 'Provide at least one stop with valid address and coordinates.' });
      }

      // 1. Strict City-Based Geospatial Isolation Check (rejects Abidjan -> Bouaké, Accra -> Abidjan, etc.)
      const stopCoords = preparedStops.map((s) => ({ lat: s.lat, lng: s.lng }));
      const geoCheck = validateDeliveryGeospatial({
        pickup: pickupCoords,
        stops: stopCoords,
        vehicleCategory,
        cities: DEFAULT_CITIES,
      });
      if (!geoCheck.ok) {
        return res.status(422).json({
          error: geoCheck.messageFr,
          errorEn: geoCheck.messageEn,
          code: geoCheck.code,
          details: geoCheck.details,
        });
      }

      // 2. Authoritative Server-Side Pricing & Quote Verification (NEVER trust frontend price)
      const submittedQuoteId = cleanStr(body.quoteId, 64);
      let authoritativeQuote = submittedQuoteId ? getRememberedServerQuote(submittedQuoteId) : null;

      if (authoritativeQuote) {
        const verified = verifyQuoteForOrderConfirmation({
          quote: authoritativeQuote,
          pickup: pickupCoords,
          stops: stopCoords,
          vehicleCategory,
          clientSubmittedPrice:
            typeof body.quotedPrice === 'number' && Number.isFinite(body.quotedPrice)
              ? body.quotedPrice
              : undefined,
        });
        if (!verified.ok) {
          return res.status(422).json({
            error: verified.messageFr,
            errorEn: verified.messageEn,
            code: verified.code,
          });
        }
        authoritativeQuote.status = 'consumed';
      } else {
        const routeEstimate = await computeServerRoadRoute([pickupCoords, ...stopCoords]);
        const fresh = generateAuthoritativeQuote({
          pickup: pickupCoords,
          stops: stopCoords,
          vehicleCategory,
          timingType,
          weightKg: Math.max(0.5, cleanNum(body.weightKg, 1)),
          packageSize: (cleanStr(body.packageSize, 20) || 'small') as 'small' | 'medium' | 'large' | 'bulk',
          fragile: Boolean(body.fragile),
          routeOverride: routeEstimate,
          cities: DEFAULT_CITIES,
        });
        if (!fresh.ok) {
          return res.status(422).json({
            error: fresh.messageFr,
            errorEn: fresh.messageEn,
            code: fresh.code,
          });
        }
        authoritativeQuote = fresh.quote;
        authoritativeQuote.status = 'consumed';
      }

      // 3. Separate Order Confirmation from Courier Assignment
      // Orders always start unassigned in searching_courier (or scheduled) and dispatch offers to couriers
      const status = timingType === 'scheduled' ? 'scheduled' : 'searching_courier';
      const nowIso = new Date().toISOString();

      const { data: createdDelivery, error: delErr } = await admin
        .from('deliveries')
        .insert({
          id: deliveryId,
          reference,
          city_id: authoritativeQuote.cityId,
          quote_id: submittedQuoteId || null,
          pricing_rule_version_id: authoritativeQuote.pricingRuleVersionId,
          business_id: cleanStr(body.businessId, 128) || null,
          merchant_uid: uid,
          merchant_name: cleanStr(body.merchantName, 160) || 'Marchand ROVA',
          driver_uid: '',
          driver_name: null,
          vehicle_category: vehicleCategory,
          timing_type: timingType,
          scheduled_for: cleanStr(body.scheduledFor, 60) || null,
          pickup_address: pickupAddress,
          pickup_landmark: cleanStr(body.pickupLandmark, 200) || null,
          pickup_instructions: cleanStr(body.pickupInstructions, 300) || null,
          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          primary_destination_label: preparedStops[0].address.slice(0, 240),
          stop_ids: preparedStops.map((s) => s.id),
          package_type: cleanStr(body.packageType, 80) || 'Colis commercial',
          package_size: cleanStr(body.packageSize, 20) || 'small',
          weight_kg: Math.max(0.5, cleanNum(body.weightKg, 1)),
          quantity: Math.max(1, Math.floor(cleanNum(body.quantity, 1))),
          fragile: Boolean(body.fragile),
          special_handling: cleanStr(body.specialHandling, 240) || null,
          proof_required: cleanStr(body.proofRequired, 30) || 'otp',
          status,
          custody_status: 'with_sender',
          is_multi_stop: preparedStops.length > 1,
          stop_count: preparedStops.length,
          completed_stop_count: 0,
          total_distance_km: authoritativeQuote.distanceKm,
          estimated_duration_min: authoritativeQuote.durationMin,
          distance_source: authoritativeQuote.distanceSource,
          is_fallback_estimate: authoritativeQuote.isFallbackEstimate,
          quoted_price: authoritativeQuote.customerTotal,
          courier_earnings: authoritativeQuote.courierEarnings,
          platform_commission: authoritativeQuote.platformCommission,
          currency: authoritativeQuote.currency,
          payment_method: cleanStr(body.paymentMethod, 30) || 'mobile_money',
          payment_status: body.paymentMethod === 'invoice' ? 'invoiced' : 'authorized',
          search_started_at: status === 'searching_courier' ? nowIso : null,
          dispatch_wave: status === 'searching_courier' ? 1 : 0,
        })
        .select('*')
        .single();

      if (delErr || !createdDelivery) {
        console.error('Delivery insert error:', delErr);
        return res.status(500).json({ error: 'Unable to create delivery.' });
      }

      const stopsRows = preparedStops.map((s) => ({
        id: s.id,
        delivery_id: deliveryId,
        merchant_uid: uid,
        driver_uid: '',
        sequence: s.sequence,
        recipient_name: s.recipientName,
        recipient_phone: s.recipientPhone,
        address: s.address,
        landmark: s.landmark,
        instructions: s.instructions,
        package_ref: s.packageRef,
        lat: s.lat,
        lng: s.lng,
        status,
        otp_code: s.otpCode,
        tracking_token: s.trackingToken,
      }));

      await admin.from('delivery_stops').insert(stopsRows);

      const trackingRows = preparedStops.map((s) => ({
        tracking_token: s.trackingToken,
        delivery_id: deliveryId,
        stop_id: s.id,
        merchant_uid: uid,
        driver_uid: '',
        reference,
        recipient_first_name: (s.recipientName.split(' ')[0] || 'Client').slice(0, 80),
        destination_label: s.address,
        destination_lat: s.lat,
        destination_lng: s.lng,
        status,
        driver_first_name: null,
        vehicle_category: vehicleCategory,
        driver_lat: null,
        driver_lng: null,
        eta_minutes: authoritativeQuote.durationMin,
        show_live_driver: false,
        otp_hint: `••${s.otpCode.slice(-2)}`,
      }));

      await admin.from('public_tracking').insert(trackingRows);

      // 4. Trigger Wave-1 Dispatch Offers to Eligible Couriers in the Same City
      let offersDispatched = 0;
      if (status === 'searching_courier') {
        const { data: onlineDrivers } = await admin
          .from('driver_dispatch')
          .select('*')
          .eq('approval_status', 'approved')
          .eq('is_online', true);

        const candidates: DispatchCourierCandidate[] = (onlineDrivers || []).map((d) => ({
          uid: String(d.uid),
          firstName: String(d.first_name || 'Livreur'),
          cityId: String(d.city_id || geoCheck.city.id),
          approvalStatus: 'approved',
          isOnline: Boolean(d.is_online),
          availabilityStatus: (d.availability_status || 'AVAILABLE') as DispatchCourierCandidate['availabilityStatus'],
          vehicleCategory: String(d.vehicle_category || 'motorcycle'),
          currentLat: Number(d.current_lat || geoCheck.city.center.lat),
          currentLng: Number(d.current_lng || geoCheck.city.center.lng),
          gpsAccuracyMeters: typeof d.gps_accuracy_m === 'number' ? d.gps_accuracy_m : 20,
          gpsUpdatedAtMs: d.gps_updated_at ? Date.parse(String(d.gps_updated_at)) : Date.now(),
          rating: Number(d.rating || 4.8),
          acceptanceRate: Number(d.acceptance_rate || 95),
          activeDeliveryCount: Number(d.active_delivery_count || 0),
          maxConcurrentDeliveries: Number(d.max_concurrent_deliveries || 1),
        }));

        const wavePlan = buildDispatchWaveOffers({
          deliveryId,
          city: geoCheck.city,
          pickup: pickupCoords,
          requiredVehicle: vehicleCategory,
          weightKg: Math.max(0.5, cleanNum(body.weightKg, 1)),
          offeredEarnings: authoritativeQuote.courierEarnings,
          waveNumber: 1,
          candidates,
        });

        if (wavePlan.offers.length > 0) {
          await admin.from('delivery_offers').insert(
            wavePlan.offers.map((o) => ({
              id: o.id,
              delivery_id: o.deliveryId,
              city_id: o.cityId,
              courier_uid: o.courierUid,
              wave_number: o.waveNumber,
              status: o.status,
              internal_score: o.internalScore,
              estimated_pickup_distance_km: o.estimatedPickupDistanceKm,
              estimated_pickup_eta_min: o.estimatedPickupEtaMin,
              offered_earnings: o.offeredEarnings,
              currency: o.currency,
              expires_at: o.expiresAt,
              sent_at: o.sentAt,
            }))
          );
          offersDispatched = wavePlan.offers.length;
        }
      }

      // 5. Record immutable audit event & template-driven customer notification
      await admin.from('delivery_events').insert({
        id: `evt_${crypto.randomBytes(8).toString('hex')}`,
        delivery_id: deliveryId,
        city_id: authoritativeQuote.cityId,
        event_type: 'delivery.created',
        actor_uid: uid,
        actor_role: 'customer',
        from_status: null,
        to_status: status,
        payload: {
          quoteId: authoritativeQuote.id,
          customerTotal: authoritativeQuote.customerTotal,
          currency: authoritativeQuote.currency,
          offersDispatched,
        },
      });

      const notif = renderNotificationTemplate('delivery.created', 'fr', {
        reference,
        cityName: authoritativeQuote.cityName,
      });
      await admin.from('notifications').insert({
        user_id: uid,
        title: notif.title,
        message: notif.message,
        event_type: 'delivery.created',
        delivery_id: deliveryId,
        read: false,
      });

      return res.status(201).json({
        delivery: mapDeliveryRow(createdDelivery),
        quote: {
          id: authoritativeQuote.id,
          cityId: authoritativeQuote.cityId,
          customerTotal: authoritativeQuote.customerTotal,
          currency: authoritativeQuote.currency,
          distanceSource: authoritativeQuote.distanceSource,
        },
        offersDispatched,
      });
    } catch (err) {
      console.error('POST /deliveries error:', err);
      return res.status(500).json({ error: 'Unable to create delivery.' });
    }
  });

  // Delivery stops (owner, driver, or admin)
  router.get('/deliveries/:id/stops', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const deliveryId = cleanStr(req.params.id, 128);

      const { data: delivery } = await admin
        .from('deliveries')
        .select('merchant_uid, driver_uid')
        .eq('id', deliveryId)
        .maybeSingle();

      if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });
      if (
        delivery.merchant_uid !== uid &&
        delivery.driver_uid !== uid &&
        !req.isRovaAdmin
      ) {
        return res.status(403).json({ error: 'Forbidden.' });
      }

      const { data: stops, error } = await admin
        .from('delivery_stops')
        .select('*')
        .eq('delivery_id', deliveryId)
        .order('sequence', { ascending: true });

      if (error) return res.status(500).json({ error: 'Unable to load stops.' });
      return res.json({ stops: (stops || []).map(mapStopRow) });
    } catch (err) {
      console.error('GET /deliveries/:id/stops error:', err);
      return res.status(500).json({ error: 'Unable to load stops.' });
    }
  });

  // Delivery status update (enforces centralized state machine, role rules, and template notifications)
  router.patch('/deliveries/:id/status', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const deliveryId = cleanStr(req.params.id, 128);
      const nextStatus = cleanStr(req.body?.status, 40) as CanonicalDeliveryStatus;

      const { data: existing } = await admin
        .from('deliveries')
        .select('merchant_uid, driver_uid, reference, driver_name, estimated_duration_min, status, custody_status, proof_required, city_id')
        .eq('id', deliveryId)
        .maybeSingle();

      if (!existing) return res.status(404).json({ error: 'Delivery not found.' });

      const actorRole: ActorRole = req.isRovaAdmin
        ? 'admin'
        : existing.driver_uid === uid
        ? 'courier'
        : 'customer';

      const check = validateDeliveryTransition(
        {
          currentStatus: String(existing.status) as CanonicalDeliveryStatus,
          nextStatus,
          actorUid: uid,
          actorRole,
          merchantUid: String(existing.merchant_uid),
          assignedDriverUid: existing.driver_uid ? String(existing.driver_uid) : null,
          proofRequired: (existing.proof_required || 'otp') as 'otp',
          proofPayload: req.body?.proof,
          failureReason: cleanStr(req.body?.failureReason, 300),
        },
        (existing.custody_status || 'with_sender') as CustodyStatus
      );

      if (!check.ok) {
        return res.status(check.code === 'UNAUTHORIZED_ACTOR' ? 403 : 422).json({
          error: check.messageFr,
          errorEn: check.messageEn,
          code: check.code,
        });
      }

      if (check.idempotent) {
        return res.json({ ok: true, idempotent: true });
      }

      const { error } = await admin
        .from('deliveries')
        .update({ status: nextStatus, custody_status: check.nextCustodyStatus })
        .eq('id', deliveryId);

      if (error) return res.status(500).json({ error: 'Unable to update delivery status.' });
      await admin
        .from('public_tracking')
        .update({
          status: nextStatus,
          show_live_driver: !check.shouldStopTracking,
        })
        .eq('delivery_id', deliveryId);

      await admin.from('delivery_events').insert({
        id: `evt_${crypto.randomBytes(8).toString('hex')}`,
        delivery_id: deliveryId,
        city_id: existing.city_id ? String(existing.city_id) : null,
        event_type: check.eventType || `delivery.${nextStatus}`,
        actor_uid: uid,
        actor_role: actorRole,
        from_status: String(existing.status),
        to_status: nextStatus,
        payload: {},
      });

      if (existing.merchant_uid) {
        const rendered = renderNotificationTemplate(check.eventType || `delivery.${nextStatus}`, 'fr', {
          reference: String(existing.reference),
          courierName: existing.driver_name ? String(existing.driver_name) : undefined,
          etaMinutes: Math.max(2, Number(existing.estimated_duration_min || 15)),
        });
        await admin.from('notifications').insert({
          user_id: existing.merchant_uid,
          title: rendered.title,
          message: rendered.message,
          event_type: check.eventType || nextStatus,
          delivery_id: deliveryId,
          read: false,
        });
      }

      return res.json({ ok: true, status: nextStatus, custodyStatus: check.nextCustodyStatus });
    } catch (err) {
      console.error('PATCH /deliveries/:id/status error:', err);
      return res.status(500).json({ error: 'Unable to update delivery status.' });
    }
  });

  // Saved recipients CRUD
  router.post('/recipients', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const coords = validLatLng(req.body?.lat, req.body?.lng);
      const name = cleanStr(req.body?.name, 120);
      const phone = cleanStr(req.body?.phone, 40);
      const address = cleanStr(req.body?.address, 300);

      if (!name || !phone || !address || !coords) {
        return res.status(400).json({ error: 'Valid recipient name, phone, address and coordinates are required.' });
      }

      const { data, error } = await admin
        .from('saved_recipients')
        .insert({
          owner_id: uid,
          business_id: cleanStr(req.body?.businessId, 128) || null,
          name,
          phone,
          address,
          landmark: cleanStr(req.body?.landmark, 200) || null,
          instructions: cleanStr(req.body?.instructions, 300) || null,
          lat: coords.lat,
          lng: coords.lng,
        })
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: 'Unable to save address.' });
      return res.status(201).json({ recipient: mapRecipientRow(data) });
    } catch (err) {
      console.error('POST /recipients error:', err);
      return res.status(500).json({ error: 'Unable to save address.' });
    }
  });

  router.put('/recipients/:id', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const id = cleanStr(req.params.id, 128);
      const coords = validLatLng(req.body?.lat, req.body?.lng);
      const name = cleanStr(req.body?.name, 120);
      const phone = cleanStr(req.body?.phone, 40);
      const address = cleanStr(req.body?.address, 300);

      if (!name || !phone || !address || !coords) {
        return res.status(400).json({ error: 'Valid recipient details are required.' });
      }

      const { data, error } = await admin
        .from('saved_recipients')
        .update({
          name,
          phone,
          address,
          landmark: cleanStr(req.body?.landmark, 200) || null,
          instructions: cleanStr(req.body?.instructions, 300) || null,
          lat: coords.lat,
          lng: coords.lng,
        })
        .eq('id', id)
        .eq('owner_id', uid)
        .select('*')
        .maybeSingle();

      if (error || !data) return res.status(404).json({ error: 'Address not found.' });
      return res.json({ recipient: mapRecipientRow(data) });
    } catch (err) {
      console.error('PUT /recipients/:id error:', err);
      return res.status(500).json({ error: 'Unable to update address.' });
    }
  });

  router.delete('/recipients/:id', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const id = cleanStr(req.params.id, 128);

      const { error } = await admin
        .from('saved_recipients')
        .delete()
        .eq('id', id)
        .eq('owner_id', uid);

      if (error) return res.status(500).json({ error: 'Unable to delete address.' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /recipients/:id error:', err);
      return res.status(500).json({ error: 'Unable to delete address.' });
    }
  });

  // Reservations (Server-Authoritative Validation & Pricing)
  router.post('/reservations', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const body = req.body || {};
      const coords = validLatLng(body.pickupLat, body.pickupLng);
      const pickupAddress = cleanStr(body.pickupAddress, 300);

      if (!pickupAddress || !coords) {
        return res.status(400).json({ error: 'Valid pickup address and coordinates are required.' });
      }

      const vehicleCategory = ALLOWED_VEHICLES.has(String(body.vehicleCategory))
        ? String(body.vehicleCategory)
        : 'cargo_van';
      const rawDur = cleanStr(body.durationType, 20);
      const durationType: ScheduledDurationType =
        rawDur === 'window' || rawDur === 'hours' || rawDur === 'full_day' ? rawDur : 'hours';

      const loc = validateScheduledLocations({ pickup: coords, cities: DEFAULT_CITIES });
      if (!loc.ok) {
        return res.status(loc.httpStatus).json({ error: loc.messageFr, errorEn: loc.messageEn, code: loc.code });
      }

      const quoteRes = generateScheduledQuote({
        city: loc.city,
        vehicleCategory,
        durationType,
        reservationDate: cleanStr(body.reservationDate, 20),
        startTime: cleanStr(body.startTime, 12),
        endTime: cleanStr(body.endTime, 12),
        estimatedDistanceKm: loc.estimatedDistanceKm,
        estimatedWeightKg: body.estimatedWeightKg !== undefined ? cleanNum(body.estimatedWeightKg, 5) : undefined,
        fragile: Boolean(body.fragile),
      });
      if (!quoteRes.ok) {
        return res.status(quoteRes.httpStatus).json({ error: quoteRes.messageFr, errorEn: quoteRes.messageEn, code: quoteRes.code });
      }

      const { data, error } = await admin
        .from('reservations')
        .insert({
          business_id: cleanStr(body.businessId, 128) || null,
          merchant_uid: uid,
          merchant_name: cleanStr(body.merchantName, 160) || 'Marchand ROVA',
          vehicle_category: vehicleCategory,
          driver_uid: '',
          reservation_date: quoteRes.quote.reservationDate,
          start_time: quoteRes.quote.startTime,
          end_time: quoteRes.quote.endTime,
          duration_type: durationType,
          pickup_address: pickupAddress,
          pickup_lat: coords.lat,
          pickup_lng: coords.lng,
          destinations_summary: cleanStr(body.destinationsSummary, 400) || null,
          cargo_requirements: cleanStr(body.cargoRequirements, 300) || null,
          quoted_price: quoteRes.quote.customerTotal,
          currency: quoteRes.quote.currency,
          status: 'pending_approval',
        })
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: 'Unable to create reservation.' });
      return res.status(201).json({ reservation: mapReservationRow(data), quote: quoteRes.quote });
    } catch (err) {
      console.error('POST /reservations error:', err);
      return res.status(500).json({ error: 'Unable to create reservation.' });
    }
  });

  router.patch('/reservations/:id/status', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const id = cleanStr(req.params.id, 128);
      const status = cleanStr(req.body?.status, 30);

      if (!ALLOWED_RESERVATION_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid reservation status.' });
      }

      const { data: existing } = await admin
        .from('reservations')
        .select('merchant_uid')
        .eq('id', id)
        .maybeSingle();

      if (!existing) return res.status(404).json({ error: 'Reservation not found.' });
      if (existing.merchant_uid !== uid && !req.isRovaAdmin) {
        return res.status(403).json({ error: 'Forbidden.' });
      }
      if (existing.merchant_uid === uid && !req.isRovaAdmin && status !== 'cancelled') {
        return res.status(403).json({ error: 'Merchants may only cancel their own reservations.' });
      }

      const { error } = await admin.from('reservations').update({ status }).eq('id', id);
      if (error) return res.status(500).json({ error: 'Unable to update reservation.' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('PATCH /reservations/:id/status error:', err);
      return res.status(500).json({ error: 'Unable to update reservation.' });
    }
  });

  // Notifications
  router.patch('/notifications/read-all', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      await admin
        .from('notifications')
        .update({ read: true })
        .eq('user_id', uid)
        .eq('read', false);
      return res.json({ ok: true });
    } catch (err) {
      console.error('PATCH /notifications/read-all error:', err);
      return res.status(500).json({ error: 'Unable to update notifications.' });
    }
  });

  // Incidents / support reports
  router.post('/incidents', requireSupabaseAuth, async (req: SupabaseAuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin()!;
      const uid = req.supabaseUser!.id;
      const category = ALLOWED_INCIDENT_CATEGORIES.has(String(req.body?.category))
        ? String(req.body.category)
        : 'dispute';
      const description = cleanStr(req.body?.description, 1000);
      if (description.length < 5) {
        return res.status(400).json({ error: 'Please provide a brief description (at least 5 characters).' });
      }

      const { error } = await admin.from('incidents').insert({
        delivery_id: cleanStr(req.body?.deliveryId, 128) || null,
        reported_by_uid: uid,
        reporter_role: cleanStr(req.body?.reporterRole, 40) || 'merchant',
        category,
        description,
        status: 'open',
      });

      if (error) return res.status(500).json({ error: 'Unable to submit incident report.' });
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('POST /incidents error:', err);
      return res.status(500).json({ error: 'Unable to submit incident report.' });
    }
  });

  return router;
}
