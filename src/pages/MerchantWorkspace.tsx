import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowRight,
  Bell,
  Building2,
  Calendar,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Home,
  LogOut,
  MapPin,
  Package,
  Plus,
  Route,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  BusinessMember,
  BusinessRecord,
  DeliveryRecord,
  DeliveryStopRecord,
  DriverDispatchRecord,
  NotificationRecord,
  PaymentMethod,
  PricingRuleRecord,
  ProofType,
  QuoteResult,
  ReservationRecord,
  SavedRecipient,
  TimingType,
  VehicleCategory,
} from '../types/rova';
import {
  formatMoney,
  generateOtp,
  generateReference,
  generateTrackingToken,
  getEffectivePricingRule,
  getPaymentMethodLabelEn,
  getStatusLabel,
  getVehicleLabel,
  PAYMENT_METHODS_EN,
  rankSuitableDrivers,
  STATUS_META,
  VEHICLE_CATALOG,
} from '../lib/logistics';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';

type MerchantSection =
  | 'overview'
  | 'create'
  | 'deliveries'
  | 'reservations'
  | 'recipients'
  | 'finance'
  | 'settings';

interface DraftStop {
  id: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  landmark: string;
  digitalAddress: string;
  instructions: string;
  packageRef: string;
  lat: number;
  lng: number;
}

interface MerchantWorkspaceProps {
  onOpenTracking: (token: string) => void;
  workspaceSwitcher?: React.ReactNode;
  onRequestSignIn?: () => void;
}

export function MerchantWorkspace({
  onOpenTracking,
  workspaceSwitcher,
  onRequestSignIn,
}: MerchantWorkspaceProps) {
  const { firebaseUser, profile, updateProfileFields, logout } = useAuth();
  const { lang, t } = useLanguage();
  const uid = firebaseUser?.uid || '';

  const [section, setSection] = useState<MerchantSection>('overview');
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live Firestore state
  const [business, setBusiness] = useState<BusinessRecord | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [recipients, setRecipients] = useState<SavedRecipient[]>([]);
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<DriverDispatchRecord[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRuleRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  // Payment providers fetched from backend
  const [paymentProviders, setPaymentProviders] = useState<
    Array<{ id: string; name: string; status: string; methods: string[] }>
  >([]);

  // Selected delivery details
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [selectedStops, setSelectedStops] = useState<DeliveryStopRecord[]>([]);
  const [selectedPolyline, setSelectedPolyline] = useState<[number, number][]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'active' | 'scheduled' | 'completed'>('all');

  // 7-Step Delivery Creation State
  const [step, setStep] = useState(1);
  const [pickup, setPickup] = useState({
    address: 'Plateau, Abidjan',
    landmark: '',
    digitalAddress: '',
    instructions: '',
    lat: 5.3235,
    lng: -4.0267,
  });
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [draftStop, setDraftStop] = useState<DraftStop>({
    id: 'tmp',
    recipientName: '',
    recipientPhone: '',
    address: '',
    landmark: '',
    digitalAddress: '',
    instructions: '',
    packageRef: '',
    lat: 5.348,
    lng: -3.998,
  });
  const [pkg, setPkg] = useState({
    packageType: 'Colis commercial',
    packageSize: 'medium' as DeliveryRecord['packageSize'],
    weightKg: 5,
    quantity: 1,
    fragile: false,
    specialHandling: '',
    proofRequired: 'otp' as ProofType,
  });
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('motorcycle');
  const [timingType, setTimingType] = useState<TimingType>('instant');
  const [scheduledFor, setScheduledFor] = useState('');
  const [selectedDriverUid, setSelectedDriverUid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mobile_money');
  const [routeMetrics, setRouteMetrics] = useState<{
    distanceKm: number;
    durationMin: number;
    geometry: [number, number][];
  }>({ distanceKm: 6.4, durationMin: 18, geometry: [] });
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  // Reservation Form
  const [resForm, setResForm] = useState({
    vehicleCategory: 'cargo_van' as VehicleCategory,
    reservationDate: new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '17:00',
    durationType: 'full_day' as ReservationRecord['durationType'],
    pickupAddress: 'Plateau, Abidjan',
    pickupLat: 5.3235,
    pickupLng: -4.0267,
    destinationsSummary: '',
    cargoRequirements: '',
  });

  // Saved Recipient Form
  const [recForm, setRecForm] = useState({
    name: '',
    phone: '',
    address: '',
    landmark: '',
    lat: 5.348,
    lng: -3.998,
  });

  // Business Profile & Team Forms
  const [bizForm, setBizForm] = useState({
    name: profile?.displayName ? `${profile.displayName} Logistics` : '',
    industry: 'Commerce & Distribution',
    city: 'Abidjan',
    country: 'Côte d’Ivoire',
    currency: 'GHS',
    defaultPickupAddress: 'Plateau, Abidjan',
  });
  const [memberForm, setMemberForm] = useState({
    name: '',
    email: '',
    memberRole: 'employee' as BusinessMember['memberRole'],
  });

  const flash = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner((p) => (p === msg ? null : p)), 4500);
  };

  const requireSignedIn = () => {
    if (!uid) {
      flash(
        t(
          'Connectez-vous avec Google pour enregistrer vos données en temps réel.',
          'Sign in with Google to save live records to Firestore.'
        )
      );
      onRequestSignIn?.();
      return false;
    }
    return true;
  };

  // Load payment provider statuses (always available)
  useEffect(() => {
    fetch('/api/payments/providers')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.providers)) setPaymentProviders(data.providers);
      })
      .catch(() => {});
  }, []);

  // Firestore real-time listeners (strictly guarded by uid)
  useEffect(() => {
    if (!uid) {
      setBusiness(null);
      setDeliveries([]);
      setReservations([]);
      setRecipients([]);
      setMembers([]);
      setOnlineDrivers([]);
      setPricingRules([]);
      setNotifications([]);
      return;
    }

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'businesses'), where('ownerId', '==', uid)),
        (snap) => {
          if (!snap.empty) {
            const d = snap.docs[0];
            const data = { id: d.id, ...(d.data() as Omit<BusinessRecord, 'id'>) };
            setBusiness(data);
            setBizForm({
              name: data.name,
              industry: data.industry || 'Commerce & Distribution',
              city: data.city,
              country: data.country,
              currency: data.currency,
              defaultPickupAddress: data.defaultPickupAddress || '',
            });
          } else {
            setBusiness(null);
          }
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'businesses')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'deliveries'), where('merchantUid', '==', uid), orderBy('createdAt', 'desc')),
        (snap) => setDeliveries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'deliveries')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'reservations'), where('merchantUid', '==', uid), orderBy('createdAt', 'desc')),
        (snap) =>
          setReservations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReservationRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'reservations')
      )
    );

    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'driverDispatch'),
          where('approvalStatus', '==', 'approved'),
          where('isOnline', '==', true)
        ),
        (snap) =>
          setOnlineDrivers(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverDispatchRecord, 'id'>) }))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'driverDispatch')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'pricingRules'), where('active', '==', true)),
        (snap) => setPricingRules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PricingRuleRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'pricingRules')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('userId', '==', uid), orderBy('createdAt', 'desc')),
        (snap) =>
          setNotifications(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [uid]);

  // Subcollections under business (recipients & members)
  useEffect(() => {
    if (!uid || !business?.id) {
      setRecipients([]);
      setMembers([]);
      return;
    }
    const u1 = onSnapshot(
      query(collection(db, 'businesses', business.id, 'recipients'), where('ownerId', '==', uid)),
      (snap) => setRecipients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavedRecipient, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, `businesses/${business.id}/recipients`)
    );
    const u2 = onSnapshot(
      query(collection(db, 'businesses', business.id, 'members'), where('ownerId', '==', uid)),
      (snap) => setMembers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BusinessMember, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, `businesses/${business.id}/members`)
    );
    return () => {
      u1();
      u2();
    };
  }, [uid, business?.id]);

  // Selected delivery stops listener
  useEffect(() => {
    if (!uid || !selectedDeliveryId) {
      setSelectedStops([]);
      setSelectedPolyline([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'deliveries', selectedDeliveryId, 'stops'), where('merchantUid', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryStopRecord, 'id'>) }))
          .sort((a, b) => a.sequence - b.sequence);
        setSelectedStops(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `deliveries/${selectedDeliveryId}/stops`)
    );
    return () => unsub();
  }, [uid, selectedDeliveryId]);

  // Compute route geometry + live server quote whenever stops/vehicle/timing change
  useEffect(() => {
    const activeStopsList = stops.length > 0 ? stops : draftStop.address ? [draftStop] : [];
    const rule = getEffectivePricingRule(pricingRules, vehicleCategory);

    if (activeStopsList.length === 0) {
      setRouteMetrics({ distanceKm: 0, durationMin: 0, geometry: [] });
      setQuote({
        currency: rule.currency,
        total: rule.minimumFare,
        breakdown: [{ label: t('Tarif minimum', 'Minimum fare'), amount: rule.minimumFare }],
      });
      return;
    }

    let cancelled = false;
    const coords = [
      { lat: pickup.lat, lng: pickup.lng },
      ...activeStopsList.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];

    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coords }),
    })
      .then((r) => r.json())
      .then(async (routeData) => {
        if (cancelled) return;
        const dist = Number(routeData.distanceKm) || 4.5;
        const dur = Number(routeData.durationMin) || 15;
        setRouteMetrics({
          distanceKm: dist,
          durationMin: dur,
          geometry: Array.isArray(routeData.geometry) ? routeData.geometry : [],
        });

        const quoteRes = await fetch('/api/pricing/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            distanceKm: dist,
            stopCount: activeStopsList.length,
            weightKg: pkg.weightKg,
            timingType,
            rule,
          }),
        });
        const quoteData = await quoteRes.json();
        if (!cancelled && quoteData && typeof quoteData.total === 'number') {
          setQuote(quoteData);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pickup.lat, pickup.lng, stops, draftStop.lat, draftStop.lng, draftStop.address, vehicleCategory, timingType, pkg.weightKg, pricingRules]);

  const matchedDrivers = useMemo(
    () => rankSuitableDrivers(onlineDrivers, pickup.lat, pickup.lng, vehicleCategory, pkg.weightKg),
    [onlineDrivers, pickup.lat, pickup.lng, vehicleCategory, pkg.weightKg]
  );

  const selectedDelivery = useMemo(
    () => deliveries.find((d) => d.id === selectedDeliveryId) || null,
    [deliveries, selectedDeliveryId]
  );

  // Polyline for selected delivery drawer
  useEffect(() => {
    if (!selectedDelivery || selectedStops.length === 0) {
      setSelectedPolyline([]);
      return;
    }
    let cancelled = false;
    const coords = [
      { lat: selectedDelivery.pickupLat, lng: selectedDelivery.pickupLng },
      ...selectedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];
    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coords }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.geometry)) setSelectedPolyline(data.geometry);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedDelivery?.id, selectedStops.length]);

  const handleAddStop = () => {
    if (!draftStop.recipientName.trim() || !draftStop.address.trim()) {
      flash(t('Indiquez le nom du destinataire et l’adresse.', 'Enter recipient name and address.'));
      return;
    }
    setStops((prev) => [
      ...prev,
      {
        ...draftStop,
        id: `s_${Date.now()}_${prev.length + 1}`,
        recipientPhone: draftStop.recipientPhone.trim() || '+225 07 00 00 00 00',
      },
    ]);
    setDraftStop({
      id: 'tmp',
      recipientName: '',
      recipientPhone: '',
      address: '',
      landmark: '',
      digitalAddress: '',
      instructions: '',
      packageRef: '',
      lat: pickup.lat + 0.015,
      lng: pickup.lng + 0.015,
    });
  };

  const handleOptimizeStops = async () => {
    if (stops.length < 2) return;
    try {
      const res = await fetch('/api/geo/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: pickup.lat, lng: pickup.lng },
          stops: stops.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
        }),
      });
      const data = await res.json();
      if (Array.isArray(data.orderedIds)) {
        const mapById = new Map(stops.map((s) => [s.id, s]));
        const reordered = data.orderedIds
          .map((id: string) => mapById.get(id))
          .filter(Boolean) as DraftStop[];
        if (reordered.length === stops.length) {
          setStops(reordered);
          flash(t('Ordre des arrêts optimisé selon la distance.', 'Stop order optimized by distance.'));
        }
      }
    } catch {
      // Ignore network hiccup
    }
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const imported: DraftStop[] = [];
      lines.slice(1).forEach((line, idx) => {
        const [name, phone, address, latStr, lngStr] = line.split(',').map((c) => c.trim());
        if (!name || !address) return;
        const lat = Number(latStr);
        const lng = Number(lngStr);
        imported.push({
          id: `csv_${Date.now()}_${idx}`,
          recipientName: name,
          recipientPhone: phone || '+225 07 00 00 00 00',
          address,
          landmark: '',
          digitalAddress: '',
          instructions: '',
          packageRef: `CSV-${idx + 1}`,
          lat: Number.isFinite(lat) ? lat : pickup.lat + (idx + 1) * 0.008,
          lng: Number.isFinite(lng) ? lng : pickup.lng + (idx + 1) * 0.006,
        });
      });
      if (imported.length > 0) {
        setStops((prev) => [...prev, ...imported]);
        flash(t(`${imported.length} arrêt(s) importé(s) depuis CSV.`, `Imported ${imported.length} stop(s) from CSV.`));
      }
    };
    reader.readAsText(file);
  };

  const handleCreateDelivery = async () => {
    if (!requireSignedIn()) return;
    const finalStops = stops.length > 0 ? stops : draftStop.recipientName && draftStop.address ? [draftStop] : [];
    if (!pickup.address.trim() || finalStops.length === 0) {
      flash(t('Ajoutez une adresse de collecte et au moins un destinataire.', 'Add a pickup address and at least one stop.'));
      return;
    }

    setBusy(true);
    try {
      const deliveryRef = doc(collection(db, 'deliveries'));
      const reference = generateReference('RV');
      const matched = matchedDrivers.find((m) => m.driver.uid === selectedDriverUid)?.driver || null;
      const initialStatus: DeliveryRecord['status'] = matched
        ? 'driver_assigned'
        : timingType === 'scheduled'
        ? 'scheduled'
        : 'pending';

      const preparedStops = finalStops.slice(0, 50).map((s, idx) => {
        const stopDocRef = doc(collection(db, 'deliveries', deliveryRef.id, 'stops'));
        return {
          stopRef: stopDocRef,
          stopId: stopDocRef.id,
          sequence: idx + 1,
          otpCode: generateOtp(),
          trackingToken: generateTrackingToken(),
          data: s,
        };
      });

      const rule = getEffectivePricingRule(pricingRules, vehicleCategory);
      const deliveryPayload: Record<string, unknown> = {
        reference,
        ...(business?.id ? { businessId: business.id } : {}),
        merchantUid: uid,
        merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
        driverUid: matched ? matched.uid : '',
        ...(matched ? { driverName: matched.firstName.slice(0, 120) } : {}),
        vehicleCategory,
        timingType,
        ...(scheduledFor.trim() ? { scheduledFor: scheduledFor.trim().slice(0, 60) } : {}),
        pickupAddress: pickup.address.trim().slice(0, 300),
        ...(pickup.landmark.trim() ? { pickupLandmark: pickup.landmark.trim().slice(0, 200) } : {}),
        ...(pickup.digitalAddress.trim() ? { pickupDigitalAddress: pickup.digitalAddress.trim().slice(0, 60) } : {}),
        ...(pickup.instructions.trim() ? { pickupInstructions: pickup.instructions.trim().slice(0, 300) } : {}),
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        primaryDestinationLabel: preparedStops[0].data.address.slice(0, 240),
        stopIds: preparedStops.map((p) => p.stopId),
        packageType: pkg.packageType.trim().slice(0, 80) || 'Colis',
        packageSize: pkg.packageSize,
        weightKg: Math.max(0.5, Number(pkg.weightKg) || 1),
        quantity: Math.max(1, Math.floor(Number(pkg.quantity) || 1)),
        fragile: pkg.fragile,
        ...(pkg.specialHandling.trim() ? { specialHandling: pkg.specialHandling.trim().slice(0, 240) } : {}),
        proofRequired: pkg.proofRequired,
        status: initialStatus,
        isMultiStop: preparedStops.length > 1,
        stopCount: preparedStops.length,
        completedStopCount: 0,
        totalDistanceKm: Number(routeMetrics.distanceKm.toFixed(2)),
        estimatedDurationMin: Math.round(routeMetrics.durationMin),
        quotedPrice: quote?.total ?? rule.minimumFare,
        currency: quote?.currency || rule.currency,
        paymentMethod,
        paymentStatus: paymentMethod === 'invoice' ? 'invoiced' : 'authorized',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Step 1: Commit parent delivery first so stops rules `exists(/deliveries/{id})` passes
      await setDoc(deliveryRef, deliveryPayload);

      // Step 2: Commit stops + isolated publicTracking projections atomically
      const batch = writeBatch(db);
      for (const ps of preparedStops) {
        const s = ps.data;
        batch.set(ps.stopRef, {
          deliveryId: deliveryRef.id,
          merchantUid: uid,
          driverUid: matched ? matched.uid : '',
          sequence: ps.sequence,
          recipientName: s.recipientName.trim().slice(0, 120),
          recipientPhone: (s.recipientPhone.trim() || '+225 07 00 00 00 00').slice(0, 40),
          address: s.address.trim().slice(0, 300),
          ...(s.landmark.trim() ? { landmark: s.landmark.trim().slice(0, 200) } : {}),
          ...(s.digitalAddress.trim() ? { digitalAddress: s.digitalAddress.trim().slice(0, 60) } : {}),
          ...(s.instructions.trim() ? { instructions: s.instructions.trim().slice(0, 300) } : {}),
          lat: s.lat,
          lng: s.lng,
          ...(s.packageRef.trim() ? { packageRef: s.packageRef.trim().slice(0, 80) } : {}),
          status: initialStatus,
          otpCode: ps.otpCode,
          trackingToken: ps.trackingToken,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const recFirst = s.recipientName.trim().split(' ')[0] || 'Client';
        batch.set(doc(db, 'publicTracking', ps.trackingToken), {
          trackingToken: ps.trackingToken,
          deliveryId: deliveryRef.id,
          stopId: ps.stopId,
          merchantUid: uid,
          driverUid: matched ? matched.uid : '',
          reference,
          recipientFirstName: recFirst.slice(0, 80),
          destinationLabel: s.address.trim().slice(0, 300),
          destinationLat: s.lat,
          destinationLng: s.lng,
          status: initialStatus,
          ...(matched ? { driverFirstName: matched.firstName.slice(0, 80) } : {}),
          vehicleCategory,
          showLiveDriver: Boolean(matched && ps.sequence === 1),
          otpHint: ps.otpCode,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();

      setStops([]);
      setStep(1);
      setSelectedDeliveryId(deliveryRef.id);
      setSection('deliveries');
      flash(t(`Livraison ${reference} créée avec succès !`, `Delivery ${reference} created!`));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'deliveries');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireSignedIn()) return;

    // Overlap conflict check
    const conflict = reservations.find(
      (r) =>
        r.status !== 'cancelled' &&
        r.reservationDate === resForm.reservationDate &&
        r.vehicleCategory === resForm.vehicleCategory &&
        !(resForm.endTime <= r.startTime || resForm.startTime >= r.endTime)
    );
    if (conflict) {
      flash(
        t(
          'Créneau déjà réservé pour cette catégorie de véhicule. Choisissez une autre heure.',
          'Time slot conflicts with an existing reservation for this vehicle class.'
        )
      );
      return;
    }

    setBusy(true);
    try {
      const rule = getEffectivePricingRule(pricingRules, resForm.vehicleCategory);
      const price = resForm.durationType === 'full_day' ? rule.fullDayRate : rule.baseFee + rule.scheduledFee * 4;
      await addDoc(collection(db, 'reservations'), {
        ...(business?.id ? { businessId: business.id } : {}),
        merchantUid: uid,
        merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
        vehicleCategory: resForm.vehicleCategory,
        driverUid: '',
        reservationDate: resForm.reservationDate,
        startTime: resForm.startTime,
        endTime: resForm.endTime,
        durationType: resForm.durationType,
        pickupAddress: resForm.pickupAddress.trim().slice(0, 300),
        pickupLat: resForm.pickupLat,
        pickupLng: resForm.pickupLng,
        ...(resForm.destinationsSummary.trim()
          ? { destinationsSummary: resForm.destinationsSummary.trim().slice(0, 400) }
          : {}),
        ...(resForm.cargoRequirements.trim()
          ? { cargoRequirements: resForm.cargoRequirements.trim().slice(0, 300) }
          : {}),
        quotedPrice: price,
        currency: rule.currency,
        status: 'pending_approval',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      flash(t('Demande de réservation envoyée au Centre d’Opérations.', 'Reservation sent to Operations.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'reservations');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireSignedIn()) return;
    if (!bizForm.name.trim()) return;
    setBusy(true);
    try {
      if (business) {
        await updateDoc(doc(db, 'businesses', business.id), {
          name: bizForm.name.trim().slice(0, 160),
          industry: bizForm.industry.trim().slice(0, 80),
          city: bizForm.city.trim().slice(0, 100),
          country: bizForm.country.trim().slice(0, 80),
          currency: bizForm.currency.trim().slice(0, 8),
          defaultPickupAddress: bizForm.defaultPickupAddress.trim().slice(0, 300),
          updatedAt: serverTimestamp(),
        });
      } else {
        const ref = await addDoc(collection(db, 'businesses'), {
          ownerId: uid,
          name: bizForm.name.trim().slice(0, 160),
          industry: bizForm.industry.trim().slice(0, 80),
          city: bizForm.city.trim().slice(0, 100),
          country: bizForm.country.trim().slice(0, 80),
          currency: bizForm.currency.trim().slice(0, 8),
          verificationStatus: 'pending',
          walletBalance: 0,
          defaultPickupAddress: bizForm.defaultPickupAddress.trim().slice(0, 300),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateProfileFields({ businessId: ref.id });
      }
      flash(t('Profil entreprise enregistré.', 'Business profile saved.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'businesses');
    } finally {
      setBusy(false);
    }
  };

  const handleAddRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireSignedIn()) return;
    if (!business) {
      flash(t('Enregistrez d’abord votre profil entreprise dans Paramètres.', 'Save your business profile in Settings first.'));
      setSection('settings');
      return;
    }
    if (!recForm.name.trim() || !recForm.address.trim()) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'businesses', business.id, 'recipients'), {
        ownerId: uid,
        name: recForm.name.trim().slice(0, 120),
        phone: (recForm.phone.trim() || '+225 07 00 00 00 00').slice(0, 40),
        address: recForm.address.trim().slice(0, 300),
        ...(recForm.landmark.trim() ? { landmark: recForm.landmark.trim().slice(0, 200) } : {}),
        lat: recForm.lat,
        lng: recForm.lng,
        createdAt: serverTimestamp(),
      });
      setRecForm({ name: '', phone: '', address: '', landmark: '', lat: 5.348, lng: -3.998 });
      flash(t('Destinataire ajouté au carnet.', 'Recipient saved.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `businesses/${business.id}/recipients`);
    } finally {
      setBusy(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireSignedIn() || !business) return;
    if (!memberForm.name.trim() || !memberForm.email.trim()) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'businesses', business.id, 'members'), {
        ownerId: uid,
        name: memberForm.name.trim().slice(0, 120),
        email: memberForm.email.trim().slice(0, 200),
        memberRole: memberForm.memberRole,
        status: 'invited',
        createdAt: serverTimestamp(),
      });
      setMemberForm({ name: '', email: '', memberRole: 'employee' });
      flash(t('Invitation collaborateur créée.', 'Team invitation created.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `businesses/${business.id}/members`);
    } finally {
      setBusy(false);
    }
  };

  const copyTrackingUrl = (token: string) => {
    const url = `${window.location.origin}${window.location.pathname}?track=${token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedToken(token);
    window.setTimeout(() => setCopiedToken((p) => (p === token ? null : p)), 2500);
  };

  const filteredDeliveries = useMemo(() => {
    if (deliveryFilter === 'all') return deliveries;
    if (deliveryFilter === 'active') {
      return deliveries.filter((d) => !['delivered', 'failed', 'cancelled', 'scheduled'].includes(d.status));
    }
    if (deliveryFilter === 'scheduled') return deliveries.filter((d) => d.status === 'scheduled');
    return deliveries.filter((d) => d.status === 'delivered');
  }, [deliveries, deliveryFilter]);

  const unreadNotifs = notifications.filter((n) => !n.read).length;
  const totalSpend = deliveries
    .filter((d) => d.status !== 'cancelled')
    .reduce((acc, d) => acc + d.quotedPrice, 0);

  const navItems: Array<{
    id: MerchantSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: t('Tableau de bord', 'Overview'), icon: Home },
    { id: 'create', label: t('Nouvelle livraison', 'New Delivery'), icon: Plus },
    { id: 'deliveries', label: t('Mes livraisons', 'Deliveries'), icon: Package },
    { id: 'reservations', label: t('Réservations', 'Reservations'), icon: Calendar },
    { id: 'recipients', label: t('Carnet d’adresses', 'Address Book'), icon: MapPin },
    { id: 'finance', label: t('Paiements & Factures', 'Payments & Billing'), icon: CreditCard },
    { id: 'settings', label: t('Entreprise & Équipe', 'Business & Team'), icon: Settings },
  ];

  const createMarkers: MapMarkerItem[] = [
    { id: 'pk', lat: pickup.lat, lng: pickup.lng, kind: 'pickup', label: pickup.address || 'Collecte', draggable: true },
    ...stops.map((s, idx) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      kind: 'stop' as const,
      sequence: idx + 1,
      label: `#${idx + 1} ${s.recipientName}`,
    })),
  ];

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-950 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r border-neutral-200 bg-white shrink-0">
        <div className="h-16 px-6 flex items-center justify-between border-b border-neutral-200">
          <div>
            <span className="font-display text-base font-extrabold tracking-[0.2em]">ROVA</span>
            <p className="text-[11px] text-neutral-500">{t('Espace Marchand', 'Merchant Workspace')}</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm transition-colors ${
                  active ? 'bg-neutral-950 text-white font-medium' : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-neutral-200 space-y-3">
          {workspaceSwitcher}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">
                {business?.name || profile?.displayName || t('Compte Marchand', 'Merchant Preview')}
              </p>
              <p className="text-[11px] text-neutral-500 truncate">
                {uid ? firebaseUser?.email : t('Aperçu · Départ à zéro', 'Preview · Fresh start')}
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

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-neutral-200">
          <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
            <h1 className="font-display text-base font-bold tracking-tight truncate">
              {navItems.find((n) => n.id === section)?.label}
            </h1>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSection('create')}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('Expédier', 'Dispatch')}
              </button>
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-2 rounded-full border border-neutral-200 hover:border-neutral-950"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifs > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-neutral-950 text-white text-[10px] font-mono flex items-center justify-center">
                    {unreadNotifs}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Mobile Nav */}
          <div className="lg:hidden flex overflow-x-auto border-t border-neutral-100 px-3 py-2 gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border ${
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

        {!uid && (
          <div className="bg-white border-b border-neutral-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-neutral-700">
              {t(
                'Départ à zéro — Explorez librement l’Espace Marchand et connectez-vous avec Google lorsque vous souhaitez enregistrer vos livraisons.',
                'Starting fresh — Explore the Merchant Workspace freely and sign in with Google to save live deliveries.'
              )}
            </p>
            <button
              type="button"
              onClick={onRequestSignIn}
              className="px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
            >
              {t('Connexion Google', 'Google Sign-In')}
            </button>
          </div>
        )}

        {banner && (
          <div className="bg-neutral-950 text-white px-4 sm:px-6 py-2.5 text-xs flex items-center justify-between">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner(null)} className="text-neutral-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {notifOpen && (
          <div className="bg-white border-b border-neutral-200 px-4 sm:px-6 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{t('Notifications', 'Notifications')}</p>
              <button type="button" onClick={() => setNotifOpen(false)} className="text-xs text-neutral-500">
                {t('Fermer', 'Close')}
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-neutral-500">{t('Aucune notification (0).', 'No notifications (0).')}</p>
            ) : (
              notifications.slice(0, 5).map((n) => (
                <div key={n.id} className="rounded-xl bg-neutral-50 p-3 text-xs">
                  <p className="font-semibold">{n.title}</p>
                  <p className="text-neutral-600">{n.message}</p>
                </div>
              ))
            )}
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          {/* 1. OVERVIEW */}
          {section === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: t('Livraisons totales', 'Total Deliveries'), value: deliveries.length },
                  {
                    label: t('En cours', 'Active'),
                    value: deliveries.filter((d) => !['delivered', 'failed', 'cancelled'].includes(d.status)).length,
                  },
                  { label: t('Réservations', 'Reservations'), value: reservations.length },
                  { label: t('Dépenses totales', 'Total Spend'), value: formatMoney(totalSpend, 'GHS') },
                ].map((k) => (
                  <div key={k.label} className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-1">
                    <p className="text-xs text-neutral-500">{k.label}</p>
                    <p className="font-mono text-2xl font-bold tabular-nums">{k.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-3xl bg-neutral-950 text-white p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1.5">
                  <h2 className="font-display text-xl font-bold">
                    {t('Prêt à lancer votre première livraison ?', 'Ready to dispatch your first delivery?')}
                  </h2>
                  <p className="text-xs sm:text-sm text-neutral-300">
                    {t(
                      'Course instantanée, tournée multi-arrêts ou réservation de fourgon avec devis instantané.',
                      'Instant dispatch, multi-stop tour, or scheduled van reservation with live pricing.'
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSection('create')}
                    className="px-5 py-2.5 rounded-full bg-white text-neutral-950 text-xs font-semibold hover:bg-neutral-200"
                  >
                    {t('Créer une livraison', 'Create delivery')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('reservations')}
                    className="px-5 py-2.5 rounded-full border border-neutral-700 text-white text-xs font-medium hover:border-white"
                  >
                    {t('Réserver un véhicule', 'Reserve vehicle')}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-neutral-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold">
                    {t('Livraisons récentes', 'Recent Deliveries')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSection('deliveries')}
                    className="text-xs text-neutral-500 hover:text-neutral-950"
                  >
                    {t('Tout voir', 'View all')} →
                  </button>
                </div>
                {deliveries.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <Package className="w-6 h-6 mx-auto text-neutral-400" />
                    <p className="text-sm font-semibold">
                      {t('Aucune livraison pour le moment (0)', 'No deliveries yet (0)')}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {t(
                        'Utilisez le créateur de livraison en 7 étapes pour expédier votre premier colis.',
                        'Use the 7-step delivery builder to dispatch your first parcel.'
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {deliveries.slice(0, 6).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          setSelectedDeliveryId(d.id);
                          setSection('deliveries');
                        }}
                        className="w-full p-4 hover:bg-neutral-50 flex items-center justify-between gap-3 text-left"
                      >
                        <div>
                          <p className="font-mono text-xs font-bold">{d.reference}</p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            {d.pickupAddress} → {d.primaryDestinationLabel || `${d.stopCount} arrêt(s)`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-xs font-bold tabular-nums">
                            {formatMoney(d.quotedPrice, d.currency)}
                          </p>
                          <p className="text-[11px] text-neutral-500">{getStatusLabel(d.status, lang)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. 7-STEP DELIVERY CREATOR */}
          {section === 'create' && (
            <div className="space-y-6">
              {/* Stepper Pills */}
              <div className="flex overflow-x-auto gap-1.5 pb-1">
                {[
                  { n: 1, label: t('1. Collecte', '1. Pickup') },
                  { n: 2, label: t('2. Arrêts', '2. Stops') },
                  { n: 3, label: t('3. Colis', '3. Package') },
                  { n: 4, label: t('4. Véhicule', '4. Vehicle') },
                  { n: 5, label: t('5. Horaire & Livreur', '5. Schedule & Driver') },
                  { n: 6, label: '6. Payment Method' },
                  { n: 7, label: t('7. Confirmation', '7. Confirm') },
                ].map((s) => (
                  <button
                    key={s.n}
                    type="button"
                    onClick={() => setStep(s.n)}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      step === s.n
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Form Panel */}
                <div className="lg:col-span-7 rounded-3xl border border-neutral-200 bg-white p-6 space-y-5">
                  {step === 1 && (
                    <div className="space-y-4">
                      <h2 className="font-display text-lg font-bold">
                        {t('Point de collecte', 'Pickup location')}
                      </h2>
                      <input
                        type="text"
                        placeholder={t('Adresse complète de collecte', 'Full pickup address')}
                        value={pickup.address}
                        onChange={(e) => setPickup((p) => ({ ...p, address: e.target.value }))}
                        className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder={t('Repère proche (ex. Face pharmacie)', 'Nearby landmark')}
                          value={pickup.landmark}
                          onChange={(e) => setPickup((p) => ({ ...p, landmark: e.target.value }))}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                        <input
                          type="text"
                          placeholder={t('Instructions collecte', 'Pickup instructions')}
                          value={pickup.instructions}
                          onChange={(e) => setPickup((p) => ({ ...p, instructions: e.target.value }))}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-display text-lg font-bold">
                          {t('Destinataires & Multi-arrêts', 'Recipients & Multi-Stop')}
                        </h2>
                        <div className="flex gap-2">
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-300 text-xs cursor-pointer hover:border-neutral-950">
                            <Upload className="w-3.5 h-3.5" />
                            CSV
                            <input type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
                          </label>
                          {stops.length >= 2 && (
                            <button
                              type="button"
                              onClick={handleOptimizeStops}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-950 text-white text-xs"
                            >
                              <Route className="w-3.5 h-3.5" />
                              {t('Optimiser', 'Optimize')}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder={t('Nom du destinataire', 'Recipient name')}
                          value={draftStop.recipientName}
                          onChange={(e) => setDraftStop((p) => ({ ...p, recipientName: e.target.value }))}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                        <input
                          type="tel"
                          placeholder={t('Téléphone destinataire', 'Recipient phone')}
                          value={draftStop.recipientPhone}
                          onChange={(e) => setDraftStop((p) => ({ ...p, recipientPhone: e.target.value }))}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                        <input
                          type="text"
                          placeholder={t('Adresse de livraison', 'Delivery address')}
                          value={draftStop.address}
                          onChange={(e) => setDraftStop((p) => ({ ...p, address: e.target.value }))}
                          className="sm:col-span-2 rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleAddStop}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-950 text-xs font-semibold hover:bg-neutral-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t('Ajouter cet arrêt à la tournée', 'Add stop to route')}
                      </button>

                      {stops.length > 0 && (
                        <div className="space-y-2 pt-2">
                          {stops.map((s, idx) => (
                            <div
                              key={s.id}
                              className="rounded-2xl border border-neutral-200 p-3 flex items-center justify-between text-xs"
                            >
                              <div>
                                <p className="font-semibold">
                                  #{idx + 1} · {s.recipientName}
                                </p>
                                <p className="text-neutral-500">{s.address}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStops((prev) => prev.filter((x) => x.id !== s.id))}
                                className="p-1.5 text-neutral-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {step === 3 && (
                    <div className="space-y-4">
                      <h2 className="font-display text-lg font-bold">
                        {t('Détails du colis & Preuve de remise', 'Package & Proof of Delivery')}
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={pkg.packageType}
                          onChange={(e) => setPkg((p) => ({ ...p, packageType: e.target.value }))}
                          placeholder={t('Nature du colis', 'Package type')}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                        <select
                          value={pkg.packageSize}
                          onChange={(e) =>
                            setPkg((p) => ({ ...p, packageSize: e.target.value as DeliveryRecord['packageSize'] }))
                          }
                          className="rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-xs"
                        >
                          <option value="small">{t('Petit colis', 'Small')}</option>
                          <option value="medium">{t('Colis moyen', 'Medium')}</option>
                          <option value="large">{t('Grand carton', 'Large')}</option>
                          <option value="bulk">{t('Fret / Palette', 'Bulk / Pallet')}</option>
                        </select>
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={pkg.weightKg}
                          onChange={(e) => setPkg((p) => ({ ...p, weightKg: Number(e.target.value) }))}
                          placeholder={t('Poids (kg)', 'Weight (kg)')}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                        />
                        <select
                          value={pkg.proofRequired}
                          onChange={(e) => setPkg((p) => ({ ...p, proofRequired: e.target.value as ProofType }))}
                          className="rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-xs"
                        >
                          <option value="otp">{t('Code OTP destinataire', 'Recipient OTP Code')}</option>
                          <option value="signature">{t('Signature électronique', 'Digital Signature')}</option>
                          <option value="photo">{t('Photo à la remise', 'Delivery Photo')}</option>
                          <option value="recipient_confirm">{t('Confirmation directe', 'Direct Confirmation')}</option>
                        </select>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs text-neutral-700">
                        <input
                          type="checkbox"
                          checked={pkg.fragile}
                          onChange={(e) => setPkg((p) => ({ ...p, fragile: e.target.checked }))}
                          className="rounded"
                        />
                        {t('Contenu fragile / manipulation délicate', 'Fragile contents / careful handling')}
                      </label>
                    </div>
                  )}

                  {step === 4 && (
                    <div className="space-y-4">
                      <h2 className="font-display text-lg font-bold">
                        {t('Choisir la catégorie de véhicule', 'Select vehicle category')}
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {VEHICLE_CATALOG.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setVehicleCategory(v.id)}
                            className={`rounded-2xl border p-4 text-left transition-colors space-y-1 ${
                              vehicleCategory === v.id
                                ? 'border-neutral-950 bg-neutral-50'
                                : 'border-neutral-200 hover:border-neutral-400'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm">
                                {lang === 'fr' ? v.labelFr : v.label}
                              </span>
                              <span className="font-mono text-[11px] text-neutral-500">≤ {v.maxWeightKg} kg</span>
                            </div>
                            <p className="text-xs text-neutral-500">
                              {lang === 'fr' ? v.summaryFr : v.summary}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {step === 5 && (
                    <div className="space-y-4">
                      <h2 className="font-display text-lg font-bold">
                        {t('Planification & Livreurs en ligne', 'Timing & Online Drivers')}
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'instant', label: t('Instantanée', 'Instant') },
                          { id: 'scheduled', label: t('Planifiée', 'Scheduled') },
                          { id: 'full_day', label: t('Journée complète', 'Full Day') },
                        ].map((tm) => (
                          <button
                            key={tm.id}
                            type="button"
                            onClick={() => setTimingType(tm.id as TimingType)}
                            className={`px-4 py-2 rounded-full text-xs font-medium border ${
                              timingType === tm.id
                                ? 'bg-neutral-950 text-white border-neutral-950'
                                : 'bg-white border-neutral-300'
                            }`}
                          >
                            {tm.label}
                          </button>
                        ))}
                      </div>

                      {timingType === 'scheduled' && (
                        <input
                          type="datetime-local"
                          value={scheduledFor}
                          onChange={(e) => setScheduledFor(e.target.value)}
                          className="rounded-xl border border-neutral-300 px-3.5 py-2 text-xs"
                        />
                      )}

                      <div className="space-y-2 pt-2">
                        <p className="text-xs font-semibold text-neutral-700">
                          {t('Livreurs en ligne compatibles', 'Suitable online drivers')} ({matchedDrivers.length})
                        </p>
                        {matchedDrivers.length === 0 ? (
                          <p className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-xs text-neutral-600">
                            {t(
                              'Aucun livreur en ligne pour le moment. La course sera publiée sur le Radar livreur et visible par le Centre d’Opérations.',
                              'No online drivers right now. The delivery will be published to the Driver Radar and Operations Center.'
                            )}
                          </p>
                        ) : (
                          matchedDrivers.map((m) => (
                            <button
                              key={m.driver.uid}
                              type="button"
                              onClick={() =>
                                setSelectedDriverUid((p) => (p === m.driver.uid ? '' : m.driver.uid))
                              }
                              className={`w-full rounded-2xl border p-3.5 text-left flex items-center justify-between text-xs ${
                                selectedDriverUid === m.driver.uid
                                  ? 'border-neutral-950 bg-neutral-50'
                                  : 'border-neutral-200'
                              }`}
                            >
                              <div>
                                <p className="font-semibold">{m.driver.firstName}</p>
                                <p className="text-neutral-500">
                                  {m.distanceKm} km · ~{m.etaMinutes} min · ★ {m.driver.rating.toFixed(1)}
                                </p>
                              </div>
                              <span className="font-mono text-[11px]">
                                {selectedDriverUid === m.driver.uid ? t('Choisi', 'Selected') : t('Sélectionner', 'Select')}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* STEP 6: PAYMENT METHODS STRICTLY IN ENGLISH */}
                  {step === 6 && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="font-display text-lg font-bold">Select Payment Method</h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          Choose how this commercial delivery will be settled.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {PAYMENT_METHODS_EN.map((pm) => (
                          <button
                            key={pm.id}
                            type="button"
                            onClick={() => setPaymentMethod(pm.id)}
                            className={`rounded-2xl border p-4 text-left transition-colors space-y-1 ${
                              paymentMethod === pm.id
                                ? 'border-neutral-950 bg-neutral-50'
                                : 'border-neutral-200 hover:border-neutral-400'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm">{pm.label}</span>
                              {paymentMethod === pm.id && <Check className="w-4 h-4" />}
                            </div>
                            <p className="text-xs text-neutral-500">{pm.subtitle}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {step === 7 && (
                    <div className="space-y-4">
                      <h2 className="font-display text-lg font-bold">
                        {t('Récapitulatif de la livraison', 'Delivery summary')}
                      </h2>
                      <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 space-y-2 text-xs">
                        <p>
                          <strong>{t('Collecte', 'Pickup')}:</strong> {pickup.address}
                        </p>
                        <p>
                          <strong>{t('Arrêts', 'Stops')}:</strong> {stops.length || (draftStop.address ? 1 : 0)}
                        </p>
                        <p>
                          <strong>{t('Véhicule', 'Vehicle')}:</strong> {getVehicleLabel(vehicleCategory, lang)}
                        </p>
                        <p>
                          <strong>Payment Method:</strong> {getPaymentMethodLabelEn(paymentMethod)}
                        </p>
                        <p className="font-mono text-sm font-bold pt-2 border-t border-neutral-200">
                          {t('Total estimé', 'Estimated total')}:{' '}
                          {formatMoney(quote?.total || 0, quote?.currency || 'GHS')}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleCreateDelivery}
                        className="w-full py-3.5 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {busy
                          ? t('Création en cours...', 'Publishing...')
                          : uid
                          ? t('Confirmer et lancer la livraison', 'Confirm & dispatch delivery')
                          : t('Connexion Google pour publier', 'Sign in with Google to dispatch')}
                      </button>
                    </div>
                  )}

                  {/* Stepper Next / Prev */}
                  <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
                    <button
                      type="button"
                      disabled={step === 1}
                      onClick={() => setStep((s) => Math.max(1, s - 1))}
                      className="px-4 py-2 rounded-full border border-neutral-300 text-xs font-medium disabled:opacity-30"
                    >
                      {t('Précédent', 'Previous')}
                    </button>
                    {step < 7 && (
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.min(7, s + 1))}
                        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800"
                      >
                        {t('Continuer', 'Next')}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Right Live Map & Quote Panel */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="rounded-3xl border border-neutral-200 bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs px-1">
                      <span className="font-semibold">{t('Carte d’itinéraire', 'Route Map')}</span>
                      <span className="font-mono text-neutral-500">
                        {routeMetrics.distanceKm.toFixed(1)} km · ~{Math.round(routeMetrics.durationMin)} min
                      </span>
                    </div>
                    <RovaMap
                      center={[pickup.lat, pickup.lng]}
                      zoom={12}
                      markers={createMarkers}
                      routeCoordinates={routeMetrics.geometry}
                      interactivePick
                      showSearchBar
                      onLocationSelected={(place) => {
                        if (step === 1) {
                          setPickup((p) => ({
                            ...p,
                            address: place.displayName,
                            lat: place.lat,
                            lng: place.lng,
                          }));
                        } else {
                          setDraftStop((p) => ({
                            ...p,
                            address: place.displayName,
                            lat: place.lat,
                            lng: place.lng,
                          }));
                        }
                      }}
                      heightClass="h-[300px]"
                    />
                  </div>

                  {quote && (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-2.5 text-xs">
                      <p className="font-semibold text-sm">{t('Devis en temps réel', 'Live Quote')}</p>
                      <div className="space-y-1 text-neutral-600">
                        {quote.breakdown.map((b, i) => (
                          <div key={i} className="flex justify-between">
                            <span>{b.label}</span>
                            <span className="font-mono tabular-nums">{formatMoney(b.amount, quote.currency)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-2.5 border-t border-neutral-200 flex justify-between font-semibold text-sm">
                        <span>{t('Total', 'Total')}</span>
                        <span className="font-mono tabular-nums">{formatMoney(quote.total, quote.currency)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3. DELIVERIES LIST & TRACKING DRAWER */}
          {section === 'deliveries' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {(['all', 'active', 'scheduled', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDeliveryFilter(f)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium border ${
                      deliveryFilter === f
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white border-neutral-300 text-neutral-700'
                    }`}
                  >
                    {f === 'all'
                      ? t('Toutes', 'All')
                      : f === 'active'
                      ? t('En cours', 'Active')
                      : f === 'scheduled'
                      ? t('Planifiées', 'Scheduled')
                      : t('Livrées', 'Delivered')}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 space-y-3">
                  {filteredDeliveries.length === 0 ? (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center space-y-2">
                      <Package className="w-6 h-6 mx-auto text-neutral-400" />
                      <p className="text-sm font-semibold">
                        {t('Aucune livraison dans cette vue (0)', 'No deliveries here (0)')}
                      </p>
                    </div>
                  ) : (
                    filteredDeliveries.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedDeliveryId(d.id)}
                        className={`w-full text-left rounded-3xl border p-5 transition-colors space-y-2 ${
                          selectedDeliveryId === d.id
                            ? 'border-neutral-950 bg-white shadow-xs'
                            : 'border-neutral-200 bg-white hover:border-neutral-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-bold">{d.reference}</span>
                          <span className="font-mono text-xs font-bold tabular-nums">
                            {formatMoney(d.quotedPrice, d.currency)}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600">{d.pickupAddress}</p>
                        <div className="flex items-center justify-between text-[11px] text-neutral-500">
                          <span>{getStatusLabel(d.status, lang)}</span>
                          <span>{getPaymentMethodLabelEn(d.paymentMethod)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="lg:col-span-6">
                  {selectedDelivery ? (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-mono text-base font-bold">{selectedDelivery.reference}</h3>
                          <p className="text-xs text-neutral-500">
                            {getStatusLabel(selectedDelivery.status, lang)} ·{' '}
                            {getVehicleLabel(selectedDelivery.vehicleCategory, lang)}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-neutral-600">
                          {getPaymentMethodLabelEn(selectedDelivery.paymentMethod)}
                        </span>
                      </div>

                      <RovaMap
                        center={[selectedDelivery.pickupLat, selectedDelivery.pickupLng]}
                        zoom={12}
                        markers={[
                          {
                            id: 'pk',
                            lat: selectedDelivery.pickupLat,
                            lng: selectedDelivery.pickupLng,
                            kind: 'pickup',
                            label: selectedDelivery.pickupAddress,
                          },
                          ...selectedStops.map((s) => ({
                            id: s.id,
                            lat: s.lat,
                            lng: s.lng,
                            kind: 'stop' as const,
                            sequence: s.sequence,
                            label: `#${s.sequence} ${s.recipientName}`,
                          })),
                        ]}
                        routeCoordinates={selectedPolyline}
                        heightClass="h-[240px]"
                      />

                      <div className="space-y-2.5">
                        <p className="text-xs font-semibold">
                          {t('Arrêts & Liens destinataires isolés', 'Stops & Isolated Recipient Links')}
                        </p>
                        {selectedStops.map((s) => (
                          <div key={s.id} className="rounded-2xl border border-neutral-200 p-3.5 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">
                                #{s.sequence} · {s.recipientName}
                              </span>
                              <span className="font-mono text-[11px]">OTP: {s.otpCode}</span>
                            </div>
                            <p className="text-neutral-600">{s.address}</p>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => copyTrackingUrl(s.trackingToken)}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-neutral-300 hover:border-neutral-950"
                              >
                                <Copy className="w-3 h-3" />
                                {copiedToken === s.trackingToken ? t('Copié !', 'Copied!') : t('Copier le lien', 'Copy link')}
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenTracking(s.trackingToken)}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-950 text-white"
                              >
                                <ExternalLink className="w-3 h-3" />
                                {t('Ouvrir le suivi', 'Open tracking')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center text-xs text-neutral-500">
                      {t('Sélectionnez une livraison pour consulter son itinéraire et ses liens destinataires.', 'Select a delivery to inspect its route and recipient links.')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 4. RESERVATIONS */}
          {section === 'reservations' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form
                onSubmit={handleCreateReservation}
                className="lg:col-span-5 rounded-3xl border border-neutral-200 bg-white p-6 space-y-4 h-fit"
              >
                <h2 className="font-display text-base font-bold">
                  {t('Réserver un véhicule ROVA', 'Reserve a ROVA Vehicle')}
                </h2>
                <select
                  value={resForm.vehicleCategory}
                  onChange={(e) => setResForm((p) => ({ ...p, vehicleCategory: e.target.value as VehicleCategory }))}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-xs"
                >
                  {VEHICLE_CATALOG.map((v) => (
                    <option key={v.id} value={v.id}>
                      {lang === 'fr' ? v.labelFr : v.label} (≤ {v.maxWeightKg} kg)
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    required
                    value={resForm.reservationDate}
                    onChange={(e) => setResForm((p) => ({ ...p, reservationDate: e.target.value }))}
                    className="rounded-xl border border-neutral-300 px-2.5 py-2 text-xs"
                  />
                  <input
                    type="time"
                    required
                    value={resForm.startTime}
                    onChange={(e) => setResForm((p) => ({ ...p, startTime: e.target.value }))}
                    className="rounded-xl border border-neutral-300 px-2.5 py-2 text-xs"
                  />
                  <input
                    type="time"
                    required
                    value={resForm.endTime}
                    onChange={(e) => setResForm((p) => ({ ...p, endTime: e.target.value }))}
                    className="rounded-xl border border-neutral-300 px-2.5 py-2 text-xs"
                  />
                </div>
                <input
                  type="text"
                  required
                  placeholder={t('Adresse de départ', 'Pickup address')}
                  value={resForm.pickupAddress}
                  onChange={(e) => setResForm((p) => ({ ...p, pickupAddress: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <textarea
                  rows={2}
                  placeholder={t('Destinations prévues / besoins cargo', 'Planned stops / cargo notes')}
                  value={resForm.destinationsSummary}
                  onChange={(e) => setResForm((p) => ({ ...p, destinationsSummary: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800"
                >
                  {t('Envoyer la réservation', 'Submit reservation')}
                </button>
              </form>

              <div className="lg:col-span-7 space-y-3">
                <h3 className="font-display text-base font-bold">
                  {t('Mes réservations', 'My Reservations')} ({reservations.length})
                </h3>
                {reservations.length === 0 ? (
                  <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center text-xs text-neutral-500">
                    {t('Aucune réservation planifiée (0).', 'No scheduled reservations (0).')}
                  </div>
                ) : (
                  reservations.map((r) => (
                    <div key={r.id} className="rounded-3xl border border-neutral-200 bg-white p-5 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-semibold text-sm">{getVehicleLabel(r.vehicleCategory, lang)}</p>
                        <p className="text-neutral-500 font-mono">
                          {r.reservationDate} · {r.startTime}–{r.endTime}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold">{formatMoney(r.quotedPrice, r.currency)}</p>
                        <p className="text-neutral-500">{r.status}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 5. SAVED RECIPIENTS */}
          {section === 'recipients' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form
                onSubmit={handleAddRecipient}
                className="lg:col-span-5 rounded-3xl border border-neutral-200 bg-white p-6 space-y-3 h-fit"
              >
                <h2 className="font-display text-base font-bold">
                  {t('Ajouter un destinataire', 'Add Saved Recipient')}
                </h2>
                <input
                  type="text"
                  required
                  placeholder={t('Nom complet', 'Full name')}
                  value={recForm.name}
                  onChange={(e) => setRecForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <input
                  type="tel"
                  required
                  placeholder={t('Téléphone', 'Phone')}
                  value={recForm.phone}
                  onChange={(e) => setRecForm((p) => ({ ...p, phone: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <input
                  type="text"
                  required
                  placeholder={t('Adresse', 'Address')}
                  value={recForm.address}
                  onChange={(e) => setRecForm((p) => ({ ...p, address: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold"
                >
                  {t('Enregistrer', 'Save recipient')}
                </button>
              </form>

              <div className="lg:col-span-7 space-y-3">
                {recipients.length === 0 ? (
                  <div className="rounded-3xl border border-neutral-200 bg-white p-12 text-center text-xs text-neutral-500">
                    {t('Carnet de destinataires vide (0).', 'No saved recipients yet (0).')}
                  </div>
                ) : (
                  recipients.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-3xl border border-neutral-200 bg-white p-4 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-semibold text-sm">{r.name}</p>
                        <p className="text-neutral-500">
                          {r.address} · {r.phone}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!business) return;
                          deleteDoc(doc(db, 'businesses', business.id, 'recipients', r.id)).catch(() => {});
                        }}
                        className="p-2 text-neutral-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 6. FINANCE & PAYMENT METHODS (STRICTLY IN ENGLISH) */}
          {section === 'finance' && (
            <div className="space-y-6">
              <div className="rounded-3xl border border-neutral-200 bg-white p-6 space-y-4">
                <div>
                  <h2 className="font-display text-lg font-bold">Payment Methods & Providers</h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Payment channels available for your business account (English standard).
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  {PAYMENT_METHODS_EN.map((pm) => (
                    <div key={pm.id} className="rounded-2xl border border-neutral-200 p-4 space-y-1">
                      <p className="font-semibold text-sm">{pm.label}</p>
                      <p className="text-xs text-neutral-500">{pm.subtitle}</p>
                    </div>
                  ))}
                </div>
                {paymentProviders.length > 0 && (
                  <div className="pt-3 border-t border-neutral-100 flex flex-wrap gap-3 text-xs text-neutral-600">
                    {paymentProviders.map((prov) => (
                      <span key={prov.id} className="font-mono">
                        {prov.name} ({prov.status})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-neutral-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-neutral-100 font-display text-sm font-bold">
                  {t('Historique de facturation', 'Billing History')}
                </div>
                {deliveries.length === 0 ? (
                  <p className="p-10 text-center text-xs text-neutral-500">
                    {t('Aucune facture émise (0).', 'No invoices yet (0).')}
                  </p>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {deliveries.map((d) => (
                      <div key={d.id} className="p-4 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-mono font-bold">{d.reference}</p>
                          <p className="text-neutral-500">
                            {getPaymentMethodLabelEn(d.paymentMethod)} · {d.paymentStatus}
                          </p>
                        </div>
                        <span className="font-mono font-bold tabular-nums">
                          {formatMoney(d.quotedPrice, d.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 7. BUSINESS SETTINGS & TEAM */}
          {section === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form
                onSubmit={handleSaveBusiness}
                className="rounded-3xl border border-neutral-200 bg-white p-6 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <h2 className="font-display text-base font-bold">
                    {t('Profil de l’entreprise', 'Business Profile')}
                  </h2>
                </div>
                <input
                  type="text"
                  required
                  placeholder={t('Nom de l’entreprise', 'Business name')}
                  value={bizForm.name}
                  onChange={(e) => setBizForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder={t('Ville', 'City')}
                    value={bizForm.city}
                    onChange={(e) => setBizForm((p) => ({ ...p, city: e.target.value }))}
                    className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                  />
                  <input
                    type="text"
                    placeholder={t('Pays', 'Country')}
                    value={bizForm.country}
                    onChange={(e) => setBizForm((p) => ({ ...p, country: e.target.value }))}
                    className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                  />
                </div>
                <input
                  type="text"
                  placeholder={t('Adresse de collecte par défaut', 'Default pickup address')}
                  value={bizForm.defaultPickupAddress}
                  onChange={(e) => setBizForm((p) => ({ ...p, defaultPickupAddress: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-6 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold"
                >
                  {t('Enregistrer l’entreprise', 'Save business')}
                </button>
              </form>

              <div className="rounded-3xl border border-neutral-200 bg-white p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  <h2 className="font-display text-base font-bold">
                    {t('Équipe & Collaborateurs', 'Team Members')}
                  </h2>
                </div>
                <form onSubmit={handleInviteMember} className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      placeholder={t('Nom', 'Name')}
                      value={memberForm.name}
                      onChange={(e) => setMemberForm((p) => ({ ...p, name: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                    <input
                      type="email"
                      required
                      placeholder={t('E-mail', 'Email')}
                      value={memberForm.email}
                      onChange={(e) => setMemberForm((p) => ({ ...p, email: e.target.value }))}
                      className="rounded-xl border border-neutral-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!business || busy}
                    className="px-5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium disabled:opacity-40"
                  >
                    {t('Inviter', 'Invite member')}
                  </button>
                </form>

                {members.length === 0 ? (
                  <p className="text-xs text-neutral-500">
                    {t('Aucun collaborateur invité (0).', 'No team members invited (0).')}
                  </p>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {members.map((m) => (
                      <div key={m.id} className="py-2.5 flex justify-between text-xs">
                        <span>
                          <strong>{m.name}</strong> ({m.email})
                        </span>
                        <span className="font-mono text-neutral-500">{m.memberRole}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
