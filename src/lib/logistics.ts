import { DeliveryStatus, DriverDispatchRecord, PaymentMethod, PricingRuleRecord, VehicleCategory } from '../types/rova';
import type { AppLanguage } from '../context/LanguageContext';

export const VEHICLE_CATALOG: Array<{
  id: VehicleCategory;
  label: string;
  labelFr: string;
  maxWeightKg: number;
  sizes: Array<'small' | 'medium' | 'large' | 'bulk'>;
  summary: string;
  summaryFr: string;
  baseFallback: number;
  perKmFallback: number;
  fullDayFallback: number;
}> = [
  {
    id: 'motorcycle',
    label: 'Motorcycle',
    labelFr: 'Moto rapide',
    maxWeightKg: 15,
    sizes: ['small', 'medium'],
    summary: 'Documents, retail parcels, urgent city drop-offs up to 15 kg',
    summaryFr: 'Plis urgents, colis boutique et livraisons express urbaines jusqu’à 15 kg',
    baseFallback: 18,
    perKmFallback: 4.5,
    fullDayFallback: 240,
  },
  {
    id: 'cargo_motorcycle',
    label: 'Cargo Motorcycle',
    labelFr: 'Moto cargo',
    maxWeightKg: 45,
    sizes: ['small', 'medium', 'large'],
    summary: 'Insulated box & commercial multi-stop tours up to 45 kg',
    summaryFr: 'Caisson isotherme et tournées commerciales multi-arrêts jusqu’à 45 kg',
    baseFallback: 24,
    perKmFallback: 5.5,
    fullDayFallback: 310,
  },
  {
    id: 'tricycle',
    label: 'Cargo Tricycle',
    labelFr: 'Tricycle utilitaire',
    maxWeightKg: 250,
    sizes: ['medium', 'large'],
    summary: 'Neighborhood wholesale crates and appliances up to 250 kg',
    summaryFr: 'Caisses de gros, cartons volumineux et équipements jusqu’à 250 kg',
    baseFallback: 36,
    perKmFallback: 7.5,
    fullDayFallback: 420,
  },
  {
    id: 'cargo_van',
    label: 'Cargo Van',
    labelFr: 'Fourgonnette cargo',
    maxWeightKg: 800,
    sizes: ['medium', 'large', 'bulk'],
    summary: 'Store restocking, apparel racks, high-volume multi-stop up to 800 kg',
    summaryFr: 'Réassort de magasins et tournées multi-arrêts à fort volume jusqu’à 800 kg',
    baseFallback: 65,
    perKmFallback: 11,
    fullDayFallback: 750,
  },
  {
    id: 'commercial_van',
    label: 'Commercial Van',
    labelFr: 'Fourgon commercial',
    maxWeightKg: 1500,
    sizes: ['large', 'bulk'],
    summary: 'B2B warehouse transfers and scheduled commercial runs up to 1.5T',
    summaryFr: 'Transferts entrepôt B2B et navettes planifiées jusqu’à 1,5 tonne',
    baseFallback: 95,
    perKmFallback: 14,
    fullDayFallback: 1050,
  },
  {
    id: 'truck',
    label: 'Box Truck',
    labelFr: 'Camion porteur',
    maxWeightKg: 5000,
    sizes: ['bulk'],
    summary: 'Palletized freight, distribution hubs and full-day charter up to 5T',
    summaryFr: 'Fret palettisé, plateformes de distribution et affrètement journée jusqu’à 5 tonnes',
    baseFallback: 180,
    perKmFallback: 22,
    fullDayFallback: 1950,
  },
];

/**
 * Payment Methods are intentionally kept strictly in English per product specification.
 */
export const PAYMENT_METHODS_EN: Array<{
  id: PaymentMethod;
  label: string;
  subtitle: string;
}> = [
  { id: 'mobile_money', label: 'Mobile Money', subtitle: 'MTN MoMo · Telecel Cash · AirtelTigo' },
  { id: 'card', label: 'Bank Card', subtitle: 'Visa · Mastercard · Paystack · Stripe' },
  { id: 'invoice', label: 'Corporate Invoice', subtitle: 'Monthly B2B Billing (Net 15 / Net 30)' },
  { id: 'wallet', label: 'Business Wallet', subtitle: 'Prepaid ROVA Merchant Balance' },
];

export function getPaymentMethodLabelEn(method: PaymentMethod): string {
  return PAYMENT_METHODS_EN.find((m) => m.id === method)?.label || method;
}

export function getVehicleLabel(category: VehicleCategory, lang: AppLanguage = 'fr'): string {
  const item = VEHICLE_CATALOG.find((v) => v.id === category);
  if (!item) return category;
  return lang === 'fr' ? item.labelFr : item.label;
}

export const DELIVERY_STATUS_ORDER: DeliveryStatus[] = [
  'pending',
  'scheduled',
  'driver_assigned',
  'driver_approaching_pickup',
  'at_pickup',
  'package_collected',
  'in_transit',
  'approaching_recipient',
  'arrived',
  'delivered',
];

export const STATUS_META: Record<
  DeliveryStatus,
  { label: string; labelFr: string; dot: string; text: string }
> = {
  pending: { label: 'Pending dispatch', labelFr: 'En attente d’affectation', dot: 'bg-neutral-400', text: 'text-neutral-700' },
  scheduled: { label: 'Scheduled', labelFr: 'Planifiée', dot: 'bg-neutral-900', text: 'text-neutral-900' },
  driver_assigned: { label: 'Driver assigned', labelFr: 'Livreur assigné', dot: 'bg-blue-600', text: 'text-blue-700' },
  driver_approaching_pickup: { label: 'Approaching pickup', labelFr: 'En route vers la collecte', dot: 'bg-blue-600', text: 'text-blue-700' },
  at_pickup: { label: 'At pickup', labelFr: 'Arrivé à la collecte', dot: 'bg-amber-600', text: 'text-amber-700' },
  package_collected: { label: 'Package collected', labelFr: 'Colis récupéré', dot: 'bg-amber-600', text: 'text-amber-700' },
  in_transit: { label: 'In transit', labelFr: 'En cours de livraison', dot: 'bg-emerald-600', text: 'text-emerald-700' },
  approaching_recipient: { label: 'Approaching recipient', labelFr: 'Proche du destinataire', dot: 'bg-emerald-600', text: 'text-emerald-700' },
  arrived: { label: 'Arrived', labelFr: 'Arrivé à destination', dot: 'bg-emerald-600', text: 'text-emerald-700' },
  delivered: { label: 'Delivered', labelFr: 'Livrée', dot: 'bg-emerald-700', text: 'text-emerald-800' },
  failed: { label: 'Failed', labelFr: 'Échec de livraison', dot: 'bg-red-600', text: 'text-red-700' },
  rescheduled: { label: 'Rescheduled', labelFr: 'Reprogrammée', dot: 'bg-amber-600', text: 'text-amber-700' },
  cancelled: { label: 'Cancelled', labelFr: 'Annulée', dot: 'bg-neutral-400', text: 'text-neutral-500' },
};

export function getStatusLabel(status: DeliveryStatus, lang: AppLanguage = 'fr'): string {
  const meta = STATUS_META[status];
  if (!meta) return status;
  return lang === 'fr' ? meta.labelFr : meta.label;
}

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

export interface RankedDriverMatch {
  driver: DriverDispatchRecord;
  distanceKm: number;
  etaMinutes: number;
  score: number;
}

export function rankSuitableDrivers(
  onlineDrivers: DriverDispatchRecord[],
  pickupLat: number,
  pickupLng: number,
  requiredVehicle: VehicleCategory,
  weightKg: number
): RankedDriverMatch[] {
  const requiredSpec = VEHICLE_CATALOG.find((v) => v.id === requiredVehicle);
  const minCapacity = Math.max(weightKg, requiredSpec?.maxWeightKg ? 0 : weightKg);

  return onlineDrivers
    .filter((d) => {
      if (d.approvalStatus !== 'approved' || !d.isOnline) return false;
      const drvSpec = VEHICLE_CATALOG.find((v) => v.id === d.vehicleCategory);
      if (!drvSpec || drvSpec.maxWeightKg < minCapacity) return false;
      return d.vehicleCategory === requiredVehicle || drvSpec.maxWeightKg >= (requiredSpec?.maxWeightKg || weightKg);
    })
    .map((driver) => {
      const distanceKm = Number(
        haversineDistanceKm(pickupLat, pickupLng, driver.currentLat, driver.currentLng).toFixed(2)
      );
      const avgSpeedKmh = driver.vehicleCategory === 'motorcycle' || driver.vehicleCategory === 'cargo_motorcycle' ? 30 : 24;
      const etaMinutes = Math.max(3, Math.round((distanceKm / avgSpeedKmh) * 60));

      const exactVehicleBonus = driver.vehicleCategory === requiredVehicle ? 20 : 0;
      const distanceScore = Math.max(0, 45 - distanceKm * 2.5);
      const ratingScore = (driver.rating / 5) * 20;
      const acceptanceScore = (driver.acceptanceRate / 100) * 15;
      const workloadPenalty = driver.activeDeliveryCount * 12;

      const score = Number(
        Math.max(0, exactVehicleBonus + distanceScore + ratingScore + acceptanceScore - workloadPenalty).toFixed(1)
      );

      return { driver, distanceKm, etaMinutes, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function generateTrackingToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = 'rvt_';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function generateReference(prefix = 'RV'): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${num}`;
}

export function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function getEffectivePricingRule(
  rules: PricingRuleRecord[],
  vehicleCategory: VehicleCategory
): PricingRuleRecord {
  const matched = rules.find((r) => r.active && r.vehicleCategory === vehicleCategory);
  if (matched) return matched;
  const fallback = VEHICLE_CATALOG.find((v) => v.id === vehicleCategory) || VEHICLE_CATALOG[0];
  return {
    id: `default_${vehicleCategory}`,
    zoneName: 'Zone Métropolitaine',
    city: 'Accra',
    country: 'Ghana',
    currency: 'GHS',
    vehicleCategory,
    baseFee: fallback.baseFallback,
    perKmRate: fallback.perKmFallback,
    minimumFare: fallback.baseFallback,
    waitingFeePerMin: 1.5,
    scheduledFee: 6,
    cargoSurcharge: 15,
    multiStopFee: 7,
    priorityMultiplier: 1.25,
    peakMultiplier: 1.15,
    fullDayRate: fallback.fullDayFallback,
    active: true,
  };
}

export function formatMoney(amount: number, currency = 'GHS'): string {
  return `${currency} ${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getNextDriverStatus(
  current: DeliveryStatus,
  lang: AppLanguage = 'fr'
): { next: DeliveryStatus; actionLabel: string } | null {
  switch (current) {
    case 'driver_assigned':
      return {
        next: 'driver_approaching_pickup',
        actionLabel: lang === 'fr' ? 'Partir vers la collecte' : 'Head to Pickup',
      };
    case 'driver_approaching_pickup':
      return {
        next: 'at_pickup',
        actionLabel: lang === 'fr' ? 'Confirmer l’arrivée à la collecte' : 'Confirm Arrival at Pickup',
      };
    case 'at_pickup':
      return {
        next: 'package_collected',
        actionLabel: lang === 'fr' ? 'Confirmer la prise en charge' : 'Confirm Parcel Collection',
      };
    case 'package_collected':
      return {
        next: 'in_transit',
        actionLabel: lang === 'fr' ? 'Démarrer le trajet destinataire' : 'Start Route to Recipient',
      };
    case 'in_transit':
      return {
        next: 'approaching_recipient',
        actionLabel: lang === 'fr' ? 'En approche du destinataire' : 'Approaching Recipient',
      };
    case 'approaching_recipient':
      return {
        next: 'arrived',
        actionLabel: lang === 'fr' ? 'Arrivé à destination' : 'Arrived at Destination',
      };
    default:
      return null;
  }
}
