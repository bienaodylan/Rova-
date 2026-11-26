import express from 'express';
import crypto from 'crypto';
import {
  getSupabaseAdmin,
  requireSupabaseAuth,
  SupabaseAuthRequest,
} from './supabaseAdmin.ts';
import {
  buildFallbackRouteEstimate,
  CityConfig,
  DEFAULT_CITIES,
  GeoCoordinate,
  getCityById,
  haversineDistanceKm,
  isValidCoordinate,
  RouteEstimate,
  validateDeliveryGeospatial,
} from './engines/geospatialEngine.ts';
import {
  AuthoritativeQuote,
  generateAuthoritativeQuote,
  verifyQuoteForOrderConfirmation,
} from './engines/pricingEngine.ts';
import {
  ALLOWED_COURIER_AVAILABILITY_STATES,
  CourierAvailabilityState,
  validateCourierGpsTelemetry,
} from './engines/courierGpsEngine.ts';
import {
  buildDispatchWaveOffers,
  DispatchCourierCandidate,
  OfferStatus,
  sanitizeOfferForCourier,
} from './engines/dispatchEngine.ts';
import {
  ActorRole,
  CanonicalDeliveryStatus,
  CustodyStatus,
  evaluateCancellationPolicy,
  ProofVerificationMethod,
  ProofVerificationPayload,
  validateDeliveryTransition,
} from './engines/stateMachineEngine.ts';
import {
  EventNotificationEngine,
  NotificationLocale,
  renderNotificationTemplate,
} from './engines/notificationEngine.ts';
import {
  ReconcilableCourier,
  ReconcilableDelivery,
  runReconciliationCycle,
} from './engines/reconciliationEngine.ts';
import { createCorrelationId, logOperationalEvent } from './engines/observability.ts';
import { reconcileAllScheduledReservations } from './scheduledRoutes.ts';

// Bounded server quote store (augments Supabase delivery_quotes for fast verification & preview resilience)
const quoteMemoryStore = new Map<string, AuthoritativeQuote>();

export function rememberServerQuote(quote: AuthoritativeQuote): void {
  if (quoteMemoryStore.size >= 1000) {
    const oldest = quoteMemoryStore.keys().next().value;
    if (oldest) quoteMemoryStore.delete(oldest);
  }
  quoteMemoryStore.set(quote.id, quote);
}

export function getRememberedServerQuote(quoteId: string): AuthoritativeQuote | null {
  return quoteMemoryStore.get(quoteId) || null;
}

function cleanStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function getLocale(req: express.Request): NotificationLocale {
  const header = String(req.headers['accept-language'] || req.body?.locale || 'fr').toLowerCase();
  return header.startsWith('en') ? 'en' : 'fr';
}

function decodeGooglePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

export async function computeServerRoadRoute(points: GeoCoordinate[]): Promise<RouteEstimate> {
  let straightLineKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    straightLineKm += haversineDistanceKm(points[i], points[i + 1]);
  }
  straightLineKm = Number(straightLineKm.toFixed(2));

  const googleServerKey = (process.env.GOOGLE_MAPS_SERVER_API_KEY || '').trim();
  if (googleServerKey.length >= 20 && points.length >= 2 && points.length <= 27) {
    try {
      const origin = points[0];
      const destination = points[points.length - 1];
      const intermediates = points.slice(1, -1).map((p) => ({
        location: { latLng: { latitude: p.lat, longitude: p.lng } },
      }));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const gRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleServerKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          ...(intermediates.length > 0 ? { intermediates } : {}),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (gRes.ok) {
        const gData = (await gRes.json()) as {
          routes?: Array<{
            distanceMeters?: number;
            duration?: string;
            polyline?: { encodedPolyline?: string };
          }>;
        };
        const route = gData.routes?.[0];
        if (route?.polyline?.encodedPolyline) {
          const distanceKm = Number(((route.distanceMeters || 0) / 1000).toFixed(2));
          const durationSec = parseInt(String(route.duration || '0').replace(/[^0-9]/g, ''), 10) || 0;
          return {
            distanceKm: Math.max(0.5, distanceKm),
            straightLineKm,
            durationMin: Math.max(3, Math.round(durationSec / 60)),
            distanceSource: 'google_routes',
            isFallbackEstimate: false,
            geometry: decodeGooglePolyline(route.polyline.encodedPolyline),
          };
        }
      }
    } catch {
      // Fall through to OSRM
    }
  }

  try {
    const coordsStr = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const osrmRes = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`,
      {
        headers: { 'User-Agent': 'ROVA-Logistics-Platform/1.0' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (osrmRes.ok) {
      const data = (await osrmRes.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
        }>;
      };
      const route = data.routes?.[0];
      if (route) {
        return {
          distanceKm: Math.max(0.5, Number((route.distance / 1000).toFixed(2))),
          straightLineKm,
          durationMin: Math.max(3, Math.round(route.duration / 60)),
          distanceSource: 'osrm',
          isFallbackEstimate: false,
          geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        };
      }
    }
  } catch {
    // Explicit fallback below
  }

  return buildFallbackRouteEstimate(points);
}

async function loadActiveCities(): Promise<CityConfig[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return DEFAULT_CITIES;
  try {
    const { data, error } = await admin.from('cities').select('*');
    if (error || !data || data.length === 0) return DEFAULT_CITIES;
    return data.map((row) => ({
      id: String(row.id),
      countryCode: String(row.country_code),
      countryName: String(row.country_name),
      name: String(row.name),
      currency: String(row.currency || 'XOF'),
      timezone: String(row.timezone || 'Africa/Abidjan'),
      isActive: Boolean(row.is_active),
      center: { lat: Number(row.center_lat), lng: Number(row.center_lng) },
      serviceRadiusKm: Number(row.service_radius_km || 30),
      bounds: {
        minLat: Number(row.min_lat),
        maxLat: Number(row.max_lat),
        minLng: Number(row.min_lng),
        maxLng: Number(row.max_lng),
      },
      maxDeliveryDistanceKm: Number(row.max_delivery_distance_km || 45),
      maxDeliveryDurationMin: Number(row.max_delivery_duration_min || 150),
      allowedVehicles: Array.isArray(row.allowed_vehicles)
        ? row.allowed_vehicles.map(String)
        : ['motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van'],
      operatingHours: (row.operating_hours as CityConfig['operatingHours']) || DEFAULT_CITIES[0].operatingHours,
      dispatchConfig: (row.dispatch_config as CityConfig['dispatchConfig']) || DEFAULT_CITIES[0].dispatchConfig,
      cancellationPolicy:
        (row.cancellation_policy as CityConfig['cancellationPolicy']) || DEFAULT_CITIES[0].cancellationPolicy,
      gpsPolicy: (row.gps_policy as CityConfig['gpsPolicy']) || DEFAULT_CITIES[0].gpsPolicy,
    }));
  } catch {
    return DEFAULT_CITIES;
  }
}

async function persistEventAndNotify(params: {
  deliveryId: string;
  cityId?: string | null;
  reference: string;
  eventType: string;
  actorUid: string;
  actorRole: ActorRole;
  fromStatus?: string | null;
  toStatus?: string | null;
  correlationId: string;
  payload?: Record<string, unknown>;
  customerUid?: string | null;
  courierUid?: string | null;
  courierName?: string | null;
  etaMinutes?: number;
  reason?: string;
  locale?: NotificationLocale;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const eventId = `evt_${crypto.randomBytes(8).toString('hex')}`;
  try {
    await admin.from('delivery_events').insert({
      id: eventId,
      delivery_id: params.deliveryId,
      city_id: params.cityId || null,
      event_type: params.eventType,
      actor_uid: params.actorUid,
      actor_role: params.actorRole,
      from_status: params.fromStatus || null,
      to_status: params.toStatus || null,
      correlation_id: params.correlationId,
      payload: params.payload || {},
    });
  } catch (err) {
    logOperationalEvent('warn', 'delivery_events.insert_failed', {
      deliveryId: params.deliveryId,
      eventType: params.eventType,
      error: err instanceof Error ? err.message : 'db_error',
    });
  }

  // Event-driven outbox + in_app notification (never breaks delivery transition)
  try {
    const locale = params.locale || 'fr';
    const rendered = renderNotificationTemplate(params.eventType, locale, {
      reference: params.reference,
      courierName: params.courierName || undefined,
      etaMinutes: params.etaMinutes,
      reason: params.reason,
    });

    if (params.customerUid) {
      const dedupeKey = `${eventId}:${params.customerUid}:in_app`;
      const { error: outboxErr } = await admin.from('notification_outbox').insert({
        id: `ntf_${crypto.randomBytes(6).toString('hex')}`,
        event_id: eventId,
        delivery_id: params.deliveryId,
        recipient_uid: params.customerUid,
        recipient_role: 'customer',
        channel: 'in_app',
        template_key: params.eventType,
        locale,
        dedupe_key: dedupeKey,
        payload: { title: rendered.title, message: rendered.message },
        status: 'sent',
        attempt_count: 1,
        sent_at: new Date().toISOString(),
      });

      if (!outboxErr) {
        await admin.from('notifications').insert({
          user_id: params.customerUid,
          title: rendered.title,
          message: rendered.message,
          event_type: params.eventType,
          delivery_id: params.deliveryId,
          read: false,
        });
      }
    }
  } catch (err) {
    logOperationalEvent('warn', 'notification.persist_non_fatal', {
      deliveryId: params.deliveryId,
      eventType: params.eventType,
      error: err instanceof Error ? err.message : 'notif_error',
    });
  }
}

function requireAdminMiddleware(
  req: SupabaseAuthRequest,
  res: express.Response,
  next: express.NextFunction
) {
  if (!req.isRovaAdmin) {
    return res.status(403).json({
      error: 'Administrator privileges are required for this operations endpoint.',
      code: 'ADMIN_REQUIRED',
    });
  }
  return next();
}

function isAuthorizedCronRequest(req: express.Request): boolean {
  const configured = (process.env.CRON_SECRET || '').trim();
  if (configured.length < 16) return false;
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createOperationsRouter(): express.Router {
  const router = express.Router();

  // ==========================================================================
  // 1. CITIES & SERVICE AREAS (Public Read)
  // ==========================================================================
  router.get('/cities', async (_req, res) => {
    const cities = await loadActiveCities();
    return res.json({
      cities: cities
        .filter((c) => c.isActive)
        .map((c) => ({
          id: c.id,
          countryCode: c.countryCode,
          countryName: c.countryName,
          name: c.name,
          currency: c.currency,
          timezone: c.timezone,
          center: c.center,
          serviceRadiusKm: c.serviceRadiusKm,
          bounds: c.bounds,
          maxDeliveryDistanceKm: c.maxDeliveryDistanceKm,
          maxDeliveryDurationMin: c.maxDeliveryDurationMin,
          allowedVehicles: c.allowedVehicles,
          operatingHours: c.operatingHours,
          cancellationPolicy: c.cancellationPolicy,
        })),
    });
  });

  // ==========================================================================
  // 2. AUTHORITATIVE SERVER-SIDE QUOTE ENGINE (Geospatial + Pricing + HMAC)
  // ==========================================================================
  router.post('/quotes', async (req, res) => {
    const correlationId = createCorrelationId('qt');
    try {
      const body = req.body || {};
      const pickup: GeoCoordinate = {
        lat: Number(body.pickup?.lat ?? body.pickupLat),
        lng: Number(body.pickup?.lng ?? body.pickupLng),
      };
      const rawStops = Array.isArray(body.stops) ? body.stops.slice(0, 30) : [];
      const stops: GeoCoordinate[] = rawStops.map((s: Record<string, unknown>) => ({
        lat: Number(s.lat),
        lng: Number(s.lng),
      }));
      const vehicleCategory = cleanStr(body.vehicleCategory, 40) || 'motorcycle';

      const cities = await loadActiveCities();

      // Run geospatial city-isolation check BEFORE invoking external routing APIs (saves quota!)
      const preGeo = validateDeliveryGeospatial({
        pickup,
        stops,
        vehicleCategory,
        cities,
      });

      if (!preGeo.ok) {
        logOperationalEvent('info', 'quote.rejected_geospatial', {
          correlationId,
          code: preGeo.code,
          details: preGeo.details,
        });
        return res.status(422).json({
          error: preGeo.messageFr,
          errorEn: preGeo.messageEn,
          code: preGeo.code,
          details: preGeo.details,
        });
      }

      const routeEstimate = await computeServerRoadRoute([pickup, ...stops]);
      const result = generateAuthoritativeQuote({
        pickup,
        stops,
        vehicleCategory,
        timingType: cleanStr(body.timingType, 30) || 'instant',
        weightKg: Number(body.weightKg || 1),
        packageSize: body.packageSize,
        fragile: Boolean(body.fragile),
        isPriority: Boolean(body.isPriority),
        isPeakHour: Boolean(body.isPeakHour),
        routeOverride: routeEstimate,
        cities,
      });

      if (!result.ok) {
        return res.status(422).json({
          error: result.messageFr,
          errorEn: result.messageEn,
          code: result.code,
          details: result.details,
        });
      }

      const { quote } = result;
      rememberServerQuote(quote);

      // Persist quote to Supabase when configured (non-blocking if preview DB unavailable)
      const admin = getSupabaseAdmin();
      if (admin) {
        await admin
          .from('delivery_quotes')
          .insert({
            id: quote.id,
            city_id: quote.cityId,
            pricing_rule_version_id: quote.pricingRuleVersionId,
            vehicle_category: quote.vehicleCategory,
            timing_type: quote.timingType,
            pickup_lat: quote.pickup.lat,
            pickup_lng: quote.pickup.lng,
            stops_json: quote.stops,
            distance_km: quote.distanceKm,
            duration_min: quote.durationMin,
            distance_source: quote.distanceSource,
            is_fallback_estimate: quote.isFallbackEstimate,
            currency: quote.currency,
            customer_total: quote.customerTotal,
            courier_earnings: quote.courierEarnings,
            platform_commission: quote.platformCommission,
            breakdown_json: quote.breakdown,
            signature_hash: quote.signatureHash,
            status: 'active',
            expires_at: quote.expiresAt,
          })
          .then(({ error }) => {
            if (error) {
              logOperationalEvent('warn', 'quote.db_persist_skipped', {
                correlationId,
                quoteId: quote.id,
                error: error.message,
              });
            }
          });
      }

      logOperationalEvent('info', 'quote.generated', {
        correlationId,
        quoteId: quote.id,
        cityId: quote.cityId,
        distanceKm: quote.distanceKm,
        distanceSource: quote.distanceSource,
        customerTotal: quote.customerTotal,
        currency: quote.currency,
      });

      return res.status(201).json({
        quote: {
          id: quote.id,
          cityId: quote.cityId,
          cityName: quote.cityName,
          countryCode: quote.countryCode,
          pricingRuleVersionId: quote.pricingRuleVersionId,
          vehicleCategory: quote.vehicleCategory,
          timingType: quote.timingType,
          distanceKm: quote.distanceKm,
          straightLineKm: quote.straightLineKm,
          durationMin: quote.durationMin,
          distanceSource: quote.distanceSource,
          isFallbackEstimate: quote.isFallbackEstimate,
          currency: quote.currency,
          customerTotal: quote.customerTotal,
          breakdown: quote.breakdown,
          createdAt: quote.createdAt,
          expiresAt: quote.expiresAt,
          signatureHash: quote.signatureHash,
        },
      });
    } catch (err) {
      logOperationalEvent('error', 'quote.error', {
        correlationId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return res.status(500).json({ error: 'Unable to compute authoritative quote right now.' });
    }
  });

  // ==========================================================================
  // 3. CENTRALIZED DELIVERY STATE MACHINE TRANSITION
  // ==========================================================================
  router.post(
    '/deliveries/:id/transition',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      const correlationId = createCorrelationId('trn');
      try {
        const admin = getSupabaseAdmin()!;
        const uid = req.supabaseUser!.id;
        const deliveryId = cleanStr(req.params.id, 128);
        const nextStatus = cleanStr(req.body?.nextStatus || req.body?.status, 40) as CanonicalDeliveryStatus;

        const { data: delivery } = await admin
          .from('deliveries')
          .select('*')
          .eq('id', deliveryId)
          .maybeSingle();

        if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });

        const actorRole: ActorRole = req.isRovaAdmin
          ? 'admin'
          : delivery.driver_uid === uid
          ? 'courier'
          : delivery.merchant_uid === uid
          ? 'customer'
          : 'customer';

        // Load expected OTP from stop if verifying delivery
        let expectedCode: string | undefined;
        if (nextStatus === 'delivered') {
          const { data: stops } = await admin
            .from('delivery_stops')
            .select('id, otp_code')
            .eq('delivery_id', deliveryId)
            .order('sequence', { ascending: true })
            .limit(1);
          expectedCode = stops?.[0]?.otp_code ? String(stops[0].otp_code) : undefined;
        }

        const proofPayload: ProofVerificationPayload | undefined = req.body?.proof
          ? {
              method: (req.body.proof.method || delivery.proof_required || 'otp') as ProofVerificationMethod,
              providedCode: cleanStr(req.body.proof.code || req.body.proof.providedCode, 32),
              expectedCode,
              photoUrl: cleanStr(req.body.proof.photoUrl, 500),
              signatureHash: cleanStr(req.body.proof.signatureHash, 256),
              recipientName: cleanStr(req.body.proof.recipientName, 120),
              notes: cleanStr(req.body.proof.notes, 300),
            }
          : undefined;

        const check = validateDeliveryTransition(
          {
            currentStatus: String(delivery.status) as CanonicalDeliveryStatus,
            nextStatus,
            actorUid: uid,
            actorRole,
            merchantUid: String(delivery.merchant_uid),
            assignedDriverUid: delivery.driver_uid ? String(delivery.driver_uid) : null,
            proofRequired: (delivery.proof_required || 'otp') as ProofVerificationMethod,
            proofPayload,
            pickupConfirmed: req.body?.pickupConfirmed !== false,
            failureReason: cleanStr(req.body?.failureReason, 300),
          },
          (delivery.custody_status || 'with_sender') as CustodyStatus
        );

        if (!check.ok) {
          return res.status(check.code === 'UNAUTHORIZED_ACTOR' ? 403 : 422).json({
            error: check.messageFr,
            errorEn: check.messageEn,
            code: check.code,
          });
        }

        if (check.idempotent) {
          return res.json({ ok: true, idempotent: true, status: delivery.status });
        }

        const nowIso = new Date().toISOString();
        const updates: Record<string, unknown> = {
          status: nextStatus,
          custody_status: check.nextCustodyStatus,
          updated_at: nowIso,
        };
        if (nextStatus === 'package_collected') updates.pickup_confirmed_at = nowIso;
        if (nextStatus === 'delivered') {
          updates.delivered_at = nowIso;
          updates.pod_verified = true;
          updates.pod_method = proofPayload?.method || delivery.proof_required || 'otp';
        }
        if (nextStatus === 'failed') {
          updates.failure_reason = cleanStr(req.body?.failureReason, 300);
        }

        const { error: updErr } = await admin
          .from('deliveries')
          .update(updates)
          .eq('id', deliveryId);

        if (updErr) {
          return res.status(500).json({ error: 'Unable to update delivery state.' });
        }

        // Persist verified PoD record
        if (nextStatus === 'delivered') {
          await admin.from('proof_of_delivery').insert({
            delivery_id: deliveryId,
            method: proofPayload?.method || delivery.proof_required || 'otp',
            otp_verified: Boolean(proofPayload?.providedCode),
            recipient_name: proofPayload?.recipientName || null,
            photo_url: proofPayload?.photoUrl || null,
            signature_hash: proofPayload?.signatureHash || null,
            notes: proofPayload?.notes || null,
            verified_by_uid: uid,
          });
        }

        // Sync public tracking & terminate live location sharing on terminal states
        await admin
          .from('public_tracking')
          .update({
            status: nextStatus,
            show_live_driver: !check.shouldStopTracking,
            updated_at: nowIso,
          })
          .eq('delivery_id', deliveryId);

        // Update courier availability on terminal completion
        if (delivery.driver_uid && check.shouldStopTracking) {
          await admin
            .from('driver_dispatch')
            .update({
              availability_status: 'AVAILABLE',
              active_delivery_count: 0,
              updated_at: nowIso,
            })
            .eq('uid', delivery.driver_uid);
        }

        await persistEventAndNotify({
          deliveryId,
          cityId: delivery.city_id ? String(delivery.city_id) : null,
          reference: String(delivery.reference),
          eventType: check.eventType || `delivery.${nextStatus}`,
          actorUid: uid,
          actorRole,
          fromStatus: String(delivery.status),
          toStatus: nextStatus,
          correlationId,
          customerUid: String(delivery.merchant_uid),
          courierUid: delivery.driver_uid ? String(delivery.driver_uid) : null,
          courierName: delivery.driver_name ? String(delivery.driver_name) : null,
          etaMinutes: Number(delivery.estimated_duration_min || 15),
          reason: cleanStr(req.body?.failureReason, 300) || undefined,
          locale: getLocale(req),
        });

        return res.json({
          ok: true,
          status: nextStatus,
          custodyStatus: check.nextCustodyStatus,
          trackingStopped: Boolean(check.shouldStopTracking),
        });
      } catch (err) {
        logOperationalEvent('error', 'delivery.transition_error', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
        return res.status(500).json({ error: 'Unable to transition delivery.' });
      }
    }
  );

  // ==========================================================================
  // 4. STATE-BASED CANCELLATION & POST-PICKUP RETURN WORKFLOW
  // ==========================================================================
  router.post(
    '/deliveries/:id/cancel',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      const correlationId = createCorrelationId('cnl');
      try {
        const admin = getSupabaseAdmin()!;
        const uid = req.supabaseUser!.id;
        const deliveryId = cleanStr(req.params.id, 128);
        const previewOnly = Boolean(req.body?.preview);
        const initiateReturn = Boolean(req.body?.initiateReturn);
        const reasonCode = cleanStr(req.body?.reasonCode, 60) || 'customer_requested';
        const reasonNotes = cleanStr(req.body?.reasonNotes, 300);

        const { data: delivery } = await admin
          .from('deliveries')
          .select('*')
          .eq('id', deliveryId)
          .maybeSingle();

        if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });

        const isOwner = delivery.merchant_uid === uid;
        if (!isOwner && !req.isRovaAdmin) {
          return res.status(403).json({ error: 'Not authorized to cancel this delivery.' });
        }

        const cities = await loadActiveCities();
        const city = getCityById(delivery.city_id ? String(delivery.city_id) : 'abidjan', cities) || cities[0];
        const evaluation = evaluateCancellationPolicy({
          status: String(delivery.status) as CanonicalDeliveryStatus,
          quotedPrice: Number(delivery.quoted_price || 0),
          city,
          createdAtMs: Date.parse(String(delivery.created_at || new Date().toISOString())),
          actorRole: req.isRovaAdmin ? 'admin' : 'customer',
        });

        if (previewOnly) {
          return res.json({ evaluation });
        }

        const nowIso = new Date().toISOString();

        // Post-pickup return-to-sender workflow
        if (!evaluation.allowed && evaluation.requiresReturnWorkflow) {
          if (!initiateReturn) {
            return res.status(422).json({
              error: evaluation.messageFr,
              errorEn: evaluation.messageEn,
              code: 'POST_PICKUP_CANCEL_BLOCKED',
              evaluation,
            });
          }

          await admin
            .from('deliveries')
            .update({
              status: 'return_required',
              return_fee: evaluation.returnFeeAmount,
              custody_status: 'with_courier',
              cancellation_reason: reasonNotes || reasonCode,
              updated_at: nowIso,
            })
            .eq('id', deliveryId);

          await admin.from('cancellation_records').insert({
            delivery_id: deliveryId,
            cancelled_by_uid: uid,
            cancelled_by_role: req.isRovaAdmin ? 'admin' : 'customer',
            delivery_status_at_cancel: String(delivery.status),
            reason_code: reasonCode,
            reason_notes: reasonNotes || null,
            fee_amount: evaluation.returnFeeAmount,
            refund_amount: 0,
            currency: evaluation.currency,
            policy_applied: evaluation.policyApplied,
            return_required: true,
          });

          await persistEventAndNotify({
            deliveryId,
            cityId: city.id,
            reference: String(delivery.reference),
            eventType: 'delivery.return_required',
            actorUid: uid,
            actorRole: req.isRovaAdmin ? 'admin' : 'customer',
            fromStatus: String(delivery.status),
            toStatus: 'return_required',
            correlationId,
            customerUid: String(delivery.merchant_uid),
            courierUid: delivery.driver_uid ? String(delivery.driver_uid) : null,
            reason: reasonNotes || reasonCode,
            locale: getLocale(req),
          });

          return res.json({
            ok: true,
            status: 'return_required',
            evaluation,
          });
        }

        if (!evaluation.allowed) {
          return res.status(422).json({
            error: evaluation.messageFr,
            errorEn: evaluation.messageEn,
            code: 'CANCELLATION_NOT_ALLOWED',
            evaluation,
          });
        }

        // Standard pre-pickup cancellation
        await admin
          .from('deliveries')
          .update({
            status: 'cancelled',
            cancellation_fee: evaluation.feeAmount,
            cancelled_at: nowIso,
            cancelled_by_uid: uid,
            cancellation_reason: reasonNotes || reasonCode,
            updated_at: nowIso,
          })
          .eq('id', deliveryId);

        // Cancel open dispatch offers & stop live tracking
        await admin
          .from('delivery_offers')
          .update({ status: 'CANCELLED', updated_at: nowIso })
          .eq('delivery_id', deliveryId)
          .in('status', ['CREATED', 'SENT', 'DELIVERED', 'VIEWED']);

        await admin
          .from('public_tracking')
          .update({ status: 'cancelled', show_live_driver: false, updated_at: nowIso })
          .eq('delivery_id', deliveryId);

        if (delivery.driver_uid) {
          await admin
            .from('driver_dispatch')
            .update({ availability_status: 'AVAILABLE', active_delivery_count: 0, updated_at: nowIso })
            .eq('uid', delivery.driver_uid);
        }

        await admin.from('cancellation_records').insert({
          delivery_id: deliveryId,
          cancelled_by_uid: uid,
          cancelled_by_role: req.isRovaAdmin ? 'admin' : 'customer',
          delivery_status_at_cancel: String(delivery.status),
          reason_code: reasonCode,
          reason_notes: reasonNotes || null,
          fee_amount: evaluation.feeAmount,
          refund_amount: evaluation.refundAmount,
          currency: evaluation.currency,
          policy_applied: evaluation.policyApplied,
          return_required: false,
        });

        await persistEventAndNotify({
          deliveryId,
          cityId: city.id,
          reference: String(delivery.reference),
          eventType: 'delivery.cancelled',
          actorUid: uid,
          actorRole: req.isRovaAdmin ? 'admin' : 'customer',
          fromStatus: String(delivery.status),
          toStatus: 'cancelled',
          correlationId,
          customerUid: String(delivery.merchant_uid),
          courierUid: delivery.driver_uid ? String(delivery.driver_uid) : null,
          reason: reasonNotes || reasonCode,
          locale: getLocale(req),
        });

        return res.json({ ok: true, status: 'cancelled', evaluation });
      } catch (err) {
        logOperationalEvent('error', 'delivery.cancel_error', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
        return res.status(500).json({ error: 'Unable to cancel delivery right now.' });
      }
    }
  );

  // ==========================================================================
  // 5. COURIER GPS TELEMETRY & AVAILABILITY ENGINE
  // ==========================================================================
  router.post(
    '/courier/location',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const admin = getSupabaseAdmin()!;
        const courierUid = req.supabaseUser!.id;

        const { data: driver } = await admin
          .from('driver_dispatch')
          .select('*')
          .eq('uid', courierUid)
          .maybeSingle();

        if (!driver) {
          return res.status(404).json({ error: 'Courier dispatch profile not found.' });
        }

        const cities = await loadActiveCities();
        const sample = {
          courierUid,
          lat: Number(req.body?.lat),
          lng: Number(req.body?.lng),
          accuracyMeters: Number(req.body?.accuracyMeters ?? req.body?.accuracy ?? 20),
          heading: typeof req.body?.heading === 'number' ? req.body.heading : null,
          speedMps: typeof req.body?.speedMps === 'number' ? req.body.speedMps : null,
          recordedAtMs: req.body?.recordedAt ? Date.parse(String(req.body.recordedAt)) : Date.now(),
          deliveryId: cleanStr(req.body?.deliveryId, 128) || null,
        };

        const validation = validateCourierGpsTelemetry({
          sample,
          courier: {
            uid: courierUid,
            cityId: driver.city_id ? String(driver.city_id) : null,
            approvalStatus: String(driver.approval_status) as 'approved',
            isOnline: Boolean(driver.is_online),
            availabilityStatus: (driver.availability_status || (driver.is_online ? 'AVAILABLE' : 'OFFLINE')) as CourierAvailabilityState,
            lastLat: typeof driver.current_lat === 'number' ? driver.current_lat : null,
            lastLng: typeof driver.current_lng === 'number' ? driver.current_lng : null,
            lastGpsUpdatedAtMs: driver.gps_updated_at ? Date.parse(String(driver.gps_updated_at)) : null,
          },
          cities,
        });

        if (!validation.ok) {
          return res.status(422).json({
            error: validation.messageFr,
            errorEn: validation.messageEn,
            code: validation.code,
          });
        }

        const nowIso = new Date().toISOString();
        await admin.from('courier_locations').insert({
          courier_uid: courierUid,
          delivery_id: sample.deliveryId,
          city_id: validation.city.id,
          lat: sample.lat,
          lng: sample.lng,
          accuracy_m: sample.accuracyMeters,
          heading: sample.heading,
          speed_mps: sample.speedMps,
          recorded_at: new Date(sample.recordedAtMs).toISOString(),
        });

        await admin
          .from('driver_dispatch')
          .update({
            city_id: validation.city.id,
            current_lat: sample.lat,
            current_lng: sample.lng,
            gps_accuracy_m: sample.accuracyMeters,
            gps_heading: sample.heading,
            gps_speed_mps: sample.speedMps,
            gps_updated_at: nowIso,
            updated_at: nowIso,
          })
          .eq('uid', courierUid);

        if (sample.deliveryId) {
          await admin
            .from('deliveries')
            .update({ driver_lat: sample.lat, driver_lng: sample.lng, updated_at: nowIso })
            .eq('id', sample.deliveryId)
            .eq('driver_uid', courierUid);

          await admin
            .from('public_tracking')
            .update({ driver_lat: sample.lat, driver_lng: sample.lng, updated_at: nowIso })
            .eq('delivery_id', sample.deliveryId)
            .eq('driver_uid', courierUid)
            .eq('show_live_driver', true);
        }

        return res.json({
          ok: true,
          cityId: validation.city.id,
          recommendedNextIntervalSec: validation.recommendedNextIntervalSec,
        });
      } catch (err) {
        logOperationalEvent('error', 'courier.location_error', {
          error: err instanceof Error ? err.message : 'unknown',
        });
        return res.status(500).json({ error: 'Unable to record courier location.' });
      }
    }
  );

  router.post(
    '/courier/availability',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const admin = getSupabaseAdmin()!;
        const courierUid = req.supabaseUser!.id;
        const nextState = cleanStr(req.body?.status, 40).toUpperCase() as CourierAvailabilityState;

        if (!ALLOWED_COURIER_AVAILABILITY_STATES.has(nextState)) {
          return res.status(400).json({ error: 'Invalid courier availability state.' });
        }
        if (nextState === 'SUSPENDED' && !req.isRovaAdmin) {
          return res.status(403).json({ error: 'Only administrators can suspend couriers.' });
        }

        const isOnline = nextState !== 'OFFLINE' && nextState !== 'SUSPENDED';
        const nowIso = new Date().toISOString();

        await admin
          .from('driver_dispatch')
          .update({ availability_status: nextState, is_online: isOnline, updated_at: nowIso })
          .eq('uid', courierUid);
        await admin
          .from('drivers')
          .update({ availability_status: nextState, is_online: isOnline, updated_at: nowIso })
          .eq('uid', courierUid);

        return res.json({ ok: true, availabilityStatus: nextState, isOnline });
      } catch {
        return res.status(500).json({ error: 'Unable to update courier availability.' });
      }
    }
  );

  // ==========================================================================
  // 6. DISPATCH OFFERS & ATOMIC CONCURRENCY-SAFE ACCEPTANCE
  // ==========================================================================
  router.get(
    '/courier/offers',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const admin = getSupabaseAdmin()!;
        const courierUid = req.supabaseUser!.id;
        const nowIso = new Date().toISOString();

        const { data, error } = await admin
          .from('delivery_offers')
          .select('*')
          .eq('courier_uid', courierUid)
          .in('status', ['CREATED', 'SENT', 'DELIVERED', 'VIEWED'])
          .gt('expires_at', nowIso)
          .order('created_at', { ascending: false })
          .limit(10);

        if (error) return res.status(500).json({ error: 'Unable to fetch courier offers.' });

        // Strictly strip internal_score before sending to courier client
        const offers = (data || []).map((row) =>
          sanitizeOfferForCourier({
            id: String(row.id),
            deliveryId: String(row.delivery_id),
            cityId: String(row.city_id),
            courierUid: String(row.courier_uid),
            waveNumber: Number(row.wave_number || 1),
            status: String(row.status) as OfferStatus,
            internalScore: Number(row.internal_score || 0),
            estimatedPickupDistanceKm: Number(row.estimated_pickup_distance_km || 0),
            estimatedPickupEtaMin: Number(row.estimated_pickup_eta_min || 5),
            offeredEarnings: Number(row.offered_earnings || 0),
            currency: String(row.currency || 'XOF'),
            expiresAt: String(row.expires_at),
            sentAt: String(row.sent_at),
          })
        );

        return res.json({ offers });
      } catch {
        return res.status(500).json({ error: 'Unable to load offers.' });
      }
    }
  );

  router.post(
    '/offers/:offerId/accept',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      const correlationId = createCorrelationId('acc');
      try {
        const admin = getSupabaseAdmin()!;
        const courierUid = req.supabaseUser!.id;
        const offerId = cleanStr(req.params.offerId, 128);

        // Execute atomic PostgreSQL RPC with FOR UPDATE row locks
        const { data, error } = await admin.rpc('accept_delivery_offer', {
          p_offer_id: offerId,
          p_courier_uid: courierUid,
        });

        if (error) {
          logOperationalEvent('error', 'offer.accept_rpc_error', {
            correlationId,
            offerId,
            courierId: courierUid,
            error: error.message,
          });
          return res.status(500).json({ error: 'Unable to process offer acceptance.' });
        }

        const result = (data || {}) as {
          ok?: boolean;
          code?: string;
          message?: string;
          delivery_id?: string;
          courier_name?: string;
        };

        if (!result.ok) {
          const status =
            result.code === 'OFFER_UNAUTHORIZED'
              ? 403
              : result.code === 'OFFER_NOT_FOUND'
              ? 404
              : 409;
          return res.status(status).json({ error: result.message || 'Offer unavailable.', code: result.code });
        }

        // Emit automatic customer notification
        if (result.delivery_id) {
          const { data: del } = await admin
            .from('deliveries')
            .select('reference, merchant_uid, city_id, estimated_duration_min')
            .eq('id', result.delivery_id)
            .maybeSingle();

          if (del) {
            await persistEventAndNotify({
              deliveryId: result.delivery_id,
              cityId: del.city_id ? String(del.city_id) : null,
              reference: String(del.reference),
              eventType: 'delivery.courier_assigned',
              actorUid: courierUid,
              actorRole: 'courier',
              fromStatus: 'searching_courier',
              toStatus: 'driver_assigned',
              correlationId,
              customerUid: String(del.merchant_uid),
              courierUid,
              courierName: result.courier_name || 'Livreur ROVA',
              etaMinutes: Number(del.estimated_duration_min || 12),
              locale: getLocale(req),
            });
          }
        }

        return res.json({ ok: true, result });
      } catch (err) {
        logOperationalEvent('error', 'offer.accept_error', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
        return res.status(500).json({ error: 'Unable to accept offer.' });
      }
    }
  );

  router.post(
    '/offers/:offerId/reject',
    requireSupabaseAuth,
    async (req: SupabaseAuthRequest, res) => {
      try {
        const admin = getSupabaseAdmin()!;
        const courierUid = req.supabaseUser!.id;
        const offerId = cleanStr(req.params.offerId, 128);
        const reason = cleanStr(req.body?.reason, 200) || 'courier_declined';

        const { data: offer } = await admin
          .from('delivery_offers')
          .select('id, courier_uid, status')
          .eq('id', offerId)
          .maybeSingle();

        if (!offer) return res.status(404).json({ error: 'Offer not found.' });
        if (offer.courier_uid !== courierUid) return res.status(403).json({ error: 'Forbidden.' });

        await admin
          .from('delivery_offers')
          .update({
            status: 'REJECTED',
            rejection_reason: reason,
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', offerId)
          .eq('courier_uid', courierUid);

        return res.json({ ok: true, status: 'REJECTED' });
      } catch {
        return res.status(500).json({ error: 'Unable to reject offer.' });
      }
    }
  );

  // ==========================================================================
  // 7. ADMIN OPERATIONS & RECONCILIATION ENDPOINTS (STRICTLY ADMIN-ONLY)
  // ==========================================================================
  router.get(
    '/ops/overview',
    requireSupabaseAuth,
    requireAdminMiddleware,
    async (_req, res) => {
      try {
        const admin = getSupabaseAdmin()!;
        const [cities, deliveriesRes, offersRes, eventsRes, notifRes] = await Promise.all([
          loadActiveCities(),
          admin.from('deliveries').select('id, reference, city_id, status, driver_uid, quoted_price, currency, created_at').order('created_at', { ascending: false }).limit(50),
          admin.from('delivery_offers').select('id, delivery_id, city_id, courier_uid, wave_number, status, expires_at, created_at').order('created_at', { ascending: false }).limit(50),
          admin.from('delivery_events').select('*').order('created_at', { ascending: false }).limit(50),
          admin.from('notification_outbox').select('id, delivery_id, channel, template_key, status, attempt_count, last_error, created_at').order('created_at', { ascending: false }).limit(50),
        ]);

        return res.json({
          cities,
          recentDeliveries: deliveriesRes.data || [],
          recentOffers: offersRes.data || [],
          recentEvents: eventsRes.data || [],
          notificationOutbox: notifRes.data || [],
        });
      } catch {
        return res.status(500).json({ error: 'Unable to load operations overview.' });
      }
    }
  );

  router.post(
    '/ops/dispatch/:deliveryId/redispatch',
    requireSupabaseAuth,
    requireAdminMiddleware,
    async (req: SupabaseAuthRequest, res) => {
      const correlationId = createCorrelationId('dsp');
      try {
        const admin = getSupabaseAdmin()!;
        const deliveryId = cleanStr(req.params.deliveryId, 128);
        const { data: delivery } = await admin
          .from('deliveries')
          .select('*')
          .eq('id', deliveryId)
          .maybeSingle();

        if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });

        const cities = await loadActiveCities();
        const city = getCityById(delivery.city_id ? String(delivery.city_id) : 'abidjan', cities) || cities[0];
        const nextWave = Number(delivery.dispatch_wave || 0) + 1;

        const { data: rawDrivers } = await admin
          .from('driver_dispatch')
          .select('*')
          .eq('approval_status', 'approved')
          .eq('is_online', true);

        const candidates: DispatchCourierCandidate[] = (rawDrivers || []).map((d) => ({
          uid: String(d.uid),
          firstName: String(d.first_name || 'Livreur'),
          cityId: String(d.city_id || city.id),
          approvalStatus: String(d.approval_status) as 'approved',
          isOnline: Boolean(d.is_online),
          availabilityStatus: (d.availability_status || 'AVAILABLE') as CourierAvailabilityState,
          vehicleCategory: String(d.vehicle_category || 'motorcycle'),
          currentLat: Number(d.current_lat || city.center.lat),
          currentLng: Number(d.current_lng || city.center.lng),
          gpsAccuracyMeters: typeof d.gps_accuracy_m === 'number' ? d.gps_accuracy_m : 20,
          gpsUpdatedAtMs: d.gps_updated_at ? Date.parse(String(d.gps_updated_at)) : Date.now(),
          rating: Number(d.rating || 4.8),
          acceptanceRate: Number(d.acceptance_rate || 95),
          activeDeliveryCount: Number(d.active_delivery_count || 0),
          maxConcurrentDeliveries: Number(d.max_concurrent_deliveries || 1),
        }));

        const plan = buildDispatchWaveOffers({
          deliveryId,
          city,
          pickup: { lat: Number(delivery.pickup_lat), lng: Number(delivery.pickup_lng) },
          requiredVehicle: String(delivery.vehicle_category || 'motorcycle'),
          weightKg: Number(delivery.weight_kg || 1),
          offeredEarnings: Number(delivery.courier_earnings || Math.round(Number(delivery.quoted_price || 0) * 0.8)),
          waveNumber: nextWave,
          candidates,
        });

        if (plan.offers.length > 0) {
          await admin.from('delivery_offers').insert(
            plan.offers.map((o) => ({
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
          await admin
            .from('deliveries')
            .update({ dispatch_wave: nextWave, status: 'searching_courier', updated_at: new Date().toISOString() })
            .eq('id', deliveryId);
        }

        await persistEventAndNotify({
          deliveryId,
          cityId: city.id,
          reference: String(delivery.reference),
          eventType: plan.offers.length > 0 ? 'delivery.searching_courier' : 'delivery.no_courier_found',
          actorUid: req.supabaseUser!.id,
          actorRole: 'admin',
          correlationId,
          payload: { wave: nextWave, offersDispatched: plan.offers.length },
        });

        return res.json({
          ok: true,
          wave: nextWave,
          offersDispatched: plan.offers.length,
          exhausted: plan.exhausted,
        });
      } catch {
        return res.status(500).json({ error: 'Unable to trigger redispatch.' });
      }
    }
  );

  async function executeSupabaseReconciliation() {
    const admin = getSupabaseAdmin();
    const cities = await loadActiveCities();
    if (!admin) {
      const baseReport = await runReconciliationCycle({ offers: [], couriers: [], deliveries: [], cities });
      const scheduledReport = await reconcileAllScheduledReservations();
      return { ...baseReport, scheduled: scheduledReport };
    }

    const [offersRes, driversRes, deliveriesRes] = await Promise.all([
      admin.from('delivery_offers').select('*').in('status', ['CREATED', 'SENT', 'DELIVERED', 'VIEWED']).limit(200),
      admin.from('driver_dispatch').select('*').eq('is_online', true).limit(200),
      admin.from('deliveries').select('id, reference, city_id, merchant_uid, status, driver_uid, search_started_at, dispatch_wave, pod_verified').limit(200),
    ]);

    const offers = (offersRes.data || []).map((o) => ({
      id: String(o.id),
      deliveryId: String(o.delivery_id),
      cityId: String(o.city_id),
      courierUid: String(o.courier_uid),
      waveNumber: Number(o.wave_number || 1),
      status: String(o.status) as OfferStatus,
      internalScore: Number(o.internal_score || 0),
      estimatedPickupDistanceKm: Number(o.estimated_pickup_distance_km || 0),
      estimatedPickupEtaMin: Number(o.estimated_pickup_eta_min || 5),
      offeredEarnings: Number(o.offered_earnings || 0),
      currency: String(o.currency || 'XOF'),
      expiresAt: String(o.expires_at),
      sentAt: String(o.sent_at),
    }));

    const couriers: ReconcilableCourier[] = (driversRes.data || []).map((d) => ({
      uid: String(d.uid),
      cityId: String(d.city_id || 'abidjan'),
      isOnline: Boolean(d.is_online),
      availabilityStatus: (d.availability_status || 'AVAILABLE') as CourierAvailabilityState,
      gpsUpdatedAtMs: d.gps_updated_at ? Date.parse(String(d.gps_updated_at)) : 0,
    }));

    const deliveries: ReconcilableDelivery[] = (deliveriesRes.data || []).map((d) => ({
      id: String(d.id),
      reference: String(d.reference),
      cityId: String(d.city_id || 'abidjan'),
      merchantUid: String(d.merchant_uid),
      status: String(d.status),
      driverUid: String(d.driver_uid || ''),
      searchStartedAtMs: d.search_started_at ? Date.parse(String(d.search_started_at)) : null,
      dispatchWave: Number(d.dispatch_wave || 0),
      podVerified: Boolean(d.pod_verified),
      showLiveTracking: false,
    }));

    const notifEngine = new EventNotificationEngine();
    const report = await runReconciliationCycle({
      offers,
      couriers,
      deliveries,
      notificationEngine: notifEngine,
      cities,
    });

    // Persist reconciliation state updates back to Supabase
    const nowIso = new Date().toISOString();
    const expiredIds = offers.filter((o) => o.status === 'EXPIRED').map((o) => o.id);
    if (expiredIds.length > 0) {
      await admin
        .from('delivery_offers')
        .update({ status: 'EXPIRED', updated_at: nowIso })
        .in('id', expiredIds);
    }

    const staleCourierIds = couriers
      .filter((c) => c.availabilityStatus === 'TEMPORARILY_UNAVAILABLE')
      .map((c) => c.uid);
    if (staleCourierIds.length > 0) {
      await admin
        .from('driver_dispatch')
        .update({ availability_status: 'TEMPORARILY_UNAVAILABLE', updated_at: nowIso })
        .in('uid', staleCourierIds);
    }

    const scheduledReport = await reconcileAllScheduledReservations();
    return { ...report, scheduled: scheduledReport };
  }

  router.post(
    '/ops/reconcile',
    requireSupabaseAuth,
    requireAdminMiddleware,
    async (_req, res) => {
      try {
        const report = await executeSupabaseReconciliation();
        return res.json({ ok: true, report });
      } catch {
        return res.status(500).json({ error: 'Reconciliation job failed.' });
      }
    }
  );

  // Vercel Cron / Scheduled Worker Reconciliation Endpoint
  router.post('/cron/reconcile', async (req, res) => {
    if (!isAuthorizedCronRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized cron trigger.' });
    }
    try {
      const report = await executeSupabaseReconciliation();
      return res.json({ ok: true, report });
    } catch {
      return res.status(500).json({ error: 'Cron reconciliation failed.' });
    }
  });

  // Expose helper for quote validation in supabaseRoutes.ts
  router.post('/quotes/verify', async (req, res) => {
    const quoteId = cleanStr(req.body?.quoteId, 64);
    const quote = getRememberedServerQuote(quoteId);
    if (!quote) {
      return res.status(404).json({ ok: false, code: 'QUOTE_NOT_FOUND' });
    }
    const pickup = { lat: Number(req.body?.pickup?.lat), lng: Number(req.body?.pickup?.lng) };
    const stops = Array.isArray(req.body?.stops)
      ? req.body.stops.map((s: Record<string, unknown>) => ({ lat: Number(s.lat), lng: Number(s.lng) }))
      : [];
    if (!isValidCoordinate(pickup)) {
      return res.status(400).json({ ok: false, code: 'INVALID_COORDINATES' });
    }
    const check = verifyQuoteForOrderConfirmation({
      quote,
      pickup,
      stops,
      vehicleCategory: cleanStr(req.body?.vehicleCategory, 40),
      clientSubmittedPrice:
        typeof req.body?.clientSubmittedPrice === 'number' ? req.body.clientSubmittedPrice : undefined,
    });
    return res.status(check.ok ? 200 : 422).json(check);
  });

  return router;
}
