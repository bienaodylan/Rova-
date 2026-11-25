import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  Boxes,
  Calendar,
  ClipboardList,
  DollarSign,
  ExternalLink,
  Handshake,
  Inbox,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  AuditLogRecord,
  DeliveryRecord,
  DeliveryStatus,
  DeliveryStopRecord,
  DriverDispatchRecord,
  DriverRecord,
  EquipmentAssignmentRecord,
  EquipmentRecord,
  IncidentRecord,
  PartnerRecord,
  PricingRuleRecord,
  ReservationRecord,
  VehicleCategory,
  VehicleRecord,
} from '../types/rova';
import {
  formatMoney,
  getPaymentMethodLabelEn,
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
  VEHICLE_CATALOG,
} from '../lib/logistics';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';

type OpsSection =
  | 'dashboard'
  | 'dispatch'
  | 'drivers'
  | 'fleet'
  | 'equipment'
  | 'partners'
  | 'pricing'
  | 'finance';

interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  company?: string;
  city?: string;
  platform: 'ios' | 'android' | 'partner' | 'driver' | 'contact';
  message?: string;
  createdAt?: { toDate: () => Date };
}

interface OperationsCenterProps {
  onOpenTracking: (token: string) => void;
  workspaceSwitcher?: React.ReactNode;
  onRequestSignIn?: () => void;
}

const EQUIPMENT_CATEGORIES: Array<{ id: EquipmentRecord['category']; labelFr: string; labelEn: string }> = [
  { id: 'uniform', labelFr: 'Uniforme ROVA', labelEn: 'Branded Uniform' },
  { id: 'jacket', labelFr: 'Veste ROVA', labelEn: 'ROVA Jacket' },
  { id: 'shirt', labelFr: 'Polo / Chemise ROVA', labelEn: 'ROVA Polo / Shirt' },
  { id: 'helmet', labelFr: 'Casque de sécurité', labelEn: 'Safety Helmet' },
  { id: 'bag', labelFr: 'Sac isotherme', labelEn: 'Insulated Thermal Bag' },
  { id: 'delivery_box', labelFr: 'Caisson rigide', labelEn: 'Hard Delivery Box' },
  { id: 'reflective_vest', labelFr: 'Gilet réfléchissant', labelEn: 'Reflective Vest' },
  { id: 'phone_holder', labelFr: 'Support téléphone', labelEn: 'Phone Mount' },
  { id: 'id_card', labelFr: 'Badge chauffeur', labelEn: 'Driver ID Badge' },
  { id: 'sticker', labelFr: 'Autocollants marque', labelEn: 'Branding Stickers' },
  { id: 'vehicle_branding', labelFr: 'Flocage véhicule', labelEn: 'Vehicle Wrap' },
  { id: 'accessory', labelFr: 'Accessoire terrain', labelEn: 'Operational Accessory' },
];

const PARTNER_TYPES: Array<{ id: PartnerRecord['partnerType']; labelFr: string; labelEn: string }> = [
  { id: 'fleet_partner', labelFr: 'Partenaire de flotte', labelEn: 'Fleet Partner' },
  { id: 'transport_provider', labelFr: 'Transporteur', labelEn: 'Transport Provider' },
  { id: 'delivery_partner', labelFr: 'Partenaire livraison', labelEn: 'Delivery Partner' },
  { id: 'corporate_client', labelFr: 'Compte entreprise', labelEn: 'Corporate Client' },
  { id: 'warehouse', labelFr: 'Entrepôt / Hub', labelEn: 'Warehouse Hub' },
  { id: 'fulfillment', labelFr: 'Centre fulfillment', labelEn: 'Fulfillment Partner' },
];

export function OperationsCenter({
  onOpenTracking,
  workspaceSwitcher,
  onRequestSignIn,
}: OperationsCenterProps) {
  const { firebaseUser, profile, isAdmin, logout } = useAuth();
  const { lang, t } = useLanguage();
  const uid = firebaseUser?.uid || '';
  const actorEmail = firebaseUser?.email || profile?.email || 'ops@rova.africa';
  const canQueryLive = Boolean(uid && isAdmin);

  const [section, setSection] = useState<OpsSection>('dashboard');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [driverDispatch, setDriverDispatch] = useState<DriverDispatchRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [equipment, setEquipment] = useState<EquipmentRecord[]>([]);
  const [equipmentAssignments, setEquipmentAssignments] = useState<EquipmentAssignmentRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRuleRecord[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  const [dispatchTab, setDispatchTab] = useState<'deliveries' | 'reservations'>('deliveries');
  const [assignSelect, setAssignSelect] = useState<Record<string, string>>({});
  const [resAssignDriver, setResAssignDriver] = useState<Record<string, string>>({});
  const [resAssignVehicle, setResAssignVehicle] = useState<Record<string, string>>({});
  const [driverFilter, setDriverFilter] = useState<'all' | 'pending' | 'approved' | 'suspended'>('all');

  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    fleetNumber: '',
    registration: '',
    category: 'cargo_van' as VehicleCategory,
    ownerType: 'rova' as VehicleRecord['ownerType'],
    partnerName: '',
    assignedDriverId: '',
    capacityKg: 800,
    status: 'available' as VehicleRecord['status'],
    serviceArea: 'Grand Abidjan',
    maintenanceStatus: 'nominal' as VehicleRecord['maintenanceStatus'],
    insuranceExpiry: '',
    brandingStatus: 'branded' as VehicleRecord['brandingStatus'],
  });

  const [showEquipForm, setShowEquipForm] = useState(false);
  const [equipForm, setEquipForm] = useState({
    name: '',
    category: 'delivery_box' as EquipmentRecord['category'],
    size: '',
    totalStock: 20,
  });
  const [assignEquipForm, setAssignEquipForm] = useState({
    equipmentId: '',
    driverId: '',
    quantity: 1,
    size: '',
  });

  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [partnerForm, setPartnerForm] = useState({
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    partnerType: 'fleet_partner' as PartnerRecord['partnerType'],
    serviceArea: 'Grand Abidjan',
    commissionRate: 15,
    paymentTerms: 'Net 15',
    vehicleCount: 5,
    driverCount: 5,
    contractRef: '',
  });

  const [showPricingForm, setShowPricingForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [pricingForm, setPricingForm] = useState({
    zoneName: 'Zone Métropolitaine',
    city: 'Abidjan',
    country: 'Côte d’Ivoire',
    currency: 'GHS',
    vehicleCategory: 'motorcycle' as VehicleCategory,
    baseFee: 18,
    perKmRate: 4.5,
    minimumFare: 18,
    waitingFeePerMin: 1.5,
    scheduledFee: 6,
    cargoSurcharge: 15,
    multiStopFee: 7,
    priorityMultiplier: 1.25,
    peakMultiplier: 1.15,
    fullDayRate: 240,
    active: true,
  });

  const [govTab, setGovTab] = useState<'finance' | 'incidents' | 'waitlist' | 'audit'>('finance');
  const [resolutionDraft, setResolutionDraft] = useState<Record<string, string>>({});

  const flash = (msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => setStatusBanner((prev) => (prev === msg ? null : prev)), 4500);
  };

  const requireAdminAction = () => {
    if (!canQueryLive) {
      flash(
        t(
          'Connectez-vous avec votre compte administrateur Google pour enregistrer cette action.',
          'Sign in with your Google administrator account to save this action.'
        )
      );
      onRequestSignIn?.();
      return false;
    }
    return true;
  };

  const logAudit = async (action: string, entityType: string, entityId: string, summary: string) => {
    if (!canQueryLive) return;
    const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'record';
    try {
      await addDoc(collection(db, 'auditLogs'), {
        actorUid: uid,
        actorEmail: actorEmail.slice(0, 200),
        action: action.slice(0, 80),
        entityType: entityType.slice(0, 60),
        entityId: safeEntityId,
        summary: summary.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'auditLogs');
    }
  };

  const notifyUser = async (
    targetUid: string,
    title: string,
    message: string,
    eventType: string,
    deliveryId?: string
  ) => {
    if (!targetUid || !canQueryLive) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        userId: targetUid,
        title: title.slice(0, 140),
        message: message.slice(0, 400),
        eventType: eventType.slice(0, 60),
        ...(deliveryId ? { deliveryId } : {}),
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notifications');
    }
  };

  useEffect(() => {
    if (!canQueryLive) return;

    const unsubs: Array<() => void> = [];
    unsubs.push(
      onSnapshot(
        query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(150)),
        (snap) => setDeliveries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'deliveries')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'reservations'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => setReservations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReservationRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'reservations')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'drivers'), orderBy('createdAt', 'desc'), limit(150)),
        (snap) => setDrivers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'drivers')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'driverDispatch'),
        (snap) => setDriverDispatch(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverDispatchRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'driverDispatch')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'vehicles'), orderBy('createdAt', 'desc'), limit(150)),
        (snap) => setVehicles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<VehicleRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'vehicles')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'equipment'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => setEquipment(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EquipmentRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'equipment')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'equipmentAssignments'), orderBy('createdAt', 'desc'), limit(150)),
        (snap) =>
          setEquipmentAssignments(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EquipmentAssignmentRecord, 'id'>) }))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'equipmentAssignments')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'partners'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => setPartners(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'partners')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'pricingRules'),
        (snap) => setPricingRules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PricingRuleRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'pricingRules')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'incidents'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => setIncidents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<IncidentRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'incidents')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'waitlist'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => setWaitlist(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WaitlistEntry, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'waitlist')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(100)),
        (snap) => setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [canQueryLive]);

  const kpis = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const deliveriesToday = deliveries.filter((d) => {
      const dt = d.createdAt?.toDate ? d.createdAt.toDate().toISOString().slice(0, 10) : '';
      return dt === todayStr;
    }).length;
    const activeDeliveries = deliveries.filter((d) => !['delivered', 'failed', 'cancelled'].includes(d.status));
    const pendingDispatch = deliveries.filter((d) => d.status === 'pending' && !d.driverUid);
    const failedDeliveries = deliveries.filter((d) => d.status === 'failed');
    const onlineDrivers = driverDispatch.filter((d) => d.approvalStatus === 'approved' && d.isOnline);
    const pendingDrivers = drivers.filter((d) => d.approvalStatus === 'pending' || d.approvalStatus === 'under_review');
    const approvedDrivers = drivers.filter((d) => d.approvalStatus === 'approved');
    const reservedVehicles = vehicles.filter((v) => v.status === 'reserved').length;
    const pendingReservations = reservations.filter((r) => r.status === 'pending_approval');
    const openIncidents = incidents.filter((i) => i.status !== 'resolved');

    const billableDeliveries = deliveries.filter((d) => d.status !== 'cancelled');
    const grossRevenue = billableDeliveries.reduce((acc, d) => acc + (d.quotedPrice || 0), 0);
    const platformCommission = grossRevenue * 0.15;
    const driverPayouts = grossRevenue * 0.85;
    const paidTotal = billableDeliveries
      .filter((d) => d.paymentStatus === 'paid')
      .reduce((acc, d) => acc + d.quotedPrice, 0);
    const invoicedTotal = billableDeliveries
      .filter((d) => d.paymentStatus === 'invoiced')
      .reduce((acc, d) => acc + d.quotedPrice, 0);

    return {
      deliveriesToday,
      activeCount: activeDeliveries.length,
      pendingDispatchCount: pendingDispatch.length,
      failedCount: failedDeliveries.length,
      onlineDriversCount: onlineDrivers.length,
      pendingDriversCount: pendingDrivers.length,
      approvedDrivers,
      onlineDrivers,
      fleetTotal: vehicles.length,
      reservedVehicles,
      pendingReservationsCount: pendingReservations.length,
      openIncidentsCount: openIncidents.length,
      grossRevenue,
      platformCommission,
      driverPayouts,
      paidTotal,
      invoicedTotal,
    };
  }, [deliveries, driverDispatch, drivers, vehicles, reservations, incidents]);

  const opsMapMarkers: MapMarkerItem[] = useMemo(() => {
    const markers: MapMarkerItem[] = [];
    kpis.onlineDrivers.forEach((drv) => {
      markers.push({
        id: `drv_${drv.uid}`,
        lat: drv.currentLat,
        lng: drv.currentLng,
        kind: 'driver',
        label: `${drv.firstName} (${getVehicleLabel(drv.vehicleCategory, lang)}) · ${drv.serviceArea}`,
      });
    });
    deliveries
      .filter((d) => !['delivered', 'failed', 'cancelled'].includes(d.status))
      .slice(0, 40)
      .forEach((d) => {
        markers.push({
          id: `del_${d.id}`,
          lat: d.pickupLat,
          lng: d.pickupLng,
          kind: 'pickup',
          label: `${d.reference} · ${d.merchantName} (${getStatusLabel(d.status, lang)})`,
        });
      });
    return markers;
  }, [kpis.onlineDrivers, deliveries, lang]);

  const mapCenter: [number, number] = useMemo(() => {
    if (opsMapMarkers.length > 0) return [opsMapMarkers[0].lat, opsMapMarkers[0].lng];
    return [5.3235, -4.0267];
  }, [opsMapMarkers]);

  const handleDriverApproval = async (drv: DriverRecord, nextStatus: DriverRecord['approvalStatus']) => {
    if (!requireAdminAction()) return;
    setBusyId(drv.id);
    try {
      const batch = writeBatch(db);
      const isOnlineNext = nextStatus === 'approved' ? drv.isOnline : false;
      batch.update(doc(db, 'drivers', drv.id), {
        approvalStatus: nextStatus,
        isOnline: isOnlineNext,
        updatedAt: serverTimestamp(),
      });
      const firstName = drv.fullName.trim().split(' ')[0] || 'Livreur';
      batch.set(
        doc(db, 'driverDispatch', drv.id),
        {
          uid: drv.uid,
          firstName: firstName.slice(0, 80),
          partnerType: drv.partnerType,
          vehicleCategory: drv.vehicleCategory,
          serviceArea: drv.serviceArea,
          approvalStatus: nextStatus,
          isOnline: isOnlineNext,
          currentLat: typeof drv.currentLat === 'number' ? drv.currentLat : 5.3235,
          currentLng: typeof drv.currentLng === 'number' ? drv.currentLng : -4.0267,
          rating: drv.rating,
          completedDeliveries: drv.completedDeliveries,
          acceptanceRate: drv.acceptanceRate,
          activeDeliveryCount: drv.activeDeliveryCount,
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
      await batch.commit();
      await notifyUser(
        drv.uid,
        nextStatus === 'approved' ? 'Compte chauffeur validé' : 'Statut chauffeur mis à jour',
        `Votre statut livreur ROVA est désormais : ${nextStatus}.`,
        `driver_${nextStatus}`
      );
      await logAudit(`driver_${nextStatus}`, 'driver', drv.id, `Chauffeur ${drv.fullName} -> ${nextStatus}`);
      flash(t(`Chauffeur ${drv.fullName} mis à jour.`, `Driver ${drv.fullName} updated.`));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `drivers/${drv.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignDeliveryDriver = async (delivery: DeliveryRecord) => {
    if (!requireAdminAction()) return;
    const selectedDriverUid = assignSelect[delivery.id];
    const drv = drivers.find((d) => d.uid === selectedDriverUid);
    if (!drv) return;
    setBusyId(delivery.id);
    try {
      const nextStatus: DeliveryStatus =
        delivery.status === 'pending' || delivery.status === 'scheduled' ? 'driver_assigned' : delivery.status;
      const stopsSnap = await getDocs(collection(db, 'deliveries', delivery.id, 'stops'));
      const batch = writeBatch(db);
      const deliveryUpdate: Record<string, unknown> = {
        driverUid: drv.uid,
        driverName: drv.fullName.slice(0, 120),
        status: nextStatus,
        updatedAt: serverTimestamp(),
      };
      if (typeof drv.currentLat === 'number' && typeof drv.currentLng === 'number') {
        deliveryUpdate.driverLat = drv.currentLat;
        deliveryUpdate.driverLng = drv.currentLng;
      }
      batch.update(doc(db, 'deliveries', delivery.id), deliveryUpdate);

      const drvFirst = drv.fullName.trim().split(' ')[0] || 'Livreur';
      stopsSnap.docs.forEach((sDoc) => {
        const stopData = sDoc.data() as DeliveryStopRecord;
        const stopNextStatus: DeliveryStatus =
          stopData.status === 'pending' || stopData.status === 'scheduled' ? 'driver_assigned' : stopData.status;
        batch.update(sDoc.ref, {
          driverUid: drv.uid,
          status: stopNextStatus,
          updatedAt: serverTimestamp(),
        });
        if (stopData.trackingToken) {
          batch.update(doc(db, 'publicTracking', stopData.trackingToken), {
            driverUid: drv.uid,
            driverFirstName: drvFirst.slice(0, 80),
            status: stopNextStatus,
            showLiveDriver: stopData.sequence === 1,
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
      await logAudit('assign_driver', 'delivery', delivery.id, `Assigné ${drv.fullName} à ${delivery.reference}`);
      flash(t(`${drv.fullName} assigné à ${delivery.reference}.`, `Assigned ${drv.fullName} to ${delivery.reference}.`));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveries/${delivery.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenDeliveryTracking = async (deliveryId: string) => {
    if (!canQueryLive) return;
    try {
      const snap = await getDocs(collection(db, 'deliveries', deliveryId, 'stops'));
      const firstStop = snap.docs
        .map((d) => d.data() as DeliveryStopRecord)
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (firstStop?.trackingToken) onOpenTracking(firstStop.trackingToken);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `deliveries/${deliveryId}/stops`);
    }
  };

  const handleUpdateReservation = async (res: ReservationRecord, nextStatus: ReservationRecord['status']) => {
    if (!requireAdminAction()) return;
    setBusyId(res.id);
    try {
      const assignedDrvUid = resAssignDriver[res.id] ?? res.driverUid ?? '';
      const assignedVehId = resAssignVehicle[res.id] ?? res.vehicleId ?? '';
      const payload: Record<string, unknown> = {
        status: nextStatus,
        driverUid: assignedDrvUid,
        updatedAt: serverTimestamp(),
      };
      if (assignedVehId) payload.vehicleId = assignedVehId;
      await updateDoc(doc(db, 'reservations', res.id), payload);
      await logAudit(`reservation_${nextStatus}`, 'reservation', res.id, `Réservation ${res.merchantName} -> ${nextStatus}`);
      flash(t('Réservation mise à jour.', 'Reservation updated.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `reservations/${res.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdminAction()) return;
    if (!vehicleForm.fleetNumber.trim() || !vehicleForm.registration.trim()) return;
    setBusyId('new_vehicle');
    try {
      const payload: Record<string, unknown> = {
        fleetNumber: vehicleForm.fleetNumber.trim().slice(0, 40),
        registration: vehicleForm.registration.trim().toUpperCase().slice(0, 40),
        category: vehicleForm.category,
        ownerType: vehicleForm.ownerType,
        capacityKg: Math.max(1, Math.min(50000, Number(vehicleForm.capacityKg) || 100)),
        status: vehicleForm.status,
        serviceArea: vehicleForm.serviceArea.trim().slice(0, 120) || 'Grand Abidjan',
        maintenanceStatus: vehicleForm.maintenanceStatus,
        brandingStatus: vehicleForm.brandingStatus,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (vehicleForm.partnerName.trim()) payload.partnerName = vehicleForm.partnerName.trim().slice(0, 120);
      if (vehicleForm.assignedDriverId.trim()) payload.assignedDriverId = vehicleForm.assignedDriverId.trim().slice(0, 128);
      if (vehicleForm.insuranceExpiry.trim()) payload.insuranceExpiry = vehicleForm.insuranceExpiry.trim().slice(0, 40);

      const ref = await addDoc(collection(db, 'vehicles'), payload);
      await logAudit('create_vehicle', 'vehicle', ref.id, `Véhicule ajouté : ${payload.fleetNumber}`);
      setShowVehicleForm(false);
      flash(t('Véhicule enregistré dans la flotte.', 'Vehicle registered in fleet.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'vehicles');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateVehicleStatus = async (veh: VehicleRecord, nextStatus: VehicleRecord['status']) => {
    if (!requireAdminAction()) return;
    setBusyId(veh.id);
    try {
      await updateDoc(doc(db, 'vehicles', veh.id), { status: nextStatus, updatedAt: serverTimestamp() });
      flash(t('Statut du véhicule mis à jour.', 'Vehicle status updated.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `vehicles/${veh.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdminAction()) return;
    if (!equipForm.name.trim()) return;
    setBusyId('new_equip');
    try {
      const stock = Math.max(0, Math.floor(Number(equipForm.totalStock) || 0));
      const payload: Record<string, unknown> = {
        name: equipForm.name.trim().slice(0, 120),
        category: equipForm.category,
        totalStock: stock,
        assignedCount: 0,
        availableStock: stock,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (equipForm.size.trim()) payload.size = equipForm.size.trim().slice(0, 20);
      const ref = await addDoc(collection(db, 'equipment'), payload);
      await logAudit('create_equipment', 'equipment', ref.id, `Stock ajouté : ${stock}x ${payload.name}`);
      setEquipForm({ name: '', category: 'delivery_box', size: '', totalStock: 20 });
      setShowEquipForm(false);
      flash(t('Équipement ajouté au stock.', 'Equipment added to stock.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'equipment');
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdminAction()) return;
    const item = equipment.find((eq) => eq.id === assignEquipForm.equipmentId);
    const drv = drivers.find((d) => d.uid === assignEquipForm.driverId);
    const qty = Math.max(1, Math.min(100, Math.floor(Number(assignEquipForm.quantity) || 1)));
    if (!item || !drv || item.availableStock < qty) return;

    setBusyId('assign_equip');
    try {
      const batch = writeBatch(db);
      const assignRef = doc(collection(db, 'equipmentAssignments'));
      const payload: Record<string, unknown> = {
        equipmentId: item.id,
        equipmentName: item.name.slice(0, 120),
        driverId: drv.uid,
        driverName: drv.fullName.slice(0, 120),
        quantity: qty,
        status: 'assigned',
        assignedBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const cleanSize = assignEquipForm.size.trim() || item.size || '';
      if (cleanSize) payload.size = cleanSize.slice(0, 20);
      batch.set(assignRef, payload);
      batch.update(doc(db, 'equipment', item.id), {
        assignedCount: item.assignedCount + qty,
        availableStock: item.availableStock - qty,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setAssignEquipForm({ equipmentId: '', driverId: '', quantity: 1, size: '' });
      flash(t(`Équipement attribué à ${drv.fullName}.`, `Issued equipment to ${drv.fullName}.`));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'equipmentAssignments');
    } finally {
      setBusyId(null);
    }
  };

  const handleReturnEquipment = async (assignment: EquipmentAssignmentRecord) => {
    if (!requireAdminAction() || assignment.status !== 'assigned') return;
    setBusyId(assignment.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'equipmentAssignments', assignment.id), {
        status: 'returned',
        updatedAt: serverTimestamp(),
      });
      const item = equipment.find((eq) => eq.id === assignment.equipmentId);
      if (item) {
        batch.update(doc(db, 'equipment', item.id), {
          assignedCount: Math.max(0, item.assignedCount - assignment.quantity),
          availableStock: item.availableStock + assignment.quantity,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      flash(t('Équipement restitué au stock.', 'Equipment returned to stock.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `equipmentAssignments/${assignment.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdminAction()) return;
    if (!partnerForm.companyName.trim() || !partnerForm.contactEmail.trim()) return;
    setBusyId('new_partner');
    try {
      const payload: Record<string, unknown> = {
        companyName: partnerForm.companyName.trim().slice(0, 160),
        contactName: partnerForm.contactName.trim().slice(0, 120) || 'Contact Opérations',
        contactEmail: partnerForm.contactEmail.trim().slice(0, 200),
        contactPhone: partnerForm.contactPhone.trim().slice(0, 40) || '+225 00 00 00 00',
        partnerType: partnerForm.partnerType,
        status: 'active',
        serviceArea: partnerForm.serviceArea.trim().slice(0, 120) || 'Grand Abidjan',
        commissionRate: Math.max(0, Math.min(100, Number(partnerForm.commissionRate) || 15)),
        vehicleCount: Math.max(0, Math.floor(Number(partnerForm.vehicleCount) || 0)),
        driverCount: Math.max(0, Math.floor(Number(partnerForm.driverCount) || 0)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (partnerForm.paymentTerms.trim()) payload.paymentTerms = partnerForm.paymentTerms.trim().slice(0, 80);
      if (partnerForm.contractRef.trim()) payload.contractRef = partnerForm.contractRef.trim().slice(0, 80);
      const ref = await addDoc(collection(db, 'partners'), payload);
      await logAudit('create_partner', 'partner', ref.id, `Partenaire créé : ${payload.companyName}`);
      setShowPartnerForm(false);
      flash(t('Partenaire enregistré.', 'Partner onboarded.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'partners');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdatePartnerStatus = async (partner: PartnerRecord, nextStatus: PartnerRecord['status']) => {
    if (!requireAdminAction()) return;
    setBusyId(partner.id);
    try {
      await updateDoc(doc(db, 'partners', partner.id), { status: nextStatus, updatedAt: serverTimestamp() });
      flash(t('Statut partenaire mis à jour.', 'Partner status updated.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `partners/${partner.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleInitializeDefaultPricing = async () => {
    if (!requireAdminAction()) return;
    setBusyId('init_pricing');
    try {
      const batch = writeBatch(db);
      VEHICLE_CATALOG.forEach((v) => {
        batch.set(doc(db, 'pricingRules', `metro_${v.id}`), {
          zoneName: 'Zone Métropolitaine',
          city: 'Abidjan',
          country: 'Côte d’Ivoire',
          currency: 'GHS',
          vehicleCategory: v.id,
          baseFee: v.baseFallback,
          perKmRate: v.perKmFallback,
          minimumFare: v.baseFallback,
          waitingFeePerMin: 1.5,
          scheduledFee: 6,
          cargoSurcharge: v.maxWeightKg >= 250 ? 25 : 10,
          multiStopFee: 7,
          priorityMultiplier: 1.25,
          peakMultiplier: 1.15,
          fullDayRate: v.fullDayFallback,
          active: true,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      flash(t('6 règles tarifaires par défaut initialisées.', 'Initialized 6 default vehicle pricing rules.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'pricingRules');
    } finally {
      setBusyId(null);
    }
  };

  const handleSavePricingRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdminAction()) return;
    setBusyId('save_pricing');
    try {
      const payload = {
        zoneName: pricingForm.zoneName.trim().slice(0, 100) || 'Zone Métropolitaine',
        city: pricingForm.city.trim().slice(0, 80) || 'Abidjan',
        country: pricingForm.country.trim().slice(0, 80) || 'Côte d’Ivoire',
        currency: pricingForm.currency.trim().toUpperCase().slice(0, 8) || 'GHS',
        vehicleCategory: pricingForm.vehicleCategory,
        baseFee: Math.max(0, Number(pricingForm.baseFee) || 0),
        perKmRate: Math.max(0, Number(pricingForm.perKmRate) || 0),
        minimumFare: Math.max(0, Number(pricingForm.minimumFare) || 0),
        waitingFeePerMin: Math.max(0, Number(pricingForm.waitingFeePerMin) || 0),
        scheduledFee: Math.max(0, Number(pricingForm.scheduledFee) || 0),
        cargoSurcharge: Math.max(0, Number(pricingForm.cargoSurcharge) || 0),
        multiStopFee: Math.max(0, Number(pricingForm.multiStopFee) || 0),
        priorityMultiplier: Math.max(1, Number(pricingForm.priorityMultiplier) || 1),
        peakMultiplier: Math.max(1, Number(pricingForm.peakMultiplier) || 1),
        fullDayRate: Math.max(0, Number(pricingForm.fullDayRate) || 0),
        active: Boolean(pricingForm.active),
        updatedAt: serverTimestamp(),
      };
      if (editingRuleId) {
        await updateDoc(doc(db, 'pricingRules', editingRuleId), payload);
      } else {
        await addDoc(collection(db, 'pricingRules'), payload);
      }
      setShowPricingForm(false);
      setEditingRuleId(null);
      flash(t('Règle tarifaire enregistrée.', 'Pricing rule saved.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'pricingRules');
    } finally {
      setBusyId(null);
    }
  };

  const handleTogglePricingActive = async (rule: PricingRuleRecord) => {
    if (!requireAdminAction()) return;
    setBusyId(rule.id);
    try {
      await updateDoc(doc(db, 'pricingRules', rule.id), { active: !rule.active, updatedAt: serverTimestamp() });
      flash(t('Règle tarifaire mise à jour.', 'Pricing rule updated.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `pricingRules/${rule.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateIncident = async (inc: IncidentRecord, nextStatus: IncidentRecord['status']) => {
    if (!requireAdminAction()) return;
    setBusyId(inc.id);
    try {
      const notes = (resolutionDraft[inc.id] ?? inc.resolutionNotes ?? '').trim().slice(0, 1000);
      const payload: Record<string, unknown> = { status: nextStatus, updatedAt: serverTimestamp() };
      if (notes) payload.resolutionNotes = notes;
      await updateDoc(doc(db, 'incidents', inc.id), payload);
      flash(t('Incident mis à jour.', 'Incident updated.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${inc.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteWaitlistEntry = async (id: string) => {
    if (!requireAdminAction()) return;
    setBusyId(id);
    try {
      await deleteDoc(doc(db, 'waitlist', id));
      flash(t('Demande archivée.', 'Inquiry archived.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `waitlist/${id}`);
    } finally {
      setBusyId(null);
    }
  };

  const filteredDrivers = useMemo(() => {
    if (driverFilter === 'all') return drivers;
    if (driverFilter === 'pending') {
      return drivers.filter((d) => d.approvalStatus === 'pending' || d.approvalStatus === 'under_review');
    }
    return drivers.filter((d) => d.approvalStatus === driverFilter);
  }, [drivers, driverFilter]);

  const navItems: Array<{
    id: OpsSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'dashboard', label: t('Carte Opérations', 'Operations Map'), icon: LayoutDashboard },
    {
      id: 'dispatch',
      label: t('Dispatch & Réservations', 'Dispatch & Bookings'),
      icon: Radio,
      badge: kpis.pendingDispatchCount + kpis.pendingReservationsCount,
    },
    { id: 'drivers', label: t('Validation Livreurs', 'Drivers Queue'), icon: UserCheck, badge: kpis.pendingDriversCount },
    { id: 'fleet', label: t('Flotte ROVA', 'ROVA Fleet'), icon: Truck },
    { id: 'equipment', label: t('Marque & Équipements', 'Brand & Equipment'), icon: Boxes },
    { id: 'partners', label: t('Partenaires', 'Partnerships'), icon: Handshake },
    { id: 'pricing', label: t('Moteur Tarifaire', 'Pricing Engine'), icon: Sliders },
    { id: 'finance', label: t('Finances & Audit', 'Finance & Audit'), icon: DollarSign, badge: kpis.openIncidentsCount },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-950 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r border-neutral-200 bg-white shrink-0">
        <div className="h-16 px-6 flex items-center justify-between border-b border-neutral-200">
          <div>
            <span className="font-display text-base font-extrabold tracking-[0.2em]">ROVA</span>
            <p className="text-[11px] text-neutral-500">
              {t('Centre d’Opérations', 'Operations Center')}
            </p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm transition-colors ${
                  active ? 'bg-neutral-950 text-white font-medium' : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </span>
                {item.badge && item.badge > 0 ? (
                  <span
                    className={`font-mono text-[11px] px-2 py-0.5 rounded-full tabular-nums ${
                      active ? 'bg-white text-neutral-950' : 'bg-neutral-950 text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-neutral-200 space-y-3">
          {workspaceSwitcher}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-neutral-950 truncate">
                {profile?.displayName || t('Administrateur ROVA', 'ROVA Admin')}
              </p>
              <p className="text-[11px] text-neutral-500 truncate">
                {uid ? actorEmail : t('Aperçu (non connecté)', 'Preview (signed out)')}
              </p>
            </div>
            {uid ? (
              <button
                type="button"
                onClick={logout}
                className="p-2 rounded-full border border-neutral-200 hover:border-neutral-950 text-neutral-600"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onRequestSignIn}
                className="px-3 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
              >
                {t('Connexion', 'Sign in')}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-neutral-200">
          <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
            <h1 className="font-display text-base font-bold tracking-tight truncate">
              {navItems.find((n) => n.id === section)?.label}
            </h1>
            <div className="flex items-center gap-3 text-xs font-mono text-neutral-600">
              <span className="hidden sm:inline">
                {t('EN LIGNE', 'ONLINE')}: {kpis.onlineDriversCount}
              </span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">
                {t('ACTIVES', 'ACTIVE')}: {kpis.activeCount}
              </span>
            </div>
          </div>

          {/* Mobile Horizontal Nav */}
          <div className="lg:hidden flex overflow-x-auto border-t border-neutral-100 px-3 py-2 gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  section === item.id
                    ? 'bg-neutral-950 text-white border-neutral-950'
                    : 'bg-white text-neutral-700 border-neutral-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        {!canQueryLive && (
          <div className="bg-white border-b border-neutral-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-neutral-700">
              {t(
                'Mode aperçu (Départ à zéro) — Connectez-vous avec votre compte administrateur Google pour synchroniser et piloter la base en direct.',
                'Preview mode (Starting fresh) — Sign in with your Google administrator account for live Firestore operations.'
              )}
            </p>
            <button
              type="button"
              onClick={onRequestSignIn}
              className="px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800"
            >
              {t('Connexion Admin Google', 'Admin Google Sign-In')}
            </button>
          </div>
        )}

        {statusBanner && (
          <div className="bg-neutral-950 text-white px-4 sm:px-6 py-2.5 text-xs flex items-center justify-between">
            <span>{statusBanner}</span>
            <button type="button" onClick={() => setStatusBanner(null)} className="text-neutral-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1440px] w-full mx-auto">
          {/* 1. DASHBOARD */}
          {section === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
                {[
                  { label: t('Livraisons du jour', 'Deliveries Today'), value: kpis.deliveriesToday, sub: `${deliveries.length} ${t('total', 'total')}` },
                  { label: t('Courses actives', 'Active Deliveries'), value: kpis.activeCount, sub: `${kpis.pendingDispatchCount} ${t('en attente', 'unassigned')}` },
                  { label: t('Livreurs en ligne', 'Online Drivers'), value: kpis.onlineDriversCount, sub: `${kpis.approvedDrivers.length} ${t('validés', 'approved')}` },
                  { label: t('Flotte ROVA', 'ROVA Fleet'), value: kpis.fleetTotal, sub: `${kpis.reservedVehicles} ${t('réservés', 'reserved')}` },
                  { label: t('Incidents ouverts', 'Open Incidents'), value: kpis.openIncidentsCount, sub: `${kpis.failedCount} ${t('échecs', 'failed')}` },
                  {
                    label: t('Volume brut', 'Gross Volume'),
                    value: formatMoney(kpis.grossRevenue, 'GHS'),
                    sub: `15%: ${formatMoney(kpis.platformCommission, 'GHS')}`,
                  },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-2xl border border-neutral-200 p-4 bg-white space-y-1">
                    <p className="text-xs text-neutral-500">{kpi.label}</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-neutral-950 truncate">
                      {kpi.value}
                    </p>
                    <p className="text-[11px] text-neutral-500 truncate">{kpi.sub}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-3xl border border-neutral-200 bg-white overflow-hidden">
                  <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-sm font-bold">
                        {t('Carte opérationnelle en direct', 'Live Operations Map')}
                      </h2>
                      <p className="text-xs text-neutral-500">
                        {t('Positions GPS des livreurs en ligne et collectes actives', 'GPS positions of online drivers and active pickups')}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-neutral-500">{opsMapMarkers.length}</span>
                  </div>
                  <div className="p-4">
                    <RovaMap
                      center={mapCenter}
                      zoom={12}
                      markers={opsMapMarkers}
                      heightClass="h-[420px]"
                      showSearchBar
                    />
                  </div>
                </div>

                <div className="rounded-3xl border border-neutral-200 bg-white flex flex-col overflow-hidden">
                  <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold">
                      {t('Livreurs en ligne', 'Online Drivers')}
                    </h2>
                    <span className="font-mono text-xs text-emerald-700">{kpis.onlineDriversCount}</span>
                  </div>
                  <div className="divide-y divide-neutral-100 overflow-y-auto max-h-[440px]">
                    {kpis.onlineDrivers.length === 0 ? (
                      <div className="p-8 text-center space-y-2">
                        <Radio className="w-5 h-5 mx-auto text-neutral-400" />
                        <p className="text-xs font-semibold">
                          {t('Aucun livreur en ligne (0)', 'No online drivers (0)')}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {t(
                            'Validez vos premiers livreurs dans l’onglet Validation Livreurs pour activer leur GPS.',
                            'Approve your first drivers in the Drivers Queue to enable live GPS.'
                          )}
                        </p>
                      </div>
                    ) : (
                      kpis.onlineDrivers.map((d) => (
                        <div key={d.uid} className="p-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{d.firstName}</p>
                            <p className="text-xs text-neutral-500 truncate">
                              {getVehicleLabel(d.vehicleCategory, lang)} · {d.serviceArea}
                            </p>
                          </div>
                          <span className="font-mono text-[11px] text-emerald-700">LIVE</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. DISPATCH & RESERVATIONS */}
          {section === 'dispatch' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDispatchTab('deliveries')}
                  className={`px-4 py-2 rounded-full text-xs font-medium border ${
                    dispatchTab === 'deliveries'
                      ? 'bg-neutral-950 text-white border-neutral-950'
                      : 'bg-white text-neutral-700 border-neutral-300'
                  }`}
                >
                  {t('Courses & Dispatch', 'Deliveries Dispatch')} ({deliveries.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDispatchTab('reservations')}
                  className={`px-4 py-2 rounded-full text-xs font-medium border ${
                    dispatchTab === 'reservations'
                      ? 'bg-neutral-950 text-white border-neutral-950'
                      : 'bg-white text-neutral-700 border-neutral-300'
                  }`}
                >
                  {t('Réservations de véhicules', 'Vehicle Reservations')} ({reservations.length})
                </button>
              </div>

              {dispatchTab === 'deliveries' && (
                <div className="space-y-3">
                  {deliveries.length === 0 ? (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                      <Package className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">
                        {t('Aucune livraison enregistrée (Départ à zéro)', 'No deliveries yet (Starting fresh)')}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {t(
                          'Créez une livraison depuis l’Espace Marchand pour l’affecter ici.',
                          'Create a delivery from the Merchant Workspace to dispatch it here.'
                        )}
                      </p>
                    </div>
                  ) : (
                    deliveries.map((del) => (
                      <div key={del.id} className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono text-sm font-bold">{del.reference}</span>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1.5 font-medium">
                                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[del.status].dot}`} />
                                {getStatusLabel(del.status, lang)}
                              </span>
                              <span>·</span>
                              <span className="text-neutral-500">{getVehicleLabel(del.vehicleCategory, lang)}</span>
                            </div>
                            <p className="text-xs text-neutral-600">
                              {del.merchantName} — {del.pickupAddress}
                            </p>
                          </div>
                          <div className="text-left sm:text-right">
                            <p className="font-mono text-sm font-bold tabular-nums">
                              {formatMoney(del.quotedPrice, del.currency)}
                            </p>
                            <p className="text-[11px] text-neutral-500">
                              {getPaymentMethodLabelEn(del.paymentMethod)} · {del.paymentStatus}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-neutral-100">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={assignSelect[del.id] ?? del.driverUid ?? ''}
                              onChange={(e) => setAssignSelect((p) => ({ ...p, [del.id]: e.target.value }))}
                              className="rounded-xl border border-neutral-300 px-3 py-1.5 text-xs bg-white"
                            >
                              <option value="">{t('Choisir un livreur validé...', 'Select approved driver...')}</option>
                              {kpis.approvedDrivers.map((d) => (
                                <option key={d.uid} value={d.uid}>
                                  {d.fullName} ({getVehicleLabel(d.vehicleCategory, lang)})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busyId === del.id}
                              onClick={() => handleAssignDeliveryDriver(del)}
                              className="px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
                            >
                              {t('Assigner', 'Assign')}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenDeliveryTracking(del.id)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-neutral-300 text-xs hover:border-neutral-950"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {t('Vue destinataire', 'Recipient view')}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {dispatchTab === 'reservations' && (
                <div className="space-y-3">
                  {reservations.length === 0 ? (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                      <Calendar className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">
                        {t('Aucune réservation en attente (0)', 'No reservations yet (0)')}
                      </p>
                    </div>
                  ) : (
                    reservations.map((res) => (
                      <div key={res.id} className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">
                              {res.merchantName} · {getVehicleLabel(res.vehicleCategory, lang)}
                            </p>
                            <p className="text-xs text-neutral-500 font-mono">
                              {res.reservationDate} ({res.startTime}–{res.endTime}) · {res.pickupAddress}
                            </p>
                          </div>
                          <span className="font-mono text-sm font-bold">
                            {formatMoney(res.quotedPrice, res.currency)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-100">
                          {res.status === 'pending_approval' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateReservation(res, 'confirmed')}
                              className="px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
                            >
                              {t('Confirmer la réservation', 'Approve reservation')}
                            </button>
                          )}
                          {res.status === 'confirmed' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateReservation(res, 'completed')}
                              className="px-4 py-1.5 rounded-full bg-emerald-700 text-white text-xs font-medium"
                            >
                              {t('Marquer terminée', 'Mark completed')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. DRIVERS QUEUE */}
          {section === 'drivers' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {(['all', 'pending', 'approved', 'suspended'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDriverFilter(f)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium border ${
                      driverFilter === f
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white text-neutral-700 border-neutral-300'
                    }`}
                  >
                    {f === 'all'
                      ? t('Tous', 'All')
                      : f === 'pending'
                      ? t('En attente', 'Pending')
                      : f === 'approved'
                      ? t('Validés', 'Approved')
                      : t('Suspendus', 'Suspended')}
                  </button>
                ))}
              </div>

              {filteredDrivers.length === 0 ? (
                <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                  <UserCheck className="w-6 h-6 mx-auto text-neutral-400" />
                  <p className="text-sm font-semibold">
                    {t('Aucun dossier chauffeur (0)', 'No driver profiles (0)')}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {t(
                      'Les chauffeurs inscrits via l’Application Livreur apparaissent ici pour vérification.',
                      'Drivers registering from the Driver App appear here for verification.'
                    )}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredDrivers.map((drv) => (
                    <div key={drv.id} className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-sm">{drv.fullName}</p>
                          <p className="text-xs text-neutral-500">
                            {drv.phone} · {drv.serviceArea}
                          </p>
                        </div>
                        <span className="font-mono text-xs uppercase text-neutral-600">{drv.approvalStatus}</span>
                      </div>
                      <div className="rounded-2xl bg-neutral-50 p-3 text-xs grid grid-cols-2 gap-2">
                        <span>{getVehicleLabel(drv.vehicleCategory, lang)}</span>
                        <span className="font-mono">{drv.vehiclePlate}</span>
                        <span className="font-mono text-neutral-500">{drv.licenseNumber}</span>
                        <span className="font-mono text-neutral-500">{drv.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {drv.approvalStatus !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => handleDriverApproval(drv, 'approved')}
                            className="px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
                          >
                            {t('Valider', 'Approve')}
                          </button>
                        )}
                        {drv.approvalStatus !== 'suspended' && (
                          <button
                            type="button"
                            onClick={() => handleDriverApproval(drv, 'suspended')}
                            className="px-4 py-1.5 rounded-full border border-neutral-300 text-xs text-red-700"
                          >
                            {t('Suspendre', 'Suspend')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. FLEET */}
          {section === 'fleet' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold">{t('Flotte ROVA', 'ROVA Fleet')}</h2>
                  <p className="text-xs text-neutral-500">
                    {t('Véhicules propriétaires, partenaires et chauffeurs', 'ROVA-owned, partner, and driver vehicles')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowVehicleForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('Ajouter un véhicule', 'Register vehicle')}
                </button>
              </div>

              {showVehicleForm && (
                <form
                  onSubmit={handleCreateVehicle}
                  className="rounded-3xl border border-neutral-950 bg-white p-6 space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <input
                      type="text"
                      required
                      placeholder={t('N° Flotte (ex. RV-001)', 'Fleet # (RV-001)')}
                      value={vehicleForm.fleetNumber}
                      onChange={(e) => setVehicleForm((p) => ({ ...p, fleetNumber: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="text"
                      required
                      placeholder={t('Immatriculation', 'Registration plate')}
                      value={vehicleForm.registration}
                      onChange={(e) => setVehicleForm((p) => ({ ...p, registration: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <select
                      value={vehicleForm.category}
                      onChange={(e) => setVehicleForm((p) => ({ ...p, category: e.target.value as VehicleCategory }))}
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs"
                    >
                      {VEHICLE_CATALOG.map((v) => (
                        <option key={v.id} value={v.id}>
                          {lang === 'fr' ? v.labelFr : v.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder={t('Zone de service', 'Service area')}
                      value={vehicleForm.serviceArea}
                      onChange={(e) => setVehicleForm((p) => ({ ...p, serviceArea: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowVehicleForm(false)}
                      className="px-4 py-2 rounded-full border border-neutral-300 text-xs"
                    >
                      {t('Annuler', 'Cancel')}
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium"
                    >
                      {t('Enregistrer', 'Save')}
                    </button>
                  </div>
                </form>
              )}

              {vehicles.length === 0 ? (
                <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                  <Truck className="w-6 h-6 mx-auto text-neutral-400" />
                  <p className="text-sm font-semibold">
                    {t('Aucun véhicule dans le parc (0)', 'No vehicles registered (0)')}
                  </p>
                </div>
              ) : (
                <div className="rounded-3xl border border-neutral-200 bg-white overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                      <tr>
                        <th className="p-3.5">{t('Flotte / Plaque', 'Fleet / Plate')}</th>
                        <th className="p-3.5">{t('Catégorie', 'Category')}</th>
                        <th className="p-3.5">{t('Zone', 'Zone')}</th>
                        <th className="p-3.5">{t('Statut', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {vehicles.map((v) => (
                        <tr key={v.id}>
                          <td className="p-3.5 font-mono font-bold">
                            {v.fleetNumber} · <span className="font-normal text-neutral-500">{v.registration}</span>
                          </td>
                          <td className="p-3.5">{getVehicleLabel(v.category, lang)}</td>
                          <td className="p-3.5">{v.serviceArea}</td>
                          <td className="p-3.5">
                            <select
                              value={v.status}
                              onChange={(e) => handleUpdateVehicleStatus(v, e.target.value as VehicleRecord['status'])}
                              className="rounded-xl border border-neutral-300 bg-white px-2.5 py-1 text-xs"
                            >
                              {(['available', 'assigned', 'in_operation', 'reserved', 'maintenance', 'inactive', 'suspended'] as const).map(
                                (st) => (
                                  <option key={st} value={st}>
                                    {st}
                                  </option>
                                )
                              )}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 5. EQUIPMENT */}
          {section === 'equipment' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold">
                    {t('Marque physique & Équipements', 'Physical Brand & Equipment')}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {t('Uniformes, caissons, sacs isothermes, casques et dotations chauffeurs', 'Uniforms, boxes, bags, helmets, and driver issuance')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEquipForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('Ajouter un article', 'Add stock item')}
                </button>
              </div>

              {showEquipForm && (
                <form
                  onSubmit={handleCreateEquipment}
                  className="rounded-3xl border border-neutral-950 bg-white p-5 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <input
                      type="text"
                      required
                      placeholder={t('Nom (ex. Caisson ROVA 45L)', 'Item name')}
                      value={equipForm.name}
                      onChange={(e) => setEquipForm((p) => ({ ...p, name: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <select
                      value={equipForm.category}
                      onChange={(e) =>
                        setEquipForm((p) => ({ ...p, category: e.target.value as EquipmentRecord['category'] }))
                      }
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs"
                    >
                      {EQUIPMENT_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {lang === 'fr' ? c.labelFr : c.labelEn}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder={t('Taille / Format', 'Size')}
                      value={equipForm.size}
                      onChange={(e) => setEquipForm((p) => ({ ...p, size: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="number"
                      min={0}
                      value={equipForm.totalStock}
                      onChange={(e) => setEquipForm((p) => ({ ...p, totalStock: Number(e.target.value) }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="px-5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium">
                      {t('Ajouter au stock', 'Add to stock')}
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-3xl border border-neutral-200 bg-white overflow-hidden">
                  {equipment.length === 0 ? (
                    <div className="p-12 text-center space-y-2">
                      <Boxes className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">{t('Stock vide (0)', 'Empty inventory (0)')}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {equipment.map((eq) => (
                        <div key={eq.id} className="p-4 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-sm">{eq.name}</p>
                            <p className="text-neutral-500">{eq.category}</p>
                          </div>
                          <div className="font-mono tabular-nums">
                            {eq.availableStock} / {eq.totalStock} {t('dispo', 'avail')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <form
                  onSubmit={handleAssignEquipment}
                  className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-3 h-fit"
                >
                  <h3 className="font-display text-sm font-bold">
                    {t('Attribuer à un livreur', 'Issue to driver')}
                  </h3>
                  <select
                    required
                    value={assignEquipForm.equipmentId}
                    onChange={(e) => setAssignEquipForm((p) => ({ ...p, equipmentId: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">{t('Choisir un article...', 'Select item...')}</option>
                    {equipment.filter((e) => e.availableStock > 0).map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} ({eq.availableStock})
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    value={assignEquipForm.driverId}
                    onChange={(e) => setAssignEquipForm((p) => ({ ...p, driverId: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">{t('Choisir un livreur...', 'Select driver...')}</option>
                    {drivers.map((d) => (
                      <option key={d.uid} value={d.uid}>
                        {d.fullName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={assignEquipForm.quantity}
                    onChange={(e) => setAssignEquipForm((p) => ({ ...p, quantity: Number(e.target.value) }))}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
                  >
                    {t('Attribuer', 'Assign')}
                  </button>
                </form>
              </div>

              {equipmentAssignments.length > 0 && (
                <div className="rounded-3xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                  {equipmentAssignments.map((a) => (
                    <div key={a.id} className="p-4 flex items-center justify-between text-xs">
                      <span>
                        <strong>{a.quantity}x {a.equipmentName}</strong> — {a.driverName}
                      </span>
                      {a.status === 'assigned' ? (
                        <button
                          type="button"
                          onClick={() => handleReturnEquipment(a)}
                          className="px-3 py-1 rounded-full border border-neutral-300 hover:border-neutral-950"
                        >
                          {t('Marquer restitué', 'Mark returned')}
                        </button>
                      ) : (
                        <span className="font-mono text-neutral-400 uppercase">{a.status}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 6. PARTNERS */}
          {section === 'partners' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">
                  {t('Partenaires commerciaux', 'Commercial Partners')}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowPartnerForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('Nouveau partenaire', 'Add partner')}
                </button>
              </div>

              {showPartnerForm && (
                <form
                  onSubmit={handleCreatePartner}
                  className="rounded-3xl border border-neutral-950 bg-white p-5 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      required
                      placeholder={t('Raison sociale', 'Company name')}
                      value={partnerForm.companyName}
                      onChange={(e) => setPartnerForm((p) => ({ ...p, companyName: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="text"
                      required
                      placeholder={t('Nom du contact', 'Contact name')}
                      value={partnerForm.contactName}
                      onChange={(e) => setPartnerForm((p) => ({ ...p, contactName: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="email"
                      required
                      placeholder={t('E-mail', 'Email')}
                      value={partnerForm.contactEmail}
                      onChange={(e) => setPartnerForm((p) => ({ ...p, contactEmail: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="tel"
                      required
                      placeholder={t('Téléphone', 'Phone')}
                      value={partnerForm.contactPhone}
                      onChange={(e) => setPartnerForm((p) => ({ ...p, contactPhone: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <select
                      value={partnerForm.partnerType}
                      onChange={(e) =>
                        setPartnerForm((p) => ({ ...p, partnerType: e.target.value as PartnerRecord['partnerType'] }))
                      }
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs"
                    >
                      {PARTNER_TYPES.map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {lang === 'fr' ? pt.labelFr : pt.labelEn}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder={t('Zone de service', 'Service area')}
                      value={partnerForm.serviceArea}
                      onChange={(e) => setPartnerForm((p) => ({ ...p, serviceArea: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="px-5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium">
                      {t('Enregistrer', 'Save')}
                    </button>
                  </div>
                </form>
              )}

              {partners.length === 0 ? (
                <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                  <Handshake className="w-6 h-6 mx-auto text-neutral-400" />
                  <p className="text-sm font-semibold">{t('Aucun partenaire enregistré (0)', 'No partners yet (0)')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {partners.map((pt) => (
                    <div key={pt.id} className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{pt.companyName}</span>
                        <span className="font-mono uppercase">{pt.status}</span>
                      </div>
                      <p className="text-neutral-600">{pt.contactName} · {pt.contactEmail}</p>
                      <div className="flex gap-2">
                        {pt.status !== 'active' && (
                          <button
                            type="button"
                            onClick={() => handleUpdatePartnerStatus(pt, 'active')}
                            className="px-3.5 py-1.5 rounded-full bg-neutral-950 text-white"
                          >
                            {t('Activer', 'Activate')}
                          </button>
                        )}
                        {pt.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => handleUpdatePartnerStatus(pt, 'suspended')}
                            className="px-3.5 py-1.5 rounded-full border border-neutral-300"
                          >
                            {t('Suspendre', 'Suspend')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 7. PRICING ENGINE */}
          {section === 'pricing' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold">
                    {t('Moteur tarifaire dynamique', 'Dynamic Pricing Engine')}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {t('Les devis marchands utilisent ces tarifs actifs en temps réel.', 'Merchant quotes read active rules live.')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleInitializeDefaultPricing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-950 bg-white text-xs font-medium"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('Initialiser 6 tarifs par défaut', 'Initialize 6 defaults')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRuleId(null);
                      setShowPricingForm((v) => !v);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('Nouvelle règle', 'New rule')}
                  </button>
                </div>
              </div>

              {showPricingForm && (
                <form
                  onSubmit={handleSavePricingRule}
                  className="rounded-3xl border border-neutral-950 bg-white p-5 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <input
                      type="text"
                      required
                      value={pricingForm.zoneName}
                      onChange={(e) => setPricingForm((p) => ({ ...p, zoneName: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <select
                      value={pricingForm.vehicleCategory}
                      onChange={(e) =>
                        setPricingForm((p) => ({ ...p, vehicleCategory: e.target.value as VehicleCategory }))
                      }
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs"
                    >
                      {VEHICLE_CATALOG.map((v) => (
                        <option key={v.id} value={v.id}>
                          {lang === 'fr' ? v.labelFr : v.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.5"
                      value={pricingForm.baseFee}
                      onChange={(e) => setPricingForm((p) => ({ ...p, baseFee: Number(e.target.value) }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                      placeholder="Base"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={pricingForm.perKmRate}
                      onChange={(e) => setPricingForm((p) => ({ ...p, perKmRate: Number(e.target.value) }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                      placeholder="/km"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="px-5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium">
                      {t('Enregistrer la règle', 'Save rule')}
                    </button>
                  </div>
                </form>
              )}

              {pricingRules.length === 0 ? (
                <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                  <Sliders className="w-6 h-6 mx-auto text-neutral-400" />
                  <p className="text-sm font-semibold">
                    {t('Aucune règle tarifaire personnalisée (0)', 'No custom pricing rules (0)')}
                  </p>
                </div>
              ) : (
                <div className="rounded-3xl border border-neutral-200 bg-white overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                      <tr>
                        <th className="p-3.5">{t('Zone / Véhicule', 'Zone / Vehicle')}</th>
                        <th className="p-3.5">{t('Base + /km', 'Base + /km')}</th>
                        <th className="p-3.5">{t('Journée', 'Full-day')}</th>
                        <th className="p-3.5 text-right">{t('Statut', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 font-mono">
                      {pricingRules.map((r) => (
                        <tr key={r.id}>
                          <td className="p-3.5 font-sans">
                            <p className="font-semibold">{getVehicleLabel(r.vehicleCategory, lang)}</p>
                            <p className="text-neutral-500">{r.zoneName}</p>
                          </td>
                          <td className="p-3.5 tabular-nums">
                            {formatMoney(r.baseFee, r.currency)} + {formatMoney(r.perKmRate, r.currency)}/km
                          </td>
                          <td className="p-3.5 tabular-nums">{formatMoney(r.fullDayRate, r.currency)}</td>
                          <td className="p-3.5 text-right font-sans">
                            <button
                              type="button"
                              onClick={() => handleTogglePricingActive(r)}
                              className="px-3 py-1 rounded-full border border-neutral-300 text-xs"
                            >
                              {r.active ? t('Actif', 'Active') : t('En pause', 'Paused')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 8. FINANCE, INCIDENTS, WAITLIST, AUDIT */}
          {section === 'finance' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'finance', label: t('Finances', 'Finance Ledger') },
                  { id: 'incidents', label: `${t('Incidents', 'Incidents')} (${kpis.openIncidentsCount})` },
                  { id: 'waitlist', label: `${t('Liste d’attente', 'Waitlist')} (${waitlist.length})` },
                  { id: 'audit', label: `${t('Journal d’audit', 'Audit Logs')} (${auditLogs.length})` },
                ].map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => setGovTab(tb.id as typeof govTab)}
                    className={`px-4 py-2 rounded-full text-xs font-medium border ${
                      govTab === tb.id
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white text-neutral-700 border-neutral-300'
                    }`}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>

              {govTab === 'finance' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-3xl border border-neutral-200 bg-white p-5">
                      <p className="text-xs text-neutral-500">{t('Volume brut', 'Gross Volume')}</p>
                      <p className="font-mono text-2xl font-bold tabular-nums mt-1">
                        {formatMoney(kpis.grossRevenue, 'GHS')}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-neutral-200 bg-white p-5">
                      <p className="text-xs text-neutral-500">{t('Commission ROVA (15%)', 'Platform Fee (15%)')}</p>
                      <p className="font-mono text-2xl font-bold tabular-nums mt-1">
                        {formatMoney(kpis.platformCommission, 'GHS')}
                      </p>
                    </div>
                    <div className="rounded-3xl border border-neutral-200 bg-white p-5">
                      <p className="text-xs text-neutral-500">{t('Reversements livreurs (85%)', 'Driver Payouts (85%)')}</p>
                      <p className="font-mono text-2xl font-bold tabular-nums mt-1">
                        {formatMoney(kpis.driverPayouts, 'GHS')}
                      </p>
                    </div>
                  </div>

                  {/* Payment Methods kept strictly in English */}
                  <div className="rounded-3xl border border-neutral-200 bg-white overflow-hidden">
                    <div className="px-5 py-4 border-b border-neutral-100 font-display text-sm font-bold">
                      {t('Écritures financières · Payment Methods', 'Settlement Entries · Payment Methods')}
                    </div>
                    {deliveries.length === 0 ? (
                      <p className="p-8 text-center text-xs text-neutral-500">
                        {t('Aucune transaction enregistrée (0).', 'No billable transactions yet (0).')}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                            <tr>
                              <th className="p-3.5">{t('Référence', 'Reference')}</th>
                              <th className="p-3.5">{t('Marchand', 'Merchant')}</th>
                              <th className="p-3.5">Payment Method</th>
                              <th className="p-3.5">Payment Status</th>
                              <th className="p-3.5 text-right">{t('Montant', 'Amount')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {deliveries.slice(0, 25).map((d) => (
                              <tr key={d.id}>
                                <td className="p-3.5 font-mono font-bold">{d.reference}</td>
                                <td className="p-3.5">{d.merchantName}</td>
                                <td className="p-3.5 font-medium">{getPaymentMethodLabelEn(d.paymentMethod)}</td>
                                <td className="p-3.5 font-mono uppercase text-[11px]">{d.paymentStatus}</td>
                                <td className="p-3.5 text-right font-mono tabular-nums">
                                  {formatMoney(d.quotedPrice, d.currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {govTab === 'incidents' && (
                <div className="space-y-3">
                  {incidents.length === 0 ? (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                      <ShieldCheck className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">{t('Aucun incident signalé (0)', 'No incidents (0)')}</p>
                    </div>
                  ) : (
                    incidents.map((inc) => (
                      <div key={inc.id} className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-3">
                        <p className="text-sm">{inc.description}</p>
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="text"
                            placeholder={t('Notes de résolution...', 'Resolution notes...')}
                            value={resolutionDraft[inc.id] ?? inc.resolutionNotes ?? ''}
                            onChange={(e) => setResolutionDraft((p) => ({ ...p, [inc.id]: e.target.value }))}
                            className="flex-1 rounded-xl border border-neutral-300 px-3 py-1.5 text-xs"
                          />
                          {inc.status !== 'resolved' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateIncident(inc, 'resolved')}
                              className="px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
                            >
                              {t('Résoudre', 'Resolve')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {govTab === 'waitlist' && (
                <div className="space-y-3">
                  {waitlist.length === 0 ? (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                      <Inbox className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">{t('Aucune demande en attente (0)', 'No waitlist entries (0)')}</p>
                    </div>
                  ) : (
                    waitlist.map((w) => (
                      <div key={w.id} className="rounded-3xl border border-neutral-200 bg-white p-4 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-semibold">{w.name} ({w.email})</p>
                          <p className="text-neutral-500">{w.platform} · {w.company || w.city || ''}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteWaitlistEntry(w.id)}
                          className="underline text-neutral-500 hover:text-red-700"
                        >
                          {t('Archiver', 'Archive')}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {govTab === 'audit' && (
                <div className="rounded-3xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                  {auditLogs.length === 0 ? (
                    <div className="p-12 text-center space-y-2">
                      <ClipboardList className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">{t('Journal d’audit vide (0)', 'Empty audit log (0)')}</p>
                    </div>
                  ) : (
                    auditLogs.map((log) => (
                      <div key={log.id} className="p-4 flex flex-wrap justify-between gap-2 text-xs">
                        <span>
                          <strong className="font-mono mr-2">[{log.action}]</strong>
                          {log.summary}
                        </span>
                        <span className="font-mono text-neutral-500">{log.actorEmail}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
