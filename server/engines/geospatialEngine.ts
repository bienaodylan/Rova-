export interface GeoCoordinate {
  lat: number;
  lng: number;
}

export interface CityDispatchConfig {
  offerTtlSeconds: number;
  maxWaves: number;
  waveRadiiKm: number[];
  waveBatchSize: number;
  searchTimeoutSeconds: number;
}

export interface CityCancellationPolicy {
  freeCancelWindowSec: number;
  assignedFee: number;
  approachingPickupFee: number;
  atPickupFee: number;
  postPickupAllowed: boolean;
  returnFeeMultiplier: number;
}

export interface CityGpsPolicy {
  maxStaleSeconds: number;
  maxAccuracyMeters: number;
  idleIntervalSec: number;
  enRouteIntervalSec: number;
  approachingIntervalSec: number;
}

export interface CityOperatingHours {
  open: string; // HH:MM
  close: string; // HH:MM
  days: number[]; // 0 (Sun) - 6 (Sat)
}

export interface CityConfig {
  id: string;
  countryCode: string;
  countryName: string;
  name: string;
  currency: string;
  timezone: string;
  isActive: boolean;
  center: GeoCoordinate;
  serviceRadiusKm: number;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  maxDeliveryDistanceKm: number;
  maxDeliveryDurationMin: number;
  allowedVehicles: string[];
  operatingHours: CityOperatingHours;
  dispatchConfig: CityDispatchConfig;
  cancellationPolicy: CityCancellationPolicy;
  gpsPolicy: CityGpsPolicy;
}

export type DistanceSource = 'google_routes' | 'osrm' | 'haversine_fallback';

export interface RouteEstimate {
  distanceKm: number;
  straightLineKm: number;
  durationMin: number;
  distanceSource: DistanceSource;
  isFallbackEstimate: boolean;
  geometry: [number, number][];
}

export interface GeospatialValidationError {
  ok: false;
  code:
    | 'INVALID_COORDINATES'
    | 'PICKUP_OUTSIDE_SERVICE_AREA'
    | 'DESTINATION_OUTSIDE_SERVICE_AREA'
    | 'CROSS_CITY_NOT_SUPPORTED'
    | 'CITY_INACTIVE'
    | 'VEHICLE_NOT_SUPPORTED_IN_CITY'
    | 'ROUTE_LIMIT_EXCEEDED'
    | 'NO_STOPS_PROVIDED';
  messageFr: string;
  messageEn: string;
  details?: Record<string, unknown>;
}

export interface GeospatialValidationSuccess {
  ok: true;
  city: CityConfig;
  straightLineKm: number;
}

export type GeospatialValidationResult = GeospatialValidationSuccess | GeospatialValidationError;

export const DEFAULT_CITIES: CityConfig[] = [
  {
    id: 'abidjan',
    countryCode: 'CI',
    countryName: 'Côte d’Ivoire',
    name: 'Abidjan',
    currency: 'XOF',
    timezone: 'Africa/Abidjan',
    isActive: true,
    center: { lat: 5.348, lng: -4.017 },
    serviceRadiusKm: 32,
    bounds: { minLat: 5.18, maxLat: 5.56, minLng: -4.28, maxLng: -3.72 },
    maxDeliveryDistanceKm: 45,
    maxDeliveryDurationMin: 150,
    allowedVehicles: ['motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van', 'commercial_van', 'truck'],
    operatingHours: { open: '06:00', close: '23:00', days: [0, 1, 2, 3, 4, 5, 6] },
    dispatchConfig: {
      offerTtlSeconds: 30,
      maxWaves: 3,
      waveRadiiKm: [3, 8, 18],
      waveBatchSize: 3,
      searchTimeoutSeconds: 240,
    },
    cancellationPolicy: {
      freeCancelWindowSec: 120,
      assignedFee: 500,
      approachingPickupFee: 1000,
      atPickupFee: 1500,
      postPickupAllowed: false,
      returnFeeMultiplier: 0.75,
    },
    gpsPolicy: {
      maxStaleSeconds: 90,
      maxAccuracyMeters: 150,
      idleIntervalSec: 30,
      enRouteIntervalSec: 10,
      approachingIntervalSec: 5,
    },
  },
  {
    id: 'bouake',
    countryCode: 'CI',
    countryName: 'Côte d’Ivoire',
    name: 'Bouaké',
    currency: 'XOF',
    timezone: 'Africa/Abidjan',
    isActive: true,
    center: { lat: 7.69, lng: -5.03 },
    serviceRadiusKm: 22,
    bounds: { minLat: 7.5, maxLat: 7.88, minLng: -5.22, maxLng: -4.84 },
    maxDeliveryDistanceKm: 30,
    maxDeliveryDurationMin: 120,
    allowedVehicles: ['motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van'],
    operatingHours: { open: '06:30', close: '22:00', days: [0, 1, 2, 3, 4, 5, 6] },
    dispatchConfig: {
      offerTtlSeconds: 30,
      maxWaves: 3,
      waveRadiiKm: [3, 7, 15],
      waveBatchSize: 3,
      searchTimeoutSeconds: 240,
    },
    cancellationPolicy: {
      freeCancelWindowSec: 120,
      assignedFee: 400,
      approachingPickupFee: 800,
      atPickupFee: 1200,
      postPickupAllowed: false,
      returnFeeMultiplier: 0.75,
    },
    gpsPolicy: {
      maxStaleSeconds: 90,
      maxAccuracyMeters: 150,
      idleIntervalSec: 30,
      enRouteIntervalSec: 10,
      approachingIntervalSec: 5,
    },
  },
  {
    id: 'yamoussoukro',
    countryCode: 'CI',
    countryName: 'Côte d’Ivoire',
    name: 'Yamoussoukro',
    currency: 'XOF',
    timezone: 'Africa/Abidjan',
    isActive: true,
    center: { lat: 6.8276, lng: -5.2893 },
    serviceRadiusKm: 20,
    bounds: { minLat: 6.66, maxLat: 7.0, minLng: -5.46, maxLng: -5.1 },
    maxDeliveryDistanceKm: 28,
    maxDeliveryDurationMin: 120,
    allowedVehicles: ['motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van'],
    operatingHours: { open: '06:30', close: '22:00', days: [0, 1, 2, 3, 4, 5, 6] },
    dispatchConfig: {
      offerTtlSeconds: 30,
      maxWaves: 3,
      waveRadiiKm: [3, 7, 14],
      waveBatchSize: 3,
      searchTimeoutSeconds: 240,
    },
    cancellationPolicy: {
      freeCancelWindowSec: 120,
      assignedFee: 400,
      approachingPickupFee: 800,
      atPickupFee: 1200,
      postPickupAllowed: false,
      returnFeeMultiplier: 0.75,
    },
    gpsPolicy: {
      maxStaleSeconds: 90,
      maxAccuracyMeters: 150,
      idleIntervalSec: 30,
      enRouteIntervalSec: 10,
      approachingIntervalSec: 5,
    },
  },
  {
    id: 'accra',
    countryCode: 'GH',
    countryName: 'Ghana',
    name: 'Accra',
    currency: 'GHS',
    timezone: 'Africa/Accra',
    isActive: true,
    center: { lat: 5.6037, lng: -0.187 },
    serviceRadiusKm: 32,
    bounds: { minLat: 5.45, maxLat: 5.82, minLng: -0.42, maxLng: 0.08 },
    maxDeliveryDistanceKm: 45,
    maxDeliveryDurationMin: 150,
    allowedVehicles: ['motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van', 'commercial_van', 'truck'],
    operatingHours: { open: '06:00', close: '23:00', days: [0, 1, 2, 3, 4, 5, 6] },
    dispatchConfig: {
      offerTtlSeconds: 30,
      maxWaves: 3,
      waveRadiiKm: [3, 8, 18],
      waveBatchSize: 3,
      searchTimeoutSeconds: 240,
    },
    cancellationPolicy: {
      freeCancelWindowSec: 120,
      assignedFee: 10,
      approachingPickupFee: 18,
      atPickupFee: 25,
      postPickupAllowed: false,
      returnFeeMultiplier: 0.75,
    },
    gpsPolicy: {
      maxStaleSeconds: 90,
      maxAccuracyMeters: 150,
      idleIntervalSec: 30,
      enRouteIntervalSec: 10,
      approachingIntervalSec: 5,
    },
  },
  {
    id: 'dakar',
    countryCode: 'SN',
    countryName: 'Sénégal',
    name: 'Dakar',
    currency: 'XOF',
    timezone: 'Africa/Dakar',
    isActive: true,
    center: { lat: 14.7167, lng: -17.4677 },
    serviceRadiusKm: 28,
    bounds: { minLat: 14.58, maxLat: 14.88, minLng: -17.56, maxLng: -17.18 },
    maxDeliveryDistanceKm: 40,
    maxDeliveryDurationMin: 150,
    allowedVehicles: ['motorcycle', 'cargo_motorcycle', 'tricycle', 'cargo_van', 'commercial_van'],
    operatingHours: { open: '06:00', close: '23:00', days: [0, 1, 2, 3, 4, 5, 6] },
    dispatchConfig: {
      offerTtlSeconds: 30,
      maxWaves: 3,
      waveRadiiKm: [3, 8, 16],
      waveBatchSize: 3,
      searchTimeoutSeconds: 240,
    },
    cancellationPolicy: {
      freeCancelWindowSec: 120,
      assignedFee: 500,
      approachingPickupFee: 1000,
      atPickupFee: 1500,
      postPickupAllowed: false,
      returnFeeMultiplier: 0.75,
    },
    gpsPolicy: {
      maxStaleSeconds: 90,
      maxAccuracyMeters: 150,
      idleIntervalSec: 30,
      enRouteIntervalSec: 10,
      approachingIntervalSec: 5,
    },
  },
];

export function isValidCoordinate(point: unknown): point is GeoCoordinate {
  if (!point || typeof point !== 'object') return false;
  const p = point as GeoCoordinate;
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return false;
  // Reject null-island default coordinates (0, 0)
  if (Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001) return false;
  return true;
}

/**
 * Straight-line (Haversine) distance in kilometers.
 * Used ONLY for boundary checks, candidate proximity filtering, and explicit fallback estimates.
 */
export function haversineDistanceKm(a: GeoCoordinate, b: GeoCoordinate): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isPointInsideCity(point: GeoCoordinate, city: CityConfig): boolean {
  if (
    point.lat < city.bounds.minLat ||
    point.lat > city.bounds.maxLat ||
    point.lng < city.bounds.minLng ||
    point.lng > city.bounds.maxLng
  ) {
    return false;
  }
  const distFromCenter = haversineDistanceKm(point, city.center);
  return distFromCenter <= city.serviceRadiusKm;
}

export function resolvePointCity(
  point: GeoCoordinate,
  cities: CityConfig[] = DEFAULT_CITIES
): CityConfig | null {
  if (!isValidCoordinate(point)) return null;
  let bestCity: CityConfig | null = null;
  let bestDist = Infinity;
  for (const city of cities) {
    if (!isPointInsideCity(point, city)) continue;
    const d = haversineDistanceKm(point, city.center);
    if (d < bestDist) {
      bestDist = d;
      bestCity = city;
    }
  }
  return bestCity;
}

export function getCityById(
  cityId: string | undefined | null,
  cities: CityConfig[] = DEFAULT_CITIES
): CityConfig | null {
  if (!cityId) return null;
  return cities.find((c) => c.id === cityId.toLowerCase()) || null;
}

/**
 * Validates that pickup and every destination stop reside inside the SAME active ROVA city,
 * that the requested vehicle is enabled in that city, and that distance does not breach city limits.
 * Explicitly rejects inter-city (e.g. Abidjan -> Bouaké) and cross-country (e.g. Accra -> Abidjan) requests.
 */
export function validateDeliveryGeospatial(params: {
  pickup: GeoCoordinate;
  stops: GeoCoordinate[];
  vehicleCategory: string;
  cities?: CityConfig[];
}): GeospatialValidationResult {
  const cities = params.cities || DEFAULT_CITIES;

  if (!isValidCoordinate(params.pickup)) {
    return {
      ok: false,
      code: 'INVALID_COORDINATES',
      messageFr: 'Les coordonnées du point de collecte sont invalides.',
      messageEn: 'Pickup coordinates are invalid.',
    };
  }

  if (!Array.isArray(params.stops) || params.stops.length === 0) {
    return {
      ok: false,
      code: 'NO_STOPS_PROVIDED',
      messageFr: 'Au moins une destination valide est requise.',
      messageEn: 'At least one valid destination stop is required.',
    };
  }

  for (let i = 0; i < params.stops.length; i++) {
    if (!isValidCoordinate(params.stops[i])) {
      return {
        ok: false,
        code: 'INVALID_COORDINATES',
        messageFr: `Les coordonnées de la destination #${i + 1} sont invalides.`,
        messageEn: `Destination #${i + 1} coordinates are invalid.`,
      };
    }
  }

  const pickupCity = resolvePointCity(params.pickup, cities);
  if (!pickupCity) {
    return {
      ok: false,
      code: 'PICKUP_OUTSIDE_SERVICE_AREA',
      messageFr:
        'Le point de collecte est hors de nos zones urbaines desservies (Abidjan, Bouaké, Yamoussoukro, Accra, Dakar).',
      messageEn:
        'Pickup location is outside supported urban service areas (Abidjan, Bouaké, Yamoussoukro, Accra, Dakar).',
    };
  }

  if (!pickupCity.isActive) {
    return {
      ok: false,
      code: 'CITY_INACTIVE',
      messageFr: `Le service ROVA est actuellement suspendu à ${pickupCity.name}.`,
      messageEn: `ROVA service is currently inactive in ${pickupCity.name}.`,
      details: { cityId: pickupCity.id },
    };
  }

  for (let i = 0; i < params.stops.length; i++) {
    const stopCity = resolvePointCity(params.stops[i], cities);
    if (!stopCity) {
      return {
        ok: false,
        code: 'DESTINATION_OUTSIDE_SERVICE_AREA',
        messageFr: `La destination #${i + 1} se trouve hors de la zone urbaine desservie de ${pickupCity.name}.`,
        messageEn: `Destination #${i + 1} is outside the supported urban service area of ${pickupCity.name}.`,
        details: { pickupCityId: pickupCity.id, stopIndex: i },
      };
    }

    if (stopCity.id !== pickupCity.id) {
      return {
        ok: false,
        code: 'CROSS_CITY_NOT_SUPPORTED',
        messageFr: `Les livraisons inter-villes (${pickupCity.name} → ${stopCity.name}) ne sont pas disponibles. ROVA opère en logistique urbaine intra-ville.`,
        messageEn: `Cross-city deliveries (${pickupCity.name} → ${stopCity.name}) are not supported. ROVA operates within isolated urban service areas.`,
        details: {
          pickupCityId: pickupCity.id,
          pickupCityName: pickupCity.name,
          destinationCityId: stopCity.id,
          destinationCityName: stopCity.name,
        },
      };
    }
  }

  if (!pickupCity.allowedVehicles.includes(params.vehicleCategory)) {
    return {
      ok: false,
      code: 'VEHICLE_NOT_SUPPORTED_IN_CITY',
      messageFr: `La catégorie de véhicule « ${params.vehicleCategory} » n’est pas disponible à ${pickupCity.name}.`,
      messageEn: `Vehicle category "${params.vehicleCategory}" is not available in ${pickupCity.name}.`,
      details: { cityId: pickupCity.id, vehicleCategory: params.vehicleCategory },
    };
  }

  const allPoints = [params.pickup, ...params.stops];
  let straightLineKm = 0;
  for (let i = 0; i < allPoints.length - 1; i++) {
    straightLineKm += haversineDistanceKm(allPoints[i], allPoints[i + 1]);
  }
  straightLineKm = Number(straightLineKm.toFixed(2));

  if (straightLineKm > pickupCity.maxDeliveryDistanceKm) {
    return {
      ok: false,
      code: 'ROUTE_LIMIT_EXCEEDED',
      messageFr: `La distance demandée (${straightLineKm} km) dépasse la limite urbaine autorisée pour ${pickupCity.name} (${pickupCity.maxDeliveryDistanceKm} km).`,
      messageEn: `Requested distance (${straightLineKm} km) exceeds the maximum allowed distance for ${pickupCity.name} (${pickupCity.maxDeliveryDistanceKm} km).`,
      details: {
        straightLineKm,
        maxDeliveryDistanceKm: pickupCity.maxDeliveryDistanceKm,
        cityId: pickupCity.id,
      },
    };
  }

  return {
    ok: true,
    city: pickupCity,
    straightLineKm,
  };
}

/**
 * Validates computed road route against city maximum distance and duration thresholds.
 */
export function validateRouteAgainstCityLimits(
  route: RouteEstimate,
  city: CityConfig
): { ok: true } | GeospatialValidationError {
  if (route.distanceKm > city.maxDeliveryDistanceKm) {
    return {
      ok: false,
      code: 'ROUTE_LIMIT_EXCEEDED',
      messageFr: `La distance routière (${route.distanceKm} km) dépasse le maximum autorisé à ${city.name} (${city.maxDeliveryDistanceKm} km).`,
      messageEn: `Road distance (${route.distanceKm} km) exceeds the maximum allowed in ${city.name} (${city.maxDeliveryDistanceKm} km).`,
      details: { distanceKm: route.distanceKm, maxDeliveryDistanceKm: city.maxDeliveryDistanceKm },
    };
  }
  if (route.durationMin > city.maxDeliveryDurationMin) {
    return {
      ok: false,
      code: 'ROUTE_LIMIT_EXCEEDED',
      messageFr: `La durée estimée (${route.durationMin} min) dépasse la limite opérationnelle de ${city.name} (${city.maxDeliveryDurationMin} min).`,
      messageEn: `Estimated duration (${route.durationMin} min) exceeds operational limit for ${city.name} (${city.maxDeliveryDurationMin} min).`,
      details: { durationMin: route.durationMin, maxDeliveryDurationMin: city.maxDeliveryDurationMin },
    };
  }
  return { ok: true };
}

/**
 * Explicit fallback route estimator when external road routing APIs are unavailable.
 * Clearly marks `isFallbackEstimate: true` and `distanceSource: 'haversine_fallback'`.
 */
export function buildFallbackRouteEstimate(points: GeoCoordinate[]): RouteEstimate {
  let straightLineKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    straightLineKm += haversineDistanceKm(points[i], points[i + 1]);
  }
  // Urban road detour factor (1.30x) clearly marked as fallback estimate
  const roadEstimateKm = Math.max(0.5, Number((straightLineKm * 1.3).toFixed(2)));
  const durationMin = Math.max(5, Math.round((roadEstimateKm / 24) * 60));

  return {
    distanceKm: roadEstimateKm,
    straightLineKm: Number(straightLineKm.toFixed(2)),
    durationMin,
    distanceSource: 'haversine_fallback',
    isFallbackEstimate: true,
    geometry: points.map((p) => [p.lat, p.lng]),
  };
}
