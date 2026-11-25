import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  DEFAULT_CITIES,
  getCityById,
  validateDeliveryGeospatial,
} from '../engines/geospatialEngine.ts';
import {
  generateAuthoritativeQuote,
  verifyQuoteForOrderConfirmation,
} from '../engines/pricingEngine.ts';
import {
  canActorViewCourierLocation,
  getAdaptiveGpsFrequencySeconds,
  validateCourierGpsTelemetry,
} from '../engines/courierGpsEngine.ts';
import {
  AtomicDispatchCoordinator,
  AtomicOfferStoreDelivery,
  buildDispatchWaveOffers,
  DeliveryOfferRecord,
  DispatchCourierCandidate,
  sanitizeOfferForCourier,
} from '../engines/dispatchEngine.ts';
import {
  evaluateCancellationPolicy,
  validateDeliveryTransition,
} from '../engines/stateMachineEngine.ts';
import {
  EventNotificationEngine,
  renderNotificationTemplate,
} from '../engines/notificationEngine.ts';
import { runReconciliationCycle } from '../engines/reconciliationEngine.ts';
import { createApiApp } from '../apiApp.ts';

// Reference West African urban coordinates
const ABIDJAN_PLATEAU = { lat: 5.3235, lng: -4.0267 };
const ABIDJAN_COCODY = { lat: 5.3599, lng: -3.987 };
const ABIDJAN_MARCORY = { lat: 5.3025, lng: -3.9835 };
const BOUAKE_CENTER = { lat: 7.6902, lng: -5.0303 };
const YAMOUSSOUKRO_CENTER = { lat: 6.8276, lng: -5.2893 };
const ACCRA_OSU = { lat: 5.556, lng: -0.1819 };
const ACCRA_EAST_LEGON = { lat: 5.6355, lng: -0.156 };
const PARIS_UNSUPPORTED = { lat: 48.8566, lng: 2.3522 };

// ============================================================================
// 1. PRICING & GEOSPATIAL ISOLATION TESTS
// ============================================================================
describe('1. Geospatial City Isolation & Server-Side Pricing Engine', () => {
  it('accepts valid intra-city Abidjan delivery and computes itemized XOF quote with courier/platform split', () => {
    const res = generateAuthoritativeQuote({
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      weightKg: 4,
      routeOverride: {
        distanceKm: 6.4,
        straightLineKm: 5.8,
        durationMin: 18,
        distanceSource: 'google_routes',
        isFallbackEstimate: false,
        geometry: [
          [ABIDJAN_PLATEAU.lat, ABIDJAN_PLATEAU.lng],
          [ABIDJAN_COCODY.lat, ABIDJAN_COCODY.lng],
        ],
      },
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.quote.cityId, 'abidjan');
    assert.equal(res.quote.currency, 'XOF');
    assert.equal(res.quote.distanceSource, 'google_routes');
    assert.equal(res.quote.isFallbackEstimate, false);
    assert.ok(res.quote.customerTotal >= 1500, 'respects Abidjan motorcycle minimum fare');
    assert.equal(
      res.quote.courierEarnings + res.quote.platformCommission,
      res.quote.customerTotal,
      'courier earnings + platform commission equal customer total'
    );
    assert.ok(res.quote.breakdown.length >= 2);
    assert.ok(res.quote.signatureHash.length === 64);
  });

  it('enforces minimum fare floor and applies multi-stop, cargo, fragile, priority & peak surcharges', () => {
    const shortRes = generateAuthoritativeQuote({
      pickup: ABIDJAN_PLATEAU,
      stops: [{ lat: 5.324, lng: -4.026 }],
      vehicleCategory: 'motorcycle',
      routeOverride: {
        distanceKm: 0.5,
        straightLineKm: 0.4,
        durationMin: 3,
        distanceSource: 'osrm',
        isFallbackEstimate: false,
        geometry: [],
      },
    });
    assert.equal(shortRes.ok, true);
    if (shortRes.ok) {
      assert.equal(shortRes.quote.customerTotal, 1500);
    }

    const richRes = generateAuthoritativeQuote({
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY, ABIDJAN_MARCORY],
      vehicleCategory: 'cargo_van',
      weightKg: 35,
      packageSize: 'large',
      fragile: true,
      isPriority: true,
      isPeakHour: true,
      timingType: 'scheduled',
      routeOverride: {
        distanceKm: 12,
        straightLineKm: 9.5,
        durationMin: 35,
        distanceSource: 'osrm',
        isFallbackEstimate: false,
        geometry: [],
      },
    });
    assert.equal(richRes.ok, true);
    if (richRes.ok) {
      const codes = richRes.quote.breakdown.map((b) => b.code);
      assert.ok(codes.includes('multi_stop_fee'));
      assert.ok(codes.includes('cargo_surcharge'));
      assert.ok(codes.includes('fragile_surcharge'));
      assert.ok(codes.includes('scheduled_fee'));
      assert.ok(codes.includes('priority_multiplier'));
      assert.ok(codes.includes('peak_multiplier'));
    }
  });

  it('uses isolated city tariffs (Accra GHS vs Abidjan XOF)', () => {
    const accraRes = generateAuthoritativeQuote({
      pickup: ACCRA_OSU,
      stops: [ACCRA_EAST_LEGON],
      vehicleCategory: 'motorcycle',
      routeOverride: {
        distanceKm: 10,
        straightLineKm: 9.1,
        durationMin: 25,
        distanceSource: 'osrm',
        isFallbackEstimate: false,
        geometry: [],
      },
    });
    assert.equal(accraRes.ok, true);
    if (accraRes.ok) {
      assert.equal(accraRes.quote.cityId, 'accra');
      assert.equal(accraRes.quote.currency, 'GHS');
      assert.ok(accraRes.quote.customerTotal >= 22);
    }
  });

  it('strictly REJECTS cross-city deliveries (Abidjan -> Bouaké, Abidjan -> Yamoussoukro, Accra -> Abidjan)', () => {
    const abjToBouake = validateDeliveryGeospatial({
      pickup: ABIDJAN_PLATEAU,
      stops: [BOUAKE_CENTER],
      vehicleCategory: 'motorcycle',
    });
    assert.equal(abjToBouake.ok, false);
    if (!abjToBouake.ok) assert.equal(abjToBouake.code, 'CROSS_CITY_NOT_SUPPORTED');

    const abjToYamoussoukro = validateDeliveryGeospatial({
      pickup: ABIDJAN_PLATEAU,
      stops: [YAMOUSSOUKRO_CENTER],
      vehicleCategory: 'cargo_van',
    });
    assert.equal(abjToYamoussoukro.ok, false);
    if (!abjToYamoussoukro.ok) assert.equal(abjToYamoussoukro.code, 'CROSS_CITY_NOT_SUPPORTED');

    const accraToAbj = validateDeliveryGeospatial({
      pickup: ACCRA_OSU,
      stops: [ABIDJAN_PLATEAU],
      vehicleCategory: 'motorcycle',
    });
    assert.equal(accraToAbj.ok, false);
    if (!accraToAbj.ok) assert.equal(accraToAbj.code, 'CROSS_CITY_NOT_SUPPORTED');
  });

  it('rejects unsupported cities and routes exceeding city max distance', () => {
    const unsupported = validateDeliveryGeospatial({
      pickup: PARIS_UNSUPPORTED,
      stops: [{ lat: 48.86, lng: 2.35 }],
      vehicleCategory: 'motorcycle',
    });
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) assert.equal(unsupported.code, 'PICKUP_OUTSIDE_SERVICE_AREA');

    const tooLong = generateAuthoritativeQuote({
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      routeOverride: {
        distanceKm: 95,
        straightLineKm: 6,
        durationMin: 180,
        distanceSource: 'osrm',
        isFallbackEstimate: false,
        geometry: [],
      },
    });
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.equal(tooLong.code, 'ROUTE_LIMIT_EXCEEDED');
  });

  it('rejects expired quotes, manipulated frontend prices, and tampered signatures', () => {
    const now = Date.now();
    const res = generateAuthoritativeQuote({
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      nowMs: now,
      quoteTtlSeconds: 120,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    // 1. Valid confirmation passes
    const okVerify = verifyQuoteForOrderConfirmation({
      quote: res.quote,
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      clientSubmittedPrice: res.quote.customerTotal,
      nowMs: now + 30_000,
    });
    assert.equal(okVerify.ok, true);

    // 2. Manipulated frontend price rejected
    const tamperedPrice = verifyQuoteForOrderConfirmation({
      quote: res.quote,
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      clientSubmittedPrice: 100, // Client tried to pay 100 XOF instead of server total
      nowMs: now + 30_000,
    });
    assert.equal(tamperedPrice.ok, false);
    assert.equal(tamperedPrice.code, 'PRICE_MANIPULATION_DETECTED');

    // 3. Expired quote rejected
    const expired = verifyQuoteForOrderConfirmation({
      quote: res.quote,
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      nowMs: now + 180_000,
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'QUOTE_EXPIRED');

    // 4. Tampered quote total without valid HMAC rejected
    const forged = { ...res.quote, customerTotal: 500 };
    const sigFail = verifyQuoteForOrderConfirmation({
      quote: forged,
      pickup: ABIDJAN_PLATEAU,
      stops: [ABIDJAN_COCODY],
      vehicleCategory: 'motorcycle',
      nowMs: now + 10_000,
    });
    assert.equal(sigFail.ok, false);
    assert.equal(sigFail.code, 'QUOTE_SIGNATURE_INVALID');
  });
});

// ============================================================================
// 2. DISPATCH & ATOMIC CONCURRENCY TESTS
// ============================================================================
describe('2. Dispatch Engine, Wave Expansion & Atomic Concurrent Offer Acceptance', () => {
  const abidjan = getCityById('abidjan', DEFAULT_CITIES)!;
  const now = Date.now();

  const makeCourier = (overrides: Partial<DispatchCourierCandidate>): DispatchCourierCandidate => ({
    uid: 'drv_default',
    firstName: 'Kouassi',
    cityId: 'abidjan',
    approvalStatus: 'approved',
    isOnline: true,
    availabilityStatus: 'AVAILABLE',
    vehicleCategory: 'motorcycle',
    currentLat: 5.325,
    currentLng: -4.025,
    gpsAccuracyMeters: 15,
    gpsUpdatedAtMs: now - 10_000,
    rating: 4.9,
    acceptanceRate: 96,
    activeDeliveryCount: 0,
    maxConcurrentDeliveries: 1,
    ...overrides,
  });

  it('excludes stale GPS, wrong city, offline, suspended, and incompatible vehicle couriers', () => {
    const candidates: DispatchCourierCandidate[] = [
      makeCourier({ uid: 'drv_good', firstName: 'Aya', currentLat: 5.324, currentLng: -4.026 }),
      makeCourier({ uid: 'drv_stale', gpsUpdatedAtMs: now - 300_000 }), // 5 min stale
      makeCourier({ uid: 'drv_bouake', cityId: 'bouake', currentLat: BOUAKE_CENTER.lat, currentLng: BOUAKE_CENTER.lng }),
      makeCourier({ uid: 'drv_offline', isOnline: false, availabilityStatus: 'OFFLINE' }),
      makeCourier({ uid: 'drv_bad_acc', gpsAccuracyMeters: 400 }),
      makeCourier({ uid: 'drv_busy', activeDeliveryCount: 1, maxConcurrentDeliveries: 1 }),
    ];

    const plan = buildDispatchWaveOffers({
      deliveryId: 'del_1',
      city: abidjan,
      pickup: ABIDJAN_PLATEAU,
      requiredVehicle: 'motorcycle',
      weightKg: 3,
      offeredEarnings: 2400,
      waveNumber: 1,
      candidates,
      nowMs: now,
    });

    assert.equal(plan.offers.length, 1);
    assert.equal(plan.offers[0].courierUid, 'drv_good');
    assert.equal(plan.excludedReasons.drv_stale, 'STALE_GPS');
    assert.equal(plan.excludedReasons.drv_bouake, 'WRONG_CITY');
    assert.equal(plan.excludedReasons.drv_bad_acc, 'POOR_GPS_ACCURACY');
    assert.equal(plan.excludedReasons.drv_busy, 'AT_CAPACITY');

    // Internal ranking score MUST be stripped before sending to courier client
    const sanitized = sanitizeOfferForCourier(plan.offers[0]) as unknown as Record<string, unknown>;
    assert.equal('internalScore' in sanitized, false);
  });

  it('expands search radius across Wave 1 (3 km) -> Wave 2 (8 km)', () => {
    // Courier ~5.5 km away from Plateau (Cocody)
    const farCourier = makeCourier({
      uid: 'drv_cocody',
      currentLat: ABIDJAN_COCODY.lat,
      currentLng: ABIDJAN_COCODY.lng,
    });

    const wave1 = buildDispatchWaveOffers({
      deliveryId: 'del_wave',
      city: abidjan,
      pickup: ABIDJAN_PLATEAU,
      requiredVehicle: 'motorcycle',
      weightKg: 2,
      offeredEarnings: 2000,
      waveNumber: 1,
      candidates: [farCourier],
      nowMs: now,
    });
    assert.equal(wave1.offers.length, 0);

    const wave2 = buildDispatchWaveOffers({
      deliveryId: 'del_wave',
      city: abidjan,
      pickup: ABIDJAN_PLATEAU,
      requiredVehicle: 'motorcycle',
      weightKg: 2,
      offeredEarnings: 2000,
      waveNumber: 2,
      candidates: [farCourier],
      nowMs: now,
    });
    assert.equal(wave2.offers.length, 1);
    assert.equal(wave2.offers[0].courierUid, 'drv_cocody');
  });

  it('guarantees SINGLE WINNER on simultaneous concurrent offer acceptance and supersedes competing offers', async () => {
    const c1 = makeCourier({ uid: 'drv_1', firstName: 'Koffi' });
    const c2 = makeCourier({ uid: 'drv_2', firstName: 'Bintou' });

    const plan = buildDispatchWaveOffers({
      deliveryId: 'del_race',
      city: abidjan,
      pickup: ABIDJAN_PLATEAU,
      requiredVehicle: 'motorcycle',
      weightKg: 2,
      offeredEarnings: 2200,
      waveNumber: 1,
      candidates: [c1, c2],
      nowMs: now,
    });
    assert.equal(plan.offers.length, 2);

    const offers = new Map<string, DeliveryOfferRecord>(plan.offers.map((o) => [o.id, o]));
    const deliveries = new Map<string, AtomicOfferStoreDelivery>([
      ['del_race', { id: 'del_race', cityId: 'abidjan', status: 'searching_courier', driverUid: '' }],
    ]);
    const couriers = new Map<string, DispatchCourierCandidate>([
      [c1.uid, { ...c1 }],
      [c2.uid, { ...c2 }],
    ]);

    const coordinator = new AtomicDispatchCoordinator();
    const [res1, res2] = await Promise.all([
      coordinator.acceptOffer({
        offerId: plan.offers[0].id,
        courierUid: plan.offers[0].courierUid,
        offers,
        deliveries,
        couriers,
        nowMs: now + 5_000,
      }),
      coordinator.acceptOffer({
        offerId: plan.offers[1].id,
        courierUid: plan.offers[1].courierUid,
        offers,
        deliveries,
        couriers,
        nowMs: now + 5_000,
      }),
    ]);

    const winners = [res1, res2].filter((r) => r.ok);
    const losers = [res1, res2].filter((r) => !r.ok);
    assert.equal(winners.length, 1, 'EXACTLY ONE courier wins the delivery');
    assert.equal(losers.length, 1, 'Second concurrent courier is cleanly rejected');

    const statuses = Array.from(offers.values()).map((o) => o.status).sort();
    assert.deepEqual(statuses, ['ACCEPTED', 'SUPERSEDED']);
    assert.equal(deliveries.get('del_race')?.status, 'driver_assigned');
  });

  it('rejects expired offer and unauthorized courier accepting another courier offer', async () => {
    const c1 = makeCourier({ uid: 'drv_1' });
    const plan = buildDispatchWaveOffers({
      deliveryId: 'del_exp',
      city: abidjan,
      pickup: ABIDJAN_PLATEAU,
      requiredVehicle: 'motorcycle',
      weightKg: 2,
      offeredEarnings: 2000,
      waveNumber: 1,
      candidates: [c1],
      nowMs: now,
    });

    const offer = plan.offers[0];
    const offers = new Map([[offer.id, offer]]);
    const deliveries = new Map<string, AtomicOfferStoreDelivery>([
      ['del_exp', { id: 'del_exp', cityId: 'abidjan', status: 'searching_courier', driverUid: '' }],
    ]);
    const couriers = new Map([[c1.uid, { ...c1 }]]);
    const coordinator = new AtomicDispatchCoordinator();

    // Wrong courier
    const wrongCourier = await coordinator.acceptOffer({
      offerId: offer.id,
      courierUid: 'drv_intruder',
      offers,
      deliveries,
      couriers,
      nowMs: now + 5_000,
    });
    assert.equal(wrongCourier.ok, false);
    assert.equal(wrongCourier.code, 'OFFER_UNAUTHORIZED');

    // Expired offer (past 30s TTL)
    const expired = await coordinator.acceptOffer({
      offerId: offer.id,
      courierUid: c1.uid,
      offers,
      deliveries,
      couriers,
      nowMs: now + 45_000,
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'OFFER_EXPIRED');
    assert.equal(offer.status, 'EXPIRED');
  });
});

// ============================================================================
// 3. DELIVERY STATE MACHINE, POD, CANCELLATION & RETURN WORKFLOW TESTS
// ============================================================================
describe('3. Delivery Lifecycle State Machine, PoD & Cancellation/Return Policy', () => {
  const abidjan = getCityById('abidjan', DEFAULT_CITIES)!;

  it('enforces valid transitions, rejects invalid jumps, handles idempotent duplicates, and enforces OTP PoD', () => {
    // Invalid jump: searching_courier -> delivered
    const badJump = validateDeliveryTransition({
      currentStatus: 'searching_courier',
      nextStatus: 'delivered',
      actorUid: 'drv_1',
      actorRole: 'courier',
      merchantUid: 'cust_1',
      assignedDriverUid: 'drv_1',
    });
    assert.equal(badJump.ok, false);
    assert.equal(badJump.code, 'INVALID_TRANSITION');

    // Customer trying to force driver status rejected
    const clientOverride = validateDeliveryTransition({
      currentStatus: 'driver_assigned',
      nextStatus: 'delivered',
      actorUid: 'cust_1',
      actorRole: 'customer',
      merchantUid: 'cust_1',
      assignedDriverUid: 'drv_1',
    });
    assert.equal(clientOverride.ok, false);
    assert.equal(clientOverride.code, 'UNAUTHORIZED_ACTOR');

    // Duplicate transition is idempotent
    const dup = validateDeliveryTransition({
      currentStatus: 'in_transit',
      nextStatus: 'in_transit',
      actorUid: 'drv_1',
      actorRole: 'courier',
      merchantUid: 'cust_1',
      assignedDriverUid: 'drv_1',
    });
    assert.equal(dup.ok, true);
    assert.equal(dup.idempotent, true);

    // Missing PoD rejected on arrived -> delivered
    const missingPod = validateDeliveryTransition({
      currentStatus: 'arrived',
      nextStatus: 'delivered',
      actorUid: 'drv_1',
      actorRole: 'courier',
      merchantUid: 'cust_1',
      assignedDriverUid: 'drv_1',
      proofRequired: 'otp',
    });
    assert.equal(missingPod.ok, false);
    assert.equal(missingPod.code, 'PROOF_OF_DELIVERY_REQUIRED');

    // Wrong OTP rejected
    const wrongOtp = validateDeliveryTransition({
      currentStatus: 'arrived',
      nextStatus: 'delivered',
      actorUid: 'drv_1',
      actorRole: 'courier',
      merchantUid: 'cust_1',
      assignedDriverUid: 'drv_1',
      proofRequired: 'otp',
      proofPayload: { method: 'otp', providedCode: '9999', expectedCode: '4821' },
    });
    assert.equal(wrongOtp.ok, false);
    assert.equal(wrongOtp.code, 'INVALID_PROOF_CODE');

    // Valid OTP passes and terminates tracking
    const validDelivery = validateDeliveryTransition(
      {
        currentStatus: 'arrived',
        nextStatus: 'delivered',
        actorUid: 'drv_1',
        actorRole: 'courier',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
        proofRequired: 'otp',
        proofPayload: { method: 'otp', providedCode: '4821', expectedCode: '4821' },
      },
      'with_courier'
    );
    assert.equal(validDelivery.ok, true);
    assert.equal(validDelivery.nextCustodyStatus, 'delivered_to_recipient');
    assert.equal(validDelivery.shouldStopTracking, true);
  });

  it('applies transparent state-based cancellation fees and BLOCKS normal cancellation after pickup', () => {
    const now = Date.now();

    // Pre-assignment: free
    const preAssign = evaluateCancellationPolicy({
      status: 'searching_courier',
      quotedPrice: 3000,
      city: abidjan,
      createdAtMs: now - 60_000,
      actorRole: 'customer',
      nowMs: now,
    });
    assert.equal(preAssign.allowed, true);
    assert.equal(preAssign.feeAmount, 0);
    assert.equal(preAssign.refundAmount, 3000);

    // Assigned past grace window: city fee applied
    const assignedLate = evaluateCancellationPolicy({
      status: 'driver_assigned',
      quotedPrice: 3000,
      city: abidjan,
      createdAtMs: now - 300_000,
      actorRole: 'customer',
      nowMs: now,
    });
    assert.equal(assignedLate.allowed, true);
    assert.equal(assignedLate.feeAmount, 500);
    assert.equal(assignedLate.refundAmount, 2500);

    // Post-pickup: normal cancel BLOCKED, return workflow required
    const postPickup = evaluateCancellationPolicy({
      status: 'in_transit',
      quotedPrice: 3000,
      city: abidjan,
      createdAtMs: now - 600_000,
      actorRole: 'customer',
      nowMs: now,
    });
    assert.equal(postPickup.allowed, false);
    assert.equal(postPickup.requiresReturnWorkflow, true);
    assert.ok(postPickup.returnFeeAmount > 0);

    // State machine also blocks customer cancelling in_transit
    const blockedTransition = validateDeliveryTransition(
      {
        currentStatus: 'in_transit',
        nextStatus: 'cancelled',
        actorUid: 'cust_1',
        actorRole: 'customer',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
      },
      'with_courier'
    );
    assert.equal(blockedTransition.ok, false);
    assert.equal(blockedTransition.code, 'POST_PICKUP_CANCEL_BLOCKED');
  });

  it('preserves parcel custody on failed delivery and supports complete return-to-sender lifecycle', () => {
    const failNoReason = validateDeliveryTransition(
      {
        currentStatus: 'arrived',
        nextStatus: 'failed',
        actorUid: 'drv_1',
        actorRole: 'courier',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
      },
      'with_courier'
    );
    assert.equal(failNoReason.ok, false);
    assert.equal(failNoReason.code, 'FAILURE_REASON_REQUIRED');

    const failed = validateDeliveryTransition(
      {
        currentStatus: 'arrived',
        nextStatus: 'failed',
        actorUid: 'drv_1',
        actorRole: 'courier',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
        failureReason: 'Destinataire injoignable après 3 appels',
      },
      'with_courier'
    );
    assert.equal(failed.ok, true);
    assert.equal(failed.nextCustodyStatus, 'with_courier');

    const retReq = validateDeliveryTransition(
      {
        currentStatus: 'failed',
        nextStatus: 'return_required',
        actorUid: 'drv_1',
        actorRole: 'courier',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
      },
      'with_courier'
    );
    assert.equal(retReq.ok, true);

    const retTransit = validateDeliveryTransition(
      {
        currentStatus: 'return_required',
        nextStatus: 'return_in_progress',
        actorUid: 'drv_1',
        actorRole: 'courier',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
      },
      'with_courier'
    );
    assert.equal(retTransit.ok, true);
    assert.equal(retTransit.nextCustodyStatus, 'return_in_transit');

    const retDone = validateDeliveryTransition(
      {
        currentStatus: 'return_in_progress',
        nextStatus: 'return_completed',
        actorUid: 'drv_1',
        actorRole: 'courier',
        merchantUid: 'cust_1',
        assignedDriverUid: 'drv_1',
      },
      'return_in_transit'
    );
    assert.equal(retDone.ok, true);
    assert.equal(retDone.nextCustodyStatus, 'returned_to_sender');
    assert.equal(retDone.shouldStopTracking, true);
  });
});

// ============================================================================
// 4. EVENT-DRIVEN NOTIFICATION ENGINE TESTS
// ============================================================================
describe('4. Event-Driven Notification Outbox, Deduplication & Retry Safety', () => {
  it('renders centralized fr/en templates, deduplicates identical events, isolates failures, and retries with backoff', async () => {
    const fr = renderNotificationTemplate('delivery.courier_assigned', 'fr', {
      reference: 'RV-100200',
      courierName: 'Moussa',
      etaMinutes: 9,
    });
    assert.ok(fr.title.includes('RV-100200'));
    assert.ok(fr.message.includes('Moussa'));

    let smsCalls = 0;
    const engine = new EventNotificationEngine({
      sms: async () => {
        smsCalls += 1;
        if (smsCalls === 1) {
          return { status: 'failed', provider: 'sms_gateway', error: 'Transient 503' };
        }
        return { status: 'sent', provider: 'sms_gateway' };
      },
    });

    const now = Date.now();
    // Emit twice with same eventId -> second must be deduplicated
    const first = await engine.emitEventNotifications({
      eventId: 'evt_abc',
      deliveryId: 'del_1',
      templateKey: 'delivery.package_collected',
      vars: { reference: 'RV-100200', courierName: 'Moussa' },
      recipients: [{ uid: 'cust_1', role: 'customer', channels: ['in_app', 'sms', 'push'] }],
      nowMs: now,
    });
    const second = await engine.emitEventNotifications({
      eventId: 'evt_abc',
      deliveryId: 'del_1',
      templateKey: 'delivery.package_collected',
      vars: { reference: 'RV-100200', courierName: 'Moussa' },
      recipients: [{ uid: 'cust_1', role: 'customer', channels: ['in_app', 'sms', 'push'] }],
      nowMs: now,
    });

    assert.equal(first.length, 3);
    assert.equal(second.length, 0, 'Duplicate notifications strictly prevented');

    const inApp = first.find((i) => i.channel === 'in_app')!;
    const sms = first.find((i) => i.channel === 'sms')!;
    const push = first.find((i) => i.channel === 'push')!;

    assert.equal(inApp.status, 'sent');
    assert.equal(sms.status, 'failed');
    assert.ok(sms.nextRetryAtMs && sms.nextRetryAtMs > now);
    assert.equal(push.status, 'skipped_unconfigured', 'Unconfigured push provider is honestly marked skipped_unconfigured');

    // Retry after backoff succeeds
    const retryRes = await engine.retryEligibleOutbox(now + 60_000);
    assert.equal(retryRes.retried, 1);
    assert.equal(retryRes.sent, 1);
    assert.equal(sms.status, 'sent');
  });
});

// ============================================================================
// 5. GPS TELEMETRY & TRACKING PRIVACY TESTS
// ============================================================================
describe('5. Courier GPS Telemetry Validation & Location Privacy Controls', () => {
  const now = Date.now();
  const baseCourier = {
    uid: 'drv_1',
    cityId: 'abidjan',
    approvalStatus: 'approved' as const,
    isOnline: true,
    availabilityStatus: 'DELIVERY_IN_PROGRESS' as const,
    lastLat: ABIDJAN_PLATEAU.lat,
    lastLng: ABIDJAN_PLATEAU.lng,
    lastGpsUpdatedAtMs: now - 10_000,
  };

  it('accepts valid fresh GPS and rejects invalid, stale, inaccurate, offline, wrong-city, and teleportation samples', () => {
    const valid = validateCourierGpsTelemetry({
      sample: {
        courierUid: 'drv_1',
        lat: 5.3245,
        lng: -4.026,
        accuracyMeters: 18,
        recordedAtMs: now - 2_000,
      },
      courier: baseCourier,
      activeDeliveryStatus: 'in_transit',
      nowMs: now,
    });
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.city.id, 'abidjan');
      assert.equal(valid.recommendedNextIntervalSec, 10);
    }

    // Poor accuracy
    const poor = validateCourierGpsTelemetry({
      sample: { courierUid: 'drv_1', lat: 5.3245, lng: -4.026, accuracyMeters: 500, recordedAtMs: now },
      courier: baseCourier,
      nowMs: now,
    });
    assert.equal(poor.ok, false);
    if (!poor.ok) assert.equal(poor.code, 'POOR_GPS_ACCURACY');

    // Stale sample
    const stale = validateCourierGpsTelemetry({
      sample: { courierUid: 'drv_1', lat: 5.3245, lng: -4.026, accuracyMeters: 20, recordedAtMs: now - 300_000 },
      courier: baseCourier,
      nowMs: now,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, 'STALE_GPS_SAMPLE');

    // Offline courier
    const offline = validateCourierGpsTelemetry({
      sample: { courierUid: 'drv_1', lat: 5.3245, lng: -4.026, accuracyMeters: 20, recordedAtMs: now },
      courier: { ...baseCourier, isOnline: false, availabilityStatus: 'OFFLINE' },
      nowMs: now,
    });
    assert.equal(offline.ok, false);
    if (!offline.ok) assert.equal(offline.code, 'COURIER_OFFLINE');

    // Wrong city (Bouaké GPS for Abidjan courier)
    const wrongCity = validateCourierGpsTelemetry({
      sample: { courierUid: 'drv_1', lat: BOUAKE_CENTER.lat, lng: BOUAKE_CENTER.lng, accuracyMeters: 20, recordedAtMs: now },
      courier: baseCourier,
      nowMs: now,
    });
    assert.equal(wrongCity.ok, false);
    if (!wrongCity.ok) assert.equal(wrongCity.code, 'OUTSIDE_OPERATING_CITY');

    // Teleportation jump (> 180 km/h inside Abidjan in 5 seconds)
    const jump = validateCourierGpsTelemetry({
      sample: { courierUid: 'drv_1', lat: 5.45, lng: -3.9, accuracyMeters: 15, recordedAtMs: now - 5_000 },
      courier: baseCourier,
      nowMs: now,
    });
    assert.equal(jump.ok, false);
    if (!jump.ok) assert.equal(jump.code, 'IMPOSSIBLE_GPS_JUMP');

    // Adaptive GPS frequency stops on delivered/offline
    assert.equal(getAdaptiveGpsFrequencySeconds('OFFLINE', null), 0);
    assert.equal(getAdaptiveGpsFrequencySeconds('ASSIGNED', 'delivered'), 0);
  });

  it('enforces strict location privacy and stops tracking immediately after delivery completion', () => {
    const active = { merchantUid: 'cust_1', driverUid: 'drv_1', status: 'in_transit' };
    assert.equal(canActorViewCourierLocation({ actorUid: 'cust_1', isAdmin: false, delivery: active }).allowed, true);
    assert.equal(canActorViewCourierLocation({ actorUid: 'cust_2', isAdmin: false, delivery: active }).allowed, false);

    const completed = { merchantUid: 'cust_1', driverUid: 'drv_1', status: 'delivered' };
    const afterDone = canActorViewCourierLocation({ actorUid: 'cust_1', isAdmin: false, delivery: completed });
    assert.equal(afterDone.allowed, false);
    assert.equal(afterDone.reason, 'TRACKING_TERMINATED');
  });
});

// ============================================================================
// 6. RECONCILIATION IDEMPOTENCY & HTTP API SECURITY TESTS
// ============================================================================
describe('6. Reconciliation Engine Idempotency & Live Express API Security', () => {
  it('expires overdue offers, flags stale GPS couriers, escalates stuck searches, audits missing PoD, and stops terminal tracking idempotently', async () => {
    const now = Date.now();
    const offers: DeliveryOfferRecord[] = [
      {
        id: 'off_stale',
        deliveryId: 'del_stuck',
        cityId: 'abidjan',
        courierUid: 'drv_stale',
        waveNumber: 1,
        status: 'SENT',
        internalScore: 80,
        estimatedPickupDistanceKm: 2,
        estimatedPickupEtaMin: 5,
        offeredEarnings: 2000,
        currency: 'XOF',
        sentAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now - 10_000).toISOString(),
      },
    ];
    const couriers = [
      {
        uid: 'drv_stale',
        cityId: 'abidjan',
        isOnline: true,
        availabilityStatus: 'AVAILABLE' as const,
        gpsUpdatedAtMs: now - 300_000,
      },
    ];
    const deliveries = [
      {
        id: 'del_stuck',
        reference: 'RV-STUCK',
        cityId: 'abidjan',
        merchantUid: 'cust_1',
        status: 'searching_courier',
        driverUid: '',
        searchStartedAtMs: now - 400_000,
        dispatchWave: 3,
        podVerified: false,
        showLiveTracking: false,
      },
      {
        id: 'del_done_leak',
        reference: 'RV-DONE',
        cityId: 'abidjan',
        merchantUid: 'cust_1',
        status: 'delivered',
        driverUid: 'drv_1',
        dispatchWave: 1,
        podVerified: false,
        showLiveTracking: true,
      },
    ];

    const notifEngine = new EventNotificationEngine();
    const firstRun = await runReconciliationCycle({
      offers,
      couriers,
      deliveries,
      notificationEngine: notifEngine,
      nowMs: now,
    });

    assert.equal(firstRun.expiredOffersCount, 1);
    assert.equal(firstRun.staleCouriersFlaggedCount, 1);
    assert.equal(firstRun.stuckSearchesEscalatedCount, 1);
    assert.equal(firstRun.missingPodFlaggedCount, 1);
    assert.equal(firstRun.trackingTerminatedCount, 1);
    assert.equal(offers[0].status, 'EXPIRED');
    assert.equal(couriers[0].availabilityStatus, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(deliveries[0].status, 'needs_support');
    assert.equal(deliveries[1].showLiveTracking, false);

    // Second run is strictly idempotent (zero duplicate mutations)
    const secondRun = await runReconciliationCycle({
      offers,
      couriers,
      deliveries,
      notificationEngine: notifEngine,
      nowMs: now + 5_000,
    });
    assert.equal(secondRun.expiredOffersCount, 0);
    assert.equal(secondRun.staleCouriersFlaggedCount, 0);
    assert.equal(secondRun.stuckSearchesEscalatedCount, 0);
    assert.equal(secondRun.trackingTerminatedCount, 0);
  });

  it('serves /api/v1/cities, enforces cross-city rejection on /api/v1/quotes, and blocks unauthenticated admin/cron routes', async () => {
    const app = createApiApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 1. Active cities endpoint
      const citiesRes = await fetch(`${base}/api/v1/cities`);
      assert.equal(citiesRes.status, 200);
      const citiesData = (await citiesRes.json()) as { cities: Array<{ id: string }> };
      assert.ok(citiesData.cities.some((c) => c.id === 'abidjan'));
      assert.ok(citiesData.cities.some((c) => c.id === 'accra'));

      // 2. Cross-city Abidjan -> Bouaké rejected with 422
      const crossRes = await fetch(`${base}/api/v1/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickup: ABIDJAN_PLATEAU,
          stops: [BOUAKE_CENTER],
          vehicleCategory: 'motorcycle',
        }),
      });
      assert.equal(crossRes.status, 422);
      const crossBody = (await crossRes.json()) as { code?: string };
      assert.equal(crossBody.code, 'CROSS_CITY_NOT_SUPPORTED');

      // 3. Unauthenticated admin & cron routes strictly rejected
      const opsRes = await fetch(`${base}/api/v1/ops/overview`);
      assert.ok(opsRes.status === 401 || opsRes.status === 503);

      const cronRes = await fetch(`${base}/api/v1/cron/reconcile`, { method: 'POST' });
      assert.equal(cronRes.status, 401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
