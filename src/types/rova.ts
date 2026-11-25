import { Timestamp } from 'firebase/firestore';

export type UserRole =
  | 'merchant'
  | 'business_owner'
  | 'business_employee'
  | 'independent_driver'
  | 'rova_driver'
  | 'fleet_partner'
  | 'fleet_manager'
  | 'recipient'
  | 'dispatcher'
  | 'operations_manager'
  | 'admin'
  | 'super_admin';

export type VehicleCategory =
  | 'motorcycle'
  | 'cargo_motorcycle'
  | 'tricycle'
  | 'cargo_van'
  | 'commercial_van'
  | 'truck';

export type DeliveryStatus =
  | 'pending'
  | 'scheduled'
  | 'driver_assigned'
  | 'driver_approaching_pickup'
  | 'at_pickup'
  | 'package_collected'
  | 'in_transit'
  | 'approaching_recipient'
  | 'arrived'
  | 'delivered'
  | 'failed'
  | 'rescheduled'
  | 'cancelled';

export type TimingType =
  | 'instant'
  | 'scheduled'
  | 'driver_reservation'
  | 'vehicle_reservation'
  | 'full_day';

export type ProofType = 'otp' | 'pin' | 'signature' | 'photo' | 'recipient_confirm';
export type PaymentMethod = 'mobile_money' | 'card' | 'invoice' | 'wallet';

export interface RovaUser {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  businessId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface BusinessRecord {
  id: string;
  ownerId: string;
  name: string;
  industry?: string;
  city: string;
  country: string;
  currency: string;
  verificationStatus: 'pending' | 'verified' | 'suspended';
  walletBalance: number;
  defaultPickupAddress?: string;
  defaultPickupLandmark?: string;
  defaultPickupDigitalAddress?: string;
  defaultPickupLat?: number;
  defaultPickupLng?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface BusinessMember {
  id: string;
  ownerId: string;
  email: string;
  name: string;
  memberRole: 'owner' | 'manager' | 'employee';
  status: 'invited' | 'active' | 'revoked';
  createdAt?: Timestamp;
}

export interface SavedRecipient {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  address: string;
  landmark?: string;
  digitalAddress?: string;
  instructions?: string;
  lat: number;
  lng: number;
  createdAt?: Timestamp;
}

export interface DriverRecord {
  id: string;
  uid: string;
  fullName: string;
  phone: string;
  partnerType: 'independent' | 'rova_fleet' | 'fleet_partner' | 'commercial_partner';
  vehicleCategory: VehicleCategory;
  vehiclePlate: string;
  licenseNumber: string;
  insuranceRef?: string;
  serviceArea: string;
  approvalStatus: 'pending' | 'under_review' | 'approved' | 'suspended';
  isOnline: boolean;
  currentLat?: number;
  currentLng?: number;
  rating: number;
  completedDeliveries: number;
  acceptanceRate: number;
  earningsTotal: number;
  activeDeliveryCount: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DriverDispatchRecord {
  id: string;
  uid: string;
  firstName: string;
  partnerType: 'independent' | 'rova_fleet' | 'fleet_partner' | 'commercial_partner';
  vehicleCategory: VehicleCategory;
  serviceArea: string;
  approvalStatus: 'pending' | 'under_review' | 'approved' | 'suspended';
  isOnline: boolean;
  currentLat: number;
  currentLng: number;
  rating: number;
  completedDeliveries: number;
  acceptanceRate: number;
  activeDeliveryCount: number;
  updatedAt?: Timestamp;
}

export interface VehicleRecord {
  id: string;
  fleetNumber: string;
  registration: string;
  category: VehicleCategory;
  ownerType: 'rova' | 'partner' | 'driver';
  partnerName?: string;
  assignedDriverId?: string;
  capacityKg: number;
  status: 'available' | 'assigned' | 'in_operation' | 'reserved' | 'maintenance' | 'inactive' | 'suspended';
  serviceArea: string;
  maintenanceStatus: 'nominal' | 'due_soon' | 'in_service';
  insuranceExpiry?: string;
  brandingStatus: 'branded' | 'pending' | 'unbranded';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EquipmentRecord {
  id: string;
  name: string;
  category:
    | 'uniform'
    | 'jacket'
    | 'shirt'
    | 'helmet'
    | 'bag'
    | 'delivery_box'
    | 'reflective_vest'
    | 'phone_holder'
    | 'id_card'
    | 'sticker'
    | 'vehicle_branding'
    | 'accessory';
  size?: string;
  totalStock: number;
  assignedCount: number;
  availableStock: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EquipmentAssignmentRecord {
  id: string;
  equipmentId: string;
  equipmentName: string;
  driverId: string;
  driverName: string;
  quantity: number;
  size?: string;
  status: 'assigned' | 'returned' | 'replaced';
  assignedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PartnerRecord {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  partnerType: 'fleet_partner' | 'transport_provider' | 'delivery_partner' | 'corporate_client' | 'warehouse' | 'fulfillment';
  status: 'pending' | 'active' | 'suspended' | 'terminated';
  serviceArea: string;
  commissionRate: number;
  paymentTerms?: string;
  vehicleCount: number;
  driverCount: number;
  contractRef?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DeliveryRecord {
  id: string;
  reference: string;
  businessId?: string;
  merchantUid: string;
  merchantName: string;
  driverUid: string;
  driverName?: string;
  vehicleCategory: VehicleCategory;
  timingType: TimingType;
  scheduledFor?: string;
  pickupAddress: string;
  pickupLandmark?: string;
  pickupDigitalAddress?: string;
  pickupInstructions?: string;
  pickupLat: number;
  pickupLng: number;
  primaryDestinationLabel?: string;
  stopIds?: string[];
  packageType: string;
  packageSize: 'small' | 'medium' | 'large' | 'bulk';
  weightKg: number;
  quantity: number;
  fragile: boolean;
  specialHandling?: string;
  proofRequired: ProofType;
  status: DeliveryStatus;
  isMultiStop: boolean;
  stopCount: number;
  completedStopCount: number;
  totalDistanceKm: number;
  estimatedDurationMin: number;
  quotedPrice: number;
  currency: string;
  paymentMethod: PaymentMethod;
  paymentStatus: 'pending' | 'authorized' | 'paid' | 'invoiced' | 'refunded';
  driverLat?: number;
  driverLng?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DeliveryStopRecord {
  id: string;
  deliveryId: string;
  merchantUid: string;
  driverUid: string;
  sequence: number;
  recipientName: string;
  recipientPhone: string;
  address: string;
  landmark?: string;
  digitalAddress?: string;
  instructions?: string;
  lat: number;
  lng: number;
  packageRef?: string;
  status: DeliveryStatus;
  otpCode: string;
  proofType?: string;
  proofValue?: string;
  proofNotes?: string;
  trackingToken: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PublicTrackingRecord {
  trackingToken: string;
  deliveryId: string;
  stopId: string;
  merchantUid: string;
  driverUid: string;
  reference: string;
  recipientFirstName: string;
  destinationLabel: string;
  destinationLat: number;
  destinationLng: number;
  status: DeliveryStatus;
  driverFirstName?: string;
  vehicleCategory: VehicleCategory;
  driverLat?: number;
  driverLng?: number;
  etaMinutes?: number;
  showLiveDriver: boolean;
  otpHint?: string;
  updatedAt?: Timestamp;
}

export interface ReservationRecord {
  id: string;
  businessId?: string;
  merchantUid: string;
  merchantName: string;
  vehicleId?: string;
  vehicleCategory: VehicleCategory;
  driverUid: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  durationType: 'window' | 'hours' | 'full_day';
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationsSummary?: string;
  cargoRequirements?: string;
  quotedPrice: number;
  currency: string;
  status: 'pending_approval' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PricingRuleRecord {
  id: string;
  zoneName: string;
  city: string;
  country: string;
  currency: string;
  vehicleCategory: VehicleCategory;
  baseFee: number;
  perKmRate: number;
  minimumFare: number;
  waitingFeePerMin?: number;
  scheduledFee: number;
  cargoSurcharge: number;
  multiStopFee: number;
  priorityMultiplier: number;
  peakMultiplier: number;
  fullDayRate: number;
  active: boolean;
  updatedAt?: Timestamp;
}

export interface IncidentRecord {
  id: string;
  deliveryId?: string;
  reportedByUid: string;
  reporterRole: string;
  category: 'failed_delivery' | 'damage' | 'delay' | 'dispute' | 'refund' | 'driver_report';
  description: string;
  status: 'open' | 'investigating' | 'resolved';
  resolutionNotes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  message: string;
  eventType: string;
  deliveryId?: string;
  read: boolean;
  createdAt?: Timestamp;
}

export interface AuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt?: Timestamp;
}

export interface GeoPlace {
  displayName: string;
  shortName: string;
  landmark?: string;
  digitalAddress?: string;
  lat: number;
  lng: number;
  type?: string;
}

export interface QuoteResult {
  currency: string;
  total: number;
  breakdown: Array<{ label: string; amount: number }>;
}
