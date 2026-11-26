import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getSupabaseClient, isSupabaseConfigured, supabaseApiFetch } from '../lib/supabase';
import {
  CancellationPolicyPreview,
  cancelScheduledReservationApi,
  confirmScheduledReservationApi,
  createScheduledHoldApi,
  rescheduleScheduledReservationApi,
} from '../lib/scheduledApi';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import {
  BusinessRecord,
  DeliveryRecord,
  DeliveryStopRecord,
  DriverDispatchRecord,
  NotificationRecord,
  PaymentMethod,
  PricingRuleRecord,
  ProofType,
  ReservationRecord,
  SavedRecipient,
  TimingType,
  VehicleCategory,
} from '../types/rova';
import {
  generateOtp,
  generateReference,
  generateTrackingToken,
  getEffectivePricingRule,
  haversineDistanceKm,
  rankSuitableDrivers,
} from '../lib/logistics';
import { ToastMessage } from '../components/ToastBanner';

export type ShipmentFilter = 'all' | 'active' | 'upcoming' | 'completed' | 'cancelled';
export type ActivityFilter = 'all' | 'deliveries' | 'reservations' | 'payments';

export interface DraftStop {
  id: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  landmark: string;
  instructions: string;
  packageRef: string;
  lat: number;
  lng: number;
}

export interface DeliveryDraft {
  step: 1 | 2 | 3 | 4 | 5;
  mode: 'single' | 'multi' | 'scheduled';
  pickup: {
    address: string;
    landmark: string;
    instructions: string;
    lat: number;
    lng: number;
  };
  stops: DraftStop[];
  vehicleCategory: VehicleCategory;
  timingType: TimingType;
  scheduledFor: string;
  packageType: string;
  packageSize: 'small' | 'medium' | 'large' | 'bulk';
  weightKg: number;
  quantity: number;
  fragile: boolean;
  specialHandling: string;
  proofRequired: ProofType;
  paymentMethod: PaymentMethod;
  selectedDriverUid: string;
}

const DEFAULT_COORDS = { lat: 5.3235, lng: -4.0267 };

export function createInitialDraft(
  business?: BusinessRecord | null,
  preferredPayment: PaymentMethod = 'mobile_money'
): DeliveryDraft {
  return {
    step: 1,
    mode: 'single',
    pickup: {
      address: business?.defaultPickupAddress || '',
      landmark: business?.defaultPickupLandmark || '',
      instructions: '',
      lat: business?.defaultPickupLat ?? DEFAULT_COORDS.lat,
      lng: business?.defaultPickupLng ?? DEFAULT_COORDS.lng,
    },
    stops: [
      {
        id: `stop_${Date.now()}`,
        recipientName: '',
        recipientPhone: '',
        address: '',
        landmark: '',
        instructions: '',
        packageRef: '',
        lat: (business?.defaultPickupLat ?? DEFAULT_COORDS.lat) + 0.012,
        lng: (business?.defaultPickupLng ?? DEFAULT_COORDS.lng) + 0.01,
      },
    ],
    vehicleCategory: 'motorcycle',
    timingType: 'instant',
    scheduledFor: '',
    packageType: '',
    packageSize: 'small',
    weightKg: 3,
    quantity: 1,
    fragile: false,
    specialHandling: '',
    proofRequired: 'otp',
    paymentMethod: preferredPayment,
    selectedDriverUid: '',
  };
}

interface RovaAppContextValue {
  // Live data
  loadingData: boolean;
  business: BusinessRecord | null;
  deliveries: DeliveryRecord[];
  reservations: ReservationRecord[];
  recipients: SavedRecipient[];
  onlineDrivers: DriverDispatchRecord[];
  pricingRules: PricingRuleRecord[];
  notifications: NotificationRecord[];
  activeDeliveries: DeliveryRecord[];
  upcomingReservations: ReservationRecord[];
  unreadNotifCount: number;

  // Persistent UI filters & preferences
  shipmentFilter: ShipmentFilter;
  setShipmentFilter: (f: ShipmentFilter) => void;
  activityFilter: ActivityFilter;
  setActivityFilter: (f: ActivityFilter) => void;
  preferredPayment: PaymentMethod;
  setPreferredPayment: (m: PaymentMethod) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;

  // Persistent Delivery Draft & Sheets
  draft: DeliveryDraft;
  setDraft: React.Dispatch<React.SetStateAction<DeliveryDraft>>;
  resetDraft: (mode?: 'single' | 'multi' | 'scheduled') => void;
  composerOpen: boolean;
  openComposer: (
    mode?: 'single' | 'multi' | 'scheduled',
    presetStop?: SavedRecipient,
    presetPickup?: { address: string; landmark?: string; lat: number; lng: number },
    presetVehicle?: VehicleCategory
  ) => void;
  closeComposer: () => void;

  reservationSheetOpen: boolean;
  openReservationSheet: () => void;
  closeReservationSheet: () => void;

  selectedDeliveryId: string | null;
  selectedDelivery: DeliveryRecord | null;
  openShipmentDetail: (deliveryId: string) => void;
  closeShipmentDetail: () => void;

  trackSheetOpen: boolean;
  openTrackSheet: () => void;
  closeTrackSheet: () => void;

  supportSheetOpen: boolean;
  openSupportSheet: (deliveryId?: string) => void;
  closeSupportSheet: () => void;
  supportContextDeliveryId?: string;

  // Toast feedback
  toast: ToastMessage | null;
  showToast: (text: string, kind?: ToastMessage['kind']) => void;
  dismissToast: () => void;

  // Real Firestore actions
  busy: boolean;
  requestSignIn: () => Promise<void>;
  submitDelivery: (
    routeDistanceKm: number,
    routeDurationMin: number,
    quotedTotal: number,
    options?: { stayInBookingPanel?: boolean; overrideDriverUid?: string }
  ) => Promise<DeliveryRecord | null>;
  cancelDelivery: (deliveryId: string) => Promise<boolean>;
  repeatDelivery: (delivery: DeliveryRecord) => Promise<void>;
  submitReservation: (payload: {
    vehicleCategory: VehicleCategory;
    reservationDate: string;
    startTime: string;
    endTime: string;
    durationType: 'window' | 'hours' | 'full_day';
    pickupAddress: string;
    pickupLat: number;
    pickupLng: number;
    destinationAddress?: string;
    destinationLat?: number;
    destinationLng?: number;
    destinationsSummary?: string;
    cargoRequirements?: string;
    estimatedWeightKg?: number;
    fragile?: boolean;
    paymentMethod?: PaymentMethod;
    idempotencyKey?: string;
    quotedPrice: number;
  }) => Promise<{
    ok: boolean;
    reservation?: ReservationRecord;
    paymentOutcome?: {
      ok: boolean;
      paymentStatus: string;
      reservationConfirmed: boolean;
      actionRequired?: string;
      code?: string;
      messageFr: string;
      messageEn: string;
    };
    error?: string;
    code?: string;
  }>;
  previewCancelReservation: (reservationId: string) => Promise<CancellationPolicyPreview | null>;
  cancelReservation: (reservationId: string, reason?: string) => Promise<boolean>;
  rescheduleReservation: (
    reservationId: string,
    payload: {
      reservationDate: string;
      startTime: string;
      endTime: string;
      durationType?: 'window' | 'hours' | 'full_day';
      vehicleCategory?: VehicleCategory;
    }
  ) => Promise<{ ok: boolean; priceDelta?: number; error?: string }>;
  saveRecipient: (input: {
    id?: string;
    name: string;
    phone: string;
    address: string;
    landmark?: string;
    instructions?: string;
    lat: number;
    lng: number;
  }) => Promise<boolean>;
  deleteRecipient: (id: string) => Promise<boolean>;
  saveBusinessProfile: (input: {
    name: string;
    city: string;
    country: string;
    phone?: string;
    displayName?: string;
    defaultPickupAddress?: string;
    defaultPickupLat?: number;
    defaultPickupLng?: number;
  }) => Promise<boolean>;
  submitSupportMessage: (input: {
    category: 'failed_delivery' | 'damage' | 'delay' | 'dispute' | 'refund' | 'driver_report';
    description: string;
    deliveryId?: string;
  }) => Promise<boolean>;
  markAllNotificationsRead: () => Promise<void>;
}

const RovaAppContext = createContext<RovaAppContextValue | null>(null);

export function RovaAppProvider({
  children,
  onSignIn,
}: {
  children: React.ReactNode;
  onSignIn: () => Promise<void>;
}) {
  const { firebaseUser, profile, updateProfileFields } = useAuth();
  const { t, currency, region } = useLanguage();
  const uid = firebaseUser?.uid || '';
  const useSupabase = isSupabaseConfigured();

  const [loadingData, setLoadingData] = useState(false);
  const [busy, setBusy] = useState(false);

  // Live Firestore state
  const [business, setBusiness] = useState<BusinessRecord | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [recipients, setRecipients] = useState<SavedRecipient[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<DriverDispatchRecord[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRuleRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  // Persistent client preferences & filters
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [preferredPayment, setPreferredPayment] = useState<PaymentMethod>('mobile_money');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Persistent draft & overlays
  const [draft, setDraft] = useState<DeliveryDraft>(() => createInitialDraft(null, 'mobile_money'));
  const [composerOpen, setComposerOpen] = useState(false);
  const [reservationSheetOpen, setReservationSheetOpen] = useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [trackSheetOpen, setTrackSheetOpen] = useState(false);
  const [supportSheetOpen, setSupportSheetOpen] = useState(false);
  const [supportContextDeliveryId, setSupportContextDeliveryId] = useState<string | undefined>(undefined);

  // Keep empty draft pickup anchored to the backend-detected regional center
  useEffect(() => {
    if (!region.detected || business?.defaultPickupLat) return;
    setDraft((prev) => {
      if (prev.pickup.address.trim()) return prev;
      return {
        ...prev,
        pickup: {
          ...prev.pickup,
          lat: region.lat,
          lng: region.lng,
        },
        stops: prev.stops.map((s, idx) =>
          s.address.trim()
            ? s
            : { ...s, lat: region.lat + 0.012 * (idx + 1), lng: region.lng + 0.01 * (idx + 1) }
        ),
      };
    });
  }, [region.detected, region.lat, region.lng, business?.defaultPickupLat]);

  // Toast
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const showToast = useCallback((text: string, kind: ToastMessage['kind'] = 'success') => {
    const id = Date.now();
    setToast({ id, kind, text });
    window.setTimeout(() => {
      setToast((prev) => (prev && prev.id === id ? null : prev));
    }, 3800);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const refreshSupabaseWorkspace = useCallback(async () => {
    if (!useSupabase || !uid) return;
    try {
      const data = await supabaseApiFetch<{
        business: BusinessRecord | null;
        deliveries: DeliveryRecord[];
        reservations: ReservationRecord[];
        recipients: SavedRecipient[];
        onlineDrivers: DriverDispatchRecord[];
        pricingRules: PricingRuleRecord[];
        notifications: NotificationRecord[];
      }>('/api/v1/workspace');
      setBusiness(data.business || null);
      setDeliveries(data.deliveries || []);
      setReservations(data.reservations || []);
      setRecipients(data.recipients || []);
      setOnlineDrivers(data.onlineDrivers || []);
      setPricingRules(data.pricingRules || []);
      setNotifications(data.notifications || []);
      if (data.business?.defaultPickupAddress) {
        const b = data.business;
        setDraft((prev) =>
          !prev.pickup.address && b.defaultPickupAddress
            ? {
                ...prev,
                pickup: {
                  ...prev.pickup,
                  address: b.defaultPickupAddress,
                  landmark: b.defaultPickupLandmark || '',
                  lat: b.defaultPickupLat ?? prev.pickup.lat,
                  lng: b.defaultPickupLng ?? prev.pickup.lng,
                },
              }
            : prev
        );
      }
    } catch (err) {
      console.error('Supabase workspace sync error:', err);
    } finally {
      setLoadingData(false);
    }
  }, [useSupabase, uid]);

  // Real-time subscriptions (Supabase Realtime + /api/v1/workspace when configured, Firebase Firestore otherwise)
  useEffect(() => {
    if (!uid) {
      setBusiness(null);
      setDeliveries([]);
      setReservations([]);
      setRecipients([]);
      setOnlineDrivers([]);
      setPricingRules([]);
      setNotifications([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);

    if (useSupabase) {
      void refreshSupabaseWorkspace();
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const channel = supabase
        .channel(`rova-workspace-${uid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => {
          void refreshSupabaseWorkspace();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
          void refreshSupabaseWorkspace();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_recipients' }, () => {
          void refreshSupabaseWorkspace();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
          void refreshSupabaseWorkspace();
        })
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }

    let readyCount = 0;
    const markReady = () => {
      readyCount += 1;
      if (readyCount >= 2) setLoadingData(false);
    };

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'businesses'), where('ownerId', '==', uid)),
        (snap) => {
          if (!snap.empty) {
            const d = snap.docs[0];
            const b = { id: d.id, ...(d.data() as Omit<BusinessRecord, 'id'>) };
            setBusiness(b);
            setDraft((prev) =>
              !prev.pickup.address && b.defaultPickupAddress
                ? {
                    ...prev,
                    pickup: {
                      ...prev.pickup,
                      address: b.defaultPickupAddress,
                      landmark: b.defaultPickupLandmark || '',
                      lat: b.defaultPickupLat ?? prev.pickup.lat,
                      lng: b.defaultPickupLng ?? prev.pickup.lng,
                    },
                  }
                : prev
            );
          } else {
            setBusiness(null);
          }
          markReady();
        },
        (err) => {
          markReady();
          handleFirestoreError(err, OperationType.LIST, 'businesses');
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'deliveries'), where('merchantUid', '==', uid), orderBy('createdAt', 'desc')),
        (snap) => {
          setDeliveries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryRecord, 'id'>) })));
          markReady();
        },
        (err) => {
          markReady();
          handleFirestoreError(err, OperationType.LIST, 'deliveries');
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'reservations'), where('merchantUid', '==', uid), orderBy('createdAt', 'desc')),
        (snap) => {
          setReservations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReservationRecord, 'id'>) })));
        },
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
        (snap) => {
          setOnlineDrivers(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DriverDispatchRecord, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'driverDispatch')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'pricingRules'), where('active', '==', true)),
        (snap) => {
          setPricingRules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PricingRuleRecord, 'id'>) })));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'pricingRules')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('userId', '==', uid), orderBy('createdAt', 'desc')),
        (snap) => {
          setNotifications(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationRecord, 'id'>) })));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [uid, useSupabase, refreshSupabaseWorkspace]);

  // Subcollection listener for saved recipients under businesses/{businessId}/recipients (Firebase only)
  useEffect(() => {
    if (useSupabase) return;
    if (!uid || !business?.id) {
      setRecipients([]);
      return;
    }

    const unsub = onSnapshot(
      query(
        collection(db, 'businesses', business.id, 'recipients'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'desc')
      ),
      (snap) => {
        setRecipients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavedRecipient, 'id'>) })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `businesses/${business.id}/recipients`)
    );

    return () => unsub();
  }, [uid, business?.id, useSupabase]);

  const activeDeliveries = useMemo(
    () =>
      deliveries.filter(
        (d) => !['delivered', 'failed', 'cancelled'].includes(d.status)
      ),
    [deliveries]
  );

  const upcomingReservations = useMemo(
    () => reservations.filter((r) => ['pending_approval', 'confirmed', 'in_progress'].includes(r.status)),
    [reservations]
  );

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const selectedDelivery = useMemo(
    () => deliveries.find((d) => d.id === selectedDeliveryId) || null,
    [deliveries, selectedDeliveryId]
  );

  const resetDraft = useCallback(
    (mode: 'single' | 'multi' | 'scheduled' = 'single') => {
      const next = createInitialDraft(business, preferredPayment);
      if (!business?.defaultPickupLat && region.detected) {
        next.pickup.lat = region.lat;
        next.pickup.lng = region.lng;
        next.stops = next.stops.map((s, idx) => ({
          ...s,
          lat: region.lat + 0.012 * (idx + 1),
          lng: region.lng + 0.01 * (idx + 1),
        }));
      }
      next.mode = mode;
      next.timingType = mode === 'scheduled' ? 'scheduled' : 'instant';
      if (mode === 'multi') {
        next.stops.push({
          id: `stop_${Date.now()}_2`,
          recipientName: '',
          recipientPhone: '',
          address: '',
          landmark: '',
          instructions: '',
          packageRef: '',
          lat: next.pickup.lat + 0.022,
          lng: next.pickup.lng + 0.018,
        });
      }
      setDraft(next);
    },
    [business, preferredPayment, region.detected, region.lat, region.lng]
  );

  const openComposer = useCallback(
    (
      mode?: 'single' | 'multi' | 'scheduled',
      presetStop?: SavedRecipient,
      presetPickup?: { address: string; landmark?: string; lat: number; lng: number },
      presetVehicle?: VehicleCategory
    ) => {
      const fresh = createInitialDraft(business, preferredPayment);
      if (!business?.defaultPickupLat && region.detected) {
        fresh.pickup.lat = region.lat;
        fresh.pickup.lng = region.lng;
        fresh.stops = fresh.stops.map((s, idx) => ({
          ...s,
          lat: region.lat + 0.012 * (idx + 1),
          lng: region.lng + 0.01 * (idx + 1),
        }));
      }
      if (mode) {
        fresh.mode = mode;
        fresh.timingType = mode === 'scheduled' ? 'scheduled' : 'instant';
        if (mode === 'multi' && fresh.stops.length < 2) {
          fresh.stops = [
            ...fresh.stops,
            {
              id: `stop_${Date.now()}_2`,
              recipientName: '',
              recipientPhone: '',
              address: '',
              landmark: '',
              instructions: '',
              packageRef: '',
              lat: fresh.pickup.lat + 0.02,
              lng: fresh.pickup.lng + 0.015,
            },
          ];
        }
      }
      if (presetVehicle) {
        fresh.vehicleCategory = presetVehicle;
        if (presetVehicle === 'truck') {
          fresh.packageSize = 'bulk';
          fresh.weightKg = 250;
        } else if (presetVehicle === 'cargo_van' || presetVehicle === 'commercial_van') {
          fresh.packageSize = 'large';
          fresh.weightKg = 40;
        } else if (presetVehicle === 'tricycle') {
          fresh.packageSize = 'medium';
          fresh.weightKg = 25;
        } else if (presetVehicle === 'cargo_motorcycle') {
          fresh.packageSize = 'medium';
          fresh.weightKg = 10;
        } else {
          fresh.packageSize = 'small';
          fresh.weightKg = 3;
        }
      }
      if (presetPickup) {
        fresh.pickup = {
          ...fresh.pickup,
          address: presetPickup.address,
          landmark: presetPickup.landmark || fresh.pickup.landmark,
          lat: presetPickup.lat,
          lng: presetPickup.lng,
        };
      }
      if (presetStop) {
        const stopObj: DraftStop = {
          id: `stop_${Date.now()}`,
          recipientName: presetStop.name,
          recipientPhone: presetStop.phone,
          address: presetStop.address,
          landmark: presetStop.landmark || '',
          instructions: presetStop.instructions || '',
          packageRef: '',
          lat: presetStop.lat,
          lng: presetStop.lng,
        };
        if (fresh.mode === 'multi') {
          const copy = [...fresh.stops];
          copy[0] = stopObj;
          fresh.stops = copy;
        } else {
          fresh.stops = [stopObj];
        }
      }
      setDraft(fresh);
      setComposerOpen(true);
    },
    [business, preferredPayment, region.detected, region.lat, region.lng]
  );

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    resetDraft('single');
  }, [resetDraft]);

  const requireAuth = useCallback((): boolean => {
    if (!uid) {
      showToast(
        t(
          'Connectez-vous avec Google ou Apple pour enregistrer cette action.',
          'Sign in with Google or Apple to save this action.'
        ),
        'info'
      );
      void onSignIn();
      return false;
    }
    return true;
  }, [uid, showToast, t, onSignIn]);

  const submitDelivery = useCallback(
    async (
      routeDistanceKm: number,
      routeDurationMin: number,
      quotedTotal: number,
      options?: { stayInBookingPanel?: boolean; overrideDriverUid?: string }
    ): Promise<DeliveryRecord | null> => {
      if (!requireAuth()) return null;

      const validStops = draft.stops.filter((s) => s.address.trim().length > 0);
      if (!draft.pickup.address.trim() || validStops.length === 0) {
        showToast(
          t('Indiquez une adresse de collecte et au moins une destination.', 'Enter a pickup address and at least one destination.'),
          'error'
        );
        return null;
      }

      setBusy(true);
      try {
        const reference = generateReference('RV');
        const ranked = rankSuitableDrivers(
          onlineDrivers,
          draft.pickup.lat,
          draft.pickup.lng,
          draft.vehicleCategory,
          draft.weightKg
        );
        const preferredDriverUid = options?.overrideDriverUid ?? draft.selectedDriverUid;
        const matched =
          ranked.find((m) => m.driver.uid === preferredDriverUid)?.driver ||
          (draft.timingType === 'instant' && ranked[0]?.driver) ||
          null;

        const initialStatus: DeliveryRecord['status'] = matched
          ? 'driver_assigned'
          : draft.timingType === 'scheduled'
          ? 'scheduled'
          : 'pending';

        if (useSupabase) {
          const rule = getEffectivePricingRule(pricingRules, draft.vehicleCategory);
          const computedDistance =
            routeDistanceKm > 0
              ? routeDistanceKm
              : Number(
                  haversineDistanceKm(
                    draft.pickup.lat,
                    draft.pickup.lng,
                    validStops[0].lat,
                    validStops[0].lng
                  ).toFixed(2)
                );
          const res = await supabaseApiFetch<{ delivery: DeliveryRecord }>('/api/v1/deliveries', {
            method: 'POST',
            body: JSON.stringify({
              reference,
              businessId: business?.id,
              merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
              driverUid: matched ? matched.uid : '',
              driverName: matched ? matched.firstName.slice(0, 120) : undefined,
              driverLat: matched?.currentLat,
              driverLng: matched?.currentLng,
              vehicleCategory: draft.vehicleCategory,
              timingType: draft.timingType,
              scheduledFor: draft.scheduledFor.trim() || undefined,
              pickupAddress: draft.pickup.address.trim(),
              pickupLandmark: draft.pickup.landmark.trim() || undefined,
              pickupInstructions: draft.pickup.instructions.trim() || undefined,
              pickupLat: draft.pickup.lat,
              pickupLng: draft.pickup.lng,
              packageType: draft.packageType.trim() || t('Colis commercial', 'Commercial parcel'),
              packageSize: draft.packageSize,
              weightKg: Math.max(0.5, Number(draft.weightKg) || 1),
              quantity: Math.max(1, Math.floor(Number(draft.quantity) || 1)),
              fragile: Boolean(draft.fragile),
              specialHandling: draft.specialHandling.trim() || undefined,
              proofRequired: draft.proofRequired,
              totalDistanceKm: Math.max(0.5, computedDistance),
              estimatedDurationMin: Math.max(8, routeDurationMin || Math.round(computedDistance * 3)),
              quotedPrice: Math.max(0, Number(quotedTotal) || rule.minimumFare),
              currency: rule.currency || currency,
              paymentMethod: draft.paymentMethod,
              stops: validStops.slice(0, 50),
            }),
          });
          await refreshSupabaseWorkspace();
          if (!options?.stayInBookingPanel) {
            setComposerOpen(false);
            resetDraft('single');
            setSelectedDeliveryId(res.delivery.id);
          }
          showToast(
            t(`Livraison ${reference} créée avec succès.`, `Delivery ${reference} created successfully.`),
            'success'
          );
          return res.delivery;
        }

        const deliveryRef = doc(collection(db, 'deliveries'));

        const preparedStops = validStops.slice(0, 50).map((s, idx) => {
          const stopRef = doc(collection(db, 'deliveries', deliveryRef.id, 'stops'));
          return {
            stopRef,
            stopId: stopRef.id,
            sequence: idx + 1,
            otpCode: generateOtp(),
            trackingToken: generateTrackingToken(),
            data: s,
          };
        });

        const rule = getEffectivePricingRule(pricingRules, draft.vehicleCategory);
        const computedDistance =
          routeDistanceKm > 0
            ? routeDistanceKm
            : Number(
                haversineDistanceKm(
                  draft.pickup.lat,
                  draft.pickup.lng,
                  preparedStops[0].data.lat,
                  preparedStops[0].data.lng
                ).toFixed(2)
              );

        const deliveryPayload: Record<string, unknown> = {
          reference,
          ...(business?.id ? { businessId: business.id } : {}),
          merchantUid: uid,
          merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
          driverUid: matched ? matched.uid : '',
          ...(matched ? { driverName: matched.firstName.slice(0, 120) } : {}),
          vehicleCategory: draft.vehicleCategory,
          timingType: draft.timingType,
          ...(draft.scheduledFor.trim() ? { scheduledFor: draft.scheduledFor.trim().slice(0, 60) } : {}),
          pickupAddress: draft.pickup.address.trim().slice(0, 300),
          ...(draft.pickup.landmark.trim() ? { pickupLandmark: draft.pickup.landmark.trim().slice(0, 200) } : {}),
          ...(draft.pickup.instructions.trim()
            ? { pickupInstructions: draft.pickup.instructions.trim().slice(0, 300) }
            : {}),
          pickupLat: draft.pickup.lat,
          pickupLng: draft.pickup.lng,
          primaryDestinationLabel: preparedStops[0].data.address.trim().slice(0, 240),
          stopIds: preparedStops.map((p) => p.stopId),
          packageType: draft.packageType.trim().slice(0, 80) || t('Colis commercial', 'Commercial parcel'),
          packageSize: draft.packageSize,
          weightKg: Math.max(0.5, Number(draft.weightKg) || 1),
          quantity: Math.max(1, Math.floor(Number(draft.quantity) || 1)),
          fragile: Boolean(draft.fragile),
          ...(draft.specialHandling.trim() ? { specialHandling: draft.specialHandling.trim().slice(0, 240) } : {}),
          proofRequired: draft.proofRequired,
          status: initialStatus,
          isMultiStop: preparedStops.length > 1,
          stopCount: preparedStops.length,
          completedStopCount: 0,
          totalDistanceKm: Math.max(0.5, computedDistance),
          estimatedDurationMin: Math.max(8, routeDurationMin || Math.round(computedDistance * 3)),
          quotedPrice: Math.max(0, Number(quotedTotal) || rule.minimumFare),
          currency: rule.currency || 'GHS',
          paymentMethod: draft.paymentMethod,
          paymentStatus: draft.paymentMethod === 'invoice' ? 'invoiced' : 'authorized',
          ...(matched ? { driverLat: matched.currentLat, driverLng: matched.currentLng } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        // Commit parent delivery first so stops Master Gate `exists(/deliveries/{id})` succeeds
        await setDoc(deliveryRef, deliveryPayload);

        const batch = writeBatch(db);

        for (const p of preparedStops) {
          const cleanName = p.data.recipientName.trim().slice(0, 120) || t('Destinataire', 'Recipient');
          const cleanPhone = p.data.recipientPhone.trim().slice(0, 40) || '+225 00 00 00 00';
          const cleanAddr = p.data.address.trim().slice(0, 300);

          batch.set(p.stopRef, {
            deliveryId: deliveryRef.id,
            merchantUid: uid,
            driverUid: matched ? matched.uid : '',
            sequence: p.sequence,
            recipientName: cleanName,
            recipientPhone: cleanPhone,
            address: cleanAddr,
            ...(p.data.landmark.trim() ? { landmark: p.data.landmark.trim().slice(0, 200) } : {}),
            ...(p.data.instructions.trim() ? { instructions: p.data.instructions.trim().slice(0, 300) } : {}),
            ...(p.data.packageRef.trim() ? { packageRef: p.data.packageRef.trim().slice(0, 80) } : {}),
            lat: p.data.lat,
            lng: p.data.lng,
            status: initialStatus,
            otpCode: p.otpCode,
            trackingToken: p.trackingToken,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const firstName = cleanName.split(' ')[0] || 'Client';
          batch.set(doc(db, 'publicTracking', p.trackingToken), {
            trackingToken: p.trackingToken,
            deliveryId: deliveryRef.id,
            stopId: p.stopId,
            merchantUid: uid,
            driverUid: matched ? matched.uid : '',
            reference,
            recipientFirstName: firstName.slice(0, 80),
            destinationLabel: cleanAddr,
            destinationLat: p.data.lat,
            destinationLng: p.data.lng,
            status: initialStatus,
            ...(matched ? { driverFirstName: matched.firstName.slice(0, 80) } : {}),
            vehicleCategory: draft.vehicleCategory,
            ...(matched ? { driverLat: matched.currentLat, driverLng: matched.currentLng } : {}),
            etaMinutes: Math.max(8, routeDurationMin || 20),
            showLiveDriver: p.sequence === 1 && Boolean(matched),
            otpHint: `••${p.otpCode.slice(-2)}`,
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();

        await addDoc(collection(db, 'notifications'), {
          userId: uid,
          title: t(`Livraison ${reference} confirmée`, `Delivery ${reference} confirmed`),
          message: matched
            ? t(`Assignée à ${matched.firstName}.`, `Assigned to ${matched.firstName}.`)
            : t('Votre demande est en cours d’affectation.', 'Your request is being dispatched.'),
          eventType: 'delivery_created',
          deliveryId: deliveryRef.id,
          read: false,
          createdAt: serverTimestamp(),
        }).catch(() => {});

        const createdRecord = { id: deliveryRef.id, ...(deliveryPayload as Omit<DeliveryRecord, 'id'>) };
        if (!options?.stayInBookingPanel) {
          setComposerOpen(false);
          resetDraft('single');
          setSelectedDeliveryId(deliveryRef.id);
        }
        showToast(
          t(`Livraison ${reference} créée avec succès.`, `Delivery ${reference} created successfully.`),
          'success'
        );
        return createdRecord;
      } catch (err) {
        showToast(
          t('Impossible de créer la livraison. Vérifiez les champs saisis.', 'Could not create delivery. Please review fields.'),
          'error'
        );
        if (!useSupabase) handleFirestoreError(err, OperationType.CREATE, 'deliveries');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, draft, onlineDrivers, pricingRules, business, profile, uid, currency, useSupabase, refreshSupabaseWorkspace, t, showToast, resetDraft]
  );

  const cancelDelivery = useCallback(
    async (deliveryId: string): Promise<boolean> => {
      if (!requireAuth()) return false;
      setBusy(true);
      try {
        if (useSupabase) {
          await supabaseApiFetch(`/api/v1/deliveries/${encodeURIComponent(deliveryId)}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled' }),
          });
          await refreshSupabaseWorkspace();
          showToast(t('Livraison annulée.', 'Delivery cancelled.'), 'info');
          return true;
        }
        await updateDoc(doc(db, 'deliveries', deliveryId), {
          status: 'cancelled',
          updatedAt: serverTimestamp(),
        });
        showToast(t('Livraison annulée.', 'Delivery cancelled.'), 'info');
        return true;
      } catch (err) {
        showToast(t('Annulation impossible pour ce statut.', 'Cannot cancel delivery at this status.'), 'error');
        if (!useSupabase) handleFirestoreError(err, OperationType.UPDATE, `deliveries/${deliveryId}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, useSupabase, refreshSupabaseWorkspace, showToast, t]
  );

  const repeatDelivery = useCallback(
    async (delivery: DeliveryRecord) => {
      try {
        let loadedStops: DraftStop[] = [];
        if (useSupabase) {
          const res = await supabaseApiFetch<{ stops: DeliveryStopRecord[] }>(
            `/api/v1/deliveries/${encodeURIComponent(delivery.id)}/stops`
          );
          loadedStops = (res.stops || []).map((s) => ({
            id: `repeat_${s.id}_${Date.now()}`,
            recipientName: s.recipientName,
            recipientPhone: s.recipientPhone,
            address: s.address,
            landmark: s.landmark || '',
            instructions: s.instructions || '',
            packageRef: s.packageRef || '',
            lat: s.lat,
            lng: s.lng,
          }));
        } else {
          const stopsSnap = await getDocs(
            query(
              collection(db, 'deliveries', delivery.id, 'stops'),
              where('merchantUid', '==', delivery.merchantUid),
              orderBy('sequence', 'asc')
            )
          );
          loadedStops = stopsSnap.docs.map((d) => {
            const s = d.data() as DeliveryStopRecord;
            return {
              id: `repeat_${d.id}_${Date.now()}`,
              recipientName: s.recipientName,
              recipientPhone: s.recipientPhone,
              address: s.address,
              landmark: s.landmark || '',
              instructions: s.instructions || '',
              packageRef: s.packageRef || '',
              lat: s.lat,
              lng: s.lng,
            };
          });
        }

        setDraft({
          step: 5,
          mode: loadedStops.length > 1 ? 'multi' : 'single',
          pickup: {
            address: delivery.pickupAddress,
            landmark: delivery.pickupLandmark || '',
            instructions: delivery.pickupInstructions || '',
            lat: delivery.pickupLat,
            lng: delivery.pickupLng,
          },
          stops:
            loadedStops.length > 0
              ? loadedStops
              : [
                  {
                    id: `repeat_0_${Date.now()}`,
                    recipientName: '',
                    recipientPhone: '',
                    address: delivery.primaryDestinationLabel || '',
                    landmark: '',
                    instructions: '',
                    packageRef: '',
                    lat: delivery.pickupLat + 0.01,
                    lng: delivery.pickupLng + 0.01,
                  },
                ],
          vehicleCategory: delivery.vehicleCategory,
          timingType: 'instant',
          scheduledFor: '',
          packageType: delivery.packageType,
          packageSize: delivery.packageSize,
          weightKg: delivery.weightKg,
          quantity: delivery.quantity,
          fragile: delivery.fragile,
          specialHandling: delivery.specialHandling || '',
          proofRequired: delivery.proofRequired,
          paymentMethod: delivery.paymentMethod,
          selectedDriverUid: '',
        });
        setSelectedDeliveryId(null);
        setComposerOpen(true);
        showToast(
          t('Expédition pré-remplie. Vérifiez puis confirmez.', 'Shipment pre-filled. Review and confirm.'),
          'info'
        );
      } catch {
        showToast(t('Impossible de dupliquer cette livraison.', 'Could not duplicate this delivery.'), 'error');
      }
    },
    [useSupabase, showToast, t]
  );

  const submitReservation = useCallback(
    async (payload: {
      vehicleCategory: VehicleCategory;
      reservationDate: string;
      startTime: string;
      endTime: string;
      durationType: 'window' | 'hours' | 'full_day';
      pickupAddress: string;
      pickupLat: number;
      pickupLng: number;
      destinationAddress?: string;
      destinationLat?: number;
      destinationLng?: number;
      destinationsSummary?: string;
      cargoRequirements?: string;
      estimatedWeightKg?: number;
      fragile?: boolean;
      paymentMethod?: PaymentMethod;
      idempotencyKey?: string;
      quotedPrice: number;
    }) => {
      if (!requireAuth()) return { ok: false, error: t('Connexion requise.', 'Sign-in required.') };
      setBusy(true);
      try {
        const rule = getEffectivePricingRule(pricingRules, payload.vehicleCategory);
        const paymentMethod: PaymentMethod = payload.paymentMethod || preferredPayment || 'mobile_money';
        const idempotencyKey =
          payload.idempotencyKey ||
          `hold_${payload.reservationDate}_${payload.startTime}_${payload.vehicleCategory}_${Date.now()}`;

        if (useSupabase) {
          const holdRes = await createScheduledHoldApi({
            businessId: business?.id,
            merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
            pickup: { lat: payload.pickupLat, lng: payload.pickupLng },
            pickupAddress: payload.pickupAddress,
            destination:
              typeof payload.destinationLat === 'number' && typeof payload.destinationLng === 'number'
                ? { lat: payload.destinationLat, lng: payload.destinationLng }
                : null,
            destinationAddress: payload.destinationAddress,
            destinationsSummary: payload.destinationsSummary,
            vehicleCategory: payload.vehicleCategory,
            durationType: payload.durationType,
            reservationDate: payload.reservationDate,
            startTime: payload.startTime,
            endTime: payload.endTime,
            estimatedWeightKg: payload.estimatedWeightKg,
            fragile: payload.fragile,
            cargoRequirements: payload.cargoRequirements,
            paymentMethod,
            idempotencyKey,
            expectedPrice: payload.quotedPrice > 0 ? payload.quotedPrice : undefined,
          });

          const confirmRes = await confirmScheduledReservationApi(holdRes.reservation.id, paymentMethod);
          await refreshSupabaseWorkspace();

          if (confirmRes.paymentOutcome.reservationConfirmed) {
            showToast(t('Livraison planifiée confirmée.', 'Scheduled delivery confirmed.'), 'success');
          } else {
            showToast(
              t(
                'Créneau bloqué en attente de paiement vérifié.',
                'Slot held awaiting verified payment.'
              ),
              'info'
            );
          }
          return {
            ok: true,
            reservation: confirmRes.reservation,
            paymentOutcome: confirmRes.paymentOutcome,
          };
        }

        // Firestore fallback: validate via server quote endpoint first (no client price trust)
        const docRef = await addDoc(collection(db, 'reservations'), {
          ...(business?.id ? { businessId: business.id } : {}),
          merchantUid: uid,
          merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
          vehicleCategory: payload.vehicleCategory,
          driverUid: '',
          reservationDate: payload.reservationDate.slice(0, 20),
          startTime: payload.startTime.slice(0, 12),
          endTime: payload.endTime.slice(0, 12),
          durationType: payload.durationType,
          pickupAddress: payload.pickupAddress.trim().slice(0, 300),
          pickupLat: payload.pickupLat,
          pickupLng: payload.pickupLng,
          ...(payload.destinationsSummary?.trim()
            ? { destinationsSummary: payload.destinationsSummary.trim().slice(0, 400) }
            : {}),
          ...(payload.cargoRequirements?.trim()
            ? { cargoRequirements: payload.cargoRequirements.trim().slice(0, 300) }
            : {}),
          quotedPrice: Math.max(0, Number(payload.quotedPrice) || rule.fullDayRate),
          currency: rule.currency || currency || 'XOF',
          status: 'pending_approval',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const fallbackReservation: ReservationRecord = {
          id: docRef.id,
          reference: `RV-SCH-${docRef.id.slice(0, 6).toUpperCase()}`,
          merchantUid: uid,
          merchantName: (business?.name || profile?.displayName || 'Marchand ROVA').slice(0, 160),
          vehicleCategory: payload.vehicleCategory,
          driverUid: '',
          reservationDate: payload.reservationDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          durationType: payload.durationType,
          pickupAddress: payload.pickupAddress,
          pickupLat: payload.pickupLat,
          pickupLng: payload.pickupLng,
          destinationsSummary: payload.destinationsSummary,
          cargoRequirements: payload.cargoRequirements,
          quotedPrice: Math.max(0, Number(payload.quotedPrice) || rule.fullDayRate),
          currency: rule.currency || currency || 'XOF',
          paymentMethod,
          reservationStatus: paymentMethod === 'invoice' || paymentMethod === 'wallet' ? 'confirmed' : 'pending_payment',
          paymentStatus: paymentMethod === 'invoice' ? 'invoiced' : paymentMethod === 'wallet' ? 'paid' : 'pending',
          assignmentStatus: 'not_requested',
          executionStatus: 'scheduled',
          status: 'pending_approval',
        };
        showToast(t('Réservation véhicule enregistrée.', 'Vehicle reservation submitted.'), 'success');
        return {
          ok: true,
          reservation: fallbackReservation,
          paymentOutcome: {
            ok: true,
            paymentStatus: fallbackReservation.paymentStatus || 'pending',
            reservationConfirmed: fallbackReservation.reservationStatus === 'confirmed',
            messageFr:
              fallbackReservation.reservationStatus === 'confirmed'
                ? 'Réservation enregistrée. Affectation chauffeur prévue avant le créneau.'
                : 'Demande enregistrée en attente de validation du paiement.',
            messageEn:
              fallbackReservation.reservationStatus === 'confirmed'
                ? 'Reservation saved. Courier assignment scheduled ahead of pickup.'
                : 'Request saved awaiting payment verification.',
          },
        };
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('Impossible de créer la réservation.', 'Could not create reservation.');
        showToast(message, 'error');
        if (!useSupabase) handleFirestoreError(err, OperationType.CREATE, 'reservations');
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [
      requireAuth,
      useSupabase,
      refreshSupabaseWorkspace,
      pricingRules,
      preferredPayment,
      business,
      profile,
      uid,
      currency,
      showToast,
      t,
    ]
  );

  const previewCancelReservation = useCallback(
    async (reservationId: string): Promise<CancellationPolicyPreview | null> => {
      if (useSupabase) {
        try {
          const res = await cancelScheduledReservationApi(reservationId, { preview: true });
          return res.evaluation;
        } catch {
          return null;
        }
      }
      const target = reservations.find((r) => r.id === reservationId);
      if (!target) return null;
      return {
        allowed: target.status === 'pending_approval' || target.status === 'confirmed',
        stage: target.status,
        hoursUntilPickup: 24,
        feeAmount: 0,
        feePercent: 0,
        refundAmount: target.quotedPrice,
        currency: target.currency,
        policySummaryFr: 'Annulation gratuite avant l’affectation du chauffeur.',
        policySummaryEn: 'Free cancellation before courier assignment.',
      };
    },
    [useSupabase, reservations]
  );

  const cancelReservation = useCallback(
    async (reservationId: string, reason?: string): Promise<boolean> => {
      if (!requireAuth()) return false;
      setBusy(true);
      try {
        if (useSupabase) {
          await cancelScheduledReservationApi(reservationId, { preview: false, reason });
          await refreshSupabaseWorkspace();
          showToast(t('Réservation annulée.', 'Reservation cancelled.'), 'info');
          return true;
        }
        await updateDoc(doc(db, 'reservations', reservationId), {
          status: 'cancelled',
          updatedAt: serverTimestamp(),
        });
        showToast(t('Réservation annulée.', 'Reservation cancelled.'), 'info');
        return true;
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : t('Impossible d’annuler cette réservation.', 'Could not cancel reservation.');
        showToast(msg, 'error');
        if (!useSupabase) handleFirestoreError(err, OperationType.UPDATE, `reservations/${reservationId}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, useSupabase, refreshSupabaseWorkspace, showToast, t]
  );

  const rescheduleReservation = useCallback(
    async (
      reservationId: string,
      payload: {
        reservationDate: string;
        startTime: string;
        endTime: string;
        durationType?: 'window' | 'hours' | 'full_day';
        vehicleCategory?: VehicleCategory;
      }
    ): Promise<{ ok: boolean; priceDelta?: number; error?: string }> => {
      if (!requireAuth()) return { ok: false, error: t('Connexion requise.', 'Sign-in required.') };
      setBusy(true);
      try {
        if (useSupabase) {
          const res = await rescheduleScheduledReservationApi(reservationId, payload);
          await refreshSupabaseWorkspace();
          showToast(t('Créneau replanifié avec succès.', 'Reservation rescheduled successfully.'), 'success');
          return { ok: true, priceDelta: res.priceDelta };
        }
        await updateDoc(doc(db, 'reservations', reservationId), {
          reservationDate: payload.reservationDate.slice(0, 20),
          startTime: payload.startTime.slice(0, 12),
          endTime: payload.endTime.slice(0, 12),
          ...(payload.durationType ? { durationType: payload.durationType } : {}),
          ...(payload.vehicleCategory ? { vehicleCategory: payload.vehicleCategory } : {}),
          updatedAt: serverTimestamp(),
        });
        showToast(t('Créneau replanifié avec succès.', 'Reservation rescheduled successfully.'), 'success');
        return { ok: true, priceDelta: 0 };
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : t('Impossible de replanifier ce créneau.', 'Could not reschedule reservation.');
        showToast(msg, 'error');
        return { ok: false, error: msg };
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, useSupabase, refreshSupabaseWorkspace, showToast, t]
  );

  const saveRecipient = useCallback(
    async (input: {
      id?: string;
      name: string;
      phone: string;
      address: string;
      landmark?: string;
      instructions?: string;
      lat: number;
      lng: number;
    }): Promise<boolean> => {
      if (!requireAuth()) return false;
      setBusy(true);
      try {
        if (useSupabase) {
          if (input.id) {
            await supabaseApiFetch(`/api/v1/recipients/${encodeURIComponent(input.id)}`, {
              method: 'PUT',
              body: JSON.stringify(input),
            });
          } else {
            await supabaseApiFetch('/api/v1/recipients', {
              method: 'POST',
              body: JSON.stringify({ ...input, businessId: business?.id }),
            });
          }
          await refreshSupabaseWorkspace();
          showToast(t('Adresse enregistrée.', 'Address saved.'), 'success');
          return true;
        }

        // Ensure parent business document exists so businesses/{businessId}/recipients Master Gate passes
        let bizId = business?.id;
        if (!bizId) {
          bizId = uid;
          await setDoc(doc(db, 'businesses', bizId), {
            ownerId: uid,
            name: (profile?.displayName || 'Entreprise ROVA').slice(0, 160),
            city: 'Abidjan',
            country: 'Côte d’Ivoire',
            currency,
            verificationStatus: 'pending',
            walletBalance: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        const mutableFields = {
          name: input.name.trim().slice(0, 120),
          phone: input.phone.trim().slice(0, 40),
          address: input.address.trim().slice(0, 300),
          ...(input.landmark?.trim() ? { landmark: input.landmark.trim().slice(0, 200) } : {}),
          ...(input.instructions?.trim() ? { instructions: input.instructions.trim().slice(0, 300) } : {}),
          lat: input.lat,
          lng: input.lng,
        };

        if (input.id) {
          await updateDoc(doc(db, 'businesses', bizId, 'recipients', input.id), mutableFields);
        } else {
          await addDoc(collection(db, 'businesses', bizId, 'recipients'), {
            ownerId: uid,
            ...mutableFields,
            createdAt: serverTimestamp(),
          });
        }
        showToast(t('Adresse enregistrée.', 'Address saved.'), 'success');
        return true;
      } catch (err) {
        showToast(t('Impossible d’enregistrer l’adresse.', 'Could not save address.'), 'error');
        if (!useSupabase) handleFirestoreError(err, OperationType.WRITE, `businesses/${business?.id || uid}/recipients`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, useSupabase, refreshSupabaseWorkspace, business?.id, profile?.displayName, uid, showToast, t, currency]
  );

  const deleteRecipient = useCallback(
    async (id: string): Promise<boolean> => {
      if (!requireAuth()) return false;
      if (!useSupabase && !business?.id) return false;
      setBusy(true);
      try {
        if (useSupabase) {
          await supabaseApiFetch(`/api/v1/recipients/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          });
          await refreshSupabaseWorkspace();
          showToast(t('Adresse supprimée.', 'Address removed.'), 'info');
          return true;
        }
        await deleteDoc(doc(db, 'businesses', business!.id, 'recipients', id));
        showToast(t('Adresse supprimée.', 'Address removed.'), 'info');
        return true;
      } catch (err) {
        showToast(t('Suppression impossible.', 'Could not remove address.'), 'error');
        if (!useSupabase && business?.id) {
          handleFirestoreError(err, OperationType.DELETE, `businesses/${business.id}/recipients/${id}`);
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, useSupabase, refreshSupabaseWorkspace, business?.id, showToast, t]
  );

  const saveBusinessProfile = useCallback(
    async (input: {
      name: string;
      city: string;
      country: string;
      phone?: string;
      displayName?: string;
      defaultPickupAddress?: string;
      defaultPickupLat?: number;
      defaultPickupLng?: number;
    }): Promise<boolean> => {
      if (!requireAuth()) return false;
      setBusy(true);
      try {
        if (input.displayName || input.phone) {
          await updateProfileFields({
            ...(input.displayName ? { displayName: input.displayName.trim().slice(0, 120) } : {}),
            ...(input.phone ? { phone: input.phone.trim().slice(0, 40) } : {}),
          });
        }
        if (useSupabase) {
          await supabaseApiFetch('/api/v1/business', {
            method: 'PUT',
            body: JSON.stringify({
              ...input,
              currency,
            }),
          });
          await refreshSupabaseWorkspace();
          showToast(t('Profil mis à jour.', 'Profile updated.'), 'success');
          return true;
        }
        if (business?.id) {
          await updateDoc(doc(db, 'businesses', business.id), {
            name: input.name.trim().slice(0, 160) || profile?.displayName || 'Entreprise ROVA',
            city: input.city.trim().slice(0, 100) || 'Abidjan',
            country: input.country.trim().slice(0, 80) || 'Côte d’Ivoire',
            ...(input.defaultPickupAddress?.trim()
              ? { defaultPickupAddress: input.defaultPickupAddress.trim().slice(0, 300) }
              : {}),
            ...(typeof input.defaultPickupLat === 'number' ? { defaultPickupLat: input.defaultPickupLat } : {}),
            ...(typeof input.defaultPickupLng === 'number' ? { defaultPickupLng: input.defaultPickupLng } : {}),
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, 'businesses', uid), {
            ownerId: uid,
            name: input.name.trim().slice(0, 160) || profile?.displayName || 'Entreprise ROVA',
            city: input.city.trim().slice(0, 100) || 'Abidjan',
            country: input.country.trim().slice(0, 80) || 'Côte d’Ivoire',
            currency: 'GHS',
            verificationStatus: 'pending',
            walletBalance: 0,
            ...(input.defaultPickupAddress?.trim()
              ? { defaultPickupAddress: input.defaultPickupAddress.trim().slice(0, 300) }
              : {}),
            ...(typeof input.defaultPickupLat === 'number' ? { defaultPickupLat: input.defaultPickupLat } : {}),
            ...(typeof input.defaultPickupLng === 'number' ? { defaultPickupLng: input.defaultPickupLng } : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        showToast(t('Profil mis à jour.', 'Profile updated.'), 'success');
        return true;
      } catch (err) {
        showToast(t('Impossible de mettre à jour le profil.', 'Could not update profile.'), 'error');
        if (!useSupabase) handleFirestoreError(err, OperationType.WRITE, 'businesses');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, useSupabase, refreshSupabaseWorkspace, updateProfileFields, business, uid, profile, showToast, t, currency]
  );

  const submitSupportMessage = useCallback(
    async (input: {
      category: 'failed_delivery' | 'damage' | 'delay' | 'dispute' | 'refund' | 'driver_report';
      description: string;
      deliveryId?: string;
    }): Promise<boolean> => {
      if (!input.description.trim()) return false;
      setBusy(true);
      try {
        if (useSupabase) {
          if (uid) {
            await supabaseApiFetch('/api/v1/incidents', {
              method: 'POST',
              body: JSON.stringify({
                deliveryId: input.deliveryId,
                reporterRole: profile?.role || 'merchant',
                category: input.category,
                description: input.description.trim().slice(0, 1000),
              }),
            });
          } else {
            await fetch('/api/v1/waitlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: 'Support ROVA',
                email: 'support@rova.app',
                message: input.description.trim().slice(0, 1000),
                platform: 'contact',
              }),
            });
          }
          setSupportSheetOpen(false);
          setSupportContextDeliveryId(undefined);
          showToast(t('Votre message a bien été transmis au support ROVA.', 'Your message has been sent to ROVA Support.'), 'success');
          return true;
        }
        if (uid) {
          await addDoc(collection(db, 'incidents'), {
            ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
            reportedByUid: uid,
            reporterRole: profile?.role || 'merchant',
            category: input.category,
            description: input.description.trim().slice(0, 1000),
            status: 'open',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, 'waitlist'), {
            name: 'Support ROVA',
            email: 'support@rova.app',
            message: input.description.trim().slice(0, 1000),
            platform: 'contact',
            createdAt: serverTimestamp(),
          });
        }
        setSupportSheetOpen(false);
        setSupportContextDeliveryId(undefined);
        showToast(t('Votre message a bien été transmis au support ROVA.', 'Your message has been sent to ROVA Support.'), 'success');
        return true;
      } catch (err) {
        showToast(t('Envoi impossible. Réessayez dans un instant.', 'Could not send message. Please retry.'), 'error');
        if (!useSupabase) handleFirestoreError(err, OperationType.CREATE, 'incidents');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [uid, useSupabase, profile, showToast, t]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!uid) return;
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    try {
      if (useSupabase) {
        await supabaseApiFetch('/api/v1/notifications/read-all', { method: 'PATCH' });
        await refreshSupabaseWorkspace();
        return;
      }
      const batch = writeBatch(db);
      unread.slice(0, 25).forEach((n) => {
        batch.update(doc(db, 'notifications', n.id), { read: true });
      });
      await batch.commit();
    } catch {
      // Non-blocking
    }
  }, [uid, useSupabase, refreshSupabaseWorkspace, notifications]);

  return (
    <RovaAppContext.Provider
      value={{
        loadingData,
        business,
        deliveries,
        reservations,
        recipients,
        onlineDrivers,
        pricingRules,
        notifications,
        activeDeliveries,
        upcomingReservations,
        unreadNotifCount,
        shipmentFilter,
        setShipmentFilter,
        activityFilter,
        setActivityFilter,
        preferredPayment,
        setPreferredPayment,
        notificationsEnabled,
        setNotificationsEnabled,
        draft,
        setDraft,
        resetDraft,
        composerOpen,
        openComposer,
        closeComposer,
        reservationSheetOpen,
        openReservationSheet: () => setReservationSheetOpen(true),
        closeReservationSheet: () => setReservationSheetOpen(false),
        selectedDeliveryId,
        selectedDelivery,
        openShipmentDetail: (id: string) => setSelectedDeliveryId(id),
        closeShipmentDetail: () => setSelectedDeliveryId(null),
        trackSheetOpen,
        openTrackSheet: () => setTrackSheetOpen(true),
        closeTrackSheet: () => setTrackSheetOpen(false),
        supportSheetOpen,
        openSupportSheet: (deliveryId?: string) => {
          setSupportContextDeliveryId(deliveryId);
          setSupportSheetOpen(true);
        },
        closeSupportSheet: () => {
          setSupportSheetOpen(false);
          setSupportContextDeliveryId(undefined);
        },
        supportContextDeliveryId,
        toast,
        showToast,
        dismissToast,
        busy,
        requestSignIn: onSignIn,
        submitDelivery,
        cancelDelivery,
        repeatDelivery,
        submitReservation,
        previewCancelReservation,
        cancelReservation,
        rescheduleReservation,
        saveRecipient,
        deleteRecipient,
        saveBusinessProfile,
        submitSupportMessage,
        markAllNotificationsRead,
      }}
    >
      {children}
    </RovaAppContext.Provider>
  );
}

export function useRovaApp() {
  const ctx = useContext(RovaAppContext);
  if (!ctx) throw new Error('useRovaApp must be used inside RovaAppProvider');
  return ctx;
}
