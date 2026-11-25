import express from 'express';
import net from 'net';
import dotenv from 'dotenv';

dotenv.config();

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
// 0. INTELLIGENT BACKEND REGIONAL DETECTION (Edge Headers + IP Geo + TZ + Lang)
// ============================================================================
interface RegionProfile {
  countryCode: string;
  countryName: string;
  currency: string;
  city: string;
  lat: number;
  lng: number;
  defaultLang: 'fr' | 'en';
}

const REGION_PROFILES: Record<string, RegionProfile> = {
  CI: { countryCode: 'CI', countryName: 'Côte d’Ivoire', currency: 'XOF', city: 'Abidjan', lat: 5.3235, lng: -4.0267, defaultLang: 'fr' },
  SN: { countryCode: 'SN', countryName: 'Sénégal', currency: 'XOF', city: 'Dakar', lat: 14.7167, lng: -17.4677, defaultLang: 'fr' },
  BJ: { countryCode: 'BJ', countryName: 'Bénin', currency: 'XOF', city: 'Cotonou', lat: 6.3703, lng: 2.3912, defaultLang: 'fr' },
  TG: { countryCode: 'TG', countryName: 'Togo', currency: 'XOF', city: 'Lomé', lat: 6.1319, lng: 1.2228, defaultLang: 'fr' },
  BF: { countryCode: 'BF', countryName: 'Burkina Faso', currency: 'XOF', city: 'Ouagadougou', lat: 12.3714, lng: -1.5197, defaultLang: 'fr' },
  ML: { countryCode: 'ML', countryName: 'Mali', currency: 'XOF', city: 'Bamako', lat: 12.6392, lng: -8.0029, defaultLang: 'fr' },
  NE: { countryCode: 'NE', countryName: 'Niger', currency: 'XOF', city: 'Niamey', lat: 13.5116, lng: 2.1254, defaultLang: 'fr' },
  CM: { countryCode: 'CM', countryName: 'Cameroun', currency: 'XAF', city: 'Douala', lat: 4.0511, lng: 9.7679, defaultLang: 'fr' },
  GA: { countryCode: 'GA', countryName: 'Gabon', currency: 'XAF', city: 'Libreville', lat: 0.4162, lng: 9.4673, defaultLang: 'fr' },
  CG: { countryCode: 'CG', countryName: 'Congo', currency: 'XAF', city: 'Brazzaville', lat: -4.2634, lng: 15.2429, defaultLang: 'fr' },
  CD: { countryCode: 'CD', countryName: 'RD Congo', currency: 'USD', city: 'Kinshasa', lat: -4.4419, lng: 15.2663, defaultLang: 'fr' },
  GH: { countryCode: 'GH', countryName: 'Ghana', currency: 'GHS', city: 'Accra', lat: 5.6037, lng: -0.187, defaultLang: 'en' },
  NG: { countryCode: 'NG', countryName: 'Nigeria', currency: 'NGN', city: 'Lagos', lat: 6.5244, lng: 3.3792, defaultLang: 'en' },
  KE: { countryCode: 'KE', countryName: 'Kenya', currency: 'KES', city: 'Nairobi', lat: -1.2921, lng: 36.8219, defaultLang: 'en' },
  ZA: { countryCode: 'ZA', countryName: 'Afrique du Sud', currency: 'ZAR', city: 'Johannesburg', lat: -26.2041, lng: 28.0473, defaultLang: 'en' },
  TZ: { countryCode: 'TZ', countryName: 'Tanzanie', currency: 'TZS', city: 'Dar es Salaam', lat: -6.7924, lng: 39.2083, defaultLang: 'en' },
  UG: { countryCode: 'UG', countryName: 'Ouganda', currency: 'UGX', city: 'Kampala', lat: 0.3476, lng: 32.5825, defaultLang: 'en' },
  MA: { countryCode: 'MA', countryName: 'Maroc', currency: 'MAD', city: 'Casablanca', lat: 33.5731, lng: -7.5898, defaultLang: 'fr' },
  TN: { countryCode: 'TN', countryName: 'Tunisie', currency: 'EUR', city: 'Tunis', lat: 36.8065, lng: 10.1815, defaultLang: 'fr' },
  FR: { countryCode: 'FR', countryName: 'France', currency: 'EUR', city: 'Paris', lat: 48.8566, lng: 2.3522, defaultLang: 'fr' },
  BE: { countryCode: 'BE', countryName: 'Belgique', currency: 'EUR', city: 'Bruxelles', lat: 50.8503, lng: 4.3517, defaultLang: 'fr' },
  CH: { countryCode: 'CH', countryName: 'Suisse', currency: 'CHF', city: 'Genève', lat: 46.2044, lng: 6.1432, defaultLang: 'fr' },
  GB: { countryCode: 'GB', countryName: 'Royaume-Uni', currency: 'GBP', city: 'Londres', lat: 51.5072, lng: -0.1276, defaultLang: 'en' },
  DE: { countryCode: 'DE', countryName: 'Allemagne', currency: 'EUR', city: 'Berlin', lat: 52.52, lng: 13.405, defaultLang: 'en' },
  ES: { countryCode: 'ES', countryName: 'Espagne', currency: 'EUR', city: 'Madrid', lat: 40.4168, lng: -3.7038, defaultLang: 'en' },
  IT: { countryCode: 'IT', countryName: 'Italie', currency: 'EUR', city: 'Milan', lat: 45.4642, lng: 9.19, defaultLang: 'en' },
  CA: { countryCode: 'CA', countryName: 'Canada', currency: 'CAD', city: 'Montréal', lat: 45.5017, lng: -73.5673, defaultLang: 'fr' },
  US: { countryCode: 'US', countryName: 'États-Unis', currency: 'USD', city: 'New York', lat: 40.7128, lng: -74.006, defaultLang: 'en' },
  AE: { countryCode: 'AE', countryName: 'Émirats arabes unis', currency: 'AED', city: 'Dubaï', lat: 25.2048, lng: 55.2708, defaultLang: 'en' },
  AU: { countryCode: 'AU', countryName: 'Australie', currency: 'AUD', city: 'Sydney', lat: -33.8688, lng: 151.2093, defaultLang: 'en' },
  JP: { countryCode: 'JP', countryName: 'Japon', currency: 'JPY', city: 'Tokyo', lat: 35.6762, lng: 139.6503, defaultLang: 'en' },
  CN: { countryCode: 'CN', countryName: 'Chine', currency: 'CNY', city: 'Shanghai', lat: 31.2304, lng: 121.4737, defaultLang: 'en' },
  IN: { countryCode: 'IN', countryName: 'Inde', currency: 'INR', city: 'Mumbai', lat: 19.076, lng: 72.8777, defaultLang: 'en' },
};

const IANA_TZ_TO_COUNTRY: Record<string, string> = {
  'Africa/Abidjan': 'CI',
  'Africa/Accra': 'GH',
  'Africa/Dakar': 'SN',
  'Africa/Porto-Novo': 'BJ',
  'Africa/Lome': 'TG',
  'Africa/Ouagadougou': 'BF',
  'Africa/Bamako': 'ML',
  'Africa/Niamey': 'NE',
  'Africa/Douala': 'CM',
  'Africa/Libreville': 'GA',
  'Africa/Brazzaville': 'CG',
  'Africa/Kinshasa': 'CD',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Kampala': 'UG',
  'Africa/Casablanca': 'MA',
  'Africa/Tunis': 'TN',
  'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'America/Toronto': 'CA',
  'America/Montreal': 'CA',
  'America/Vancouver': 'CA',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'Asia/Dubai': 'AE',
  'Australia/Sydney': 'AU',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Kolkata': 'IN',
};

const PLACEHOLDER_KEY_PREFIXES = ['MY_', 'YOUR_', 'REPLACE_', 'INSERT_', 'CHANGE_ME', 'PLACEHOLDER'];

function getValidEnvKey(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.length < 20 || /\s/.test(trimmed)) return '';
  const upper = trimmed.toUpperCase();
  if (PLACEHOLDER_KEY_PREFIXES.some((p) => upper.startsWith(p))) return '';
  return trimmed;
}

function getGoogleMapsServerKey(): string {
  // Strictly server-only key — NEVER exposed to browser code
  return getValidEnvKey(process.env.GOOGLE_MAPS_SERVER_API_KEY);
}

function getGoogleMapsPublicBrowserKey(): string {
  // Public browser key restricted by HTTP referrer in Google Cloud Console
  return getValidEnvKey(process.env.VITE_GOOGLE_MAPS_API_KEY);
}

function createBoundedTtlCache<T>(maxEntries = 500) {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key: string): T | null {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() > hit.expiresAt) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key: string, value: T, ttlMs: number): void {
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
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
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

function isPublicIp(raw: string): boolean {
  const ip = raw.trim().replace(/^::ffff:/, '');
  const version = net.isIP(ip);
  if (version === 0) return false;
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
    return false;
  }
  return true;
}

function extractClientIp(req: express.Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const candidates: string[] = [];
  if (typeof forwarded === 'string') {
    candidates.push(...forwarded.split(',').map((s) => s.trim()));
  }
  if (req.ip) candidates.push(req.ip);
  for (const raw of candidates) {
    const clean = raw.replace(/^::ffff:/, '');
    if (isPublicIp(clean)) return clean;
  }
  return null;
}

function parseAcceptLanguageCountry(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.split(';')[0].trim());
  for (const tag of parts) {
    const match = tag.match(/^[a-z]{2,3}[-_]([A-Z]{2})$/i);
    if (match) {
      const code = match[1].toUpperCase();
      if (REGION_PROFILES[code]) return code;
    }
  }
  return null;
}

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

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

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

  const ipGeoCache = new Map<string, { countryCode: string; expiresAt: number }>();
  const geocodeSearchCache = createBoundedTtlCache<Array<Record<string, unknown>>>(500);
  const reverseGeocodeCache = createBoundedTtlCache<Record<string, unknown>>(500);
  const routeComputeCache = createBoundedTtlCache<{
    provider: string;
    distanceKm: number;
    durationMin: number;
    coordinates: [number, number][];
    geometry: [number, number][];
  }>(500);

  // ============================================================================
  // 0. INTELLIGENT BACKEND REGIONAL DETECTION
  // ============================================================================
  app.get('/api/region/detect', async (req, res) => {
    try {
      let detectedCode: string | null = null;
      let source: 'edge_header' | 'ip_geo' | 'timezone' | 'accept_language' | 'default' = 'default';

      const headerCandidates = [
        req.headers['x-appengine-country'],
        req.headers['cf-ipcountry'],
        req.headers['x-vercel-ip-country'],
        req.headers['x-country-code'],
        req.headers['x-client-region'],
      ];
      for (const h of headerCandidates) {
        if (typeof h === 'string') {
          const code = h.trim().toUpperCase();
          if (/^[A-Z]{2}$/.test(code) && code !== 'ZZ' && code !== 'XX' && REGION_PROFILES[code]) {
            detectedCode = code;
            source = 'edge_header';
            break;
          }
        }
      }

      if (!detectedCode) {
        const clientIp = extractClientIp(req);
        if (clientIp) {
          const cached = ipGeoCache.get(clientIp);
          if (cached && cached.expiresAt > Date.now()) {
            if (REGION_PROFILES[cached.countryCode]) {
              detectedCode = cached.countryCode;
              source = 'ip_geo';
            }
          } else {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 2500);
              const upstream = await fetch(
                `https://get.geojs.io/v1/ip/country/${encodeURIComponent(clientIp)}.json`,
                {
                  headers: { Accept: 'application/json', 'User-Agent': 'ROVA-Logistics-Platform/1.0' },
                  signal: controller.signal,
                }
              );
              clearTimeout(timer);
              if (upstream.ok) {
                const payload = (await upstream.json()) as { country?: string };
                const code = typeof payload.country === 'string' ? payload.country.trim().toUpperCase() : '';
                if (/^[A-Z]{2}$/.test(code) && REGION_PROFILES[code]) {
                  if (ipGeoCache.size >= 1000) {
                    const firstKey = ipGeoCache.keys().next().value;
                    if (firstKey) ipGeoCache.delete(firstKey);
                  }
                  ipGeoCache.set(clientIp, { countryCode: code, expiresAt: Date.now() + 6 * 3600_000 });
                  detectedCode = code;
                  source = 'ip_geo';
                }
              }
            } catch {
              // Fall through silently
            }
          }
        }
      }

      if (!detectedCode && typeof req.query.tz === 'string') {
        const tz = req.query.tz.trim();
        if (/^[A-Za-z0-9_/-]{1,64}$/.test(tz) && IANA_TZ_TO_COUNTRY[tz]) {
          const code = IANA_TZ_TO_COUNTRY[tz];
          if (REGION_PROFILES[code]) {
            detectedCode = code;
            source = 'timezone';
          }
        }
      }

      if (!detectedCode) {
        const langCode = parseAcceptLanguageCountry(
          typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : undefined
        );
        if (langCode) {
          detectedCode = langCode;
          source = 'accept_language';
        }
      }

      const profile = REGION_PROFILES[detectedCode || 'CI'] || REGION_PROFILES.CI;
      return res.json({ ...profile, source });
    } catch (err) {
      console.error('Region detect error:', err);
      return res.json({ ...REGION_PROFILES.CI, source: 'default' });
    }
  });

  // ============================================================================
  // PUBLIC MAPS RUNTIME CONFIG (NEVER exposes server key)
  // ============================================================================
  app.get('/api/maps/client-config', (_req, res) => {
    res.json({
      browserApiKey: getGoogleMapsPublicBrowserKey(),
      serverGeocodingEnabled: Boolean(getGoogleMapsServerKey()),
      serverRoutesEnabled: Boolean(getGoogleMapsServerKey()),
    });
  });

  // ============================================================================
  // 1. REAL GEOCODING SEARCH (GPS + GhanaPostGPS + Google Geocoding + Nominatim)
  // ============================================================================
  app.get('/api/geo/search', async (req, res) => {
    try {
      const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const countryCodes = typeof req.query.countrycodes === 'string' ? req.query.countrycodes.replace(/[^a-z,]/gi, '') : '';
      const regionBias = typeof req.query.region === 'string' ? req.query.region.replace(/[^a-z]/gi, '').slice(0, 2).toLowerCase() : '';
      if (!rawQ || rawQ.length < 2 || rawQ.length > 200) {
        return res.json({ results: [] });
      }

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

      const cacheKey = `${rawQ.toLowerCase()}|${countryCodes.toLowerCase()}|${regionBias}`;
      const cachedResults = geocodeSearchCache.get(cacheKey);
      if (cachedResults) {
        return res.json({ results: cachedResults, cached: true });
      }

      const googleServerKey = getGoogleMapsServerKey();
      if (googleServerKey) {
        try {
          const gParams = new URLSearchParams({ address: rawQ, key: googleServerKey });
          if (regionBias) gParams.set('region', regionBias);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const gRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?${gParams.toString()}`,
            { signal: controller.signal }
          );
          clearTimeout(timeout);
          if (gRes.ok) {
            const gData = (await gRes.json()) as {
              status?: string;
              results?: Array<{
                formatted_address: string;
                geometry?: { location?: { lat: number; lng: number } };
                address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
                types?: string[];
              }>;
            };
            if (gData.status === 'OK' && Array.isArray(gData.results) && gData.results.length > 0) {
              const results = gData.results.slice(0, 6).map((item) => {
                const comps = item.address_components || [];
                const findComp = (type: string) =>
                  comps.find((c) => c.types.includes(type))?.long_name || '';
                const premise = findComp('point_of_interest') || findComp('establishment') || findComp('premise');
                const route = findComp('route');
                const sublocality = findComp('sublocality') || findComp('neighborhood');
                const locality = findComp('locality') || findComp('administrative_area_level_1');
                const shortName =
                  [premise || route, sublocality, locality].filter(Boolean).slice(0, 3).join(', ') ||
                  item.formatted_address;
                return {
                  displayName: item.formatted_address,
                  shortName,
                  landmark: premise || sublocality || undefined,
                  lat: item.geometry?.location?.lat ?? 0,
                  lng: item.geometry?.location?.lng ?? 0,
                  type: item.types?.[0] || 'place',
                };
              });
              geocodeSearchCache.set(cacheKey, results, 15 * 60_000);
              return res.json({ results, provider: 'google_geocoding' });
            }
          }
        } catch {
          // Fall through to Nominatim
        }
      }

      const params = new URLSearchParams({
        q: rawQ,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '6',
      });
      if (countryCodes) params.set('countrycodes', countryCodes);

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

      geocodeSearchCache.set(cacheKey, results, 10 * 60_000);
      return res.json({ results, provider: 'nominatim' });
    } catch (err) {
      console.error('Geocode search error:', err);
      return res.status(500).json({ error: 'Unable to search addresses right now', results: [] });
    }
  });

  // ============================================================================
  // 2. REAL REVERSE GEOCODING
  // ============================================================================
  app.get('/api/geo/reverse', async (req, res) => {
    try {
      const lat = parseFloat(String(req.query.lat ?? ''));
      const lng = parseFloat(String(req.query.lng ?? ''));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'Valid lat and lng are required' });
      }

      const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      const cached = reverseGeocodeCache.get(cacheKey);
      if (cached) {
        return res.json({ ...cached, lat, lng });
      }

      const googleServerKey = getGoogleMapsServerKey();
      if (googleServerKey) {
        try {
          const gParams = new URLSearchParams({ latlng: `${lat},${lng}`, key: googleServerKey });
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const gRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?${gParams.toString()}`,
            { signal: controller.signal }
          );
          clearTimeout(timeout);
          if (gRes.ok) {
            const gData = (await gRes.json()) as {
              status?: string;
              results?: Array<{
                formatted_address: string;
                address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
              }>;
            };
            const first = gData.results?.[0];
            if (gData.status === 'OK' && first) {
              const comps = first.address_components || [];
              const findLong = (type: string) => comps.find((c) => c.types.includes(type))?.long_name || '';
              const findShort = (type: string) => comps.find((c) => c.types.includes(type))?.short_name || '';
              const road = findLong('route');
              const area = findLong('sublocality') || findLong('neighborhood');
              const city = findLong('locality') || findLong('administrative_area_level_1');
              const country = findLong('country');
              const countryCode = findShort('country').toUpperCase() || undefined;
              const shortName =
                [road, area, city].filter(Boolean).join(', ') ||
                first.formatted_address ||
                `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
              const payload = {
                displayName: first.formatted_address || shortName,
                shortName,
                landmark: area || undefined,
                country: country || undefined,
                countryCode,
                provider: 'google_geocoding',
              };
              reverseGeocodeCache.set(cacheKey, payload, 15 * 60_000);
              return res.json({ ...payload, lat, lng });
            }
          }
        } catch {
          // Fall through to Nominatim
        }
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

      const payload = {
        displayName: data.display_name || shortName,
        shortName,
        landmark: landmark || undefined,
        country: addr.country || undefined,
        countryCode: addr.country_code ? addr.country_code.toUpperCase() : undefined,
        provider: 'nominatim',
      };
      reverseGeocodeCache.set(cacheKey, payload, 10 * 60_000);
      return res.json({ ...payload, lat, lng });
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
  // 3. REAL ROAD ROUTING & MULTI-STOP OPTIMIZATION
  // ============================================================================
  app.post('/api/geo/route', async (req, res) => {
    try {
      const points = validatePoints(req.body?.points ?? req.body?.coordinates);
      if (!points) {
        return res.status(400).json({ error: 'Provide 2 to 40 valid coordinate points' });
      }

      const cacheKey = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
      const cachedRoute = routeComputeCache.get(cacheKey);
      if (cachedRoute) {
        return res.json({ ...cachedRoute, cached: true });
      }

      const googleServerKey = getGoogleMapsServerKey();
      if (googleServerKey && points.length <= 27) {
        try {
          const origin = points[0];
          const destination = points[points.length - 1];
          const intermediates = points.slice(1, -1).map((p) => ({
            location: { latLng: { latitude: p.lat, longitude: p.lng } },
          }));

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
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
            const gRoute = gData.routes?.[0];
            const encoded = gRoute?.polyline?.encodedPolyline;
            if (gRoute && encoded) {
              const decodedPath = decodeGooglePolyline(encoded);
              const distanceKm = Number(((gRoute.distanceMeters || 0) / 1000).toFixed(2));
              const durationSec = parseInt(String(gRoute.duration || '0').replace(/[^0-9]/g, ''), 10) || 0;
              const durationMin = Math.max(3, Math.round(durationSec / 60));
              const result = {
                provider: 'google_routes',
                distanceKm,
                durationMin,
                coordinates: decodedPath,
                geometry: decodedPath,
              };
              routeComputeCache.set(cacheKey, result, 10 * 60_000);
              return res.json(result);
            }
          }
        } catch {
          // Fall through to OSRM
        }
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
            const latLngPath = route.geometry.coordinates.map(([lng, lat]): [number, number] => [lat, lng]);
            const result = {
              provider: 'osrm',
              distanceKm: Number((route.distance / 1000).toFixed(2)),
              durationMin: Math.max(3, Math.round(route.duration / 60)),
              coordinates: latLngPath,
              geometry: latLngPath,
            };
            routeComputeCache.set(cacheKey, result, 10 * 60_000);
            return res.json(result);
          }
        }
      } catch {
        // Fallback below
      }

      let totalKm = 0;
      for (let i = 0; i < points.length - 1; i++) {
        totalKm += haversineKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1.28;
      }
      const fallbackPath: [number, number][] = points.map((p) => [p.lat, p.lng]);
      return res.json({
        provider: 'haversine_fallback',
        distanceKm: Number(totalKm.toFixed(2)),
        durationMin: Math.max(5, Math.round((totalKm / 26) * 60)),
        coordinates: fallbackPath,
        geometry: fallbackPath,
      });
    } catch (err) {
      console.error('Route calculation error:', err);
      return res.status(500).json({ error: 'Failed to compute route' });
    }
  });

  app.post('/api/geo/optimize', async (req, res) => {
    try {
      const pickup = (req.body?.pickup ?? req.body?.origin) as CoordPoint | undefined;
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

  return app;
}
