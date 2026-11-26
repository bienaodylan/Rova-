import { isSupabaseConfigured, supabaseApiFetch } from './supabase';
import {
  PaymentMethod,
  ReservationBreakdownItem,
  ReservationRecord,
  VehicleCategory,
} from '../types/rova';

export interface ScheduledSlotItem {
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
  availabilitySource: 'fleet_live' | 'city_capacity_policy' | 'unverified';
  restrictionCode?: string;
  restrictionReasonFr?: string;
  restrictionReasonEn?: string;
}

export interface ScheduledVehicleAvailability {
  vehicleCategory: VehicleCategory;
  eligible: boolean;
  availableForSelectedSlot: boolean;
  remainingCapacity: number;
  totalCapacity: number;
  availabilitySource: 'fleet_live' | 'city_capacity_policy' | 'unverified';
  estimatedPrice: number | null;
  currency: string;
  incompatibilityCode?: string;
  incompatibilityReasonFr?: string;
  incompatibilityReasonEn?: string;
}

export interface ScheduledDateOption {
  date: string;
  isToday: boolean;
  isOpen: boolean;
  isHoliday: boolean;
  bookableSlotsCount: number;
  reasonFr?: string;
  reasonEn?: string;
}

export interface ScheduledAvailabilityResponse {
  ok: true;
  city: {
    id: string;
    name: string;
    countryCode: string;
    currency: string;
    timezone: string;
    operatingHours: { open: string; close: string; days: number[] };
    minLeadTimeMin: number;
    maxBookingHorizonDays: number;
    pickupWindowMinutes: number;
    holdTtlSeconds: number;
    dispatchLeadTimeMin: number;
  };
  availabilitySource: 'fleet_live' | 'city_capacity_policy' | 'unverified';
  selectedDate: string;
  durationType: 'window' | 'hours' | 'full_day';
  dates: ScheduledDateOption[];
  slots: ScheduledSlotItem[];
  vehicles: ScheduledVehicleAvailability[];
  estimatedDistanceKm: number;
}

export interface ScheduledQuotePayload {
  id: string;
  cityId: string;
  cityName: string;
  timezone: string;
  vehicleCategory: VehicleCategory;
  durationType: 'window' | 'hours' | 'full_day';
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
  breakdown: ReservationBreakdownItem[];
  createdAt: string;
  expiresAt: string;
  signatureHash: string;
}

export interface CancellationPolicyPreview {
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

export interface ScheduledApiError {
  ok: false;
  code: string;
  error: string;
  errorEn?: string;
  details?: Record<string, unknown>;
}

export async function fetchScheduledAvailability(params: {
  pickup: { lat: number; lng: number };
  destination?: { lat: number; lng: number } | null;
  reservationDate?: string;
  durationType: 'window' | 'hours' | 'full_day';
  vehicleCategory: VehicleCategory;
  estimatedWeightKg?: number;
  fragile?: boolean;
}): Promise<ScheduledAvailabilityResponse | ScheduledApiError> {
  const res = await fetch('/api/v1/scheduled/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({
    ok: false,
    code: 'NETWORK_ERROR',
    error: 'Erreur réseau lors du chargement des disponibilités.',
    errorEn: 'Network error loading availability.',
  }));
  return data as ScheduledAvailabilityResponse | ScheduledApiError;
}

export async function fetchScheduledQuote(params: {
  pickup: { lat: number; lng: number };
  destination?: { lat: number; lng: number } | null;
  reservationDate: string;
  startTime: string;
  endTime: string;
  durationType: 'window' | 'hours' | 'full_day';
  vehicleCategory: VehicleCategory;
  estimatedWeightKg?: number;
  fragile?: boolean;
}): Promise<{ ok: true; quote: ScheduledQuotePayload } | ScheduledApiError> {
  const res = await fetch('/api/v1/scheduled/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({
    ok: false,
    code: 'NETWORK_ERROR',
    error: 'Impossible de calculer le tarif.',
    errorEn: 'Unable to calculate quote.',
  }));
  return data as { ok: true; quote: ScheduledQuotePayload } | ScheduledApiError;
}

export async function createScheduledHoldApi(payload: {
  businessId?: string;
  merchantName: string;
  pickup: { lat: number; lng: number };
  pickupAddress: string;
  destination?: { lat: number; lng: number } | null;
  destinationAddress?: string;
  destinationsSummary?: string;
  vehicleCategory: VehicleCategory;
  durationType: 'window' | 'hours' | 'full_day';
  reservationDate: string;
  startTime: string;
  endTime: string;
  estimatedWeightKg?: number;
  fragile?: boolean;
  cargoRequirements?: string;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  expectedPrice?: number;
}): Promise<{
  ok: true;
  deduplicated: boolean;
  reservation: ReservationRecord;
  quote: ScheduledQuotePayload;
}> {
  return supabaseApiFetch('/api/v1/scheduled/holds', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmScheduledReservationApi(
  reservationId: string,
  paymentMethod: PaymentMethod
): Promise<{
  ok: true;
  reservation: ReservationRecord;
  paymentOutcome: {
    ok: boolean;
    paymentStatus: string;
    reservationConfirmed: boolean;
    actionRequired?: string;
    code?: string;
    messageFr: string;
    messageEn: string;
  };
}> {
  return supabaseApiFetch(`/api/v1/scheduled/reservations/${encodeURIComponent(reservationId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ paymentMethod }),
  });
}

export async function cancelScheduledReservationApi(
  reservationId: string,
  options: { preview?: boolean; reason?: string }
): Promise<{
  ok: true;
  preview: boolean;
  evaluation: CancellationPolicyPreview;
  reservation: ReservationRecord;
}> {
  return supabaseApiFetch(`/api/v1/scheduled/reservations/${encodeURIComponent(reservationId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function rescheduleScheduledReservationApi(
  reservationId: string,
  payload: {
    reservationDate?: string;
    startTime?: string;
    endTime?: string;
    durationType?: 'window' | 'hours' | 'full_day';
    vehicleCategory?: VehicleCategory;
    pickupAddress?: string;
    pickup?: { lat: number; lng: number };
    cargoRequirements?: string;
    estimatedWeightKg?: number;
  }
): Promise<{
  ok: true;
  reservation: ReservationRecord;
  previousPrice: number;
  priceDelta: number;
}> {
  return supabaseApiFetch(
    `/api/v1/scheduled/reservations/${encodeURIComponent(reservationId)}/reschedule`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function assignScheduledCourierOpsApi(
  reservationId: string,
  payload: { courierUid: string; courierName: string; vehicleCategory: string; cityId?: string }
): Promise<{ ok: true; reservation: ReservationRecord }> {
  return supabaseApiFetch(`/api/v1/ops/scheduled/${encodeURIComponent(reservationId)}/assign`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function canUseScheduledBackendAuth(): boolean {
  return isSupabaseConfigured();
}
