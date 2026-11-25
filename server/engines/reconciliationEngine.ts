import { CityConfig, DEFAULT_CITIES, getCityById } from './geospatialEngine.ts';
import {
  CourierAvailabilityState,
  isCourierGpsFresh,
} from './courierGpsEngine.ts';
import { DeliveryOfferRecord, OPEN_OFFER_STATUSES } from './dispatchEngine.ts';
import { TERMINAL_DELIVERY_STATUSES } from './stateMachineEngine.ts';
import { EventNotificationEngine } from './notificationEngine.ts';
import { logOperationalEvent } from './observability.ts';

export interface ReconcilableCourier {
  uid: string;
  cityId: string;
  isOnline: boolean;
  availabilityStatus: CourierAvailabilityState;
  gpsUpdatedAtMs: number;
}

export interface ReconcilableDelivery {
  id: string;
  reference: string;
  cityId: string;
  merchantUid: string;
  status: string;
  driverUid: string;
  searchStartedAtMs?: number | null;
  dispatchWave: number;
  podVerified: boolean;
  showLiveTracking: boolean;
}

export interface ReconciliationEventRecord {
  deliveryId?: string;
  courierUid?: string;
  eventType: string;
  summary: string;
  timestamp: string;
}

export interface ReconciliationReport {
  runAt: string;
  expiredOffersCount: number;
  staleCouriersFlaggedCount: number;
  stuckSearchesEscalatedCount: number;
  missingPodFlaggedCount: number;
  trackingTerminatedCount: number;
  notificationsRetriedCount: number;
  notificationsSentCount: number;
  events: ReconciliationEventRecord[];
}

/**
 * Idempotent Operational Reconciliation Engine.
 * Safely executable on Vercel Cron, background workers, or Admin Ops manual trigger.
 */
export async function runReconciliationCycle(params: {
  offers: DeliveryOfferRecord[];
  couriers: ReconcilableCourier[];
  deliveries: ReconcilableDelivery[];
  notificationEngine?: EventNotificationEngine;
  cities?: CityConfig[];
  nowMs?: number;
}): Promise<ReconciliationReport> {
  const cities = params.cities || DEFAULT_CITIES;
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const events: ReconciliationEventRecord[] = [];

  let expiredOffersCount = 0;
  let staleCouriersFlaggedCount = 0;
  let stuckSearchesEscalatedCount = 0;
  let missingPodFlaggedCount = 0;
  let trackingTerminatedCount = 0;

  // 1. Expire overdue open dispatch offers
  for (const offer of params.offers) {
    if (OPEN_OFFER_STATUSES.has(offer.status) && Date.parse(offer.expiresAt) <= nowMs) {
      offer.status = 'EXPIRED';
      expiredOffersCount += 1;
      events.push({
        deliveryId: offer.deliveryId,
        courierUid: offer.courierUid,
        eventType: 'offer.expired',
        summary: `Offer ${offer.id} (wave ${offer.waveNumber}) expired automatically.`,
        timestamp: nowIso,
      });
    }
  }

  // 2. Mark couriers with stale GPS as TEMPORARILY_UNAVAILABLE so dispatch excludes them
  for (const courier of params.couriers) {
    if (
      !courier.isOnline ||
      courier.availabilityStatus === 'OFFLINE' ||
      courier.availabilityStatus === 'SUSPENDED' ||
      courier.availabilityStatus === 'TEMPORARILY_UNAVAILABLE'
    ) {
      continue;
    }
    const city = getCityById(courier.cityId, cities) || cities[0];
    if (!isCourierGpsFresh(courier.gpsUpdatedAtMs, city.gpsPolicy.maxStaleSeconds, nowMs)) {
      courier.availabilityStatus = 'TEMPORARILY_UNAVAILABLE';
      staleCouriersFlaggedCount += 1;
      events.push({
        courierUid: courier.uid,
        eventType: 'courier.gps_stale',
        summary: `Courier ${courier.uid} flagged TEMPORARILY_UNAVAILABLE due to stale GPS.`,
        timestamp: nowIso,
      });
    }
  }

  // 3. Detect stuck courier searches, missing PoD on delivered orders, and stale live tracking
  for (const delivery of params.deliveries) {
    const city = getCityById(delivery.cityId, cities) || cities[0];

    // 3a. Stuck search timeout -> escalate to unassigned / needs_support
    if (
      (delivery.status === 'pending' || delivery.status === 'searching_courier') &&
      !delivery.driverUid &&
      delivery.searchStartedAtMs &&
      (nowMs - delivery.searchStartedAtMs) / 1000 >= city.dispatchConfig.searchTimeoutSeconds
    ) {
      delivery.status = 'needs_support';
      stuckSearchesEscalatedCount += 1;
      events.push({
        deliveryId: delivery.id,
        eventType: 'delivery.no_courier_found',
        summary: `Delivery ${delivery.reference} exceeded search timeout (${city.dispatchConfig.searchTimeoutSeconds}s); escalated to operations.`,
        timestamp: nowIso,
      });

      if (params.notificationEngine) {
        await params.notificationEngine.emitEventNotifications({
          eventId: `reconcile_nocourier_${delivery.id}`,
          deliveryId: delivery.id,
          templateKey: 'delivery.no_courier_found',
          vars: { reference: delivery.reference, cityName: city.name },
          recipients: [{ uid: delivery.merchantUid, role: 'customer', channels: ['in_app', 'realtime'] }],
          nowMs,
        });
      }
    }

    // 3b. Missing PoD audit check on delivered orders
    if (delivery.status === 'delivered' && !delivery.podVerified) {
      missingPodFlaggedCount += 1;
      events.push({
        deliveryId: delivery.id,
        eventType: 'pod.missing_audit',
        summary: `Delivery ${delivery.reference} marked delivered without verified PoD record.`,
        timestamp: nowIso,
      });
    }

    // 3c. Terminate live tracking on any terminal delivery
    if (
      (TERMINAL_DELIVERY_STATUSES.has(delivery.status as never) || delivery.status === 'failed') &&
      delivery.showLiveTracking
    ) {
      delivery.showLiveTracking = false;
      trackingTerminatedCount += 1;
      events.push({
        deliveryId: delivery.id,
        eventType: 'tracking.terminated',
        summary: `Stopped live tracking for terminal delivery ${delivery.reference} (${delivery.status}).`,
        timestamp: nowIso,
      });
    }
  }

  // 4. Retry eligible failed notifications
  let notificationsRetriedCount = 0;
  let notificationsSentCount = 0;
  if (params.notificationEngine) {
    const notifResult = await params.notificationEngine.retryEligibleOutbox(nowMs);
    notificationsRetriedCount = notifResult.retried;
    notificationsSentCount = notifResult.sent;
  }

  const report: ReconciliationReport = {
    runAt: nowIso,
    expiredOffersCount,
    staleCouriersFlaggedCount,
    stuckSearchesEscalatedCount,
    missingPodFlaggedCount,
    trackingTerminatedCount,
    notificationsRetriedCount,
    notificationsSentCount,
    events,
  };

  logOperationalEvent('info', 'reconciliation.completed', {
    expiredOffersCount,
    staleCouriersFlaggedCount,
    stuckSearchesEscalatedCount,
    missingPodFlaggedCount,
    trackingTerminatedCount,
    notificationsRetriedCount,
  });

  return report;
}
