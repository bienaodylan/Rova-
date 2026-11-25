import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  DollarSign,
  LogOut,
  MapPin,
  Navigation,
  Package,
  Power,
  Radio,
  ShieldCheck,
  Truck,
  User,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { LanguageSelector, useLanguage } from '../context/LanguageContext';
import {
  DeliveryRecord,
  DeliveryStatus,
  DeliveryStopRecord,
  DriverRecord,
  EquipmentAssignmentRecord,
  VehicleCategory,
} from '../types/rova';
import {
  formatMoney,
  getNextDriverStatus,
  getStatusLabel,
  getVehicleLabel,
  haversineDistanceKm,
  STATUS_META,
  VEHICLE_CATALOG,
} from '../lib/logistics';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';
import { SignaturePad } from '../components/SignaturePad';

type DriverTab = 'radar' | 'active' | 'earnings' | 'profile';

interface DriverWorkspaceProps {
  workspaceSwitcher?: React.ReactNode;
  onRequestSignIn?: () => void;
}

export function DriverWorkspace({ workspaceSwitcher, onRequestSignIn }: DriverWorkspaceProps) {
  const { firebaseUser, profile, logout } = useAuth();
  const { lang, t } = useLanguage();
  const uid = firebaseUser?.uid || '';

  const [tab, setTab] = useState<DriverTab>('radar');
  const [driver, setDriver] = useState<DriverRecord | null>(null);
  const [loadingDriver, setLoadingDriver] = useState(Boolean(uid));
  const [pendingJobs, setPendingJobs] = useState<DeliveryRecord[]>([]);
  const [myDeliveries, setMyDeliveries] = useState<DeliveryRecord[]>([]);
  const [activeStops, setActiveStops] = useState<DeliveryStopRecord[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentAssignmentRecord[]>([]);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Driver onboarding registration form
  const [regForm, setRegForm] = useState({
    fullName: profile?.displayName || '',
    phone: profile?.phone || '',
    partnerType: 'independent' as DriverRecord['partnerType'],
    vehicleCategory: 'motorcycle' as VehicleCategory,
    vehiclePlate: '',
    licenseNumber: '',
    insuranceRef: '',
    serviceArea: 'Abidjan / Grand Abidjan',
  });

  // Proof of Delivery modal state
  const [podStop, setPodStop] = useState<DeliveryStopRecord | null>(null);
  const [podOtp, setPodOtp] = useState('');
  const [podSignature, setPodSignature] = useState('');
  const [podPhoto, setPodPhoto] = useState('');
  const [podNotes, setPodNotes] = useState('');

  // Incident modal
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentCategory, setIncidentCategory] = useState<
    'failed_delivery' | 'damage' | 'delay' | 'driver_report'
  >('delay');
  const [incidentDesc, setIncidentDesc] = useState('');

  const watchIdRef = useRef<number | null>(null);
  const lastGpsPushRef = useRef<number>(0);

  const flash = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner((p) => (p === msg ? null : p)), 4500);
  };

  useEffect(() => {
    if (!uid) {
      setDriver(null);
      setPendingJobs([]);
      setMyDeliveries([]);
      setEquipmentList([]);
      setLoadingDriver(false);
      return;
    }

    setLoadingDriver(true);
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'drivers', uid),
        (snap) => {
          setDriver(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<DriverRecord, 'id'>) }) : null);
          setLoadingDriver(false);
        },
        (err) => {
          setLoadingDriver(false);
          handleFirestoreError(err, OperationType.GET, `drivers/${uid}`);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'deliveries'), where('status', '==', 'pending'), where('driverUid', '==', '')),
        (snap) =>
          setPendingJobs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'deliveries')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'deliveries'), where('driverUid', '==', uid), orderBy('createdAt', 'desc')),
        (snap) =>
          setMyDeliveries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryRecord, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'deliveries')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'equipmentAssignments'), where('driverId', '==', uid)),
        (snap) =>
          setEquipmentList(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EquipmentAssignmentRecord, 'id'>) }))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'equipmentAssignments')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const activeDelivery = useMemo(
    () => myDeliveries.find((d) => !['delivered', 'failed', 'cancelled'].includes(d.status)) || null,
    [myDeliveries]
  );

  // Subscribe to stops of active delivery
  useEffect(() => {
    if (!uid || !activeDelivery) {
      setActiveStops([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'deliveries', activeDelivery.id, 'stops'),
        where('driverUid', '==', uid)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryStopRecord, 'id'>) }))
          .sort((a, b) => a.sequence - b.sequence);
        setActiveStops(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `deliveries/${activeDelivery.id}/stops`)
    );
    return () => unsub();
  }, [uid, activeDelivery?.id]);

  const currentStop = useMemo(
    () => activeStops.find((s) => s.status !== 'delivered' && s.status !== 'failed') || null,
    [activeStops]
  );

  // Real browser GPS watchPosition when online & approved
  useEffect(() => {
    const clearWatch = () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };

    if (!uid || !driver || driver.approvalStatus !== 'approved' || !driver.isOnline) {
      clearWatch();
      return;
    }

    if (!navigator.geolocation) {
      setGpsNotice(t('Géolocalisation navigateur indisponible.', 'Browser geolocation unavailable.'));
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastGpsPushRef.current < 8000) return;
        lastGpsPushRef.current = now;
        const { latitude, longitude } = pos.coords;
        setGpsNotice(null);

        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'drivers', uid), {
            currentLat: latitude,
            currentLng: longitude,
            updatedAt: serverTimestamp(),
          });
          batch.update(doc(db, 'driverDispatch', uid), {
            currentLat: latitude,
            currentLng: longitude,
            updatedAt: serverTimestamp(),
          });
          if (activeDelivery) {
            batch.update(doc(db, 'deliveries', activeDelivery.id), {
              driverLat: latitude,
              driverLng: longitude,
              updatedAt: serverTimestamp(),
            });
            if (currentStop?.trackingToken) {
              const dist = haversineDistanceKm(latitude, longitude, currentStop.lat, currentStop.lng);
              const etaMin = Math.max(2, Math.round((dist / 26) * 60));
              batch.update(doc(db, 'publicTracking', currentStop.trackingToken), {
                driverLat: latitude,
                driverLng: longitude,
                etaMinutes: etaMin,
                showLiveDriver: true,
                updatedAt: serverTimestamp(),
              });
            }
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `drivers/${uid}`);
        }
      },
      () => {
        setGpsNotice(
          t(
            'Activez l’autorisation GPS du navigateur pour diffuser votre position réelle.',
            'Allow browser GPS permission to broadcast your real location.'
          )
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return clearWatch;
  }, [uid, driver?.isOnline, driver?.approvalStatus, activeDelivery?.id, currentStop?.id]);

  // Fetch road polyline for active delivery
  useEffect(() => {
    if (!activeDelivery) {
      setRouteCoords([]);
      return;
    }
    const pts: Array<{ lat: number; lng: number }> = [];
    if (typeof driver?.currentLat === 'number' && typeof driver?.currentLng === 'number') {
      pts.push({ lat: driver.currentLat, lng: driver.currentLng });
    }
    pts.push({ lat: activeDelivery.pickupLat, lng: activeDelivery.pickupLng });
    activeStops.forEach((s) => pts.push({ lat: s.lat, lng: s.lng }));
    if (pts.length < 2) return;

    let cancelled = false;
    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: pts }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.geometry)) {
          setRouteCoords(data.geometry);
        }
      })
      .catch(() => {
        if (!cancelled) setRouteCoords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDelivery?.id, activeStops.length]);

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) {
      onRequestSignIn?.();
      return;
    }
    if (!regForm.fullName.trim() || !regForm.vehiclePlate.trim() || !regForm.licenseNumber.trim()) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      const driverPayload: Record<string, unknown> = {
        uid,
        fullName: regForm.fullName.trim().slice(0, 120),
        phone: regForm.phone.trim().slice(0, 40) || '+225 07 00 00 00 00',
        partnerType: regForm.partnerType,
        vehicleCategory: regForm.vehicleCategory,
        vehiclePlate: regForm.vehiclePlate.trim().toUpperCase().slice(0, 40),
        licenseNumber: regForm.licenseNumber.trim().slice(0, 80),
        serviceArea: regForm.serviceArea.trim().slice(0, 120) || 'Abidjan',
        approvalStatus: 'pending',
        isOnline: false,
        rating: 5,
        completedDeliveries: 0,
        acceptanceRate: 100,
        earningsTotal: 0,
        activeDeliveryCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (regForm.insuranceRef.trim()) {
        driverPayload.insuranceRef = regForm.insuranceRef.trim().slice(0, 120);
      }

      const firstName = regForm.fullName.trim().split(' ')[0] || 'Livreur';
      batch.set(doc(db, 'drivers', uid), driverPayload);
      batch.set(doc(db, 'driverDispatch', uid), {
        uid,
        firstName: firstName.slice(0, 80),
        partnerType: regForm.partnerType,
        vehicleCategory: regForm.vehicleCategory,
        serviceArea: regForm.serviceArea.trim().slice(0, 120) || 'Abidjan',
        approvalStatus: 'pending',
        isOnline: false,
        currentLat: 5.3235,
        currentLng: -4.0267,
        rating: 5,
        completedDeliveries: 0,
        acceptanceRate: 100,
        activeDeliveryCount: 0,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      flash(
        t(
          'Dossier chauffeur envoyé au Centre d’Opérations ROVA pour validation.',
          'Driver onboarding submitted to ROVA Operations for approval.'
        )
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `drivers/${uid}`);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleOnline = async () => {
    if (!uid || !driver) {
      onRequestSignIn?.();
      return;
    }
    if (driver.approvalStatus !== 'approved') {
      flash(
        t(
          'Votre compte doit d’abord être validé dans le Centre d’Opérations.',
          'Your account must be approved in Operations before going online.'
        )
      );
      return;
    }
    const nextOnline = !driver.isOnline;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'drivers', uid), {
        isOnline: nextOnline,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'driverDispatch', uid), {
        isOnline: nextOnline,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      flash(
        nextOnline
          ? t('Vous êtes maintenant EN LIGNE (GPS actif).', 'You are now ONLINE (GPS active).')
          : t('Vous êtes HORS LIGNE. Suivi GPS arrêté.', 'You are OFFLINE. GPS tracking stopped.')
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `drivers/${uid}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClaimJob = async (job: DeliveryRecord) => {
    if (!uid || !driver || driver.approvalStatus !== 'approved') return;
    setBusy(true);
    try {
      const lat = driver.currentLat ?? 5.3235;
      const lng = driver.currentLng ?? -4.0267;
      await updateDoc(doc(db, 'deliveries', job.id), {
        driverUid: uid,
        driverName: driver.fullName.slice(0, 120),
        status: 'driver_assigned',
        driverLat: lat,
        driverLng: lng,
        updatedAt: serverTimestamp(),
      });

      const stopIds = job.stopIds || [];
      const firstName = driver.fullName.trim().split(' ')[0] || 'Livreur';
      if (stopIds.length > 0) {
        const batch = writeBatch(db);
        for (const sId of stopIds) {
          const sSnap = await getDoc(doc(db, 'deliveries', job.id, 'stops', sId));
          if (!sSnap.exists()) continue;
          const stopData = sSnap.data() as DeliveryStopRecord;
          batch.update(sSnap.ref, {
            driverUid: uid,
            status: 'driver_assigned',
            updatedAt: serverTimestamp(),
          });
          if (stopData.trackingToken) {
            batch.update(doc(db, 'publicTracking', stopData.trackingToken), {
              driverUid: uid,
              driverFirstName: firstName.slice(0, 80),
              status: 'driver_assigned',
              driverLat: lat,
              driverLng: lng,
              showLiveDriver: stopData.sequence === 1,
              updatedAt: serverTimestamp(),
            });
          }
        }
        await batch.commit();
      }

      await addDoc(collection(db, 'notifications'), {
        userId: job.merchantUid,
        title: t(`Livreur assigné : ${job.reference}`, `Driver assigned: ${job.reference}`),
        message: t(
          `${driver.fullName} a accepté votre course.`,
          `${driver.fullName} accepted your delivery.`
        ),
        eventType: 'driver_assigned',
        deliveryId: job.id,
        read: false,
        createdAt: serverTimestamp(),
      });

      setTab('active');
      flash(t(`Course ${job.reference} acceptée.`, `Accepted delivery ${job.reference}.`));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveries/${job.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAdvanceStatus = async () => {
    if (!uid || !driver || !activeDelivery) return;
    const step = getNextDriverStatus(activeDelivery.status, lang);
    if (!step) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'deliveries', activeDelivery.id), {
        status: step.next,
        updatedAt: serverTimestamp(),
      });

      if (currentStop) {
        batch.update(doc(db, 'deliveries', activeDelivery.id, 'stops', currentStop.id), {
          status: step.next,
          updatedAt: serverTimestamp(),
        });
        if (currentStop.trackingToken) {
          batch.update(doc(db, 'publicTracking', currentStop.trackingToken), {
            status: step.next,
            showLiveDriver: true,
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
      flash(t(`Statut mis à jour : ${getStatusLabel(step.next, 'fr')}`, `Status updated: ${step.next}`));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveries/${activeDelivery.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteStopWithPod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !driver || !activeDelivery || !podStop) return;

    if (activeDelivery.proofRequired === 'otp' || activeDelivery.proofRequired === 'pin') {
      if (podOtp.trim() !== podStop.otpCode) {
        flash(t('Code OTP incorrect. Vérifiez auprès du destinataire.', 'Invalid OTP code.'));
        return;
      }
    }

    setBusy(true);
    try {
      const nextCompleted = activeDelivery.completedStopCount + 1;
      const isFinalStop = nextCompleted >= activeDelivery.stopCount;
      const nextStop = activeStops.find((s) => s.sequence > podStop.sequence && s.status !== 'delivered');

      const batch = writeBatch(db);

      const proofVal =
        activeDelivery.proofRequired === 'signature'
          ? podSignature.slice(0, 115000)
          : activeDelivery.proofRequired === 'photo'
          ? podPhoto.slice(0, 115000)
          : podOtp.trim() || 'CONFIRMED';

      batch.update(doc(db, 'deliveries', activeDelivery.id, 'stops', podStop.id), {
        status: 'delivered',
        proofType: activeDelivery.proofRequired,
        proofValue: proofVal,
        ...(podNotes.trim() ? { proofNotes: podNotes.trim().slice(0, 300) } : {}),
        updatedAt: serverTimestamp(),
      });

      if (podStop.trackingToken) {
        batch.update(doc(db, 'publicTracking', podStop.trackingToken), {
          status: 'delivered',
          showLiveDriver: false,
          updatedAt: serverTimestamp(),
        });
      }

      if (nextStop && !isFinalStop) {
        batch.update(doc(db, 'deliveries', activeDelivery.id, 'stops', nextStop.id), {
          status: 'in_transit',
          updatedAt: serverTimestamp(),
        });
        if (nextStop.trackingToken) {
          batch.update(doc(db, 'publicTracking', nextStop.trackingToken), {
            status: 'in_transit',
            showLiveDriver: true,
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.update(doc(db, 'deliveries', activeDelivery.id), {
        completedStopCount: nextCompleted,
        status: isFinalStop ? 'delivered' : 'in_transit',
        updatedAt: serverTimestamp(),
      });

      if (isFinalStop) {
        const driverEarning = Math.round(activeDelivery.quotedPrice * 0.85 * 100) / 100;
        batch.update(doc(db, 'drivers', uid), {
          completedDeliveries: driver.completedDeliveries + 1,
          earningsTotal: Number((driver.earningsTotal + driverEarning).toFixed(2)),
          activeDeliveryCount: Math.max(0, driver.activeDeliveryCount - 1),
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'driverDispatch', uid), {
          completedDeliveries: driver.completedDeliveries + 1,
          activeDeliveryCount: Math.max(0, driver.activeDeliveryCount - 1),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      setPodStop(null);
      setPodOtp('');
      setPodSignature('');
      setPodPhoto('');
      setPodNotes('');
      flash(
        isFinalStop
          ? t('Livraison terminée et preuve enregistrée !', 'Delivery completed with proof!')
          : t('Arrêt validé. Passage automatique au destinataire suivant.', 'Stop delivered. Advancing to next stop.')
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `deliveries/${activeDelivery.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPodPhoto(reader.result.slice(0, 115000));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) {
      onRequestSignIn?.();
      return;
    }
    if (incidentDesc.trim().length < 5) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'incidents'), {
        ...(activeDelivery ? { deliveryId: activeDelivery.id } : {}),
        reportedByUid: uid,
        reporterRole: 'driver',
        category: incidentCategory,
        description: incidentDesc.trim().slice(0, 1000),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setIncidentOpen(false);
      setIncidentDesc('');
      flash(t('Incident transmis au Centre d’Opérations.', 'Incident reported to Operations.'));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'incidents');
    } finally {
      setBusy(false);
    }
  };

  const activeMapMarkers: MapMarkerItem[] = useMemo(() => {
    if (!activeDelivery) return [];
    const m: MapMarkerItem[] = [
      {
        id: 'pickup',
        lat: activeDelivery.pickupLat,
        lng: activeDelivery.pickupLng,
        kind: 'pickup',
        label: `${t('Collecte', 'Pickup')}: ${activeDelivery.pickupAddress}`,
      },
    ];
    activeStops.forEach((s) =>
      m.push({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        kind: 'stop',
        sequence: s.sequence,
        label: `#${s.sequence} ${s.recipientName}`,
      })
    );
    if (typeof driver?.currentLat === 'number' && typeof driver?.currentLng === 'number') {
      m.push({
        id: 'me',
        lat: driver.currentLat,
        lng: driver.currentLng,
        kind: 'driver',
        label: t('Ma position GPS', 'My GPS position'),
      });
    }
    return m;
  }, [activeDelivery, activeStops, driver?.currentLat, driver?.currentLng, t]);

  const completedDeliveries = useMemo(
    () => myDeliveries.filter((d) => d.status === 'delivered'),
    [myDeliveries]
  );

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-950 py-0 sm:py-8 px-0 sm:px-4 flex justify-center">
      {/* Mobile-First App Shell (Rounded Phone Frame on Desktop) */}
      <div className="w-full max-w-md bg-white sm:rounded-[2rem] sm:border sm:border-neutral-200 sm:shadow-sm flex flex-col min-h-screen sm:min-h-[780px] overflow-hidden">
        {/* Top App Bar */}
        <header className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between gap-2 bg-white sticky top-0 z-20">
          <div>
            <span className="font-display text-sm font-extrabold tracking-[0.2em]">ROVA</span>
            <p className="text-[11px] text-neutral-500">
              {t('Application Livreur', 'Driver App')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSelector compact />
            {workspaceSwitcher}
            {uid ? (
              <button
                type="button"
                onClick={logout}
                title={t('Déconnexion', 'Sign out')}
                className="p-2 rounded-full border border-neutral-200 text-neutral-600 hover:text-neutral-950"
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
        </header>

        {/* Online / Offline GPS Header Control */}
        <div className="px-5 py-3.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-neutral-950 truncate">
              {driver
                ? driver.isOnline
                  ? t('En ligne · GPS actif', 'Online · GPS active')
                  : t('Hors ligne', 'Offline')
                : t('Mode découverte · Départ à zéro', 'Preview mode · Starting fresh')}
            </p>
            <p className="text-[11px] text-neutral-500 truncate">
              {driver
                ? `${getVehicleLabel(driver.vehicleCategory, lang)} · ${driver.vehiclePlate}`
                : t('Inscrivez votre véhicule dans l’onglet Profil', 'Register your vehicle in Profile tab')}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleToggleOnline}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-colors shrink-0 ${
              driver?.isOnline
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-neutral-950 text-white hover:bg-neutral-800'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            {driver?.isOnline ? t('Passer hors ligne', 'Go offline') : t('Passer en ligne', 'Go online')}
          </button>
        </div>

        {/* Driver Sub-Navigation Segmented Pill Bar */}
        <nav
          aria-label={t('Sections livreur', 'Driver sections')}
          className="px-4 py-2.5 bg-white border-b border-neutral-200 grid grid-cols-4 gap-1.5"
        >
          {[
            { id: 'radar', label: t('Radar', 'Radar'), icon: Radio },
            { id: 'active', label: t('Course', 'Active'), icon: Navigation },
            { id: 'earnings', label: t('Revenus', 'Earnings'), icon: DollarSign },
            { id: 'profile', label: t('Profil', 'Profile'), icon: User },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as DriverTab)}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-full text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'bg-neutral-950 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-950'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {(banner || gpsNotice) && (
          <div className="bg-neutral-950 text-white px-5 py-2.5 text-xs flex items-center justify-between gap-2">
            <span>{banner || gpsNotice}</span>
            <button
              type="button"
              onClick={() => {
                setBanner(null);
                setGpsNotice(null);
              }}
              className="text-neutral-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          {loadingDriver ? (
            <div className="py-16 text-center text-xs text-neutral-500">
              {t('Chargement du profil chauffeur...', 'Loading driver profile...')}
            </div>
          ) : (
            <>
              {/* TAB 1: DISPATCH RADAR */}
              {tab === 'radar' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold">
                      {t('Radar de courses', 'Dispatch Radar')}
                    </h2>
                    <span className="font-mono text-xs text-neutral-500 tabular-nums">
                      {pendingJobs.length} {t('disponibles', 'available')}
                    </span>
                  </div>

                  {driver && driver.approvalStatus !== 'approved' && (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
                      <p className="font-semibold">
                        {t('Validation requise par les Opérations', 'Operations verification pending')}
                      </p>
                      <p>
                        {t(
                          'Votre dossier est actuellement en attente. Une fois validé dans le Centre d’Opérations, vous pourrez accepter des courses.',
                          'Your profile is pending review. Once approved in Operations, you can accept deliveries.'
                        )}
                      </p>
                    </div>
                  )}

                  {pendingJobs.length === 0 ? (
                    <div className="rounded-3xl border border-neutral-200 p-8 text-center space-y-3 bg-neutral-50/50">
                      <div className="w-11 h-11 rounded-2xl bg-white border border-neutral-200 mx-auto flex items-center justify-center">
                        <Radio className="w-5 h-5 text-neutral-500" />
                      </div>
                      <p className="text-sm font-semibold">
                        {t('Aucune course en attente', 'No pending deliveries')}
                      </p>
                      <p className="text-xs text-neutral-500 leading-relaxed">
                        {t(
                          'Départ à zéro : dès qu’un marchand publiera une livraison depuis l’Espace Marchand, elle apparaîtra instantanément ici.',
                          'Starting fresh: as soon as a merchant publishes a delivery from the Merchant Workspace, it appears here live.'
                        )}
                      </p>
                    </div>
                  ) : (
                    pendingJobs.map((job) => (
                      <div key={job.id} className="rounded-3xl border border-neutral-200 p-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold">{job.reference}</span>
                          <span className="font-mono text-sm font-bold tabular-nums">
                            {formatMoney(job.quotedPrice * 0.85, job.currency)}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-600 space-y-1">
                          <p>
                            <strong className="text-neutral-950">{t('Collecte', 'Pickup')}:</strong>{' '}
                            {job.pickupAddress}
                          </p>
                          {job.primaryDestinationLabel && (
                            <p>
                              <strong className="text-neutral-950">{t('Destination', 'Drop-off')}:</strong>{' '}
                              {job.primaryDestinationLabel}
                            </p>
                          )}
                          <p className="font-mono text-[11px] text-neutral-500">
                            {getVehicleLabel(job.vehicleCategory, lang)} · {job.totalDistanceKm.toFixed(1)} km ·{' '}
                            {job.stopCount} {t('arrêt(s)', 'stop(s)')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy || driver?.approvalStatus !== 'approved'}
                          onClick={() => handleClaimJob(job)}
                          className="w-full py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-40"
                        >
                          {t('Accepter la course', 'Accept delivery')}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 2: ACTIVE DELIVERY */}
              {tab === 'active' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold">
                      {t('Livraison en cours', 'Active Delivery')}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setIncidentOpen(true)}
                      className="inline-flex items-center gap-1 text-xs text-neutral-600 hover:text-red-700"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {t('Signaler un incident', 'Report issue')}
                    </button>
                  </div>

                  {!activeDelivery ? (
                    <div className="rounded-3xl border border-neutral-200 p-8 text-center space-y-3 bg-neutral-50/50">
                      <div className="w-11 h-11 rounded-2xl bg-white border border-neutral-200 mx-auto flex items-center justify-center">
                        <Navigation className="w-5 h-5 text-neutral-500" />
                      </div>
                      <p className="text-sm font-semibold">
                        {t('Aucune course active', 'No active delivery')}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {t(
                          'Acceptez une course depuis le Radar pour lancer la navigation et les preuves de livraison.',
                          'Accept a delivery from the Radar to start navigation and proof of delivery.'
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-neutral-200 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-bold">{activeDelivery.reference}</span>
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span className={`w-2 h-2 rounded-full ${STATUS_META[activeDelivery.status].dot}`} />
                            {getStatusLabel(activeDelivery.status, lang)}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600">
                          {activeDelivery.merchantName} · {activeDelivery.completedStopCount}/{activeDelivery.stopCount}{' '}
                          {t('arrêts livrés', 'stops completed')}
                        </p>
                      </div>

                      <RovaMap
                        center={[activeDelivery.pickupLat, activeDelivery.pickupLng]}
                        zoom={13}
                        markers={activeMapMarkers}
                        routeCoordinates={routeCoords}
                        heightClass="h-[220px]"
                      />

                      {/* Primary Action Step Button */}
                      {(() => {
                        const nextStep = getNextDriverStatus(activeDelivery.status, lang);
                        if (nextStep) {
                          return (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={handleAdvanceStatus}
                              className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800"
                            >
                              {nextStep.actionLabel}
                            </button>
                          );
                        }
                        if (activeDelivery.status === 'arrived' && currentStop) {
                          return (
                            <button
                              type="button"
                              onClick={() => setPodStop(currentStop)}
                              className="w-full py-3 rounded-full bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800"
                            >
                              {t('Valider la preuve de livraison', 'Capture Proof of Delivery')}
                            </button>
                          );
                        }
                        return null;
                      })()}

                      {/* Stop Sequence List */}
                      <div className="space-y-2.5">
                        <p className="text-xs font-semibold text-neutral-700">
                          {t('Arrêts de la tournée', 'Route stops')}
                        </p>
                        {activeStops.map((s) => (
                          <div
                            key={s.id}
                            className={`rounded-2xl border p-4 space-y-1.5 ${
                              s.status === 'delivered'
                                ? 'border-emerald-200 bg-emerald-50/40'
                                : 'border-neutral-200 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold">
                                #{s.sequence} · {s.recipientName}
                              </span>
                              <span className="font-mono text-[11px] text-neutral-500">
                                {getStatusLabel(s.status, lang)}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-600">{s.address}</p>
                            <p className="text-[11px] font-mono text-neutral-500">{s.recipientPhone}</p>
                            {s.status !== 'delivered' && activeDelivery.status === 'arrived' && (
                              <button
                                type="button"
                                onClick={() => setPodStop(s)}
                                className="mt-2 px-4 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium"
                              >
                                {t('Remettre cet arrêt', 'Complete stop')}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: EARNINGS */}
              {tab === 'earnings' && (
                <div className="space-y-4">
                  <h2 className="font-display text-base font-bold">
                    {t('Revenus & Performances', 'Earnings & Performance')}
                  </h2>

                  <div className="rounded-3xl bg-neutral-950 text-white p-6 space-y-1">
                    <p className="text-xs text-neutral-400">
                      {t('Gains cumulés (85% net)', 'Total net earnings (85%)')}
                    </p>
                    <p className="font-mono text-3xl font-bold tabular-nums">
                      {formatMoney(driver?.earningsTotal || 0, 'GHS')}
                    </p>
                    <div className="flex items-center gap-4 pt-3 text-xs text-neutral-300 font-mono">
                      <span>{driver?.completedDeliveries || 0} {t('courses', 'trips')}</span>
                      <span>·</span>
                      <span>{t('Note', 'Rating')}: {(driver?.rating || 5).toFixed(1)}/5</span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold text-neutral-700">
                      {t('Historique des courses terminées', 'Completed deliveries')}
                    </p>
                    {completedDeliveries.length === 0 ? (
                      <div className="rounded-2xl border border-neutral-200 p-6 text-center text-xs text-neutral-500">
                        {t('Aucune course terminée pour le moment (0).', 'No completed trips yet (0).')}
                      </div>
                    ) : (
                      completedDeliveries.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-2xl border border-neutral-200 p-3.5 flex items-center justify-between text-xs"
                        >
                          <div>
                            <p className="font-mono font-bold">{d.reference}</p>
                            <p className="text-neutral-500">{d.merchantName}</p>
                          </div>
                          <span className="font-mono font-semibold tabular-nums">
                            +{formatMoney(d.quotedPrice * 0.85, d.currency)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: PROFILE, ONBOARDING & EQUIPMENT */}
              {tab === 'profile' && (
                <div className="space-y-5">
                  <h2 className="font-display text-base font-bold">
                    {t('Dossier Chauffeur & Équipements', 'Driver Profile & Equipment')}
                  </h2>

                  {!driver ? (
                    <form
                      onSubmit={handleSubmitRegistration}
                      className="rounded-3xl border border-neutral-200 p-5 space-y-3.5"
                    >
                      <p className="text-xs text-neutral-600">
                        {t(
                          'Enregistrez votre véhicule pour soumettre votre dossier au Centre d’Opérations ROVA.',
                          'Register your vehicle to submit your profile to ROVA Operations.'
                        )}
                      </p>
                      <input
                        type="text"
                        required
                        placeholder={t('Nom complet', 'Full name')}
                        value={regForm.fullName}
                        onChange={(e) => setRegForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                      />
                      <input
                        type="tel"
                        required
                        placeholder={t('Téléphone', 'Phone number')}
                        value={regForm.phone}
                        onChange={(e) => setRegForm((p) => ({ ...p, phone: e.target.value }))}
                        className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                      />
                      <select
                        value={regForm.vehicleCategory}
                        onChange={(e) =>
                          setRegForm((p) => ({ ...p, vehicleCategory: e.target.value as VehicleCategory }))
                        }
                        className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-xs"
                      >
                        {VEHICLE_CATALOG.map((v) => (
                          <option key={v.id} value={v.id}>
                            {lang === 'fr' ? v.labelFr : v.label} (≤ {v.maxWeightKg} kg)
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          required
                          placeholder={t('Immatriculation', 'Plate number')}
                          value={regForm.vehiclePlate}
                          onChange={(e) => setRegForm((p) => ({ ...p, vehiclePlate: e.target.value }))}
                          className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-xs"
                        />
                        <input
                          type="text"
                          required
                          placeholder={t('N° de permis', 'License #')}
                          value={regForm.licenseNumber}
                          onChange={(e) => setRegForm((p) => ({ ...p, licenseNumber: e.target.value }))}
                          className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-xs"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder={t('Zone de service (ex. Abidjan)', 'Service area')}
                        value={regForm.serviceArea}
                        onChange={(e) => setRegForm((p) => ({ ...p, serviceArea: e.target.value }))}
                        className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full py-3 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800"
                      >
                        {uid
                          ? t('Soumettre mon dossier chauffeur', 'Submit driver dossier')
                          : t('Connexion Google pour s’inscrire', 'Sign in with Google to register')}
                      </button>
                    </form>
                  ) : (
                    <div className="rounded-3xl border border-neutral-200 p-5 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{driver.fullName}</span>
                        <span className="font-mono uppercase text-[11px] text-neutral-600">
                          {driver.approvalStatus}
                        </span>
                      </div>
                      <p className="text-neutral-600">
                        {getVehicleLabel(driver.vehicleCategory, lang)} · {driver.vehiclePlate}
                      </p>
                      <p className="text-neutral-500">
                        {t('Permis', 'License')}: {driver.licenseNumber} · {driver.serviceArea}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold text-neutral-700">
                      {t('Équipements ROVA attribués', 'Assigned ROVA Equipment')}
                    </p>
                    {equipmentList.length === 0 ? (
                      <div className="rounded-2xl border border-neutral-200 p-5 text-center text-xs text-neutral-500">
                        {t('Aucun équipement attribué pour le moment.', 'No equipment issued yet.')}
                      </div>
                    ) : (
                      equipmentList.map((eq) => (
                        <div
                          key={eq.id}
                          className="rounded-2xl border border-neutral-200 p-3.5 flex items-center justify-between text-xs"
                        >
                          <span className="font-medium">
                            {eq.quantity}x {eq.equipmentName}
                          </span>
                          <span className="font-mono text-[11px] text-neutral-500 uppercase">
                            {eq.status}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Proof of Delivery Modal */}
      {podStop && activeDelivery && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCompleteStopWithPod}
            className="bg-white rounded-3xl border border-neutral-200 max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">
                {t('Preuve de livraison', 'Proof of Delivery')} · #{podStop.sequence}
              </h3>
              <button
                type="button"
                onClick={() => setPodStop(null)}
                className="p-1.5 rounded-full hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-neutral-600">
              {podStop.recipientName} — {podStop.address}
            </p>

            {(activeDelivery.proofRequired === 'otp' || activeDelivery.proofRequired === 'pin') && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t('Code OTP du destinataire', 'Recipient OTP code')}
                </label>
                <input
                  type="text"
                  required
                  value={podOtp}
                  onChange={(e) => setPodOtp(e.target.value)}
                  placeholder="4 chiffres"
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm font-mono tracking-widest"
                />
              </div>
            )}

            {activeDelivery.proofRequired === 'signature' && (
              <SignaturePad onChange={setPodSignature} />
            )}

            {activeDelivery.proofRequired === 'photo' && (
              <label className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 p-5 cursor-pointer hover:bg-neutral-50 text-xs text-neutral-600 gap-2">
                <Camera className="w-5 h-5" />
                <span>
                  {podPhoto
                    ? t('Photo capturée ✓', 'Photo captured ✓')
                    : t('Prendre ou charger une photo du colis remis', 'Take or upload handover photo')}
                </span>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
              </label>
            )}

            <input
              type="text"
              placeholder={t('Notes de remise (optionnel)', 'Handover notes (optional)')}
              value={podNotes}
              onChange={(e) => setPodNotes(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
            />

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800"
            >
              {t('Confirmer la remise', 'Confirm delivery')}
            </button>
          </form>
        </div>
      )}

      {/* Incident Report Modal */}
      {incidentOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitIncident}
            className="bg-white rounded-3xl border border-neutral-200 max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">
                {t('Signaler un incident', 'Report an incident')}
              </h3>
              <button
                type="button"
                onClick={() => setIncidentOpen(false)}
                className="p-1.5 rounded-full hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={incidentCategory}
              onChange={(e) => setIncidentCategory(e.target.value as typeof incidentCategory)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-xs"
            >
              <option value="delay">{t('Retard / Trafic', 'Traffic delay')}</option>
              <option value="failed_delivery">{t('Destinataire absent', 'Recipient unavailable')}</option>
              <option value="damage">{t('Colis endommagé', 'Package damage')}</option>
              <option value="driver_report">{t('Autre incident terrain', 'Other field report')}</option>
            </select>
            <textarea
              required
              minLength={5}
              rows={3}
              placeholder={t('Décrivez brièvement la situation...', 'Briefly describe the issue...')}
              value={incidentDesc}
              onChange={(e) => setIncidentDesc(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-full bg-neutral-950 text-white text-xs font-semibold"
            >
              {t('Envoyer aux Opérations', 'Send to Operations')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
