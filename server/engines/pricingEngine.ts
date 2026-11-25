import crypto from 'crypto';
import {
  buildFallbackRouteEstimate,
  CityConfig,
  DEFAULT_CITIES,
  DistanceSource,
  GeoCoordinate,
  RouteEstimate,
  validateDeliveryGeospatial,
  validateRouteAgainstCityLimits,
} from './geospatialEngine.ts';

export interface PricingRuleVersion {
  id: string;
  cityId: string;
  vehicleCategory: string;
  versionNumber: number;
  currency: string;
  baseFee: number;
  perKmRate: number;
  perMinRate: number;
  minimumFare: number;
  cargoSurcharge: number;
  fragileSurcharge: number;
  multiStopFee: number;
  scheduledFee: number;
  waitingFeePerMin: number;
  returnFeeMultiplier: number;
  platformCommissionRate: number; // e.g., 0.20 = 20%
  priorityMultiplier: number;
  peakMultiplier: number;
  fullDayRate: number;
  isActive: boolean;
}

export interface QuoteBreakdownItem {
  code: string;
  labelFr: string;
  labelEn: string;
  amount: number;
}

export interface AuthoritativeQuote {
  id: string;
  cityId: string;
  cityName: string;
  countryCode: string;
  pricingRuleVersionId: string;
  vehicleCategory: string;
  timingType: string;
  pickup: GeoCoordinate;
  stops: GeoCoordinate[];
  distanceKm: number;
  straightLineKm: number;
  durationMin: number;
  distanceSource: DistanceSource;
  isFallbackEstimate: boolean;
  currency: string;
  customerTotal: number;
  courierEarnings: number;
  platformCommission: number;
  breakdown: QuoteBreakdownItem[];
  createdAt: string;
  expiresAt: string;
  signatureHash: string;
  status: 'active' | 'consumed' | 'expired';
}

export interface QuoteRequestInput {
  userUid?: string;
  pickup: GeoCoordinate;
  stops: GeoCoordinate[];
  vehicleCategory: string;
  timingType?: string;
  weightKg?: number;
  packageSize?: 'small' | 'medium' | 'large' | 'bulk';
  fragile?: boolean;
  isPriority?: boolean;
  isPeakHour?: boolean;
  routeOverride?: RouteEstimate;
  cities?: CityConfig[];
  customRules?: PricingRuleVersion[];
  nowMs?: number;
  quoteTtlSeconds?: number;
}

export type QuoteGenerationResult =
  | { ok: true; quote: AuthoritativeQuote }
  | {
      ok: false;
      code: string;
      messageFr: string;
      messageEn: string;
      details?: Record<string, unknown>;
    };

// Ephemeral fallback secret for dev/tests ONLY when QUOTE_SIGNING_SECRET is not configured
const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

function getQuoteSigningSecret(): string {
  const configured = (process.env.QUOTE_SIGNING_SECRET || '').trim();
  if (configured.length >= 16) return configured;
  return EPHEMERAL_SIGNING_KEY;
}

// ============================================================================
// AUTHORITATIVE VERSIONED CITY TARIFF CATALOG
// XOF cities (Abidjan, Bouaké, Yamoussoukro, Dakar) use realistic Franc CFA rates
// GHS city (Accra) uses realistic Ghana Cedi rates
// ============================================================================
interface VehicleBaseTariff {
  baseFee: number;
  perKmRate: number;
  perMinRate: number;
  minimumFare: number;
  cargoSurcharge: number;
  fragileSurcharge: number;
  multiStopFee: number;
  scheduledFee: number;
  waitingFeePerMin: number;
  fullDayRate: number;
  commissionRate: number;
}

const XOF_CITY_TARIFFS: Record<string, VehicleBaseTariff> = {
  motorcycle: {
    baseFee: 1000,
    perKmRate: 250,
    perMinRate: 25,
    minimumFare: 1500,
    cargoSurcharge: 500,
    fragileSurcharge: 500,
    multiStopFee: 600,
    scheduledFee: 500,
    waitingFeePerMin: 50,
    fullDayRate: 25000,
    commissionRate: 0.2,
  },
  cargo_motorcycle: {
    baseFee: 1500,
    perKmRate: 300,
    perMinRate: 30,
    minimumFare: 2000,
    cargoSurcharge: 800,
    fragileSurcharge: 600,
    multiStopFee: 800,
    scheduledFee: 500,
    waitingFeePerMin: 60,
    fullDayRate: 32000,
    commissionRate: 0.2,
  },
  tricycle: {
    baseFee: 2500,
    perKmRate: 450,
    perMinRate: 40,
    minimumFare: 3500,
    cargoSurcharge: 1500,
    fragileSurcharge: 800,
    multiStopFee: 1000,
    scheduledFee: 750,
    waitingFeePerMin: 75,
    fullDayRate: 45000,
    commissionRate: 0.2,
  },
  cargo_van: {
    baseFee: 5000,
    perKmRate: 700,
    perMinRate: 60,
    minimumFare: 7000,
    cargoSurcharge: 2500,
    fragileSurcharge: 1200,
    multiStopFee: 1500,
    scheduledFee: 1000,
    waitingFeePerMin: 100,
    fullDayRate: 75000,
    commissionRate: 0.18,
  },
  commercial_van: {
    baseFee: 8000,
    perKmRate: 950,
    perMinRate: 80,
    minimumFare: 11000,
    cargoSurcharge: 3500,
    fragileSurcharge: 1500,
    multiStopFee: 2000,
    scheduledFee: 1500,
    waitingFeePerMin: 150,
    fullDayRate: 110000,
    commissionRate: 0.18,
  },
  truck: {
    baseFee: 18000,
    perKmRate: 1600,
    perMinRate: 120,
    minimumFare: 25000,
    cargoSurcharge: 6000,
    fragileSurcharge: 2500,
    multiStopFee: 3500,
    scheduledFee: 2500,
    waitingFeePerMin: 250,
    fullDayRate: 210000,
    commissionRate: 0.15,
  },
};

const GHS_CITY_TARIFFS: Record<string, VehicleBaseTariff> = {
  motorcycle: {
    baseFee: 18,
    perKmRate: 4.5,
    perMinRate: 0.5,
    minimumFare: 22,
    cargoSurcharge: 10,
    fragileSurcharge: 8,
    multiStopFee: 7,
    scheduledFee: 6,
    waitingFeePerMin: 1.5,
    fullDayRate: 260,
    commissionRate: 0.2,
  },
  cargo_motorcycle: {
    baseFee: 24,
    perKmRate: 5.5,
    perMinRate: 0.6,
    minimumFare: 30,
    cargoSurcharge: 12,
    fragileSurcharge: 10,
    multiStopFee: 9,
    scheduledFee: 6,
    waitingFeePerMin: 1.8,
    fullDayRate: 330,
    commissionRate: 0.2,
  },
  tricycle: {
    baseFee: 36,
    perKmRate: 7.5,
    perMinRate: 0.8,
    minimumFare: 45,
    cargoSurcharge: 18,
    fragileSurcharge: 12,
    multiStopFee: 12,
    scheduledFee: 10,
    waitingFeePerMin: 2.0,
    fullDayRate: 440,
    commissionRate: 0.2,
  },
  cargo_van: {
    baseFee: 65,
    perKmRate: 11,
    perMinRate: 1.2,
    minimumFare: 80,
    cargoSurcharge: 30,
    fragileSurcharge: 18,
    multiStopFee: 18,
    scheduledFee: 14,
    waitingFeePerMin: 3.0,
    fullDayRate: 760,
    commissionRate: 0.18,
  },
  commercial_van: {
    baseFee: 95,
    perKmRate: 14,
    perMinRate: 1.6,
    minimumFare: 120,
    cargoSurcharge: 45,
    fragileSurcharge: 22,
    multiStopFee: 24,
    scheduledFee: 18,
    waitingFeePerMin: 4.0,
    fullDayRate: 1080,
    commissionRate: 0.18,
  },
  truck: {
    baseFee: 180,
    perKmRate: 22,
    perMinRate: 2.5,
    minimumFare: 230,
    cargoSurcharge: 80,
    fragileSurcharge: 35,
    multiStopFee: 40,
    scheduledFee: 30,
    waitingFeePerMin: 6.0,
    fullDayRate: 1950,
    commissionRate: 0.15,
  },
};

const CITY_PRICE_MULTIPLIERS: Record<string, number> = {
  abidjan: 1.0,
  bouake: 0.85,
  yamoussoukro: 0.85,
  dakar: 1.05,
  accra: 1.0,
};

function roundCurrency(amount: number, currency: string): number {
  if (currency === 'XOF' || currency === 'XAF') {
    // Round to nearest 50 FCFA for clean urban cash/MoMo pricing
    return Math.round(amount / 50) * 50;
  }
  return Number(amount.toFixed(2));
}

export function resolvePricingRuleVersion(
  city: CityConfig,
  vehicleCategory: string,
  customRules?: PricingRuleVersion[]
): PricingRuleVersion {
  if (customRules?.length) {
    const active = customRules.find(
      (r) => r.isActive && r.cityId === city.id && r.vehicleCategory === vehicleCategory
    );
    if (active) return active;
  }

  const catalog = city.currency === 'GHS' ? GHS_CITY_TARIFFS : XOF_CITY_TARIFFS;
  const spec = catalog[vehicleCategory] || catalog.motorcycle;
  const mult = CITY_PRICE_MULTIPLIERS[city.id] ?? 1.0;

  return {
    id: `prv_${city.id}_${vehicleCategory}_v1`,
    cityId: city.id,
    vehicleCategory,
    versionNumber: 1,
    currency: city.currency,
    baseFee: roundCurrency(spec.baseFee * mult, city.currency),
    perKmRate: roundCurrency(spec.perKmRate * mult, city.currency),
    perMinRate: city.currency === 'GHS' ? Number((spec.perMinRate * mult).toFixed(2)) : Math.round(spec.perMinRate * mult),
    minimumFare: roundCurrency(spec.minimumFare * mult, city.currency),
    cargoSurcharge: roundCurrency(spec.cargoSurcharge * mult, city.currency),
    fragileSurcharge: roundCurrency(spec.fragileSurcharge * mult, city.currency),
    multiStopFee: roundCurrency(spec.multiStopFee * mult, city.currency),
    scheduledFee: roundCurrency(spec.scheduledFee * mult, city.currency),
    waitingFeePerMin: spec.waitingFeePerMin,
    returnFeeMultiplier: city.cancellationPolicy.returnFeeMultiplier,
    platformCommissionRate: spec.commissionRate,
    priorityMultiplier: 1.25,
    peakMultiplier: 1.15,
    fullDayRate: roundCurrency(spec.fullDayRate * mult, city.currency),
    isActive: true,
  };
}

export function signQuotePayload(payload: {
  id: string;
  cityId: string;
  pricingRuleVersionId: string;
  vehicleCategory: string;
  pickup: GeoCoordinate;
  stops: GeoCoordinate[];
  customerTotal: number;
  courierEarnings: number;
  platformCommission: number;
  currency: string;
  expiresAt: string;
}): string {
  const canonical = JSON.stringify({
    id: payload.id,
    cityId: payload.cityId,
    pricingRuleVersionId: payload.pricingRuleVersionId,
    vehicleCategory: payload.vehicleCategory,
    pickup: [Number(payload.pickup.lat.toFixed(5)), Number(payload.pickup.lng.toFixed(5))],
    stops: payload.stops.map((s) => [Number(s.lat.toFixed(5)), Number(s.lng.toFixed(5))]),
    customerTotal: payload.customerTotal,
    courierEarnings: payload.courierEarnings,
    platformCommission: payload.platformCommission,
    currency: payload.currency,
    expiresAt: payload.expiresAt,
  });

  return crypto
    .createHmac('sha256', getQuoteSigningSecret())
    .update(canonical)
    .digest('hex');
}

export function generateAuthoritativeQuote(input: QuoteRequestInput): QuoteGenerationResult {
  const cities = input.cities || DEFAULT_CITIES;
  const nowMs = input.nowMs ?? Date.now();
  const ttlSec = Math.max(60, Math.min(1800, input.quoteTtlSeconds ?? 600)); // default 10 min

  // 1. Geospatial & City Isolation Validation
  const geo = validateDeliveryGeospatial({
    pickup: input.pickup,
    stops: input.stops,
    vehicleCategory: input.vehicleCategory,
    cities,
  });

  if (!geo.ok) {
    return geo;
  }

  const { city } = geo;

  // 2. Route distance & duration (explicitly distinguishes real road route vs fallback)
  const route: RouteEstimate =
    input.routeOverride || buildFallbackRouteEstimate([input.pickup, ...input.stops]);

  const limitCheck = validateRouteAgainstCityLimits(route, city);
  if (!limitCheck.ok) {
    return limitCheck;
  }

  // 3. Pricing rule lookup for this city & vehicle
  const rule = resolvePricingRuleVersion(city, input.vehicleCategory, input.customRules);
  const timingType = input.timingType || 'instant';
  const breakdown: QuoteBreakdownItem[] = [];

  let subtotal = 0;

  if (timingType === 'full_day') {
    breakdown.push({
      code: 'full_day_charter',
      labelFr: `Affrètement journée (${city.name})`,
      labelEn: `Full-day charter (${city.name})`,
      amount: rule.fullDayRate,
    });
    subtotal = rule.fullDayRate;
  } else {
    breakdown.push({
      code: 'base_fee',
      labelFr: `Prise en charge (${city.name})`,
      labelEn: `Base dispatch fee (${city.name})`,
      amount: rule.baseFee,
    });
    subtotal += rule.baseFee;

    const distanceFee = roundCurrency(route.distanceKm * rule.perKmRate, city.currency);
    breakdown.push({
      code: 'distance_fee',
      labelFr: `Distance (${route.distanceKm.toFixed(1)} km)`,
      labelEn: `Distance (${route.distanceKm.toFixed(1)} km)`,
      amount: distanceFee,
    });
    subtotal += distanceFee;

    if (rule.perMinRate > 0) {
      const durationFee = roundCurrency(route.durationMin * rule.perMinRate, city.currency);
      breakdown.push({
        code: 'duration_fee',
        labelFr: `Temps estimé (${route.durationMin} min)`,
        labelEn: `Estimated duration (${route.durationMin} min)`,
        amount: durationFee,
      });
      subtotal += durationFee;
    }

    const extraStops = Math.max(0, input.stops.length - 1);
    if (extraStops > 0) {
      const multiStopAmount = roundCurrency(extraStops * rule.multiStopFee, city.currency);
      breakdown.push({
        code: 'multi_stop_fee',
        labelFr: `Arrêts supplémentaires (${extraStops})`,
        labelEn: `Additional stops (${extraStops})`,
        amount: multiStopAmount,
      });
      subtotal += multiStopAmount;
    }

    const weightKg = Number(input.weightKg || 1);
    const isHeavyOrLarge =
      weightKg > 15 || input.packageSize === 'large' || input.packageSize === 'bulk';
    if (isHeavyOrLarge) {
      breakdown.push({
        code: 'cargo_surcharge',
        labelFr: 'Supplément volume / poids',
        labelEn: 'Heavy / bulky cargo surcharge',
        amount: rule.cargoSurcharge,
      });
      subtotal += rule.cargoSurcharge;
    }

    if (input.fragile) {
      breakdown.push({
        code: 'fragile_surcharge',
        labelFr: 'Manutention fragile',
        labelEn: 'Fragile handling surcharge',
        amount: rule.fragileSurcharge,
      });
      subtotal += rule.fragileSurcharge;
    }

    if (timingType === 'scheduled') {
      breakdown.push({
        code: 'scheduled_fee',
        labelFr: 'Créneau planifié',
        labelEn: 'Scheduled window fee',
        amount: rule.scheduledFee,
      });
      subtotal += rule.scheduledFee;
    }

    if (input.isPriority) {
      const delta = roundCurrency(subtotal * (rule.priorityMultiplier - 1), city.currency);
      if (delta > 0) {
        breakdown.push({
          code: 'priority_multiplier',
          labelFr: 'Service express prioritaire',
          labelEn: 'Priority express dispatch',
          amount: delta,
        });
        subtotal += delta;
      }
    }

    if (input.isPeakHour) {
      const delta = roundCurrency(subtotal * (rule.peakMultiplier - 1), city.currency);
      if (delta > 0) {
        breakdown.push({
          code: 'peak_multiplier',
          labelFr: 'Forte affluence urbaine',
          labelEn: 'Peak demand adjustment',
          amount: delta,
        });
        subtotal += delta;
      }
    }
  }

  // Enforce city minimum fare
  if (subtotal < rule.minimumFare) {
    const floorAdj = roundCurrency(rule.minimumFare - subtotal, city.currency);
    breakdown.push({
      code: 'minimum_fare_adjustment',
      labelFr: 'Ajustement tarif minimum',
      labelEn: 'Minimum fare floor adjustment',
      amount: floorAdj,
    });
    subtotal = rule.minimumFare;
  }

  const customerTotal = roundCurrency(subtotal, city.currency);
  const platformCommission = roundCurrency(
    customerTotal * rule.platformCommissionRate,
    city.currency
  );
  const courierEarnings = roundCurrency(
    Math.max(0, customerTotal - platformCommission),
    city.currency
  );

  const id = `qt_${crypto.randomBytes(8).toString('hex')}`;
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlSec * 1000).toISOString();

  const signatureHash = signQuotePayload({
    id,
    cityId: city.id,
    pricingRuleVersionId: rule.id,
    vehicleCategory: input.vehicleCategory,
    pickup: input.pickup,
    stops: input.stops,
    customerTotal,
    courierEarnings,
    platformCommission,
    currency: city.currency,
    expiresAt,
  });

  return {
    ok: true,
    quote: {
      id,
      cityId: city.id,
      cityName: city.name,
      countryCode: city.countryCode,
      pricingRuleVersionId: rule.id,
      vehicleCategory: input.vehicleCategory,
      timingType,
      pickup: input.pickup,
      stops: input.stops,
      distanceKm: route.distanceKm,
      straightLineKm: route.straightLineKm,
      durationMin: route.durationMin,
      distanceSource: route.distanceSource,
      isFallbackEstimate: route.isFallbackEstimate,
      currency: city.currency,
      customerTotal,
      courierEarnings,
      platformCommission,
      breakdown,
      createdAt,
      expiresAt,
      signatureHash,
      status: 'active',
    },
  };
}

export interface QuoteVerificationResult {
  ok: boolean;
  code?:
    | 'QUOTE_EXPIRED'
    | 'QUOTE_ALREADY_USED'
    | 'QUOTE_SIGNATURE_INVALID'
    | 'QUOTE_MISMATCH'
    | 'PRICE_MANIPULATION_DETECTED';
  messageFr?: string;
  messageEn?: string;
}

/**
 * Verifies a quote before confirming an order.
 * Prevents expired quotes, replay attacks, tampered signatures, changed coordinates,
 * and manipulated frontend prices.
 */
export function verifyQuoteForOrderConfirmation(params: {
  quote: AuthoritativeQuote;
  pickup: GeoCoordinate;
  stops: GeoCoordinate[];
  vehicleCategory: string;
  clientSubmittedPrice?: number;
  nowMs?: number;
}): QuoteVerificationResult {
  const { quote } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (quote.status === 'consumed') {
    return {
      ok: false,
      code: 'QUOTE_ALREADY_USED',
      messageFr: 'Ce devis a déjà été utilisé pour une commande.',
      messageEn: 'This quote has already been consumed by an order.',
    };
  }

  if (quote.status === 'expired' || Date.parse(quote.expiresAt) <= nowMs) {
    return {
      ok: false,
      code: 'QUOTE_EXPIRED',
      messageFr: 'Ce devis a expiré. Veuillez recalculer le tarif avant de confirmer.',
      messageEn: 'This quote has expired. Please request a fresh quote before confirming.',
    };
  }

  const expectedSig = signQuotePayload({
    id: quote.id,
    cityId: quote.cityId,
    pricingRuleVersionId: quote.pricingRuleVersionId,
    vehicleCategory: quote.vehicleCategory,
    pickup: quote.pickup,
    stops: quote.stops,
    customerTotal: quote.customerTotal,
    courierEarnings: quote.courierEarnings,
    platformCommission: quote.platformCommission,
    currency: quote.currency,
    expiresAt: quote.expiresAt,
  });

  const sigA = Buffer.from(quote.signatureHash || '', 'utf8');
  const sigB = Buffer.from(expectedSig, 'utf8');
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    return {
      ok: false,
      code: 'QUOTE_SIGNATURE_INVALID',
      messageFr: 'Signature de devis invalide.',
      messageEn: 'Quote integrity signature verification failed.',
    };
  }

  const coordsMatch = (a: GeoCoordinate, b: GeoCoordinate) =>
    Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lng - b.lng) < 0.001;

  if (
    quote.vehicleCategory !== params.vehicleCategory ||
    !coordsMatch(quote.pickup, params.pickup) ||
    quote.stops.length !== params.stops.length ||
    quote.stops.some((s, i) => !coordsMatch(s, params.stops[i]))
  ) {
    return {
      ok: false,
      code: 'QUOTE_MISMATCH',
      messageFr: 'Les paramètres de la commande ne correspondent plus au devis généré.',
      messageEn: 'Order coordinates or vehicle no longer match the signed quote.',
    };
  }

  // Explicitly detect and reject manipulated frontend prices if supplied
  if (
    typeof params.clientSubmittedPrice === 'number' &&
    Number.isFinite(params.clientSubmittedPrice) &&
    Math.abs(params.clientSubmittedPrice - quote.customerTotal) > 0.01
  ) {
    return {
      ok: false,
      code: 'PRICE_MANIPULATION_DETECTED',
      messageFr: 'Le tarif soumis ne correspond pas au tarif officiel calculé par le serveur.',
      messageEn: 'Submitted price does not match the authoritative server quote.',
    };
  }

  return { ok: true };
}
