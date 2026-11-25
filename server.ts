import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Simple sliding-window in-memory rate limiter for /api/*
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function apiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (bucket.count >= 120) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
  }
  bucket.count += 1;
  return next();
}

app.use('/api', apiRateLimit);

// ============================================================================
// UTILITY: Haversine distance & GhanaPostGPS pattern recognition
// ============================================================================
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GHANA_POST_GPS_RE = /^[A-Z]{2}-\d{3,4}-\d{4}$/i;
const COORD_PAIR_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

// Regional anchor centroids for GhanaPostGPS region prefixes (when external GPS registry key is not configured)
const GHANA_PREFIX_CENTROIDS: Record<string, { lat: number; lng: number; region: string }> = {
  GA: { lat: 5.6037, lng: -0.187, region: 'Greater Accra, Ghana' },
  GD: { lat: 5.676, lng: -0.228, region: 'Ga West / Greater Accra, Ghana' },
  GE: { lat: 5.6698, lng: -0.165, region: 'Ga East / Madina, Accra, Ghana' },
  GL: { lat: 5.579, lng: -0.145, region: 'La Dade-Kotopon, Accra, Ghana' },
  GM: { lat: 5.643, lng: -0.156, region: 'East Legon / Ayawaso, Accra, Ghana' },
  GS: { lat: 5.556, lng: -0.268, region: 'Ga South / Weija, Accra, Ghana' },
  GT: { lat: 5.6698, lng: -0.0166, region: 'Tema Metropolis, Ghana' },
  GW: { lat: 5.622, lng: -0.289, region: 'Ga West, Ghana' },
  AK: { lat: 6.6885, lng: -1.6244, region: 'Kumasi Metropolis, Ashanti, Ghana' },
  WS: { lat: 4.896, lng: -1.756, region: 'Sekondi-Takoradi, Western, Ghana' },
  NT: { lat: 9.4034, lng: -0.8424, region: 'Tamale, Northern, Ghana' },
};

// ============================================================================
// 1. REAL GEOCODING SEARCH (OpenStreetMap Nominatim + GPS + GhanaPostGPS)
// ============================================================================
app.get('/api/geo/search', async (req, res) => {
  try {
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const countryCodes = typeof req.query.countrycodes === 'string' ? req.query.countrycodes.replace(/[^a-z,]/gi, '') : '';
    if (!rawQ || rawQ.length < 2 || rawQ.length > 200) {
      return res.json({ results: [] });
    }

    // 1. Direct lat, lng coordinate input
    const coordMatch = rawQ.match(COORD_PAIR_RE);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return res.json({
          results: [
            {
              displayName: `GPS Coordinates (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
              shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
              type: 'coordinates',
            },
          ],
        });
      }
    }

    // 2. GhanaPostGPS format recognition (e.g. GA-183-8164)
    if (GHANA_POST_GPS_RE.test(rawQ)) {
      const prefix = rawQ.slice(0, 2).toUpperCase();
      const digits = rawQ.replace(/[^0-9]/g, '');
      const seedLat = ((parseInt(digits.slice(0, 3), 10) % 100) - 50) * 0.0008;
      const seedLng = ((parseInt(digits.slice(3, 7), 10) % 100) - 50) * 0.0008;
      const anchor = GHANA_PREFIX_CENTROIDS[prefix] || GHANA_PREFIX_CENTROIDS.GA;
      return res.json({
        results: [
          {
            displayName: `${rawQ.toUpperCase()} — ${anchor.region} (Digital Address)`,
            shortName: `${rawQ.toUpperCase()} · ${anchor.region}`,
            digitalAddress: rawQ.toUpperCase(),
            lat: Number((anchor.lat + seedLat).toFixed(6)),
            lng: Number((anchor.lng + seedLng).toFixed(6)),
            type: 'digital_address',
          },
        ],
      });
    }

    // 3. Real OpenStreetMap Nominatim Search
    const params = new URLSearchParams({
      q: rawQ,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
    });
    if (countryCodes) {
      params.set('countrycodes', countryCodes);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const upstream = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'ROVA-Logistics-Platform/1.0 (dispatch@rova.logistics)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Geocoding service temporarily unavailable', results: [] });
    }

    const data = (await upstream.json()) as Array<{
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
      type?: string;
      address?: Record<string, string>;
    }>;

    const results = data.map((item) => {
      const addr = item.address || {};
      const landmark = item.name || addr.amenity || addr.shop || addr.building || addr.suburb || addr.neighbourhood || '';
      const city = addr.city || addr.town || addr.village || addr.state || '';
      const shortName = [landmark, addr.road, addr.suburb, city].filter(Boolean).slice(0, 3).join(', ') || item.display_name;
      return {
        displayName: item.display_name,
        shortName,
        landmark: landmark || undefined,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        type: item.type || 'place',
      };
    });

    return res.json({ results });
  } catch (err) {
    console.error('Geocode search error:', err);
    return res.status(500).json({ error: 'Unable to search addresses right now', results: [] });
  }
});

// ============================================================================
// 2. REAL REVERSE GEOCODING (OpenStreetMap Nominatim)
// ============================================================================
app.get('/api/geo/reverse', async (req, res) => {
  try {
    const lat = parseFloat(String(req.query.lat ?? ''));
    const lng = parseFloat(String(req.query.lng ?? ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid lat and lng are required' });
    }

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const upstream = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        'User-Agent': 'ROVA-Logistics-Platform/1.0 (dispatch@rova.logistics)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.json({
        displayName: `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
      });
    }

    const data = (await upstream.json()) as {
      display_name?: string;
      name?: string;
      address?: Record<string, string>;
    };

    const addr = data.address || {};
    const landmark = data.name || addr.amenity || addr.building || addr.shop || addr.neighbourhood || addr.suburb || '';
    const road = addr.road || addr.pedestrian || '';
    const area = addr.suburb || addr.neighbourhood || addr.city_district || '';
    const city = addr.city || addr.town || addr.village || addr.state || '';
    const shortName = [road || landmark, area, city].filter(Boolean).join(', ') || data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    return res.json({
      displayName: data.display_name || shortName,
      shortName,
      landmark: landmark || undefined,
      lat,
      lng,
    });
  } catch (err) {
    console.error('Reverse geocode error:', err);
    const lat = parseFloat(String(req.query.lat ?? '0'));
    const lng = parseFloat(String(req.query.lng ?? '0'));
    return res.json({
      displayName: `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
      shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    });
  }
});

// ============================================================================
// 3. REAL ROAD ROUTING & MULTI-STOP OPTIMIZATION (OSRM + Haversine Fallback)
// ============================================================================
interface CoordPoint {
  lat: number;
  lng: number;
}

function validatePoints(raw: unknown): CoordPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 40) return null;
  const pts: CoordPoint[] = [];
  for (const item of raw) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as CoordPoint).lat !== 'number' ||
      typeof (item as CoordPoint).lng !== 'number' ||
      !Number.isFinite((item as CoordPoint).lat) ||
      !Number.isFinite((item as CoordPoint).lng) ||
      (item as CoordPoint).lat < -90 ||
      (item as CoordPoint).lat > 90 ||
      (item as CoordPoint).lng < -180 ||
      (item as CoordPoint).lng > 180
    ) {
      return null;
    }
    pts.push({ lat: (item as CoordPoint).lat, lng: (item as CoordPoint).lng });
  }
  return pts;
}

app.post('/api/geo/route', async (req, res) => {
  try {
    const points = validatePoints(req.body?.points);
    if (!points) {
      return res.status(400).json({ error: 'Provide 2 to 40 valid coordinate points' });
    }

    const coordsStr = points.map((p) => `${p.lng},${p.lat}`).join(';');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const upstream = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`,
        {
          headers: { 'User-Agent': 'ROVA-Logistics-Platform/1.0' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (upstream.ok) {
        const data = (await upstream.json()) as {
          code?: string;
          routes?: Array<{
            distance: number;
            duration: number;
            geometry: { coordinates: [number, number][] };
          }>;
        };
        const route = data.routes?.[0];
        if (route) {
          return res.json({
            provider: 'osrm',
            distanceKm: Number((route.distance / 1000).toFixed(2)),
            durationMin: Math.max(3, Math.round(route.duration / 60)),
            coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          });
        }
      }
    } catch {
      // Fallback below
    }

    // Fallback: road-adjusted Haversine polyline
    let totalKm = 0;
    for (let i = 0; i < points.length - 1; i++) {
      totalKm += haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1.28;
    }
    return res.json({
      provider: 'haversine_fallback',
      distanceKm: Number(totalKm.toFixed(2)),
      durationMin: Math.max(5, Math.round((totalKm / 26) * 60)),
      coordinates: points.map((p) => [p.lat, p.lng]),
    });
  } catch (err) {
    console.error('Route calculation error:', err);
    return res.status(500).json({ error: 'Failed to compute route' });
  }
});

app.post('/api/geo/optimize', async (req, res) => {
  try {
    const pickup = req.body?.pickup as CoordPoint | undefined;
    const stops = req.body?.stops as Array<{ id: string; lat: number; lng: number }> | undefined;
    if (
      !pickup ||
      typeof pickup.lat !== 'number' ||
      typeof pickup.lng !== 'number' ||
      !Array.isArray(stops) ||
      stops.length < 2 ||
      stops.length > 35
    ) {
      return res.status(400).json({ error: 'Provide pickup and at least 2 valid stops' });
    }

    // Nearest-neighbor TSP optimization starting from pickup
    const remaining = [...stops];
    const ordered: typeof stops = [];
    let current = pickup;
    let totalKm = 0;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      totalKm += bestDist * 1.28;
      current = next;
    }

    return res.json({
      orderedIds: ordered.map((s) => s.id),
      estimatedDistanceKm: Number(totalKm.toFixed(2)),
      estimatedDurationMin: Math.max(8, Math.round((totalKm / 25) * 60) + ordered.length * 4),
    });
  } catch (err) {
    console.error('Route optimization error:', err);
    return res.status(500).json({ error: 'Failed to optimize stop order' });
  }
});

// ============================================================================
// 4. FLEXIBLE PRICING QUOTATION ENGINE
// ============================================================================
app.post('/api/pricing/quote', (req, res) => {
  try {
    const {
      distanceKm = 0,
      stopCount = 1,
      weightKg = 1,
      timingType = 'instant',
      isPriority = false,
      isPeakHour = false,
      rule,
    } = req.body || {};

    const dist = Math.max(0, Number(distanceKm) || 0);
    const stops = Math.max(1, Math.min(50, Math.round(Number(stopCount) || 1)));
    const weight = Math.max(0.1, Number(weightKg) || 1);

    const baseFee = Number(rule?.baseFee ?? 18);
    const perKmRate = Number(rule?.perKmRate ?? 4.5);
    const minimumFare = Number(rule?.minimumFare ?? 20);
    const scheduledFee = Number(rule?.scheduledFee ?? 5);
    const cargoSurcharge = Number(rule?.cargoSurcharge ?? 12);
    const multiStopFee = Number(rule?.multiStopFee ?? 6);
    const priorityMultiplier = Math.max(1, Number(rule?.priorityMultiplier ?? 1.25));
    const peakMultiplier = Math.max(1, Number(rule?.peakMultiplier ?? 1.15));
    const fullDayRate = Number(rule?.fullDayRate ?? 320);
    const currency = typeof rule?.currency === 'string' ? rule.currency : 'GHS';

    if (timingType === 'full_day') {
      const multiStopExtra = Math.max(0, stops - 1) * (multiStopFee * 0.5);
      const total = Number((fullDayRate + multiStopExtra).toFixed(2));
      return res.json({
        currency,
        total,
        breakdown: [
          { label: 'Full-day dedicated vehicle & driver', amount: fullDayRate },
          ...(multiStopExtra > 0 ? [{ label: `Multi-stop coordination (${stops} stops)`, amount: Number(multiStopExtra.toFixed(2)) }] : []),
        ],
      });
    }

    const distanceCharge = Number((dist * perKmRate).toFixed(2));
    const extraStopsCharge = Number((Math.max(0, stops - 1) * multiStopFee).toFixed(2));
    const heavyCargoCharge = weight > 15 ? cargoSurcharge : 0;
    const timingCharge =
      timingType === 'scheduled' || timingType === 'driver_reservation' || timingType === 'vehicle_reservation'
        ? scheduledFee
        : 0;

    let subtotal = baseFee + distanceCharge + extraStopsCharge + heavyCargoCharge + timingCharge;
    const breakdown: Array<{ label: string; amount: number }> = [
      { label: 'Base dispatch fee', amount: baseFee },
      { label: `Distance (${dist.toFixed(1)} km × ${perKmRate} ${currency}/km)`, amount: distanceCharge },
    ];

    if (extraStopsCharge > 0) {
      breakdown.push({ label: `Additional stops (${stops - 1} × ${multiStopFee} ${currency})`, amount: extraStopsCharge });
    }
    if (heavyCargoCharge > 0) {
      breakdown.push({ label: 'Heavy cargo handling (>15 kg)', amount: heavyCargoCharge });
    }
    if (timingCharge > 0) {
      breakdown.push({ label: 'Scheduled / reservation allocation', amount: timingCharge });
    }
    if (isPriority) {
      const pExtra = Number((subtotal * (priorityMultiplier - 1)).toFixed(2));
      subtotal += pExtra;
      breakdown.push({ label: `Priority dispatch (×${priorityMultiplier})`, amount: pExtra });
    }
    if (isPeakHour) {
      const pkExtra = Number((subtotal * (peakMultiplier - 1)).toFixed(2));
      subtotal += pkExtra;
      breakdown.push({ label: `Peak-hour demand (×${peakMultiplier})`, amount: pkExtra });
    }

    const total = Number(Math.max(minimumFare, subtotal).toFixed(2));
    if (total > subtotal) {
      breakdown.push({ label: 'Minimum fare adjustment', amount: Number((total - subtotal).toFixed(2)) });
    }

    return res.json({ currency, total, breakdown });
  } catch (err) {
    console.error('Pricing quote error:', err);
    return res.status(500).json({ error: 'Unable to calculate delivery quote' });
  }
});

// ============================================================================
// 5. PAYMENT ABSTRACTION LAYER STATUS
// ============================================================================
app.get('/api/payments/providers', (_req, res) => {
  res.json({
    providers: [
      {
        id: 'mobile_money',
        name: 'Mobile Money (MTN MoMo / Telecel / Orange Money)',
        configured: Boolean(process.env.MOMO_API_KEY || process.env.PAYSTACK_SECRET_KEY),
        requiredEnvVars: ['PAYSTACK_SECRET_KEY or MOMO_API_KEY'],
        mode: process.env.PAYSTACK_SECRET_KEY ? 'live_ready' : 'setup_required',
      },
      {
        id: 'card',
        name: 'Card Payments (Visa / Mastercard)',
        configured: Boolean(process.env.STRIPE_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY),
        requiredEnvVars: ['STRIPE_SECRET_KEY'],
        mode: process.env.STRIPE_SECRET_KEY ? 'live_ready' : 'setup_required',
      },
      {
        id: 'invoice',
        name: 'Corporate Monthly Invoicing (Net-15 / Net-30)',
        configured: true,
        requiredEnvVars: [],
        mode: 'active',
      },
      {
        id: 'wallet',
        name: 'ROVA Business Wallet',
        configured: true,
        requiredEnvVars: [],
        mode: 'active',
      },
    ],
  });
});

// ============================================================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVER
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ROVA Logistics Platform server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
