import crypto from 'crypto';
import {
  CityConfig,
  DEFAULT_CITIES,
  GeoCoordinate,
  getCityById,
  getCitySchedulingPolicy,
  haversineDistanceKm,
  isValidCoordinate,
  resolvePointCity,
} from './geospatialEngine.ts';
import {
  PricingRuleVersion,
  QuoteBreakdownItem,
  resolvePricingRuleVersion,
  signQuotePayload,
} from './pricingEngine.ts';
import { EventNotificationEngine } from './notificationEngine.ts';
import { logOperationalEvent } from './observability.ts';

// ============================================================================
// SCHEDULED DELIVERY DOMAIN TYPES & SEPARATED LIFECYCLE STATES
// ============================================================================

export type ScheduledDurationType = 'window' | 'hours' | 'full_day';

export type ReservationLifecycleStatus =
  | 'draft'
  | 'hold'
  | 'pending_payment'
  | 'confirmed'
  | 'expired'
  | 'cancelled';

export type ReservationPaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'processing'
  | 'authorized'
  | 'paid'
  | 'invoiced'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type ReservationAssignmentStatus =
  | 'not_requested'
  | 'searching'
  | 'offered'
  | 'assigned'
  | 'reassignment_required'
  | 'failed';

export type ReservationExecutionStatus =
  | 'scheduled'
  | 'preparing'
  | 'courier_en_route'
  | 'pickup_completed'
  | 'in_transit'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LegacyReservationStatus =
  | 'pending_approval'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type ScheduledPaymentMethod = 'mobile_money' | 'card' | 'invoice' | 'wallet';

export type AvailabilitySource = 'fleet_live' | 'city_capacity_policy' | 'unverified';

export const VEHICLE_CAPACITY_LIMITS_KG: Record<string, { maxWeightKg: number; supportsFragile: boolean; supportsPallets: boolean }> = {
  motorcycle: { maxWeightKg: 20, supportsFragile: true, supportsPallets: false },
  cargo_motorcycle: { maxWeightKg: 65, supportsFragile: true, supportsPallets: false },
  tricycle: { maxWeightKg: 250, supportsFragile: true, supportsPallets: false },
  cargo_van: { maxWeightKg: 850, supportsFragile: true, supportsPallets: true },
  commercial_van: { maxWeightKg: 1800, supportsFragile: true, supportsPallets: true },
  truck: { maxWeightKg: 5000, supportsFragile: true, supportsPallets: true },
};

export const DURATION_MINUTES_BY_PACKAGE: Record<ScheduledDurationType, number> = {
  window: 120, // 2h pickup/delivery window
  hours: 240, // 4h half-day
  full_day: 480, // 8h full-day
};

export interface ScheduledCourierSupply {
  uid: string;
  name: string;
  cityId: string;
  vehicleCategory: string;
  approvalStatus: 'pending' | 'under_review' | 'approved' | 'suspended';
  isActive: boolean;
  rating?: number;
}

export interface ScheduledReservationEntity {
  id: string;
  reference: string;
  businessId?: string;
  merchantUid: string;
  merchantName: string;
  cityId: string;
  cityName: string;
  timezone: string;
  vehicleCategory: string;
  vehicleId?: string;
  driverUid: string;
  assignedDriverName?: string;
  reservationDate: string; // YYYY-MM-DD in city timezone
  startTime: string; // HH:MM in city timezone
  endTime: string; // HH:MM in city timezone
  pickupWindowStart: string; // ISO UTC
  pickupWindowEnd: string; // ISO UTC
  serviceEndAt: string; // ISO UTC (full booked service end)
  durationType: ScheduledDurationType;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress?: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationsSummary?: string;
  cargoRequirements?: string;
  estimatedWeightKg?: number;
  fragile?: boolean;
  quotedPrice: number;
  courierEarnings: number;
  platformCommission: number;
  currency: string;
  pricingRuleVersionId: string;
  quoteId: string;
  pricingBreakdown: QuoteBreakdownItem[];
  paymentMethod: ScheduledPaymentMethod;
  paymentReference?: string;
  reservationStatus: ReservationLifecycleStatus;
  paymentStatus: ReservationPaymentStatus;
  assignmentStatus: ReservationAssignmentStatus;
  executionStatus: ReservationExecutionStatus;
  status: LegacyReservationStatus; // Backward compatible derived field
  holdExpiresAt?: string | null;
  idempotencyKey?: string;
  cancellationFee?: number;
  refundAmount?: number;
  cancellationReason?: string;
  dispatchStartedAt?: string | null;
  escalationReason?: string | null;
  remindersSent: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReservationAuditEvent {
  id: string;
  reservationId: string;
  eventType: string;
  actorUid: string;
  actorRole: 'customer' | 'courier' | 'admin' | 'system';
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ScheduledSlotOption {
  startTime: string;
  endTime: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  serviceEndAt: string;
  bookable: boolean;
  totalCapacity: number;
  bookedCount: number;
  heldCount: number;
  remainingCapacity: number;
  availabilitySource: AvailabilitySource;
  restrictionCode?: string;
  restrictionReasonFr?: string;
  restrictionReasonEn?: string;
}

export interface ScheduledVehicleOption {
  vehicleCategory: string;
  eligible: boolean;
  availableForSelectedSlot: boolean;
  remainingCapacity: number;
  totalCapacity: number;
  availabilitySource: AvailabilitySource;
  estimatedPrice: number | null;
  currency: string;
  incompatibilityCode?: string;
  incompatibilityReasonFr?: string;
  incompatibilityReasonEn?: string;
}

export interface ScheduledDateSummary {
  date: string; // YYYY-MM-DD in city timezone
  isToday: boolean;
  isOpen: boolean;
  isHoliday: boolean;
  bookableSlotsCount: number;
  reasonFr?: string;
  reasonEn?: string;
}

export interface ScheduledQuote {
  id: string;
  cityId: string;
  cityName: string;
  timezone: string;
  vehicleCategory: string;
  durationType: ScheduledDurationType;
  reservationDate: string;
  startTime: string;
  endTime: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  serviceEndAt: string;
  estimatedDistanceKm: number;
  estimatedWeightKg: number;
  fragile: boolean;
  currency: string;
  customerTotal: number;
  courierEarnings: number;
  platformCommission: number;
  pricingRuleVersionId: string;
  breakdown: QuoteBreakdownItem[];
  pickup?: GeoCoordinate;
  createdAt: string;
  expiresAt: string;
  signatureHash: string;
}

export interface AvailabilityQueryInput {
  pickup: GeoCoordinate;
  destination?: GeoCoordinate | null;
  reservationDate?: string;
  durationType?: ScheduledDurationType;
  vehicleCategory?: string;
  estimatedWeightKg?: number;
  fragile?: boolean;
  cities?: CityConfig[];
  fleetSupply?: ScheduledCourierSupply[];
  usePolicyCapacityFallback?: boolean;
  existingReservations?: ScheduledReservationEntity[];
  customRules?: PricingRuleVersion[];
  nowMs?: number;
}

export interface AvailabilityQuerySuccess {
  ok: true;
  city: {
    id: string;
    name: string;
    countryCode: string;
    currency: string;
    timezone: string;
    operatingHours: CityConfig['operatingHours'];
    minLeadTimeMin: number;
    maxBookingHorizonDays: number;
    pickupWindowMinutes: number;
    holdTtlSeconds: number;
    dispatchLeadTimeMin: number;
  };
  availabilitySource: AvailabilitySource;
  selectedDate: string;
  durationType: ScheduledDurationType;
  dates: ScheduledDateSummary[];
  slots: ScheduledSlotOption[];
  vehicles: ScheduledVehicleOption[];
  estimatedDistanceKm: number;
}

export interface ScheduledErrorResult {
  ok: false;
  code: string;
  httpStatus: number;
  messageFr: string;
  messageEn: string;
  details?: Record<string, unknown>;
}

export type AvailabilityQueryResult = AvailabilityQuerySuccess | ScheduledErrorResult;

export interface CancellationPolicyEvaluation {
  allowed: boolean;
  stage: string;
  hoursUntilPickup: number;
  feeAmount: number;
  feePercent: number;
  refundAmount: number;
  currency: string;
  policySummaryFr: string;
  policySummaryEn: string;
  blockReasonCode?: string;
}

// ============================================================================
// CITY TIMEZONE WALL-CLOCK UTILITIES (ZERO DEVICE-TIMEZONE ASSUMPTIONS)
// ============================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeToMinutes(hhmm: string): number | null {
  const m = TIME_RE.exec(hhmm.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getZonedDateParts(epochMs: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0=Sun..6=Sat
  dateStr: string;
  timeStr: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value || '0';
  const year = Number(lookup('year'));
  const month = Number(lookup('month'));
  const day = Number(lookup('day'));
  const hour = Number(lookup('hour')) % 24;
  const minute = Number(lookup('minute'));
  const second = Number(lookup('second'));
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = wdMap[lookup('weekday')] ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, dayOfWeek, dateStr, timeStr };
}

/**
 * Convert a wall-clock date+time in an IANA timezone to exact UTC epoch milliseconds.
 */
export function zonedWallClockToEpochMs(dateStr: string, timeStr: string, timeZone: string): number | null {
  if (!DATE_RE.test(dateStr)) return null;
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;

  // Validate calendar day didn't overflow (e.g., 2026-02-31)
  const checkUtc = new Date(Date.UTC(y, mo - 1, d));
  if (
    checkUtc.getUTCFullYear() !== y ||
    checkUtc.getUTCMonth() + 1 !== mo ||
    checkUtc.getUTCDate() !== d
  ) {
    return null;
  }

  // Iterative convergence to resolve timezone offset accurately (handles DST)
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  for (let i = 0; i < 3; i++) {
    const z = getZonedDateParts(guess, timeZone);
    const actualAsUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second, 0);
    const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
    const diff = targetAsUtc - actualAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function getDayOfWeekForDateStr(dateStr: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function deriveLegacyReservationStatus(entity: {
  reservationStatus: ReservationLifecycleStatus;
  executionStatus: ReservationExecutionStatus;
}): LegacyReservationStatus {
  if (entity.reservationStatus === 'cancelled' || entity.reservationStatus === 'expired') {
    return 'cancelled';
  }
  if (entity.executionStatus === 'completed') return 'completed';
  if (
    entity.executionStatus === 'courier_en_route' ||
    entity.executionStatus === 'pickup_completed' ||
    entity.executionStatus === 'in_transit'
  ) {
    return 'in_progress';
  }
  if (entity.reservationStatus === 'confirmed') return 'confirmed';
  return 'pending_approval';
}

// ============================================================================
// LOCATION, VEHICLE & SCHEDULE VALIDATION
// ============================================================================

export function validateScheduledLocations(params: {
  pickup: GeoCoordinate;
  destination?: GeoCoordinate | null;
  cities?: CityConfig[];
}):
  | { ok: true; city: CityConfig; estimatedDistanceKm: number }
  | ScheduledErrorResult {
  const cities = params.cities || DEFAULT_CITIES;
  if (!isValidCoordinate(params.pickup)) {
    return {
      ok: false,
      code: 'INVALID_PICKUP_COORDINATES',
      httpStatus: 400,
      messageFr: 'Les coordonnées du point de départ sont invalides.',
      messageEn: 'Pickup coordinates are invalid.',
    };
  }

  const pickupCity = resolvePointCity(params.pickup, cities);
  if (!pickupCity) {
    return {
      ok: false,
      code: 'PICKUP_OUTSIDE_SERVICE_AREA',
      httpStatus: 422,
      messageFr: 'Ce point de départ est en dehors des zones urbaines desservies par ROVA.',
      messageEn: 'This pickup location is outside ROVA active service zones.',
      details: {
        supportedCities: cities.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name })),
      },
    };
  }

  if (!pickupCity.isActive) {
    return {
      ok: false,
      code: 'CITY_INACTIVE',
      httpStatus: 422,
      messageFr: `Les réservations planifiées ne sont pas encore actives à ${pickupCity.name}.`,
      messageEn: `Scheduled reservations are not currently active in ${pickupCity.name}.`,
    };
  }

  let estimatedDistanceKm = 8; // default urban zone allowance when no destination pin provided
  if (params.destination) {
    if (!isValidCoordinate(params.destination)) {
      return {
        ok: false,
        code: 'INVALID_DESTINATION_COORDINATES',
        httpStatus: 400,
        messageFr: 'Les coordonnées de destination sont invalides.',
        messageEn: 'Destination coordinates are invalid.',
      };
    }
    const destCity = resolvePointCity(params.destination, cities);
    if (!destCity) {
      return {
        ok: false,
        code: 'DESTINATION_OUTSIDE_SERVICE_AREA',
        httpStatus: 422,
        messageFr: `La destination est en dehors de la zone de couverture de ${pickupCity.name}.`,
        messageEn: `Destination is outside ${pickupCity.name} service coverage.`,
      };
    }
    if (destCity.id !== pickupCity.id) {
      return {
        ok: false,
        code: 'CROSS_CITY_NOT_SUPPORTED',
        httpStatus: 422,
        messageFr: `Les trajets inter-villes (${pickupCity.name} → ${destCity.name}) ne sont pas pris en charge sur cette offre.`,
        messageEn: `Cross-city scheduled bookings (${pickupCity.name} → ${destCity.name}) are not supported.`,
      };
    }
    const straightKm = haversineDistanceKm(params.pickup, params.destination);
    estimatedDistanceKm = Number(Math.max(1.5, straightKm * 1.28).toFixed(2));
    if (estimatedDistanceKm > pickupCity.maxDeliveryDistanceKm) {
      return {
        ok: false,
        code: 'ROUTE_LIMIT_EXCEEDED',
        httpStatus: 422,
        messageFr: `La distance estimée (${estimatedDistanceKm.toFixed(1)} km) dépasse la limite de ${pickupCity.maxDeliveryDistanceKm} km pour ${pickupCity.name}.`,
        messageEn: `Estimated route (${estimatedDistanceKm.toFixed(1)} km) exceeds the ${pickupCity.maxDeliveryDistanceKm} km limit for ${pickupCity.name}.`,
      };
    }
  }

  return { ok: true, city: pickupCity, estimatedDistanceKm };
}

export function checkVehicleCompatibility(params: {
  city: CityConfig;
  vehicleCategory: string;
  estimatedWeightKg?: number;
  cargoRequirements?: string;
}): {
  eligible: boolean;
  code?: string;
  reasonFr?: string;
  reasonEn?: string;
} {
  const { city, vehicleCategory } = params;
  if (!city.allowedVehicles.includes(vehicleCategory)) {
    return {
      eligible: false,
      code: 'VEHICLE_NOT_SUPPORTED_IN_CITY',
      reasonFr: `Non disponible dans la zone de ${city.name}.`,
      reasonEn: `Not supported in ${city.name}.`,
    };
  }
  const spec = VEHICLE_CAPACITY_LIMITS_KG[vehicleCategory];
  if (!spec) {
    return {
      eligible: false,
      code: 'UNKNOWN_VEHICLE_CATEGORY',
      reasonFr: 'Catégorie de véhicule non reconnue.',
      reasonEn: 'Unknown vehicle category.',
    };
  }
  const weight = Number(params.estimatedWeightKg ?? 0);
  if (Number.isFinite(weight) && weight > spec.maxWeightKg) {
    return {
      eligible: false,
      code: 'WEIGHT_EXCEEDS_VEHICLE_CAPACITY',
      reasonFr: `Charge (${weight} kg) supérieure à la capacité max (${spec.maxWeightKg} kg).`,
      reasonEn: `Cargo (${weight} kg) exceeds max capacity (${spec.maxWeightKg} kg).`,
    };
  }
  const notesLower = (params.cargoRequirements || '').toLowerCase();
  if ((notesLower.includes('palette') || notesLower.includes('pallet')) && !spec.supportsPallets) {
    return {
      eligible: false,
      code: 'PALLET_REQUIRES_VAN_OR_TRUCK',
      reasonFr: 'Le transport de palettes requiert un fourgon ou un camion.',
      reasonEn: 'Palletized cargo requires a van or truck.',
    };
  }
  return { eligible: true };
}

export function validateScheduledWindow(params: {
  city: CityConfig;
  reservationDate: string;
  startTime: string;
  endTime: string;
  durationType: ScheduledDurationType;
  nowMs?: number;
}):
  | {
      ok: true;
      startEpochMs: number;
      pickupWindowEndMs: number;
      endEpochMs: number;
      durationMinutes: number;
    }
  | ScheduledErrorResult {
  const nowMs = params.nowMs ?? Date.now();
  const policy = getCitySchedulingPolicy(params.city);

  if (!DATE_RE.test(params.reservationDate)) {
    return {
      ok: false,
      code: 'INVALID_DATE_FORMAT',
      httpStatus: 400,
      messageFr: 'Format de date invalide (attendu AAAA-MM-JJ).',
      messageEn: 'Invalid date format (expected YYYY-MM-DD).',
    };
  }

  const startMin = parseTimeToMinutes(params.startTime);
  const endMin = parseTimeToMinutes(params.endTime);
  if (startMin === null || endMin === null) {
    return {
      ok: false,
      code: 'INVALID_TIME_FORMAT',
      httpStatus: 400,
      messageFr: 'Format d’heure invalide (attendu HH:MM).',
      messageEn: 'Invalid time format (expected HH:MM).',
    };
  }

  if (endMin <= startMin) {
    return {
      ok: false,
      code: 'INVALID_TIME_RANGE',
      httpStatus: 400,
      messageFr: 'L’heure de fin doit être postérieure à l’heure de début.',
      messageEn: 'End time must be after start time.',
    };
  }

  const startEpochMs = zonedWallClockToEpochMs(params.reservationDate, params.startTime, params.city.timezone);
  const endEpochMs = zonedWallClockToEpochMs(params.reservationDate, params.endTime, params.city.timezone);
  if (startEpochMs === null || endEpochMs === null) {
    return {
      ok: false,
      code: 'INVALID_CALENDAR_DATE',
      httpStatus: 400,
      messageFr: 'Cette date calendaire n’existe pas.',
      messageEn: 'This calendar date does not exist.',
    };
  }

  const nowZoned = getZonedDateParts(nowMs, params.city.timezone);
  const maxDateStr = addDaysToDateStr(nowZoned.dateStr, policy.maxBookingHorizonDays);

  if (params.reservationDate < nowZoned.dateStr) {
    return {
      ok: false,
      code: 'DATE_IN_PAST',
      httpStatus: 422,
      messageFr: 'Impossible de planifier un véhicule sur une date passée.',
      messageEn: 'Cannot schedule a vehicle on a past date.',
    };
  }

  if (params.reservationDate > maxDateStr) {
    return {
      ok: false,
      code: 'EXCEEDS_BOOKING_HORIZON',
      httpStatus: 422,
      messageFr: `Les réservations sont ouvertes jusqu’à ${policy.maxBookingHorizonDays} jours à l’avance.`,
      messageEn: `Bookings can be scheduled up to ${policy.maxBookingHorizonDays} days in advance.`,
    };
  }

  if (policy.holidays.includes(params.reservationDate)) {
    return {
      ok: false,
      code: 'CITY_HOLIDAY_CLOSED',
      httpStatus: 422,
      messageFr: `Le service planifié est fermé le ${params.reservationDate} à ${params.city.name} (jour férié).`,
      messageEn: `Scheduled service is closed on ${params.reservationDate} in ${params.city.name} (holiday).`,
    };
  }

  const dow = getDayOfWeekForDateStr(params.reservationDate);
  if (!params.city.operatingHours.days.includes(dow)) {
    return {
      ok: false,
      code: 'OUTSIDE_OPERATING_DAYS',
      httpStatus: 422,
      messageFr: `Le service ROVA n’opère pas ce jour de la semaine à ${params.city.name}.`,
      messageEn: `ROVA does not operate on this day of the week in ${params.city.name}.`,
    };
  }

  const openMin = parseTimeToMinutes(params.city.operatingHours.open) ?? 360;
  const closeMin = parseTimeToMinutes(params.city.operatingHours.close) ?? 1380;
  if (startMin < openMin || endMin > closeMin) {
    return {
      ok: false,
      code: 'OUTSIDE_OPERATING_HOURS',
      httpStatus: 422,
      messageFr: `Créneau hors horaires d’ouverture à ${params.city.name} (${params.city.operatingHours.open}–${params.city.operatingHours.close}).`,
      messageEn: `Selected time is outside ${params.city.name} operating hours (${params.city.operatingHours.open}–${params.city.operatingHours.close}).`,
    };
  }

  const minAllowedStartMs = nowMs + policy.minLeadTimeMin * 60_000;
  if (startEpochMs < nowMs) {
    return {
      ok: false,
      code: 'TIME_IN_PAST',
      httpStatus: 422,
      messageFr: 'Ce créneau horaire est déjà dépassé.',
      messageEn: 'This time slot has already passed.',
    };
  }

  if (startEpochMs < minAllowedStartMs) {
    return {
      ok: false,
      code: 'LEAD_TIME_NOT_MET',
      httpStatus: 422,
      messageFr: `Un délai minimum de ${policy.minLeadTimeMin} minutes avant la prise en charge est requis.`,
      messageEn: `Scheduled bookings require at least ${policy.minLeadTimeMin} minutes lead time.`,
    };
  }

  const durationMinutes = endMin - startMin;
  if (durationMinutes < 60) {
    return {
      ok: false,
      code: 'DURATION_TOO_SHORT',
      httpStatus: 400,
      messageFr: 'La durée minimale d’une réservation est de 1 heure.',
      messageEn: 'Minimum reservation duration is 1 hour.',
    };
  }

  const pickupWindowEndMs = Math.min(endEpochMs, startEpochMs + policy.pickupWindowMinutes * 60_000);
  return {
    ok: true,
    startEpochMs,
    pickupWindowEndMs,
    endEpochMs,
    durationMinutes,
  };
}

// ============================================================================
// REAL AVAILABILITY & CAPACITY ENGINE (NEVER FABRICATES SUPPLY)
// ============================================================================

export function isReservationOccupyingCapacity(
  res: ScheduledReservationEntity,
  nowMs: number
): boolean {
  if (res.reservationStatus === 'cancelled' || res.reservationStatus === 'expired' || res.reservationStatus === 'draft') {
    return false;
  }
  if (res.executionStatus === 'completed' || res.executionStatus === 'cancelled') {
    return false;
  }
  if (res.reservationStatus === 'hold' || res.reservationStatus === 'pending_payment') {
    if (!res.holdExpiresAt) return false;
    return Date.parse(res.holdExpiresAt) > nowMs;
  }
  return res.reservationStatus === 'confirmed';
}

export function intervalsOverlapWithBuffer(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
  bufferMs: number
): boolean {
  return startA < endB + bufferMs && endA + bufferMs > startB;
}

export function resolveVehicleSlotCapacity(params: {
  city: CityConfig;
  vehicleCategory: string;
  fleetSupply?: ScheduledCourierSupply[];
  usePolicyCapacityFallback?: boolean;
}): { totalCapacity: number; source: AvailabilitySource } {
  const { city, vehicleCategory, fleetSupply, usePolicyCapacityFallback } = params;
  if (!city.allowedVehicles.includes(vehicleCategory)) {
    return { totalCapacity: 0, source: 'fleet_live' };
  }

  if (Array.isArray(fleetSupply)) {
    const eligible = fleetSupply.filter(
      (c) =>
        c.cityId === city.id &&
        c.vehicleCategory === vehicleCategory &&
        c.approvalStatus === 'approved' &&
        c.isActive
    );
    if (eligible.length > 0 || !usePolicyCapacityFallback) {
      return { totalCapacity: eligible.length, source: 'fleet_live' };
    }
  }

  if (usePolicyCapacityFallback) {
    const policy = getCitySchedulingPolicy(city);
    return {
      totalCapacity: Math.max(0, policy.capacityPerSlotByVehicle[vehicleCategory] ?? 0),
      source: 'city_capacity_policy',
    };
  }

  return { totalCapacity: 0, source: 'unverified' };
}

export function countSlotOccupancy(params: {
  cityId: string;
  vehicleCategory: string;
  startEpochMs: number;
  endEpochMs: number;
  transitionBufferMin: number;
  existingReservations: ScheduledReservationEntity[];
  excludeReservationId?: string;
  nowMs: number;
}): { bookedCount: number; heldCount: number } {
  const bufferMs = params.transitionBufferMin * 60_000;
  let bookedCount = 0;
  let heldCount = 0;

  for (const res of params.existingReservations) {
    if (params.excludeReservationId && res.id === params.excludeReservationId) continue;
    if (res.cityId !== params.cityId || res.vehicleCategory !== params.vehicleCategory) continue;
    if (!isReservationOccupyingCapacity(res, params.nowMs)) continue;

    const rStart = Date.parse(res.pickupWindowStart);
    const rEnd = Date.parse(res.serviceEndAt || res.pickupWindowEnd);
    if (!Number.isFinite(rStart) || !Number.isFinite(rEnd)) continue;

    if (intervalsOverlapWithBuffer(params.startEpochMs, params.endEpochMs, rStart, rEnd, bufferMs)) {
      if (res.reservationStatus === 'confirmed') bookedCount += 1;
      else heldCount += 1;
    }
  }
  return { bookedCount, heldCount };
}

// ============================================================================
// SERVER-AUTHORITATIVE SCHEDULED PRICING (REUSES pricingEngine.ts)
// ============================================================================

export function generateScheduledQuote(params: {
  city: CityConfig;
  vehicleCategory: string;
  durationType: ScheduledDurationType;
  reservationDate: string;
  startTime: string;
  endTime: string;
  estimatedDistanceKm: number;
  pickup?: GeoCoordinate;
  estimatedWeightKg?: number;
  fragile?: boolean;
  customRules?: PricingRuleVersion[];
  nowMs?: number;
  quoteTtlSeconds?: number;
}): { ok: true; quote: ScheduledQuote } | ScheduledErrorResult {
  const nowMs = params.nowMs ?? Date.now();
  const windowCheck = validateScheduledWindow({
    city: params.city,
    reservationDate: params.reservationDate,
    startTime: params.startTime,
    endTime: params.endTime,
    durationType: params.durationType,
    nowMs,
  });
  if (!windowCheck.ok) return windowCheck;

  const compat = checkVehicleCompatibility({
    city: params.city,
    vehicleCategory: params.vehicleCategory,
    estimatedWeightKg: params.estimatedWeightKg,
  });
  if (!compat.eligible) {
    return {
      ok: false,
      code: compat.code || 'VEHICLE_INCOMPATIBLE',
      httpStatus: 422,
      messageFr: compat.reasonFr || 'Véhicule incompatible.',
      messageEn: compat.reasonEn || 'Vehicle incompatible.',
    };
  }

  const rule = resolvePricingRuleVersion(params.city, params.vehicleCategory, params.customRules);
  const weightKg = Math.max(0.5, Number(params.estimatedWeightKg ?? 5) || 5);
  const fragile = Boolean(params.fragile);
  const distKm = Math.max(1, Number(params.estimatedDistanceKm) || 8);

  const roundMoney = (val: number) =>
    rule.currency === 'XOF' || rule.currency === 'XAF'
      ? Math.round(val / 50) * 50
      : Number(val.toFixed(2));

  const breakdown: QuoteBreakdownItem[] = [];
  let subtotal = 0;

  if (params.durationType === 'full_day') {
    const basePkg = roundMoney(rule.fullDayRate);
    subtotal += basePkg;
    breakdown.push({
      code: 'full_day_package',
      labelFr: 'Forfait journée dédiée (8h · chauffeur + véhicule)',
      labelEn: 'Full-day dedicated package (8h · driver + vehicle)',
      amount: basePkg,
    });
    if (distKm > 45) {
      const extraDist = roundMoney((distKm - 45) * rule.perKmRate);
      subtotal += extraDist;
      breakdown.push({
        code: 'extra_distance',
        labelFr: `Distance additionnelle (+${(distKm - 45).toFixed(1)} km)`,
        labelEn: `Additional distance (+${(distKm - 45).toFixed(1)} km)`,
        amount: extraDist,
      });
    }
  } else if (params.durationType === 'hours') {
    const hoursScale = Math.max(2, Math.min(6, windowCheck.durationMinutes / 60)) / 4;
    const halfDayBase = roundMoney(rule.fullDayRate * 0.55 * hoursScale);
    subtotal += halfDayBase;
    breakdown.push({
      code: 'half_day_package',
      labelFr: `Forfait demi-journée dédiée (${(windowCheck.durationMinutes / 60).toFixed(1).replace(/\.0$/, '')}h)`,
      labelEn: `Half-day dedicated package (${(windowCheck.durationMinutes / 60).toFixed(1).replace(/\.0$/, '')}h)`,
      amount: halfDayBase,
    });
    if (distKm > 25) {
      const extraDist = roundMoney((distKm - 25) * rule.perKmRate);
      subtotal += extraDist;
      breakdown.push({
        code: 'extra_distance',
        labelFr: `Distance additionnelle (+${(distKm - 25).toFixed(1)} km)`,
        labelEn: `Additional distance (+${(distKm - 25).toFixed(1)} km)`,
        amount: extraDist,
      });
    }
  } else {
    const baseFee = roundMoney(rule.baseFee);
    const distCharge = roundMoney(distKm * rule.perKmRate);
    const schedFee = roundMoney(rule.scheduledFee);
    subtotal += baseFee + distCharge + schedFee;
    breakdown.push(
      {
        code: 'base_fee',
        labelFr: 'Prise en charge planifiée',
        labelEn: 'Scheduled dispatch base fee',
        amount: baseFee,
      },
      {
        code: 'distance_fee',
        labelFr: `Distance estimée (${distKm.toFixed(1)} km)`,
        labelEn: `Estimated distance (${distKm.toFixed(1)} km)`,
        amount: distCharge,
      },
      {
        code: 'scheduled_allocation',
        labelFr: 'Réservation de créneau garanti',
        labelEn: 'Guaranteed slot allocation fee',
        amount: schedFee,
      }
    );
  }

  if (weightKg > 25) {
    const heavyFee = roundMoney(rule.cargoSurcharge);
    subtotal += heavyFee;
    breakdown.push({
      code: 'heavy_cargo',
      labelFr: `Manutention charge lourde (${weightKg} kg)`,
      labelEn: `Heavy cargo handling (${weightKg} kg)`,
      amount: heavyFee,
    });
  }

  if (fragile && rule.fragileSurcharge > 0) {
    const fragileFee = roundMoney(rule.fragileSurcharge);
    subtotal += fragileFee;
    breakdown.push({
      code: 'fragile_handling',
      labelFr: 'Protection colis fragile',
      labelEn: 'Fragile cargo care',
      amount: fragileFee,
    });
  }

  // City-local peak hours (07:00-09:30 or 17:00-19:30)
  const startMin = parseTimeToMinutes(params.startTime) ?? 540;
  const isPeak = (startMin >= 420 && startMin <= 570) || (startMin >= 1020 && startMin <= 1170);
  if (isPeak && rule.peakMultiplier > 1 && params.durationType === 'window') {
    const peakCharge = roundMoney(subtotal * (rule.peakMultiplier - 1));
    if (peakCharge > 0) {
      subtotal += peakCharge;
      breakdown.push({
        code: 'peak_hour_demand',
        labelFr: 'Majoration heure de pointe',
        labelEn: 'Peak-hour demand surcharge',
        amount: peakCharge,
      });
    }
  }

  const customerTotal = Math.max(roundMoney(rule.minimumFare), roundMoney(subtotal));
  if (customerTotal > subtotal) {
    breakdown.push({
      code: 'minimum_fare_adjustment',
      labelFr: 'Ajustement tarif minimum',
      labelEn: 'Minimum fare adjustment',
      amount: roundMoney(customerTotal - subtotal),
    });
  }

  const platformCommission = roundMoney(customerTotal * rule.platformCommissionRate);
  const courierEarnings = roundMoney(Math.max(0, customerTotal - platformCommission));
  const ttlSec = Math.max(120, Math.min(1800, params.quoteTtlSeconds ?? 600));
  const quoteId = `sq_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlSec * 1000).toISOString();
  const pickupWindowStart = new Date(windowCheck.startEpochMs).toISOString();
  const pickupWindowEnd = new Date(windowCheck.pickupWindowEndMs).toISOString();
  const serviceEndAt = new Date(windowCheck.endEpochMs).toISOString();

  const quotePickup: GeoCoordinate = params.pickup
    ? { lat: params.pickup.lat, lng: params.pickup.lng }
    : { lat: params.city.center.lat, lng: params.city.center.lng };

  const signatureHash = signQuotePayload({
    id: quoteId,
    cityId: params.city.id,
    pricingRuleVersionId: rule.id,
    vehicleCategory: params.vehicleCategory,
    pickup: quotePickup,
    stops: [],
    customerTotal,
    courierEarnings,
    platformCommission,
    currency: rule.currency,
    expiresAt,
  });

  return {
    ok: true,
    quote: {
      id: quoteId,
      cityId: params.city.id,
      cityName: params.city.name,
      timezone: params.city.timezone,
      vehicleCategory: params.vehicleCategory,
      durationType: params.durationType,
      reservationDate: params.reservationDate,
      startTime: params.startTime,
      endTime: params.endTime,
      pickupWindowStart,
      pickupWindowEnd,
      serviceEndAt,
      estimatedDistanceKm: distKm,
      estimatedWeightKg: weightKg,
      fragile,
      currency: rule.currency,
      customerTotal,
      courierEarnings,
      platformCommission,
      pricingRuleVersionId: rule.id,
      breakdown,
      pickup: quotePickup,
      createdAt,
      expiresAt,
      signatureHash,
    },
  };
}

export function verifyScheduledQuoteSignature(quote: ScheduledQuote): boolean {
  const expected = signQuotePayload({
    id: quote.id,
    cityId: quote.cityId,
    pricingRuleVersionId: quote.pricingRuleVersionId,
    vehicleCategory: quote.vehicleCategory,
    pickup: quote.pickup ?? { lat: 0, lng: 0 },
    stops: [],
    customerTotal: quote.customerTotal,
    courierEarnings: quote.courierEarnings,
    platformCommission: quote.platformCommission,
    currency: quote.currency,
    expiresAt: quote.expiresAt,
  });
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(quote.signatureHash || '', 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============================================================================
// AVAILABILITY QUERY EVALUATOR (DATES + SLOTS + VEHICLES)
// ============================================================================

export function computeScheduledAvailability(input: AvailabilityQueryInput): AvailabilityQueryResult {
  const nowMs = input.nowMs ?? Date.now();
  const loc = validateScheduledLocations({
    pickup: input.pickup,
    destination: input.destination,
    cities: input.cities,
  });
  if (!loc.ok) return loc;

  const { city, estimatedDistanceKm } = loc;
  const policy = getCitySchedulingPolicy(city);
  const durationType: ScheduledDurationType = input.durationType || 'hours';
  const durationMin = DURATION_MINUTES_BY_PACKAGE[durationType];
  const existing = input.existingReservations || [];
  const nowZoned = getZonedDateParts(nowMs, city.timezone);

  const openMin = parseTimeToMinutes(city.operatingHours.open) ?? 360;
  const closeMin = parseTimeToMinutes(city.operatingHours.close) ?? 1380;
  const stepMin = Math.max(30, policy.slotIntervalMin);

  const buildSlotsForDate = (dateStr: string, vehicleCat: string): ScheduledSlotOption[] => {
    const cap = resolveVehicleSlotCapacity({
      city,
      vehicleCategory: vehicleCat,
      fleetSupply: input.fleetSupply,
      usePolicyCapacityFallback: input.usePolicyCapacityFallback,
    });
    const slots: ScheduledSlotOption[] = [];
    for (let sMin = openMin; sMin + durationMin <= closeMin; sMin += stepMin) {
      const startTime = formatMinutesToHHMM(sMin);
      const endTime = formatMinutesToHHMM(sMin + durationMin);
      const check = validateScheduledWindow({
        city,
        reservationDate: dateStr,
        startTime,
        endTime,
        durationType,
        nowMs,
      });

      const startMs = zonedWallClockToEpochMs(dateStr, startTime, city.timezone) ?? nowMs;
      const endMs = zonedWallClockToEpochMs(dateStr, endTime, city.timezone) ?? nowMs + durationMin * 60_000;
      const pickupEndMs = Math.min(endMs, startMs + policy.pickupWindowMinutes * 60_000);

      if (!check.ok) {
        slots.push({
          startTime,
          endTime,
          pickupWindowStart: new Date(startMs).toISOString(),
          pickupWindowEnd: new Date(pickupEndMs).toISOString(),
          serviceEndAt: new Date(endMs).toISOString(),
          bookable: false,
          totalCapacity: cap.totalCapacity,
          bookedCount: 0,
          heldCount: 0,
          remainingCapacity: 0,
          availabilitySource: cap.source,
          restrictionCode: check.code,
          restrictionReasonFr: check.messageFr,
          restrictionReasonEn: check.messageEn,
        });
        continue;
      }

      const occ = countSlotOccupancy({
        cityId: city.id,
        vehicleCategory: vehicleCat,
        startEpochMs: check.startEpochMs,
        endEpochMs: check.endEpochMs,
        transitionBufferMin: policy.transitionBufferMin,
        existingReservations: existing,
        nowMs,
      });
      const remaining = Math.max(0, cap.totalCapacity - occ.bookedCount - occ.heldCount);
      const bookable = remaining > 0;
      slots.push({
        startTime,
        endTime,
        pickupWindowStart: new Date(check.startEpochMs).toISOString(),
        pickupWindowEnd: new Date(check.pickupWindowEndMs).toISOString(),
        serviceEndAt: new Date(check.endEpochMs).toISOString(),
        bookable,
        totalCapacity: cap.totalCapacity,
        bookedCount: occ.bookedCount,
        heldCount: occ.heldCount,
        remainingCapacity: remaining,
        availabilitySource: cap.source,
        ...(bookable
          ? {}
          : {
              restrictionCode: cap.totalCapacity === 0 ? 'NO_SUPPLY_IN_CITY' : 'SLOT_FULL',
              restrictionReasonFr:
                cap.totalCapacity === 0
                  ? 'Aucun véhicule actif disponible pour cette catégorie dans cette ville.'
                  : 'Créneau complet pour cette catégorie de véhicule.',
              restrictionReasonEn:
                cap.totalCapacity === 0
                  ? 'No active vehicles available for this category in this city.'
                  : 'Time slot is fully booked for this vehicle category.',
            }),
      });
    }
    return slots;
  };

  const targetVehicle =
    input.vehicleCategory && city.allowedVehicles.includes(input.vehicleCategory)
      ? input.vehicleCategory
      : city.allowedVehicles.includes('cargo_van')
      ? 'cargo_van'
      : city.allowedVehicles[0] || 'motorcycle';

  // Generate 14-day rolling calendar preview (within booking horizon)
  const previewDays = Math.min(14, policy.maxBookingHorizonDays + 1);
  const dates: ScheduledDateSummary[] = [];
  for (let offset = 0; offset < previewDays; offset++) {
    const dStr = addDaysToDateStr(nowZoned.dateStr, offset);
    const isHoliday = policy.holidays.includes(dStr);
    const dow = getDayOfWeekForDateStr(dStr);
    const isOpen = !isHoliday && city.operatingHours.days.includes(dow);
    const daySlots = isOpen ? buildSlotsForDate(dStr, targetVehicle) : [];
    const bookableSlotsCount = daySlots.filter((s) => s.bookable).length;
    dates.push({
      date: dStr,
      isToday: offset === 0,
      isOpen,
      isHoliday,
      bookableSlotsCount,
      ...(isHoliday
        ? { reasonFr: 'Jour férié', reasonEn: 'Holiday' }
        : !isOpen
        ? { reasonFr: 'Fermé ce jour', reasonEn: 'Closed' }
        : {}),
    });
  }

  let selectedDate = input.reservationDate && DATE_RE.test(input.reservationDate)
    ? input.reservationDate
    : dates.find((d) => d.bookableSlotsCount > 0)?.date || addDaysToDateStr(nowZoned.dateStr, 1);

  if (selectedDate < nowZoned.dateStr) {
    selectedDate = dates.find((d) => d.bookableSlotsCount > 0)?.date || nowZoned.dateStr;
  }

  const slots = buildSlotsForDate(selectedDate, targetVehicle);
  const referenceSlot = slots.find((s) => s.bookable) || slots[0];
  const allVehicleCategories = Object.keys(VEHICLE_CAPACITY_LIMITS_KG);

  let overallSource: AvailabilitySource = 'unverified';
  const vehicles: ScheduledVehicleOption[] = allVehicleCategories.map((cat) => {
    const compat = checkVehicleCompatibility({
      city,
      vehicleCategory: cat,
      estimatedWeightKg: input.estimatedWeightKg,
    });
    const cap = resolveVehicleSlotCapacity({
      city,
      vehicleCategory: cat,
      fleetSupply: input.fleetSupply,
      usePolicyCapacityFallback: input.usePolicyCapacityFallback,
    });
    if (cap.source === 'fleet_live') overallSource = 'fleet_live';
    else if (overallSource !== 'fleet_live' && cap.source === 'city_capacity_policy') {
      overallSource = 'city_capacity_policy';
    }

    let remaining = cap.totalCapacity;
    let availableForSelectedSlot = false;
    let estimatedPrice: number | null = null;

    if (compat.eligible && referenceSlot) {
      const occ = countSlotOccupancy({
        cityId: city.id,
        vehicleCategory: cat,
        startEpochMs: Date.parse(referenceSlot.pickupWindowStart),
        endEpochMs: Date.parse(referenceSlot.serviceEndAt),
        transitionBufferMin: policy.transitionBufferMin,
        existingReservations: existing,
        nowMs,
      });
      remaining = Math.max(0, cap.totalCapacity - occ.bookedCount - occ.heldCount);
      availableForSelectedSlot = remaining > 0;

      const quoteRes = generateScheduledQuote({
        city,
        vehicleCategory: cat,
        durationType,
        reservationDate: selectedDate,
        startTime: referenceSlot.startTime,
        endTime: referenceSlot.endTime,
        estimatedDistanceKm,
        estimatedWeightKg: input.estimatedWeightKg,
        fragile: input.fragile,
        customRules: input.customRules,
        nowMs,
      });
      if (quoteRes.ok) {
        estimatedPrice = quoteRes.quote.customerTotal;
      }
    }

    // Fallback indicative price from city rule when reference slot is outside lead time
    if (estimatedPrice === null && compat.eligible) {
      const rule = resolvePricingRuleVersion(city, cat, input.customRules);
      if (durationType === 'full_day') estimatedPrice = rule.fullDayRate;
      else if (durationType === 'hours') estimatedPrice = Math.round(rule.fullDayRate * 0.55);
      else estimatedPrice = Math.max(rule.minimumFare, Math.round(rule.baseFee + rule.scheduledFee + rule.perKmRate * estimatedDistanceKm));
    }

    return {
      vehicleCategory: cat,
      eligible: compat.eligible,
      availableForSelectedSlot: compat.eligible && availableForSelectedSlot,
      remainingCapacity: compat.eligible ? remaining : 0,
      totalCapacity: compat.eligible ? cap.totalCapacity : 0,
      availabilitySource: cap.source,
      estimatedPrice,
      currency: city.currency,
      ...(compat.eligible
        ? remaining === 0
          ? {
              incompatibilityCode: cap.totalCapacity === 0 ? 'NO_SUPPLY_IN_CITY' : 'NO_SLOTS_AVAILABLE',
              incompatibilityReasonFr:
                cap.totalCapacity === 0
                  ? 'Aucun véhicule disponible dans cette ville.'
                  : 'Complet sur le créneau sélectionné.',
              incompatibilityReasonEn:
                cap.totalCapacity === 0
                  ? 'No active vehicles available in this city.'
                  : 'Fully booked for the selected slot.',
            }
          : {}
        : {
            incompatibilityCode: compat.code,
            incompatibilityReasonFr: compat.reasonFr,
            incompatibilityReasonEn: compat.reasonEn,
          }),
    };
  });

  return {
    ok: true,
    city: {
      id: city.id,
      name: city.name,
      countryCode: city.countryCode,
      currency: city.currency,
      timezone: city.timezone,
      operatingHours: city.operatingHours,
      minLeadTimeMin: policy.minLeadTimeMin,
      maxBookingHorizonDays: policy.maxBookingHorizonDays,
      pickupWindowMinutes: policy.pickupWindowMinutes,
      holdTtlSeconds: policy.holdTtlSeconds,
      dispatchLeadTimeMin: policy.dispatchLeadTimeMin,
    },
    availabilitySource: overallSource,
    selectedDate,
    durationType,
    dates,
    slots,
    vehicles,
    estimatedDistanceKm,
  };
}

// ============================================================================
// CANCELLATION POLICY EVALUATOR
// ============================================================================

export function evaluateReservationCancellationPolicy(
  reservation: ScheduledReservationEntity,
  city: CityConfig,
  nowMs = Date.now()
): CancellationPolicyEvaluation {
  const policy = getCitySchedulingPolicy(city).cancellationPolicy;
  const pickupMs = Date.parse(reservation.pickupWindowStart);
  const hoursUntilPickup = Number(((pickupMs - nowMs) / 3_600_000).toFixed(2));
  const roundMoney = (val: number) =>
    reservation.currency === 'XOF' || reservation.currency === 'XAF'
      ? Math.round(val / 50) * 50
      : Number(val.toFixed(2));

  if (reservation.reservationStatus === 'cancelled' || reservation.reservationStatus === 'expired') {
    return {
      allowed: false,
      stage: reservation.reservationStatus,
      hoursUntilPickup,
      feeAmount: 0,
      feePercent: 0,
      refundAmount: 0,
      currency: reservation.currency,
      policySummaryFr: 'Cette réservation est déjà annulée ou expirée.',
      policySummaryEn: 'This reservation is already cancelled or expired.',
      blockReasonCode: 'ALREADY_TERMINAL',
    };
  }

  if (
    reservation.executionStatus === 'pickup_completed' ||
    reservation.executionStatus === 'in_transit' ||
    reservation.executionStatus === 'completed'
  ) {
    return {
      allowed: false,
      stage: reservation.executionStatus,
      hoursUntilPickup,
      feeAmount: reservation.quotedPrice,
      feePercent: 100,
      refundAmount: 0,
      currency: reservation.currency,
      policySummaryFr: 'Impossible d’annuler après la prise en charge du chargement. Contactez les opérations ROVA.',
      policySummaryEn: 'Cancellation is not allowed once cargo has been picked up. Contact ROVA operations.',
      blockReasonCode: 'CANCELLATION_NOT_ALLOWED_STAGE',
    };
  }

  const paidAmount =
    reservation.paymentStatus === 'paid' || reservation.paymentStatus === 'authorized'
      ? reservation.quotedPrice
      : 0;

  // Free cancellation for temporary holds or pending payment
  if (reservation.reservationStatus === 'hold' || reservation.reservationStatus === 'pending_payment') {
    return {
      allowed: true,
      stage: reservation.reservationStatus,
      hoursUntilPickup,
      feeAmount: 0,
      feePercent: 0,
      refundAmount: paidAmount,
      currency: reservation.currency,
      policySummaryFr: 'Annulation gratuite : le créneau temporaire sera libéré immédiatement.',
      policySummaryEn: 'Free cancellation: your temporary slot hold will be released immediately.',
    };
  }

  if (reservation.executionStatus === 'courier_en_route') {
    const fee = roundMoney((reservation.quotedPrice * policy.enRouteCancelFeePercent) / 100);
    return {
      allowed: true,
      stage: 'courier_en_route',
      hoursUntilPickup,
      feeAmount: fee,
      feePercent: policy.enRouteCancelFeePercent,
      refundAmount: Math.max(0, roundMoney(paidAmount - fee)),
      currency: reservation.currency,
      policySummaryFr: `Le chauffeur est déjà en route : frais d’annulation de ${policy.enRouteCancelFeePercent}%.`,
      policySummaryEn: `Courier is already en route: ${policy.enRouteCancelFeePercent}% cancellation fee applies.`,
    };
  }

  if (reservation.assignmentStatus === 'assigned') {
    const fee = roundMoney((reservation.quotedPrice * policy.assignedCancelFeePercent) / 100);
    return {
      allowed: true,
      stage: 'courier_assigned',
      hoursUntilPickup,
      feeAmount: fee,
      feePercent: policy.assignedCancelFeePercent,
      refundAmount: Math.max(0, roundMoney(paidAmount - fee)),
      currency: reservation.currency,
      policySummaryFr: `Un chauffeur est déjà assigné : frais d’annulation de ${policy.assignedCancelFeePercent}%.`,
      policySummaryEn: `A courier is already assigned: ${policy.assignedCancelFeePercent}% cancellation fee applies.`,
    };
  }

  if (hoursUntilPickup >= policy.freeCancelHoursBeforePickup) {
    return {
      allowed: true,
      stage: 'confirmed_free_window',
      hoursUntilPickup,
      feeAmount: 0,
      feePercent: 0,
      refundAmount: paidAmount,
      currency: reservation.currency,
      policySummaryFr: `Annulation gratuite (plus de ${policy.freeCancelHoursBeforePickup}h avant la prise en charge).`,
      policySummaryEn: `Free cancellation (more than ${policy.freeCancelHoursBeforePickup}h before pickup).`,
    };
  }

  const fee = roundMoney((reservation.quotedPrice * policy.lateCancelFeePercent) / 100);
  return {
    allowed: true,
    stage: 'confirmed_late_window',
    hoursUntilPickup,
    feeAmount: fee,
    feePercent: policy.lateCancelFeePercent,
    refundAmount: Math.max(0, roundMoney(paidAmount - fee)),
    currency: reservation.currency,
    policySummaryFr: `Annulation à moins de ${policy.freeCancelHoursBeforePickup}h : frais de ${policy.lateCancelFeePercent}%.`,
    policySummaryEn: `Cancellation within ${policy.freeCancelHoursBeforePickup}h of pickup: ${policy.lateCancelFeePercent}% fee applies.`,
  };
}

// ============================================================================
// COURIER CONFLICT CHECKING (DURATION + TRAVEL/TURNAROUND BUFFER)
// ============================================================================

export function checkCourierScheduleConflict(params: {
  courierUid: string;
  targetStartMs: number;
  targetEndMs: number;
  transitionBufferMin: number;
  existingReservations: ScheduledReservationEntity[];
  excludeReservationId?: string;
  nowMs?: number;
}): { conflict: false } | { conflict: true; conflictingReservation: ScheduledReservationEntity } {
  const nowMs = params.nowMs ?? Date.now();
  const bufferMs = params.transitionBufferMin * 60_000;

  for (const res of params.existingReservations) {
    if (params.excludeReservationId && res.id === params.excludeReservationId) continue;
    if (res.driverUid !== params.courierUid) continue;
    if (!isReservationOccupyingCapacity(res, nowMs)) continue;

    const rStart = Date.parse(res.pickupWindowStart);
    const rEnd = Date.parse(res.serviceEndAt || res.pickupWindowEnd);
    if (!Number.isFinite(rStart) || !Number.isFinite(rEnd)) continue;

    if (intervalsOverlapWithBuffer(params.targetStartMs, params.targetEndMs, rStart, rEnd, bufferMs)) {
      return { conflict: true, conflictingReservation: res };
    }
  }
  return { conflict: false };
}

// ============================================================================
// PAYMENT VERIFICATION & WEBHOOK SIGNATURE SECURITY
// ============================================================================

export interface PaymentVerificationContext {
  paymentMethod: ScheduledPaymentMethod;
  walletBalance?: number | null;
  businessVerified?: boolean;
  providerVerifiedReference?: string | null;
  paymentProviderConfigured?: {
    mobile_money?: boolean;
    card?: boolean;
  };
}

export interface PaymentVerificationOutcome {
  ok: boolean;
  paymentStatus: ReservationPaymentStatus;
  reservationConfirmed: boolean;
  actionRequired?: 'provider_setup_required' | 'redirect_checkout' | 'top_up_wallet' | 'verify_business';
  code?: string;
  messageFr: string;
  messageEn: string;
}

export function verifyScheduledPaymentServerSide(
  amount: number,
  currency: string,
  ctx: PaymentVerificationContext
): PaymentVerificationOutcome {
  if (ctx.paymentMethod === 'wallet') {
    if (typeof ctx.walletBalance === 'number' && ctx.walletBalance < amount) {
      return {
        ok: false,
        paymentStatus: 'failed',
        reservationConfirmed: false,
        actionRequired: 'top_up_wallet',
        code: 'INSUFFICIENT_WALLET_BALANCE',
        messageFr: `Solde Business Wallet insuffisant (${ctx.walletBalance} ${currency} disponibles pour ${amount} ${currency}).`,
        messageEn: `Insufficient Business Wallet balance (${ctx.walletBalance} ${currency} available for ${amount} ${currency}).`,
      };
    }
    return {
      ok: true,
      paymentStatus: 'paid',
      reservationConfirmed: true,
      messageFr: 'Paiement réglé via ROVA Business Wallet.',
      messageEn: 'Paid via ROVA Business Wallet.',
    };
  }

  if (ctx.paymentMethod === 'invoice') {
    if (ctx.businessVerified === false) {
      return {
        ok: false,
        paymentStatus: 'failed',
        reservationConfirmed: false,
        actionRequired: 'verify_business',
        code: 'INVOICE_REQUIRES_VERIFIED_BUSINESS',
        messageFr: 'La facturation mensuelle (Corporate Invoice) nécessite un compte entreprise vérifié.',
        messageEn: 'Corporate Monthly Invoicing requires a verified business account.',
      };
    }
    return {
      ok: true,
      paymentStatus: 'invoiced',
      reservationConfirmed: true,
      messageFr: 'Réservation confirmée sur facturation mensuelle entreprise.',
      messageEn: 'Reservation confirmed on Corporate Monthly Invoicing.',
    };
  }

  const isMomoConfigured =
    ctx.paymentProviderConfigured?.mobile_money ??
    Boolean(process.env.MOMO_API_KEY || process.env.PAYSTACK_SECRET_KEY);
  const isCardConfigured =
    ctx.paymentProviderConfigured?.card ??
    Boolean(process.env.STRIPE_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY);

  const configured = ctx.paymentMethod === 'mobile_money' ? isMomoConfigured : isCardConfigured;

  // If a server-verified provider reference is present (e.g., from verified webhook), accept as paid
  if (configured && ctx.providerVerifiedReference) {
    return {
      ok: true,
      paymentStatus: 'paid',
      reservationConfirmed: true,
      messageFr: 'Paiement vérifié auprès du prestataire.',
      messageEn: 'Payment verified with payment provider.',
    };
  }

  if (!configured) {
    // HONESTY RULE: Never fake card / mobile money payment approval when gateway secrets are unconfigured
    return {
      ok: true,
      paymentStatus: 'pending',
      reservationConfirmed: false,
      actionRequired: 'provider_setup_required',
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      messageFr:
        'Votre créneau est réservé temporairement en attente de paiement : la passerelle Mobile Money / Carte n’est pas encore configurée sur ce serveur. Vous pouvez régler par Business Wallet ou Corporate Invoice.',
      messageEn:
        'Your slot is temporarily held awaiting payment: Mobile Money / Card gateway credentials are not yet configured on this server. You may settle with Business Wallet or Corporate Invoice.',
    };
  }

  return {
    ok: true,
    paymentStatus: 'pending',
    reservationConfirmed: false,
    actionRequired: 'redirect_checkout',
    code: 'AWAITING_PROVIDER_PAYMENT',
    messageFr: 'Créneau bloqué en attente de validation du paiement par votre prestataire.',
    messageEn: 'Slot held awaiting payment confirmation from your payment provider.',
  };
}

export function verifyWebhookHmacSignature(
  rawBody: string,
  signatureHex: string,
  secret: string
): boolean {
  if (!secret || !signatureHex) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex.trim().toLowerCase(), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============================================================================
// ATOMIC RESERVATION COORDINATOR (CONCURRENCY-SAFE HOLDS, CONFIRM, DISPATCH)
// ============================================================================

export interface CreateHoldInput {
  businessId?: string;
  merchantUid: string;
  merchantName: string;
  pickup: GeoCoordinate;
  pickupAddress: string;
  destination?: GeoCoordinate | null;
  destinationAddress?: string;
  destinationsSummary?: string;
  vehicleCategory: string;
  durationType: ScheduledDurationType;
  reservationDate: string;
  startTime: string;
  endTime: string;
  estimatedWeightKg?: number;
  fragile?: boolean;
  cargoRequirements?: string;
  paymentMethod: ScheduledPaymentMethod;
  idempotencyKey?: string;
  expectedPrice?: number;
  nowMs?: number;
}

export interface ScheduledReconciliationReport {
  runAt: string;
  expiredHoldsCount: number;
  dispatchStartedCount: number;
  remindersSentCount: number;
  escalatedUnassignedCount: number;
  delayedPickupsFlaggedCount: number;
  events: Array<{
    reservationId: string;
    eventType: string;
    summary: string;
    timestamp: string;
  }>;
}

export class AtomicReservationCoordinator {
  private reservations = new Map<string, ScheduledReservationEntity>();
  private idempotencyIndex = new Map<string, string>(); // key -> reservationId
  private processedWebhooks = new Set<string>();
  private auditEvents: ReservationAuditEvent[] = [];
  private locks = new Map<string, Promise<unknown>>();
  private cities: CityConfig[];
  private fleetSupply: ScheduledCourierSupply[];
  private usePolicyCapacityFallback: boolean;
  private customRules?: PricingRuleVersion[];
  private notificationEngine?: EventNotificationEngine;

  constructor(options?: {
    cities?: CityConfig[];
    fleetSupply?: ScheduledCourierSupply[];
    usePolicyCapacityFallback?: boolean;
    customRules?: PricingRuleVersion[];
    notificationEngine?: EventNotificationEngine;
  }) {
    this.cities = options?.cities || DEFAULT_CITIES;
    this.fleetSupply = options?.fleetSupply || [];
    this.usePolicyCapacityFallback = options?.usePolicyCapacityFallback ?? true;
    this.customRules = options?.customRules;
    this.notificationEngine = options?.notificationEngine;
  }

  public setFleetSupply(supply: ScheduledCourierSupply[]): void {
    this.fleetSupply = supply;
  }

  public setUsePolicyCapacityFallback(flag: boolean): void {
    this.usePolicyCapacityFallback = flag;
  }

  public upsertReservation(entity: ScheduledReservationEntity): void {
    this.reservations.set(entity.id, entity);
    if (entity.idempotencyKey) {
      this.idempotencyIndex.set(`${entity.merchantUid}:${entity.idempotencyKey}`, entity.id);
    }
  }

  public getReservation(id: string): ScheduledReservationEntity | undefined {
    return this.reservations.get(id);
  }

  public listReservations(): ScheduledReservationEntity[] {
    return Array.from(this.reservations.values()).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }

  public getAuditEvents(reservationId?: string): ReservationAuditEvent[] {
    if (!reservationId) return [...this.auditEvents];
    return this.auditEvents.filter((e) => e.reservationId === reservationId);
  }

  private recordAudit(
    reservationId: string,
    eventType: string,
    actorUid: string,
    actorRole: ReservationAuditEvent['actorRole'],
    summary: string,
    metadata?: Record<string, unknown>,
    nowMs = Date.now()
  ): void {
    this.auditEvents.push({
      id: `rev_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
      reservationId,
      eventType,
      actorUid,
      actorRole,
      summary,
      metadata,
      createdAt: new Date(nowMs).toISOString(),
    });
    if (this.auditEvents.length > 2000) {
      this.auditEvents.splice(0, this.auditEvents.length - 2000);
    }
  }

  private async runWithLock<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(lockKey) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.locks.set(lockKey, chained);
    await prev;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(lockKey) === chained) {
        this.locks.delete(lockKey);
      }
    }
  }

  /**
   * Atomically validates location, time, vehicle compatibility, real slot capacity,
   * computes authoritative server quote, and creates a temporary capacity hold.
   */
  public async createHold(
    input: CreateHoldInput
  ): Promise<
    | { ok: true; reservation: ScheduledReservationEntity; quote: ScheduledQuote; deduplicated: boolean }
    | ScheduledErrorResult
  > {
    const nowMs = input.nowMs ?? Date.now();

    if (input.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(`${input.merchantUid}:${input.idempotencyKey}`);
      if (existingId) {
        const existing = this.reservations.get(existingId);
        if (existing) {
          const city = getCityById(existing.cityId, this.cities) || this.cities[0];
          const quoteRes = generateScheduledQuote({
            city,
            vehicleCategory: existing.vehicleCategory,
            durationType: existing.durationType,
            reservationDate: existing.reservationDate,
            startTime: existing.startTime,
            endTime: existing.endTime,
            estimatedDistanceKm: 8,
            estimatedWeightKg: existing.estimatedWeightKg,
            fragile: existing.fragile,
            customRules: this.customRules,
            nowMs,
          });
          if (quoteRes.ok) {
            return { ok: true, reservation: existing, quote: quoteRes.quote, deduplicated: true };
          }
        }
      }
    }

    const loc = validateScheduledLocations({
      pickup: input.pickup,
      destination: input.destination,
      cities: this.cities,
    });
    if (!loc.ok) return loc;

    const compat = checkVehicleCompatibility({
      city: loc.city,
      vehicleCategory: input.vehicleCategory,
      estimatedWeightKg: input.estimatedWeightKg,
      cargoRequirements: input.cargoRequirements,
    });
    if (!compat.eligible) {
      return {
        ok: false,
        code: compat.code || 'VEHICLE_INCOMPATIBLE',
        httpStatus: 422,
        messageFr: compat.reasonFr || 'Véhicule non compatible avec ce chargement.',
        messageEn: compat.reasonEn || 'Vehicle is not compatible with this cargo.',
      };
    }

    const windowCheck = validateScheduledWindow({
      city: loc.city,
      reservationDate: input.reservationDate,
      startTime: input.startTime,
      endTime: input.endTime,
      durationType: input.durationType,
      nowMs,
    });
    if (!windowCheck.ok) return windowCheck;

    const lockKey = `slot:${loc.city.id}:${input.vehicleCategory}:${input.reservationDate}`;
    return this.runWithLock(lockKey, async () => {
      // Re-check idempotency inside lock
      if (input.idempotencyKey) {
        const existingId = this.idempotencyIndex.get(`${input.merchantUid}:${input.idempotencyKey}`);
        if (existingId) {
          const existing = this.reservations.get(existingId);
          if (existing) {
            const quoteRes = generateScheduledQuote({
              city: loc.city,
              vehicleCategory: existing.vehicleCategory,
              durationType: existing.durationType,
              reservationDate: existing.reservationDate,
              startTime: existing.startTime,
              endTime: existing.endTime,
              estimatedDistanceKm: loc.estimatedDistanceKm,
              estimatedWeightKg: existing.estimatedWeightKg,
              fragile: existing.fragile,
              customRules: this.customRules,
              nowMs,
            });
            if (quoteRes.ok) {
              return { ok: true, reservation: existing, quote: quoteRes.quote, deduplicated: true };
            }
          }
        }
      }

      const policy = getCitySchedulingPolicy(loc.city);
      const cap = resolveVehicleSlotCapacity({
        city: loc.city,
        vehicleCategory: input.vehicleCategory,
        fleetSupply: this.fleetSupply,
        usePolicyCapacityFallback: this.usePolicyCapacityFallback,
      });

      const occ = countSlotOccupancy({
        cityId: loc.city.id,
        vehicleCategory: input.vehicleCategory,
        startEpochMs: windowCheck.startEpochMs,
        endEpochMs: windowCheck.endEpochMs,
        transitionBufferMin: policy.transitionBufferMin,
        existingReservations: this.listReservations(),
        nowMs,
      });

      const remaining = cap.totalCapacity - occ.bookedCount - occ.heldCount;
      if (remaining <= 0) {
        // Compute nearby bookable alternatives
        const avail = computeScheduledAvailability({
          pickup: input.pickup,
          destination: input.destination,
          reservationDate: input.reservationDate,
          durationType: input.durationType,
          vehicleCategory: input.vehicleCategory,
          estimatedWeightKg: input.estimatedWeightKg,
          cities: this.cities,
          fleetSupply: this.fleetSupply,
          usePolicyCapacityFallback: this.usePolicyCapacityFallback,
          existingReservations: this.listReservations(),
          customRules: this.customRules,
          nowMs,
        });
        const alternatives = avail.ok
          ? avail.slots.filter((s) => s.bookable).slice(0, 3).map((s) => `${s.startTime}–${s.endTime}`)
          : [];
        return {
          ok: false,
          code: 'SLOT_UNAVAILABLE',
          httpStatus: 409,
          messageFr: 'Ce créneau vient d’être réservé et n’est plus disponible. Choisissez un autre horaire.',
          messageEn: 'This slot is no longer available. Please choose another time window.',
          details: { alternatives, remainingCapacity: 0 },
        };
      }

      const quoteRes = generateScheduledQuote({
        city: loc.city,
        vehicleCategory: input.vehicleCategory,
        durationType: input.durationType,
        reservationDate: input.reservationDate,
        startTime: input.startTime,
        endTime: input.endTime,
        estimatedDistanceKm: loc.estimatedDistanceKm,
        estimatedWeightKg: input.estimatedWeightKg,
        fragile: input.fragile,
        customRules: this.customRules,
        nowMs,
        quoteTtlSeconds: policy.holdTtlSeconds,
      });
      if (!quoteRes.ok) return quoteRes;

      if (
        typeof input.expectedPrice === 'number' &&
        Number.isFinite(input.expectedPrice) &&
        Math.abs(input.expectedPrice - quoteRes.quote.customerTotal) > 0.01
      ) {
        return {
          ok: false,
          code: 'PRICE_CHANGED',
          httpStatus: 409,
          messageFr: `Le tarif a été actualisé à ${quoteRes.quote.customerTotal} ${quoteRes.quote.currency}. Veuillez confirmer le nouveau montant.`,
          messageEn: `Pricing updated to ${quoteRes.quote.customerTotal} ${quoteRes.quote.currency}. Please review and accept the updated quote.`,
          details: {
            expectedPrice: input.expectedPrice,
            updatedQuote: quoteRes.quote,
          },
        };
      }

      const id = `res_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
      const reference = `RV-SCH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const nowIso = new Date(nowMs).toISOString();
      const holdExpiresAt = new Date(nowMs + policy.holdTtlSeconds * 1000).toISOString();

      const entity: ScheduledReservationEntity = {
        id,
        reference,
        businessId: input.businessId,
        merchantUid: input.merchantUid,
        merchantName: input.merchantName.slice(0, 160),
        cityId: loc.city.id,
        cityName: loc.city.name,
        timezone: loc.city.timezone,
        vehicleCategory: input.vehicleCategory,
        driverUid: '',
        reservationDate: input.reservationDate,
        startTime: input.startTime,
        endTime: input.endTime,
        pickupWindowStart: quoteRes.quote.pickupWindowStart,
        pickupWindowEnd: quoteRes.quote.pickupWindowEnd,
        serviceEndAt: quoteRes.quote.serviceEndAt,
        durationType: input.durationType,
        pickupAddress: input.pickupAddress.trim().slice(0, 300),
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        destinationAddress: input.destinationAddress?.trim().slice(0, 300) || undefined,
        destinationLat: input.destination?.lat,
        destinationLng: input.destination?.lng,
        destinationsSummary: input.destinationsSummary?.trim().slice(0, 400) || undefined,
        cargoRequirements: input.cargoRequirements?.trim().slice(0, 300) || undefined,
        estimatedWeightKg: quoteRes.quote.estimatedWeightKg,
        fragile: quoteRes.quote.fragile,
        quotedPrice: quoteRes.quote.customerTotal,
        courierEarnings: quoteRes.quote.courierEarnings,
        platformCommission: quoteRes.quote.platformCommission,
        currency: quoteRes.quote.currency,
        pricingRuleVersionId: quoteRes.quote.pricingRuleVersionId,
        quoteId: quoteRes.quote.id,
        pricingBreakdown: quoteRes.quote.breakdown,
        paymentMethod: input.paymentMethod,
        reservationStatus: 'hold',
        paymentStatus: 'unpaid',
        assignmentStatus: 'not_requested',
        executionStatus: 'scheduled',
        status: 'pending_approval',
        holdExpiresAt,
        idempotencyKey: input.idempotencyKey,
        remindersSent: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      this.reservations.set(id, entity);
      if (input.idempotencyKey) {
        this.idempotencyIndex.set(`${input.merchantUid}:${input.idempotencyKey}`, id);
      }
      this.recordAudit(
        id,
        'reservation.hold_created',
        input.merchantUid,
        'customer',
        `Temporary capacity hold created for ${reference} (${input.reservationDate} ${input.startTime}–${input.endTime}, expires ${holdExpiresAt}).`,
        { quoteId: quoteRes.quote.id, total: quoteRes.quote.customerTotal },
        nowMs
      );

      logOperationalEvent('info', 'scheduled.hold_created', {
        reservationId: id,
        reference,
        cityId: loc.city.id,
        vehicleCategory: input.vehicleCategory,
        total: quoteRes.quote.customerTotal,
      });

      return { ok: true, reservation: entity, quote: quoteRes.quote, deduplicated: false };
    });
  }

  /**
   * Confirms a held reservation after verifying hold expiry, pricing integrity,
   * and server-side payment authorization/settlement.
   */
  public async confirmReservation(params: {
    reservationId: string;
    actorUid: string;
    isAdmin?: boolean;
    paymentMethod?: ScheduledPaymentMethod;
    paymentCtx?: Partial<PaymentVerificationContext>;
    nowMs?: number;
  }): Promise<
    | { ok: true; reservation: ScheduledReservationEntity; paymentOutcome: PaymentVerificationOutcome }
    | ScheduledErrorResult
  > {
    const nowMs = params.nowMs ?? Date.now();
    const existing = this.reservations.get(params.reservationId);
    if (!existing) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        httpStatus: 404,
        messageFr: 'Réservation introuvable.',
        messageEn: 'Reservation not found.',
      };
    }

    if (!params.isAdmin && existing.merchantUid !== params.actorUid) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: 403,
        messageFr: 'Accès non autorisé à cette réservation.',
        messageEn: 'Not authorized to modify this reservation.',
      };
    }

    return this.runWithLock(`res:${existing.id}`, async () => {
      if (existing.reservationStatus === 'confirmed') {
        return {
          ok: true,
          reservation: existing,
          paymentOutcome: {
            ok: true,
            paymentStatus: existing.paymentStatus,
            reservationConfirmed: true,
            messageFr: 'Réservation déjà confirmée.',
            messageEn: 'Reservation is already confirmed.',
          },
        };
      }

      if (existing.reservationStatus === 'cancelled' || existing.reservationStatus === 'expired') {
        return {
          ok: false,
          code: 'HOLD_EXPIRED_OR_CANCELLED',
          httpStatus: 410,
          messageFr: 'Le créneau temporaire a expiré ou été annulé. Veuillez sélectionner un nouveau créneau.',
          messageEn: 'Slot hold has expired or was cancelled. Please select a new slot.',
        };
      }

      if (existing.holdExpiresAt && Date.parse(existing.holdExpiresAt) <= nowMs) {
        existing.reservationStatus = 'expired';
        existing.executionStatus = 'cancelled';
        existing.status = deriveLegacyReservationStatus(existing);
        existing.updatedAt = new Date(nowMs).toISOString();
        this.recordAudit(
          existing.id,
          'reservation.hold_expired',
          'system',
          'system',
          `Hold expired prior to confirmation for ${existing.reference}.`,
          undefined,
          nowMs
        );
        return {
          ok: false,
          code: 'HOLD_EXPIRED',
          httpStatus: 410,
          messageFr: 'Votre temps de réservation du créneau a expiré. Veuillez réactualiser les disponibilités.',
          messageEn: 'Your temporary slot hold has expired. Please refresh availability.',
        };
      }

      const method = params.paymentMethod || existing.paymentMethod;
      existing.paymentMethod = method;

      const outcome = verifyScheduledPaymentServerSide(existing.quotedPrice, existing.currency, {
        paymentMethod: method,
        walletBalance: params.paymentCtx?.walletBalance,
        businessVerified: params.paymentCtx?.businessVerified,
        providerVerifiedReference: params.paymentCtx?.providerVerifiedReference,
        paymentProviderConfigured: params.paymentCtx?.paymentProviderConfigured,
      });

      existing.paymentStatus = outcome.paymentStatus;
      existing.updatedAt = new Date(nowMs).toISOString();

      if (!outcome.ok) {
        this.recordAudit(
          existing.id,
          'reservation.payment_failed',
          params.actorUid,
          params.isAdmin ? 'admin' : 'customer',
          outcome.messageEn,
          { code: outcome.code, paymentMethod: method },
          nowMs
        );
        if (this.notificationEngine) {
          await this.notificationEngine.emitEventNotifications({
            eventId: `res_pay_fail_${existing.id}_${nowMs}`,
            templateKey: 'reservation.payment_failed',
            vars: { reference: existing.reference, reason: outcome.messageFr },
            recipients: [{ uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime'] }],
            nowMs,
          });
        }
        return {
          ok: false,
          code: outcome.code || 'PAYMENT_FAILED',
          httpStatus: 402,
          messageFr: outcome.messageFr,
          messageEn: outcome.messageEn,
          details: { actionRequired: outcome.actionRequired, reservation: existing },
        };
      }

      if (outcome.reservationConfirmed) {
        existing.reservationStatus = 'confirmed';
        existing.holdExpiresAt = null;
        existing.status = deriveLegacyReservationStatus(existing);
        if (params.paymentCtx?.providerVerifiedReference) {
          existing.paymentReference = params.paymentCtx.providerVerifiedReference;
        }
        this.recordAudit(
          existing.id,
          'reservation.confirmed',
          params.actorUid,
          params.isAdmin ? 'admin' : 'customer',
          `Reservation ${existing.reference} confirmed (${existing.paymentMethod} / ${existing.paymentStatus}).`,
          undefined,
          nowMs
        );
        if (this.notificationEngine) {
          await this.notificationEngine.emitEventNotifications({
            eventId: `res_confirmed_${existing.id}`,
            templateKey: 'reservation.confirmed',
            vars: { reference: existing.reference, cityName: existing.cityName },
            recipients: [{ uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'email'] }],
            nowMs,
          });
        }
      } else {
        existing.reservationStatus = 'pending_payment';
        existing.status = deriveLegacyReservationStatus(existing);
        this.recordAudit(
          existing.id,
          'reservation.pending_payment',
          params.actorUid,
          params.isAdmin ? 'admin' : 'customer',
          `Reservation ${existing.reference} awaiting verified payment (${outcome.code}).`,
          { actionRequired: outcome.actionRequired },
          nowMs
        );
      }

      return { ok: true, reservation: existing, paymentOutcome: outcome };
    });
  }

  /**
   * Idempotently processes a verified payment provider webhook (Paystack / Stripe / MoMo).
   */
  public async processPaymentWebhook(params: {
    webhookEventId: string;
    reservationId: string;
    providerReference: string;
    status: 'paid' | 'failed' | 'refunded';
    amount?: number;
    nowMs?: number;
  }): Promise<
    | { ok: true; reservation: ScheduledReservationEntity; deduplicated: boolean }
    | ScheduledErrorResult
  > {
    const nowMs = params.nowMs ?? Date.now();
    if (this.processedWebhooks.has(params.webhookEventId)) {
      const existing = this.reservations.get(params.reservationId);
      if (existing) return { ok: true, reservation: existing, deduplicated: true };
    }

    const existing = this.reservations.get(params.reservationId);
    if (!existing) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        httpStatus: 404,
        messageFr: 'Réservation introuvable.',
        messageEn: 'Reservation not found.',
      };
    }

    return this.runWithLock(`res:${existing.id}`, async () => {
      if (this.processedWebhooks.has(params.webhookEventId)) {
        return { ok: true, reservation: existing, deduplicated: true };
      }

      if (
        params.status === 'paid' &&
        typeof params.amount === 'number' &&
        Math.abs(params.amount - existing.quotedPrice) > 0.01
      ) {
        return {
          ok: false,
          code: 'PAYMENT_AMOUNT_MISMATCH',
          httpStatus: 422,
          messageFr: 'Le montant payé ne correspond pas au devis serveur.',
          messageEn: 'Paid amount does not match server quote.',
        };
      }

      this.processedWebhooks.add(params.webhookEventId);
      existing.paymentReference = params.providerReference;
      existing.updatedAt = new Date(nowMs).toISOString();

      if (params.status === 'paid') {
        existing.paymentStatus = 'paid';
        if (existing.reservationStatus === 'hold' || existing.reservationStatus === 'pending_payment') {
          existing.reservationStatus = 'confirmed';
          existing.holdExpiresAt = null;
        }
        existing.status = deriveLegacyReservationStatus(existing);
        this.recordAudit(
          existing.id,
          'reservation.payment_webhook_paid',
          'system',
          'system',
          `Verified webhook ${params.webhookEventId} settled payment ${params.providerReference}.`,
          undefined,
          nowMs
        );
        if (this.notificationEngine) {
          await this.notificationEngine.emitEventNotifications({
            eventId: `res_confirmed_${existing.id}`,
            templateKey: 'reservation.confirmed',
            vars: { reference: existing.reference, cityName: existing.cityName },
            recipients: [{ uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'email'] }],
            nowMs,
          });
        }
      } else if (params.status === 'failed') {
        existing.paymentStatus = 'failed';
        existing.reservationStatus = 'pending_payment';
        existing.status = deriveLegacyReservationStatus(existing);
        this.recordAudit(
          existing.id,
          'reservation.payment_webhook_failed',
          'system',
          'system',
          `Payment webhook ${params.webhookEventId} reported payment failure.`,
          undefined,
          nowMs
        );
      } else if (params.status === 'refunded') {
        existing.paymentStatus = 'refunded';
        this.recordAudit(
          existing.id,
          'reservation.payment_webhook_refunded',
          'system',
          'system',
          `Refund webhook ${params.webhookEventId} processed.`,
          undefined,
          nowMs
        );
      }

      return { ok: true, reservation: existing, deduplicated: false };
    });
  }

  /**
   * Cancels a reservation following city cancellation rules (or returns a dry-run preview).
   */
  public async cancelReservation(params: {
    reservationId: string;
    actorUid: string;
    isAdmin?: boolean;
    reason?: string;
    preview?: boolean;
    nowMs?: number;
  }): Promise<
    | { ok: true; evaluation: CancellationPolicyEvaluation; reservation: ScheduledReservationEntity; preview: boolean }
    | ScheduledErrorResult
  > {
    const nowMs = params.nowMs ?? Date.now();
    const existing = this.reservations.get(params.reservationId);
    if (!existing) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        httpStatus: 404,
        messageFr: 'Réservation introuvable.',
        messageEn: 'Reservation not found.',
      };
    }

    if (!params.isAdmin && existing.merchantUid !== params.actorUid) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: 403,
        messageFr: 'Accès refusé.',
        messageEn: 'Forbidden.',
      };
    }

    const city = getCityById(existing.cityId, this.cities) || this.cities[0];
    const evaluation = evaluateReservationCancellationPolicy(existing, city, nowMs);

    if (params.preview) {
      return { ok: true, evaluation, reservation: existing, preview: true };
    }

    if (!evaluation.allowed && !params.isAdmin) {
      return {
        ok: false,
        code: evaluation.blockReasonCode || 'CANCELLATION_BLOCKED',
        httpStatus: 422,
        messageFr: evaluation.policySummaryFr,
        messageEn: evaluation.policySummaryEn,
        details: { evaluation },
      };
    }

    return this.runWithLock(`res:${existing.id}`, async () => {
      const previousDriverUid = existing.driverUid;
      existing.reservationStatus = 'cancelled';
      existing.executionStatus = 'cancelled';
      existing.holdExpiresAt = null;
      existing.cancellationFee = evaluation.feeAmount;
      existing.refundAmount = evaluation.refundAmount;
      existing.cancellationReason = params.reason?.trim().slice(0, 240) || 'customer_cancelled';
      if (evaluation.refundAmount > 0 && existing.paymentStatus === 'paid') {
        existing.paymentStatus =
          evaluation.refundAmount >= existing.quotedPrice ? 'refunded' : 'partially_refunded';
      }
      existing.status = deriveLegacyReservationStatus(existing);
      existing.updatedAt = new Date(nowMs).toISOString();

      this.recordAudit(
        existing.id,
        'reservation.cancelled',
        params.actorUid,
        params.isAdmin ? 'admin' : 'customer',
        `Cancelled ${existing.reference} (fee: ${evaluation.feeAmount} ${existing.currency}, refund: ${evaluation.refundAmount} ${existing.currency}).`,
        { reason: existing.cancellationReason, evaluation },
        nowMs
      );

      if (this.notificationEngine) {
        const recipients: Array<{ uid: string; role: 'customer' | 'courier'; channels: ('in_app' | 'realtime' | 'email')[] }> = [
          { uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'email'] },
        ];
        if (previousDriverUid) {
          recipients.push({ uid: previousDriverUid, role: 'courier', channels: ['in_app', 'realtime'] });
        }
        await this.notificationEngine.emitEventNotifications({
          eventId: `res_cancelled_${existing.id}`,
          templateKey: 'reservation.cancelled',
          vars: { reference: existing.reference, reason: evaluation.policySummaryFr },
          recipients,
          nowMs,
        });
      }

      return { ok: true, evaluation, reservation: existing, preview: false };
    });
  }

  /**
   * Reschedules/modifies an active reservation with full backend revalidation
   * (city, timezone, operating hours, availability, courier conflict check, and price delta).
   */
  public async rescheduleReservation(params: {
    reservationId: string;
    actorUid: string;
    isAdmin?: boolean;
    reservationDate?: string;
    startTime?: string;
    endTime?: string;
    durationType?: ScheduledDurationType;
    vehicleCategory?: string;
    pickup?: GeoCoordinate;
    pickupAddress?: string;
    cargoRequirements?: string;
    estimatedWeightKg?: number;
    nowMs?: number;
  }): Promise<
    | { ok: true; reservation: ScheduledReservationEntity; previousPrice: number; priceDelta: number }
    | ScheduledErrorResult
  > {
    const nowMs = params.nowMs ?? Date.now();
    const existing = this.reservations.get(params.reservationId);
    if (!existing) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        httpStatus: 404,
        messageFr: 'Réservation introuvable.',
        messageEn: 'Reservation not found.',
      };
    }

    if (!params.isAdmin && existing.merchantUid !== params.actorUid) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: 403,
        messageFr: 'Accès refusé.',
        messageEn: 'Forbidden.',
      };
    }

    if (
      existing.reservationStatus === 'cancelled' ||
      existing.reservationStatus === 'expired' ||
      existing.executionStatus === 'pickup_completed' ||
      existing.executionStatus === 'in_transit' ||
      existing.executionStatus === 'completed'
    ) {
      return {
        ok: false,
        code: 'RESCHEDULE_NOT_ALLOWED_STAGE',
        httpStatus: 422,
        messageFr: 'Cette réservation ne peut plus être modifiée à ce stade.',
        messageEn: 'This reservation can no longer be rescheduled at its current stage.',
      };
    }

    const nextPickup = params.pickup || { lat: existing.pickupLat, lng: existing.pickupLng };
    const nextDest =
      typeof existing.destinationLat === 'number' && typeof existing.destinationLng === 'number'
        ? { lat: existing.destinationLat, lng: existing.destinationLng }
        : null;
    const loc = validateScheduledLocations({ pickup: nextPickup, destination: nextDest, cities: this.cities });
    if (!loc.ok) return loc;

    const policy = getCitySchedulingPolicy(loc.city);
    const hoursUntilCurrent = (Date.parse(existing.pickupWindowStart) - nowMs) / 3_600_000;
    if (!params.isAdmin && hoursUntilCurrent < policy.cancellationPolicy.allowRescheduleHoursBeforePickup) {
      return {
        ok: false,
        code: 'RESCHEDULE_WINDOW_CLOSED',
        httpStatus: 422,
        messageFr: `La replanification est fermée à moins de ${policy.cancellationPolicy.allowRescheduleHoursBeforePickup}h de la prise en charge.`,
        messageEn: `Rescheduling is closed within ${policy.cancellationPolicy.allowRescheduleHoursBeforePickup}h of pickup.`,
      };
    }

    const nextDate = params.reservationDate || existing.reservationDate;
    const nextStart = params.startTime || existing.startTime;
    const nextEnd = params.endTime || existing.endTime;
    const nextDuration = params.durationType || existing.durationType;
    const nextVehicle = params.vehicleCategory || existing.vehicleCategory;
    const nextWeight = params.estimatedWeightKg ?? existing.estimatedWeightKg;
    const nextCargo = params.cargoRequirements ?? existing.cargoRequirements;

    const compat = checkVehicleCompatibility({
      city: loc.city,
      vehicleCategory: nextVehicle,
      estimatedWeightKg: nextWeight,
      cargoRequirements: nextCargo,
    });
    if (!compat.eligible) {
      return {
        ok: false,
        code: compat.code || 'VEHICLE_INCOMPATIBLE',
        httpStatus: 422,
        messageFr: compat.reasonFr || 'Véhicule incompatible.',
        messageEn: compat.reasonEn || 'Vehicle incompatible.',
      };
    }

    const windowCheck = validateScheduledWindow({
      city: loc.city,
      reservationDate: nextDate,
      startTime: nextStart,
      endTime: nextEnd,
      durationType: nextDuration,
      nowMs,
    });
    if (!windowCheck.ok) return windowCheck;

    const lockKey = `slot:${loc.city.id}:${nextVehicle}:${nextDate}`;
    return this.runWithLock(lockKey, async () => {
      const cap = resolveVehicleSlotCapacity({
        city: loc.city,
        vehicleCategory: nextVehicle,
        fleetSupply: this.fleetSupply,
        usePolicyCapacityFallback: this.usePolicyCapacityFallback,
      });

      const occ = countSlotOccupancy({
        cityId: loc.city.id,
        vehicleCategory: nextVehicle,
        startEpochMs: windowCheck.startEpochMs,
        endEpochMs: windowCheck.endEpochMs,
        transitionBufferMin: policy.transitionBufferMin,
        existingReservations: this.listReservations(),
        excludeReservationId: existing.id,
        nowMs,
      });

      if (cap.totalCapacity - occ.bookedCount - occ.heldCount <= 0) {
        return {
          ok: false,
          code: 'SLOT_UNAVAILABLE',
          httpStatus: 409,
          messageFr: 'Le nouveau créneau demandé est complet. Choisissez un autre horaire.',
          messageEn: 'The requested new time slot is fully booked. Please choose another slot.',
        };
      }

      const quoteRes = generateScheduledQuote({
        city: loc.city,
        vehicleCategory: nextVehicle,
        durationType: nextDuration,
        reservationDate: nextDate,
        startTime: nextStart,
        endTime: nextEnd,
        estimatedDistanceKm: loc.estimatedDistanceKm,
        estimatedWeightKg: nextWeight,
        fragile: existing.fragile,
        customRules: this.customRules,
        nowMs,
      });
      if (!quoteRes.ok) return quoteRes;

      // If a courier was assigned, verify no schedule conflict with new slot/vehicle
      if (existing.driverUid) {
        const conflict = checkCourierScheduleConflict({
          courierUid: existing.driverUid,
          targetStartMs: windowCheck.startEpochMs,
          targetEndMs: windowCheck.endEpochMs,
          transitionBufferMin: policy.transitionBufferMin,
          existingReservations: this.listReservations(),
          excludeReservationId: existing.id,
          nowMs,
        });
        if (conflict.conflict || nextVehicle !== existing.vehicleCategory || loc.city.id !== existing.cityId) {
          existing.driverUid = '';
          existing.assignedDriverName = undefined;
          existing.assignmentStatus = 'reassignment_required';
        }
      }

      const previousPrice = existing.quotedPrice;
      const priceDelta = Number((quoteRes.quote.customerTotal - previousPrice).toFixed(2));

      existing.cityId = loc.city.id;
      existing.cityName = loc.city.name;
      existing.timezone = loc.city.timezone;
      existing.vehicleCategory = nextVehicle;
      existing.reservationDate = nextDate;
      existing.startTime = nextStart;
      existing.endTime = nextEnd;
      existing.durationType = nextDuration;
      existing.pickupWindowStart = quoteRes.quote.pickupWindowStart;
      existing.pickupWindowEnd = quoteRes.quote.pickupWindowEnd;
      existing.serviceEndAt = quoteRes.quote.serviceEndAt;
      existing.pickupLat = nextPickup.lat;
      existing.pickupLng = nextPickup.lng;
      if (params.pickupAddress) existing.pickupAddress = params.pickupAddress.trim().slice(0, 300);
      existing.estimatedWeightKg = quoteRes.quote.estimatedWeightKg;
      existing.cargoRequirements = nextCargo;
      existing.quotedPrice = quoteRes.quote.customerTotal;
      existing.courierEarnings = quoteRes.quote.courierEarnings;
      existing.platformCommission = quoteRes.quote.platformCommission;
      existing.currency = quoteRes.quote.currency;
      existing.pricingRuleVersionId = quoteRes.quote.pricingRuleVersionId;
      existing.quoteId = quoteRes.quote.id;
      existing.pricingBreakdown = quoteRes.quote.breakdown;
      existing.remindersSent = [];
      existing.updatedAt = new Date(nowMs).toISOString();

      this.recordAudit(
        existing.id,
        'reservation.rescheduled',
        params.actorUid,
        params.isAdmin ? 'admin' : 'customer',
        `Rescheduled ${existing.reference} to ${nextDate} ${nextStart}–${nextEnd} (price delta: ${priceDelta} ${existing.currency}).`,
        { previousPrice, newPrice: existing.quotedPrice, priceDelta },
        nowMs
      );

      if (this.notificationEngine) {
        await this.notificationEngine.emitEventNotifications({
          eventId: `res_rescheduled_${existing.id}_${nowMs}`,
          templateKey: 'reservation.rescheduled',
          vars: {
            reference: existing.reference,
            reason: `Nouveau créneau confirmé : ${nextDate} (${nextStart}–${nextEnd}).`,
          },
          recipients: [{ uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'email'] }],
          nowMs,
        });
      }

      return { ok: true, reservation: existing, previousPrice, priceDelta };
    });
  }

  /**
   * Assigns a courier to a confirmed scheduled reservation with strict city, vehicle,
   * approval, and schedule-conflict (duration + travel buffer) validation.
   */
  public async assignCourier(params: {
    reservationId: string;
    courier: ScheduledCourierSupply;
    actorUid: string;
    actorRole: 'admin' | 'system' | 'courier';
    nowMs?: number;
  }): Promise<{ ok: true; reservation: ScheduledReservationEntity } | ScheduledErrorResult> {
    const nowMs = params.nowMs ?? Date.now();
    const existing = this.reservations.get(params.reservationId);
    if (!existing) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        httpStatus: 404,
        messageFr: 'Réservation introuvable.',
        messageEn: 'Reservation not found.',
      };
    }

    if (existing.reservationStatus !== 'confirmed') {
      return {
        ok: false,
        code: 'RESERVATION_NOT_CONFIRMED',
        httpStatus: 422,
        messageFr: 'Un chauffeur ne peut être assigné qu’à une réservation confirmée.',
        messageEn: 'A courier can only be assigned to a confirmed reservation.',
      };
    }

    if (params.courier.approvalStatus !== 'approved' || !params.courier.isActive) {
      return {
        ok: false,
        code: 'COURIER_NOT_APPROVED',
        httpStatus: 422,
        messageFr: 'Ce chauffeur n’est pas validé ou actif.',
        messageEn: 'Courier is not approved or active.',
      };
    }

    if (params.courier.cityId !== existing.cityId) {
      return {
        ok: false,
        code: 'COURIER_CITY_MISMATCH',
        httpStatus: 422,
        messageFr: 'Le chauffeur n’opère pas dans la ville de cette réservation.',
        messageEn: 'Courier does not operate in the reservation city.',
      };
    }

    if (params.courier.vehicleCategory !== existing.vehicleCategory) {
      return {
        ok: false,
        code: 'COURIER_VEHICLE_MISMATCH',
        httpStatus: 422,
        messageFr: 'Le véhicule du chauffeur ne correspond pas à la catégorie réservée.',
        messageEn: 'Courier vehicle category does not match the reserved category.',
      };
    }

    const city = getCityById(existing.cityId, this.cities) || this.cities[0];
    const policy = getCitySchedulingPolicy(city);

    return this.runWithLock(`courier:${params.courier.uid}`, async () => {
      const conflict = checkCourierScheduleConflict({
        courierUid: params.courier.uid,
        targetStartMs: Date.parse(existing.pickupWindowStart),
        targetEndMs: Date.parse(existing.serviceEndAt),
        transitionBufferMin: policy.transitionBufferMin,
        existingReservations: this.listReservations(),
        excludeReservationId: existing.id,
        nowMs,
      });

      if (conflict.conflict) {
        return {
          ok: false,
          code: 'COURIER_SCHEDULE_CONFLICT',
          httpStatus: 409,
          messageFr: `Conflit d’horaire : ce chauffeur est déjà engagé sur ${conflict.conflictingReservation.reference} (marge de transition ${policy.transitionBufferMin} min requise).`,
          messageEn: `Schedule conflict: courier is already committed to ${conflict.conflictingReservation.reference} (${policy.transitionBufferMin} min travel buffer required).`,
          details: {
            conflictingReservationId: conflict.conflictingReservation.id,
            conflictingReference: conflict.conflictingReservation.reference,
            transitionBufferMin: policy.transitionBufferMin,
          },
        };
      }

      const wasReassignment = Boolean(existing.driverUid && existing.driverUid !== params.courier.uid);
      existing.driverUid = params.courier.uid;
      existing.assignedDriverName = params.courier.name;
      existing.assignmentStatus = 'assigned';
      existing.escalationReason = null;
      existing.updatedAt = new Date(nowMs).toISOString();

      this.recordAudit(
        existing.id,
        wasReassignment ? 'reservation.courier_reassigned' : 'reservation.courier_assigned',
        params.actorUid,
        params.actorRole,
        `Assigned courier ${params.courier.name} (${params.courier.uid}) to ${existing.reference}.`,
        undefined,
        nowMs
      );

      if (this.notificationEngine) {
        await this.notificationEngine.emitEventNotifications({
          eventId: `res_assign_${existing.id}_${params.courier.uid}_${nowMs}`,
          templateKey: wasReassignment ? 'reservation.courier_reassigned' : 'reservation.courier_assigned',
          vars: { reference: existing.reference, courierName: params.courier.name },
          recipients: [
            { uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'push'] },
            { uid: params.courier.uid, role: 'courier', channels: ['in_app', 'realtime', 'push'] },
          ],
          nowMs,
        });
      }

      return { ok: true, reservation: existing };
    });
  }

  /**
   * Handles a courier cancelling an assigned scheduled booking -> triggers automatic reassignment.
   */
  public async handleCourierCancellation(params: {
    reservationId: string;
    courierUid: string;
    reason?: string;
    nowMs?: number;
  }): Promise<{ ok: true; reservation: ScheduledReservationEntity } | ScheduledErrorResult> {
    const nowMs = params.nowMs ?? Date.now();
    const existing = this.reservations.get(params.reservationId);
    if (!existing) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        httpStatus: 404,
        messageFr: 'Réservation introuvable.',
        messageEn: 'Reservation not found.',
      };
    }

    if (existing.driverUid !== params.courierUid) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: 403,
        messageFr: 'Ce chauffeur n’est pas assigné à cette réservation.',
        messageEn: 'Courier is not assigned to this reservation.',
      };
    }

    return this.runWithLock(`res:${existing.id}`, async () => {
      existing.driverUid = '';
      existing.assignedDriverName = undefined;
      existing.assignmentStatus = 'reassignment_required';
      existing.dispatchStartedAt = existing.dispatchStartedAt || new Date(nowMs).toISOString();
      existing.updatedAt = new Date(nowMs).toISOString();

      this.recordAudit(
        existing.id,
        'reservation.courier_cancelled_reassignment_triggered',
        params.courierUid,
        'courier',
        `Courier ${params.courierUid} dropped ${existing.reference} (${params.reason || 'unavailable'}); reassignment initiated.`,
        undefined,
        nowMs
      );

      if (this.notificationEngine) {
        await this.notificationEngine.emitEventNotifications({
          eventId: `res_courier_drop_${existing.id}_${nowMs}`,
          templateKey: 'reservation.courier_reassigned',
          vars: { reference: existing.reference },
          recipients: [{ uid: existing.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'push'] }],
          nowMs,
        });
      }

      return { ok: true, reservation: existing };
    });
  }

  /**
   * Idempotent background reconciliation for scheduled reservations:
   * 1. Expires overdue capacity holds / unpaid bookings and releases capacity.
   * 2. Opens scheduled dispatch when inside the city's dispatch lead-time window.
   * 3. Emits deduplicated pickup reminders (24h and 2h).
   * 4. Escalates unassigned confirmed bookings past the assignment deadline.
   * 5. Flags delayed pickups past pickupWindowEnd.
   */
  public async reconcileScheduledReservations(
    nowMs = Date.now()
  ): Promise<ScheduledReconciliationReport> {
    const nowIso = new Date(nowMs).toISOString();
    const events: ScheduledReconciliationReport['events'] = [];
    let expiredHoldsCount = 0;
    let dispatchStartedCount = 0;
    let remindersSentCount = 0;
    let escalatedUnassignedCount = 0;
    let delayedPickupsFlaggedCount = 0;

    for (const res of this.reservations.values()) {
      const city = getCityById(res.cityId, this.cities) || this.cities[0];
      const policy = getCitySchedulingPolicy(city);

      // 1. Expire overdue holds / pending payments
      if (
        (res.reservationStatus === 'hold' || res.reservationStatus === 'pending_payment') &&
        res.holdExpiresAt &&
        Date.parse(res.holdExpiresAt) <= nowMs
      ) {
        res.reservationStatus = 'expired';
        res.executionStatus = 'cancelled';
        res.holdExpiresAt = null;
        res.status = deriveLegacyReservationStatus(res);
        res.updatedAt = nowIso;
        expiredHoldsCount += 1;
        events.push({
          reservationId: res.id,
          eventType: 'reservation.hold_expired',
          summary: `Expired unpaid hold ${res.reference}; capacity released.`,
          timestamp: nowIso,
        });
        this.recordAudit(res.id, 'reservation.hold_expired', 'system', 'system', `Hold expired for ${res.reference}.`, undefined, nowMs);
        continue;
      }

      if (res.reservationStatus !== 'confirmed') continue;
      if (res.executionStatus === 'completed' || res.executionStatus === 'cancelled') continue;

      const pickupStartMs = Date.parse(res.pickupWindowStart);
      const pickupEndMs = Date.parse(res.pickupWindowEnd);
      const minutesToPickup = (pickupStartMs - nowMs) / 60_000;

      // 2. Open scheduled dispatch wave at configured lead time (not prematurely for far-future bookings)
      if (
        (res.assignmentStatus === 'not_requested' || res.assignmentStatus === 'reassignment_required') &&
        minutesToPickup <= policy.dispatchLeadTimeMin &&
        nowMs < pickupEndMs
      ) {
        res.assignmentStatus = 'searching';
        res.dispatchStartedAt = nowIso;
        res.updatedAt = nowIso;
        dispatchStartedCount += 1;
        events.push({
          reservationId: res.id,
          eventType: 'reservation.dispatch_started',
          summary: `Opened scheduled dispatch for ${res.reference} (${Math.round(minutesToPickup)} min before pickup).`,
          timestamp: nowIso,
        });
        this.recordAudit(res.id, 'reservation.dispatch_started', 'system', 'system', `Scheduled dispatch started for ${res.reference}.`, undefined, nowMs);
      }

      // 3. Emit deduplicated reminders (24h and 2h windows)
      const reminderWindows: Array<{ key: string; maxMin: number; minMin: number }> = [
        { key: 'reminder_24h', maxMin: 24 * 60, minMin: 22 * 60 },
        { key: 'reminder_2h', maxMin: 120, minMin: 60 },
      ];
      for (const rw of reminderWindows) {
        if (
          minutesToPickup <= rw.maxMin &&
          minutesToPickup > rw.minMin &&
          !res.remindersSent.includes(rw.key)
        ) {
          res.remindersSent.push(rw.key);
          remindersSentCount += 1;
          events.push({
            reservationId: res.id,
            eventType: `reservation.${rw.key}`,
            summary: `Queued ${rw.key} reminder for ${res.reference}.`,
            timestamp: nowIso,
          });
          if (this.notificationEngine) {
            await this.notificationEngine.emitEventNotifications({
              eventId: `res_${rw.key}_${res.id}`,
              templateKey: 'reservation.reminder',
              vars: { reference: res.reference, etaMinutes: Math.max(1, Math.round(minutesToPickup)) },
              recipients: [{ uid: res.merchantUid, role: 'customer', channels: ['in_app', 'realtime', 'push'] }],
              nowMs,
            });
          }
        }
      }

      // 4. Escalate unassigned bookings past assignment deadline
      if (
        !res.driverUid &&
        minutesToPickup <= policy.assignmentDeadlineMin &&
        res.escalationReason !== 'UNASSIGNED_PAST_DEADLINE'
      ) {
        res.escalationReason = 'UNASSIGNED_PAST_DEADLINE';
        if (res.assignmentStatus !== 'assigned') {
          res.assignmentStatus = 'failed';
        }
        res.updatedAt = nowIso;
        escalatedUnassignedCount += 1;
        events.push({
          reservationId: res.id,
          eventType: 'reservation.escalated_unassigned',
          summary: `Reservation ${res.reference} still unassigned within ${policy.assignmentDeadlineMin} min of pickup; escalated to ops.`,
          timestamp: nowIso,
        });
        this.recordAudit(
          res.id,
          'reservation.escalated_unassigned',
          'system',
          'system',
          `Escalated unassigned ${res.reference} to operations.`,
          undefined,
          nowMs
        );
        if (this.notificationEngine) {
          await this.notificationEngine.emitEventNotifications({
            eventId: `res_escalated_${res.id}`,
            templateKey: 'reservation.at_risk',
            vars: {
              reference: res.reference,
              reason: `Aucun chauffeur assigné à moins de ${policy.assignmentDeadlineMin} min de la prise en charge.`,
            },
            recipients: [{ uid: res.merchantUid, role: 'customer', channels: ['in_app', 'realtime'] }],
            nowMs,
          });
        }
      }

      // 5. Flag delayed pickups
      if (
        nowMs > pickupEndMs &&
        (res.executionStatus === 'scheduled' || res.executionStatus === 'preparing' || res.executionStatus === 'courier_en_route') &&
        res.escalationReason !== 'PICKUP_DELAYED'
      ) {
        res.escalationReason = 'PICKUP_DELAYED';
        res.updatedAt = nowIso;
        delayedPickupsFlaggedCount += 1;
        events.push({
          reservationId: res.id,
          eventType: 'reservation.pickup_delayed',
          summary: `Pickup window passed for ${res.reference} without pickup completion.`,
          timestamp: nowIso,
        });
      }
    }

    return {
      runAt: nowIso,
      expiredHoldsCount,
      dispatchStartedCount,
      remindersSentCount,
      escalatedUnassignedCount,
      delayedPickupsFlaggedCount,
      events,
    };
  }
}
