import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../apiApp.ts';
import { DEFAULT_CITIES, getCityById, getCitySchedulingPolicy } from '../engines/geospatialEngine.ts';
import { EventNotificationEngine } from '../engines/notificationEngine.ts';
import {
  AtomicReservationCoordinator,
  checkVehicleCompatibility,
  computeScheduledAvailability,
  evaluateReservationCancellationPolicy,
  generateScheduledQuote,
  ScheduledCourierSupply,
  validateScheduledLocations,
  validateScheduledWindow,
  verifyScheduledQuoteSignature,
  verifyWebhookHmacSignature,
  zonedWallClockToEpochMs,
} from '../engines/scheduledDeliveryEngine.ts';

const ABIDJAN_PICKUP = { lat: 5.336, lng: -4.026 };
const ABIDJAN_DEST = { lat: 5.356, lng: -3.986 };
const BOUAKE_POINT = { lat: 7.69, lng: -5.03 };
const OCEAN_OUTSIDE = { lat: 0.1, lng: -10.5 };

// Fixed deterministic reference clock: 2026-11-26 08:00:00 UTC (Abidjan = Africa/Abidjan UTC+0)
const FIXED_NOW_MS = Date.UTC(2026, 10, 26, 8, 0, 0);
const TODAY_STR = '2026-11-26';
const TOMORROW_STR = '2026-11-27';

// ============================================================================
// 1. LOCATION, CITY & COVERAGE VALIDATION
// ============================================================================

test('Geospatial: accepts valid pickup & same-city destination, rejects outside coverage & cross-city', () => {
  const valid = validateScheduledLocations({
    pickup: ABIDJAN_PICKUP,
    destination: ABIDJAN_DEST,
    cities: DEFAULT_CITIES,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.city.id, 'abidjan');
    assert.ok(valid.estimatedDistanceKm > 2);
  }

  const outside = validateScheduledLocations({
    pickup: OCEAN_OUTSIDE,
    cities: DEFAULT_CITIES,
  });
  assert.equal(outside.ok, false);
  if (!outside.ok) {
    assert.equal(outside.code, 'PICKUP_OUTSIDE_SERVICE_AREA');
  }

  const crossCity = validateScheduledLocations({
    pickup: ABIDJAN_PICKUP,
    destination: BOUAKE_POINT,
    cities: DEFAULT_CITIES,
  });
  assert.equal(crossCity.ok, false);
  if (!crossCity.ok) {
    assert.equal(crossCity.code, 'CROSS_CITY_NOT_SUPPORTED');
  }
});

// ============================================================================
// 2. TIMEZONE, OPERATING HOURS, LEAD TIME, HORIZON & HOLIDAY VALIDATION
// ============================================================================

test('Schedule engine: enforces past date/time, lead time, horizon, operating hours, and city holidays', () => {
  const abidjan = getCityById('abidjan', DEFAULT_CITIES)!;
  const holidayCity = {
    ...abidjan,
    schedulingPolicy: {
      ...getCitySchedulingPolicy(abidjan),
      holidays: ['2026-11-28'],
    },
  };

  // Past date
  const pastDate = validateScheduledWindow({
    city: holidayCity,
    reservationDate: '2026-11-25',
    startTime: '10:00',
    endTime: '14:00',
    durationType: 'hours',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(pastDate.ok, false);
  if (!pastDate.ok) assert.equal(pastDate.code, 'DATE_IN_PAST');

  // Lead time violation (now is 08:00, booking 08:30 violates 60 min lead time)
  const tooSoon = validateScheduledWindow({
    city: holidayCity,
    reservationDate: TODAY_STR,
    startTime: '08:30',
    endTime: '12:30',
    durationType: 'hours',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(tooSoon.ok, false);
  if (!tooSoon.ok) assert.equal(tooSoon.code, 'LEAD_TIME_NOT_MET');

  // Beyond max horizon (>30 days)
  const tooFar = validateScheduledWindow({
    city: holidayCity,
    reservationDate: '2027-02-15',
    startTime: '10:00',
    endTime: '14:00',
    durationType: 'hours',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(tooFar.ok, false);
  if (!tooFar.ok) assert.equal(tooFar.code, 'EXCEEDS_BOOKING_HORIZON');

  // Holiday blocked
  const holiday = validateScheduledWindow({
    city: holidayCity,
    reservationDate: '2026-11-28',
    startTime: '10:00',
    endTime: '14:00',
    durationType: 'hours',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(holiday.ok, false);
  if (!holiday.ok) assert.equal(holiday.code, 'CITY_HOLIDAY_CLOSED');

  // Outside operating hours (Abidjan closes at 23:00)
  const afterClose = validateScheduledWindow({
    city: holidayCity,
    reservationDate: TOMORROW_STR,
    startTime: '20:00',
    endTime: '23:30',
    durationType: 'hours',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(afterClose.ok, false);
  if (!afterClose.ok) assert.equal(afterClose.code, 'OUTSIDE_OPERATING_HOURS');

  // Valid future window
  const okWin = validateScheduledWindow({
    city: holidayCity,
    reservationDate: TOMORROW_STR,
    startTime: '09:00',
    endTime: '13:00',
    durationType: 'hours',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(okWin.ok, true);
});

// ============================================================================
// 3. REAL AVAILABILITY & VEHICLE COMPATIBILITY (ZERO FABRICATION)
// ============================================================================

test('Availability: never fabricates live fleet capacity and enforces vehicle/cargo compatibility', () => {
  const bouake = getCityById('bouake', DEFAULT_CITIES)!;
  const abidjan = getCityById('abidjan', DEFAULT_CITIES)!;

  // Truck is not supported in Bouaké
  const truckInBouake = checkVehicleCompatibility({ city: bouake, vehicleCategory: 'truck' });
  assert.equal(truckInBouake.eligible, false);
  assert.equal(truckInBouake.code, 'VEHICLE_NOT_SUPPORTED_IN_CITY');

  // Heavy cargo exceeds motorcycle limit (20 kg)
  const heavyOnMoto = checkVehicleCompatibility({
    city: abidjan,
    vehicleCategory: 'motorcycle',
    estimatedWeightKg: 85,
  });
  assert.equal(heavyOnMoto.eligible, false);
  assert.equal(heavyOnMoto.code, 'WEIGHT_EXCEEDS_VEHICLE_CAPACITY');

  // Pallets require van or truck
  const palletsOnTricycle = checkVehicleCompatibility({
    city: abidjan,
    vehicleCategory: 'tricycle',
    cargoRequirements: '2 palettes Europe',
  });
  assert.equal(palletsOnTricycle.eligible, false);
  assert.equal(palletsOnTricycle.code, 'PALLET_REQUIRES_VAN_OR_TRUCK');

  // Strict live fleet mode with 0 active trucks -> 0 bookable slots (never fabricated!)
  const zeroFleet = computeScheduledAvailability({
    pickup: ABIDJAN_PICKUP,
    reservationDate: TOMORROW_STR,
    durationType: 'hours',
    vehicleCategory: 'truck',
    fleetSupply: [],
    usePolicyCapacityFallback: false,
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(zeroFleet.ok, true);
  if (zeroFleet.ok) {
    assert.equal(zeroFleet.availabilitySource, 'fleet_live');
    assert.equal(zeroFleet.slots.filter((s) => s.bookable).length, 0);
  }
});

// ============================================================================
// 4. AUTHORITATIVE SERVER PRICING & HMAC INTEGRITY
// ============================================================================

test('Pricing: generates HMAC-signed server quote with itemized breakdown and rejects tampering', () => {
  const abidjan = getCityById('abidjan', DEFAULT_CITIES)!;
  const res = generateScheduledQuote({
    city: abidjan,
    vehicleCategory: 'cargo_van',
    durationType: 'window',
    reservationDate: TOMORROW_STR,
    startTime: '08:00', // Peak hour in Abidjan
    endTime: '10:00',
    estimatedDistanceKm: 12,
    estimatedWeightKg: 40, // Triggers heavy cargo surcharge
    fragile: true, // Triggers fragile surcharge
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.quote.currency, 'XOF');
  assert.ok(res.quote.customerTotal > 0);
  assert.equal(res.quote.courierEarnings + res.quote.platformCommission, res.quote.customerTotal);
  assert.ok(res.quote.breakdown.some((b) => b.code === 'heavy_cargo'));
  assert.ok(res.quote.breakdown.some((b) => b.code === 'fragile_handling'));
  assert.ok(res.quote.breakdown.some((b) => b.code === 'peak_hour_demand'));
  assert.equal(verifyScheduledQuoteSignature(res.quote), true);

  // Tampering total invalidates HMAC signature
  const tampered = { ...res.quote, customerTotal: 100 };
  assert.equal(verifyScheduledQuoteSignature(tampered), false);
});

// ============================================================================
// 5. CONCURRENCY, ATOMIC CAPACITY HOLDS, IDEMPOTENCY & EXPIRY
// ============================================================================

test('Concurrency: two simultaneous requests on the final slot result in strictly 1 winner and 1 clean rejection', async () => {
  const singleVanFleet: ScheduledCourierSupply[] = [
    {
      uid: 'drv_van_1',
      name: 'Kouassi Yao',
      cityId: 'abidjan',
      vehicleCategory: 'cargo_van',
      approvalStatus: 'approved',
      isActive: true,
    },
  ];
  const coord = new AtomicReservationCoordinator({
    cities: DEFAULT_CITIES,
    fleetSupply: singleVanFleet,
    usePolicyCapacityFallback: false,
  });

  const [r1, r2] = await Promise.all([
    coord.createHold({
      merchantUid: 'merchant_a',
      merchantName: 'Boutique A',
      pickup: ABIDJAN_PICKUP,
      pickupAddress: 'Plateau, Abidjan',
      vehicleCategory: 'cargo_van',
      durationType: 'hours',
      reservationDate: TOMORROW_STR,
      startTime: '09:00',
      endTime: '13:00',
      paymentMethod: 'wallet',
      idempotencyKey: 'key_a',
      nowMs: FIXED_NOW_MS,
    }),
    coord.createHold({
      merchantUid: 'merchant_b',
      merchantName: 'Boutique B',
      pickup: ABIDJAN_PICKUP,
      pickupAddress: 'Cocody, Abidjan',
      vehicleCategory: 'cargo_van',
      durationType: 'hours',
      reservationDate: TOMORROW_STR,
      startTime: '09:00',
      endTime: '13:00',
      paymentMethod: 'wallet',
      idempotencyKey: 'key_b',
      nowMs: FIXED_NOW_MS,
    }),
  ]);

  const wins = [r1, r2].filter((r) => r.ok);
  const fails = [r1, r2].filter((r) => !r.ok);
  assert.equal(wins.length, 1);
  assert.equal(fails.length, 1);
  if (!fails[0].ok) {
    assert.equal(fails[0].code, 'SLOT_UNAVAILABLE');
  }

  // Idempotent retry by the winner returns exact same hold without failing
  const winner = wins[0];
  if (winner.ok) {
    const retry = await coord.createHold({
      merchantUid: winner.reservation.merchantUid,
      merchantName: winner.reservation.merchantName,
      pickup: ABIDJAN_PICKUP,
      pickupAddress: winner.reservation.pickupAddress,
      vehicleCategory: 'cargo_van',
      durationType: 'hours',
      reservationDate: TOMORROW_STR,
      startTime: '09:00',
      endTime: '13:00',
      paymentMethod: 'wallet',
      idempotencyKey: winner.reservation.idempotencyKey,
      nowMs: FIXED_NOW_MS,
    });
    assert.equal(retry.ok, true);
    if (retry.ok) {
      assert.equal(retry.deduplicated, true);
      assert.equal(retry.reservation.id, winner.reservation.id);
    }

    // After hold TTL expires (10 min + 1s), reconciliation releases capacity and merchant B can book
    const afterExpiryMs = FIXED_NOW_MS + 601_000;
    const rec = await coord.reconcileScheduledReservations(afterExpiryMs);
    assert.equal(rec.expiredHoldsCount, 1);

    const retryB = await coord.createHold({
      merchantUid: 'merchant_b',
      merchantName: 'Boutique B',
      pickup: ABIDJAN_PICKUP,
      pickupAddress: 'Cocody, Abidjan',
      vehicleCategory: 'cargo_van',
      durationType: 'hours',
      reservationDate: TOMORROW_STR,
      startTime: '09:00',
      endTime: '13:00',
      paymentMethod: 'wallet',
      idempotencyKey: 'key_b_retry',
      nowMs: afterExpiryMs,
    });
    assert.equal(retryB.ok, true);
  }
});

// ============================================================================
// 6. HONEST PAYMENT VERIFICATION & WEBHOOK REPLAY IDEMPOTENCY
// ============================================================================

test('Payments: never fakes card/MoMo paid without gateway, verifies wallet/invoice, deduplicates webhooks', async () => {
  const coord = new AtomicReservationCoordinator({
    cities: DEFAULT_CITIES,
    usePolicyCapacityFallback: true,
  });

  const hold = await coord.createHold({
    merchantUid: 'merchant_pay',
    merchantName: 'Test Merchant',
    pickup: ABIDJAN_PICKUP,
    pickupAddress: 'Marcory, Abidjan',
    vehicleCategory: 'cargo_van',
    durationType: 'hours',
    reservationDate: TOMORROW_STR,
    startTime: '10:00',
    endTime: '14:00',
    paymentMethod: 'card',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(hold.ok, true);
  if (!hold.ok) return;

  // Unconfigured card provider -> pending_payment (NEVER falsely marked paid/confirmed)
  const cardConfirm = await coord.confirmReservation({
    reservationId: hold.reservation.id,
    actorUid: 'merchant_pay',
    paymentMethod: 'card',
    paymentCtx: { paymentProviderConfigured: { card: false, mobile_money: false } },
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(cardConfirm.ok, true);
  if (cardConfirm.ok) {
    assert.equal(cardConfirm.paymentOutcome.reservationConfirmed, false);
    assert.equal(cardConfirm.reservation.reservationStatus, 'pending_payment');
    assert.equal(cardConfirm.reservation.paymentStatus, 'pending');
  }

  // Insufficient wallet balance -> rejected cleanly with 402
  const lowWallet = await coord.confirmReservation({
    reservationId: hold.reservation.id,
    actorUid: 'merchant_pay',
    paymentMethod: 'wallet',
    paymentCtx: { walletBalance: 50 },
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(lowWallet.ok, false);
  if (!lowWallet.ok) assert.equal(lowWallet.code, 'INSUFFICIENT_WALLET_BALANCE');

  // Verified webhook settles payment and confirms reservation idempotently
  const rawPayload = JSON.stringify({ eventId: 'evt_wh_1', reservationId: hold.reservation.id });
  const sig = crypto.createHmac('sha256', 'test_secret_12345').update(rawPayload).digest('hex');
  assert.equal(verifyWebhookHmacSignature(rawPayload, sig, 'test_secret_12345'), true);
  assert.equal(verifyWebhookHmacSignature(rawPayload, 'bad_sig', 'test_secret_12345'), false);

  const wh1 = await coord.processPaymentWebhook({
    webhookEventId: 'evt_wh_1',
    reservationId: hold.reservation.id,
    providerReference: 'paystack_ref_999',
    status: 'paid',
    amount: hold.reservation.quotedPrice,
    nowMs: FIXED_NOW_MS + 5000,
  });
  assert.equal(wh1.ok, true);
  if (wh1.ok) {
    assert.equal(wh1.deduplicated, false);
    assert.equal(wh1.reservation.reservationStatus, 'confirmed');
    assert.equal(wh1.reservation.paymentStatus, 'paid');
  }

  // Replay webhook -> deduplicated
  const whReplay = await coord.processPaymentWebhook({
    webhookEventId: 'evt_wh_1',
    reservationId: hold.reservation.id,
    providerReference: 'paystack_ref_999',
    status: 'paid',
    amount: hold.reservation.quotedPrice,
    nowMs: FIXED_NOW_MS + 6000,
  });
  assert.equal(whReplay.ok, true);
  if (whReplay.ok) assert.equal(whReplay.deduplicated, true);
});

// ============================================================================
// 7. COURIER SCHEDULE CONFLICT PREVENTION & REASSIGNMENT
// ============================================================================

test('Dispatch: prevents overlapping or zero-buffer courier double-booking and handles courier cancellation', async () => {
  const courierA: ScheduledCourierSupply = {
    uid: 'drv_1',
    name: 'Mamadou Koné',
    cityId: 'abidjan',
    vehicleCategory: 'cargo_van',
    approvalStatus: 'approved',
    isActive: true,
  };
  const notif = new EventNotificationEngine();
  const coord = new AtomicReservationCoordinator({
    cities: DEFAULT_CITIES,
    usePolicyCapacityFallback: true,
    notificationEngine: notif,
  });

  // Booking 1: 08:30 - 10:30
  const b1 = await coord.createHold({
    merchantUid: 'm1',
    merchantName: 'M1',
    pickup: ABIDJAN_PICKUP,
    pickupAddress: 'Plateau',
    vehicleCategory: 'cargo_van',
    durationType: 'window',
    reservationDate: TOMORROW_STR,
    startTime: '08:30',
    endTime: '10:30',
    paymentMethod: 'invoice',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(b1.ok, true);
  if (!b1.ok) return;
  await coord.confirmReservation({
    reservationId: b1.reservation.id,
    actorUid: 'm1',
    paymentCtx: { businessVerified: true },
    nowMs: FIXED_NOW_MS,
  });

  // Booking 2: starts immediately at 10:30 (violates 30 min transition buffer!)
  const b2 = await coord.createHold({
    merchantUid: 'm2',
    merchantName: 'M2',
    pickup: ABIDJAN_PICKUP,
    pickupAddress: 'Cocody',
    vehicleCategory: 'cargo_van',
    durationType: 'window',
    reservationDate: TOMORROW_STR,
    startTime: '10:30',
    endTime: '12:30',
    paymentMethod: 'invoice',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(b2.ok, true);
  if (!b2.ok) return;
  await coord.confirmReservation({
    reservationId: b2.reservation.id,
    actorUid: 'm2',
    paymentCtx: { businessVerified: true },
    nowMs: FIXED_NOW_MS,
  });

  // Booking 3: starts at 11:00 (exactly 30 min after 10:30 -> allowed!)
  const b3 = await coord.createHold({
    merchantUid: 'm3',
    merchantName: 'M3',
    pickup: ABIDJAN_PICKUP,
    pickupAddress: 'Yopougon',
    vehicleCategory: 'cargo_van',
    durationType: 'window',
    reservationDate: TOMORROW_STR,
    startTime: '11:00',
    endTime: '13:00',
    paymentMethod: 'invoice',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(b3.ok, true);
  if (!b3.ok) return;
  await coord.confirmReservation({
    reservationId: b3.reservation.id,
    actorUid: 'm3',
    paymentCtx: { businessVerified: true },
    nowMs: FIXED_NOW_MS,
  });

  const a1 = await coord.assignCourier({
    reservationId: b1.reservation.id,
    courier: courierA,
    actorUid: 'admin_1',
    actorRole: 'admin',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(a1.ok, true);

  // Back-to-back without buffer MUST be rejected
  const a2 = await coord.assignCourier({
    reservationId: b2.reservation.id,
    courier: courierA,
    actorUid: 'admin_1',
    actorRole: 'admin',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(a2.ok, false);
  if (!a2.ok) assert.equal(a2.code, 'COURIER_SCHEDULE_CONFLICT');

  // After 30 min transition buffer -> allowed
  const a3 = await coord.assignCourier({
    reservationId: b3.reservation.id,
    courier: courierA,
    actorUid: 'admin_1',
    actorRole: 'admin',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(a3.ok, true);

  // Courier cancels b1 -> triggers reassignment_required
  const drop = await coord.handleCourierCancellation({
    reservationId: b1.reservation.id,
    courierUid: courierA.uid,
    reason: 'Vehicle breakdown',
    nowMs: FIXED_NOW_MS + 1000,
  });
  assert.equal(drop.ok, true);
  if (drop.ok) {
    assert.equal(drop.reservation.driverUid, '');
    assert.equal(drop.reservation.assignmentStatus, 'reassignment_required');
  }
});

// ============================================================================
// 8. POLICY CANCELLATION, RESCHEDULING & IDEMPOTENT RECONCILIATION
// ============================================================================

test('Lifecycle: cancellation policy fees, rescheduling revalidation, and idempotent reconciliation', async () => {
  const notif = new EventNotificationEngine();
  const coord = new AtomicReservationCoordinator({
    cities: DEFAULT_CITIES,
    usePolicyCapacityFallback: true,
    notificationEngine: notif,
  });

  const hold = await coord.createHold({
    merchantUid: 'm_life',
    merchantName: 'Life Corp',
    pickup: ABIDJAN_PICKUP,
    pickupAddress: 'Treichville',
    vehicleCategory: 'cargo_van',
    durationType: 'hours',
    reservationDate: TOMORROW_STR,
    startTime: '10:00',
    endTime: '14:00',
    paymentMethod: 'wallet',
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(hold.ok, true);
  if (!hold.ok) return;

  await coord.confirmReservation({
    reservationId: hold.reservation.id,
    actorUid: 'm_life',
    paymentCtx: { walletBalance: 500000 },
    nowMs: FIXED_NOW_MS,
  });

  // >24h before pickup (tomorrow 10:00 vs today 08:00 = 26h) -> 0% cancellation fee
  const abidjan = getCityById('abidjan', DEFAULT_CITIES)!;
  const freeEval = evaluateReservationCancellationPolicy(hold.reservation, abidjan, FIXED_NOW_MS);
  assert.equal(freeEval.allowed, true);
  assert.equal(freeEval.feePercent, 0);
  assert.equal(freeEval.refundAmount, hold.reservation.quotedPrice);

  // 10h before pickup -> 15% late cancel fee
  const pickupMs = zonedWallClockToEpochMs(TOMORROW_STR, '10:00', 'Africa/Abidjan')!;
  const lateEval = evaluateReservationCancellationPolicy(
    hold.reservation,
    abidjan,
    pickupMs - 10 * 3_600_000
  );
  assert.equal(lateEval.allowed, true);
  assert.equal(lateEval.feePercent, 15);
  assert.ok(lateEval.feeAmount > 0);

  // Reschedule from hours (4h) to full_day (8h) -> positive price delta
  const resched = await coord.rescheduleReservation({
    reservationId: hold.reservation.id,
    actorUid: 'm_life',
    reservationDate: TOMORROW_STR,
    startTime: '08:00',
    endTime: '16:00',
    durationType: 'full_day',
    nowMs: FIXED_NOW_MS + 60_000,
  });
  assert.equal(resched.ok, true);
  if (resched.ok) {
    assert.ok(resched.priceDelta > 0);
    assert.equal(resched.reservation.durationType, 'full_day');
  }

  // Reconciliation 80 min before new 08:00 pickup -> opens scheduled dispatch (lead time = 90 min)
  const newPickupMs = zonedWallClockToEpochMs(TOMORROW_STR, '08:00', 'Africa/Abidjan')!;
  const rec1 = await coord.reconcileScheduledReservations(newPickupMs - 80 * 60_000);
  assert.equal(rec1.dispatchStartedCount, 1);

  // Running reconciliation again immediately is idempotent (0 duplicates)
  const rec2 = await coord.reconcileScheduledReservations(newPickupMs - 79 * 60_000);
  assert.equal(rec2.dispatchStartedCount, 0);

  // Reconciliation 20 min before pickup while still unassigned -> escalates to operations
  const rec3 = await coord.reconcileScheduledReservations(newPickupMs - 20 * 60_000);
  assert.equal(rec3.escalatedUnassignedCount, 1);
  assert.equal(coord.getReservation(hold.reservation.id)?.escalationReason, 'UNASSIGNED_PAST_DEADLINE');
});

// ============================================================================
// 9. LIVE HTTP API SECURITY & CONTRACT TESTS
// ============================================================================

test('Live HTTP API: /api/v1/scheduled/availability, /quote, and auth-protected /holds & /ops/scheduled', async () => {
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Valid availability in Abidjan
    const futureDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const availRes = await fetch(`${baseUrl}/api/v1/scheduled/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: ABIDJAN_PICKUP,
        reservationDate: futureDate,
        durationType: 'hours',
        vehicleCategory: 'cargo_van',
      }),
    });
    assert.equal(availRes.status, 200);
    const availJson = (await availRes.json()) as {
      ok: boolean;
      city: { id: string; timezone: string };
      slots: Array<{ bookable: boolean; startTime: string; endTime: string }>;
      vehicles: Array<{ vehicleCategory: string; eligible: boolean }>;
    };
    assert.equal(availJson.ok, true);
    assert.equal(availJson.city.id, 'abidjan');
    assert.equal(availJson.city.timezone, 'Africa/Abidjan');
    assert.ok(availJson.slots.length > 0);
    assert.ok(availJson.vehicles.length >= 6);

    // 2. Out-of-coverage location rejected cleanly with 422
    const outRes = await fetch(`${baseUrl}/api/v1/scheduled/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: OCEAN_OUTSIDE,
        durationType: 'hours',
        vehicleCategory: 'cargo_van',
      }),
    });
    assert.equal(outRes.status, 422);

    // 3. Authoritative server quote endpoint
    const quoteRes = await fetch(`${baseUrl}/api/v1/scheduled/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: ABIDJAN_PICKUP,
        destination: ABIDJAN_DEST,
        reservationDate: futureDate,
        startTime: '09:00',
        endTime: '13:00',
        durationType: 'hours',
        vehicleCategory: 'cargo_van',
        estimatedWeightKg: 50,
        fragile: true,
      }),
    });
    assert.equal(quoteRes.status, 200);
    const quoteJson = (await quoteRes.json()) as { ok: boolean; quote: { customerTotal: number; signatureHash: string } };
    assert.equal(quoteJson.ok, true);
    assert.ok(quoteJson.quote.customerTotal > 0);
    assert.ok(quoteJson.quote.signatureHash.length === 64);

    // 4. Unauthenticated hold creation is blocked (401 or 503 if Supabase unconfigured)
    const unauthHold = await fetch(`${baseUrl}/api/v1/scheduled/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup: ABIDJAN_PICKUP, pickupAddress: 'Plateau' }),
    });
    assert.ok(unauthHold.status === 401 || unauthHold.status === 503);

    // 5. Unauthenticated admin scheduled ops route is blocked
    const unauthOps = await fetch(`${baseUrl}/api/v1/ops/scheduled`);
    assert.ok(unauthOps.status === 401 || unauthOps.status === 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
