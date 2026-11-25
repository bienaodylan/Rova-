import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  DollarSign,
  Home,
  LogOut,
  MapPin,
  Navigation,
  Package,
  Power,
  Radio,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { isSupabaseConfigured } from '../lib/supabase';
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
  getNextDriverStatus,
  getStatusLabel,
  getVehicleLabel,
  haversineDistanceKm,
  STATUS_META,
  VEHICLE_CATALOG,
} from '../lib/logistics';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';
import { SignaturePad } from '../components/SignaturePad';
import { RovaWordmark } from '../components/RovaSplashScreen';
import {
  ActivityLedgerIllustration,
  TrackingParcelIllustration,
  UrbanHorizonIllustration,
} from '../components/RovaIllustrations';
import { VehicleIllustration } from '../components/VehicleIllustration';
import { BottomSheet } from '../components/BottomSheet';
import { useHideOnScroll } from '../hooks/useHideOnScroll';

type DriverTab = 'radar' | 'active' | 'earnings' | 'profile';

interface DriverWorkspaceProps {
  workspaceSwitcher?: React.ReactNode;
  onRequestSignIn?: () => void;
  onBackToClient?: () => void;
  onOpenTrackingToken?: (token: string) => void;
}

function computeEtaClock(etaMinutes: number, lang: 'fr' | 'en'): string {
  const safeMin = Math.max(2, Math.round(etaMinutes));
  const arrival = new Date(Date.now() + safeMin * 60_000);
  const clock = arrival.toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return lang === 'fr' ? `${clock} (~${safeMin} min)` : `${clock} (~${safeMin} min)`;
}

export function DriverWorkspace({
  workspaceSwitcher,
  onRequestSignIn,
  onBackToClient,
  onOpenTrackingToken,
}: DriverWorkspaceProps) {
  const { firebaseUser, profile, logout } = useAuth();
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();
  const uid = firebaseUser?.uid || '';
  const useSupabase = isSupabaseConfigured();

  const [tab, setTab] = useState<DriverTab>('radar');
  const [driver, setDriver] = useState<DriverRecord | null>(null);
  const [loadingDriver, setLoadingDriver] = useState(Boolean(uid) && !useSupabase);
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
    fullName: profile?.displayName || firebaseUser?.displayName || '',
    phone: profile?.phone || '',
    partnerType: 'independent' as DriverRecord['partnerType'],
    vehicleCategory: 'motorcycle' as VehicleCategory,
    vehiclePlate: '',
    licenseNumber: '',
    insuranceRef: '',
    serviceArea: `${region.city} / ${region.countryName}`,
  });

  // Proof of Delivery sheet state
  const [podStop, setPodStop] = useState<DeliveryStopRecord | null>(null);
  const [podOtp, setPodOtp] = useState('');
  const [podSignature, setPodSignature] = useState('');
  const [podPhoto, setPodPhoto] = useState('');
  const [podNotes, setPodNotes] = useState('');

  // Incident sheet state
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
    if (!uid || useSupabase) {
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
  }, [uid, useSupabase]);

  const activeDelivery = useMemo(
    () => myDeliveries.find((d) => !['delivered', 'failed', 'cancelled'].includes(d.status)) || null,
    [myDeliveries]
  );

  // Subscribe to stops of active delivery
  useEffect(() => {
    if (!uid || !activeDelivery || useSupabase) {
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
  }, [uid, activeDelivery?.id, useSupabase]);

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

    if (!uid || useSupabase || !driver || driver.approvalStatus !== 'approved' || !driver.isOnline) {
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
            const distToTarget = currentStop
              ? haversineDistanceKm(latitude, longitude, currentStop.lat, currentStop.lng)
              : haversineDistanceKm(latitude, longitude, activeDelivery.pickupLat, activeDelivery.pickupLng);
            const liveEtaMin = Math.max(2, Math.round((distToTarget / 26) * 60));

            batch.update(doc(db, 'deliveries', activeDelivery.id), {
              driverLat: latitude,
              driverLng: longitude,
              estimatedDurationMin: liveEtaMin,
              updatedAt: serverTimestamp(),
            });
            if (currentStop?.trackingToken) {
              batch.update(doc(db, 'publicTracking', currentStop.trackingToken), {
                driverLat: latitude,
                driverLng: longitude,
                etaMinutes: liveEtaMin,
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
  }, [uid, useSupabase, driver?.isOnline, driver?.approvalStatus, activeDelivery?.id, currentStop?.id]);

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
        serviceArea: regForm.serviceArea.trim().slice(0, 120) || region.city,
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
        serviceArea: regForm.serviceArea.trim().slice(0, 120) || region.city,
        approvalStatus: 'pending',
        isOnline: false,
        currentLat: region.lat,
        currentLng: region.lng,
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
      if (!uid) onRequestSignIn?.();
      else setTab('profile');
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
      const lat = driver.currentLat ?? region.lat;
      const lng = driver.currentLng ?? region.lng;
      const etaLabel = computeEtaClock(job.estimatedDurationMin || 18, lang);

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
              etaMinutes: Math.max(5, Math.round(job.estimatedDurationMin || 18)),
              showLiveDriver: stopData.sequence === 1,
              updatedAt: serverTimestamp(),
            });
          }
        }
        await batch.commit();
      }

      await addDoc(collection(db, 'notifications'), {
        userId: job.merchantUid,
        title: t(`Livreur assigné · ${job.reference}`, `Driver assigned · ${job.reference}`),
        message: t(
          `${driver.fullName} a accepté votre course (arrivée estimée ${etaLabel}). Appuyez pour suivre en direct.`,
          `${driver.fullName} accepted your delivery (est. arrival ${etaLabel}). Tap to track live.`
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
      const distKm =
        currentStop && typeof driver.currentLat === 'number' && typeof driver.currentLng === 'number'
          ? haversineDistanceKm(driver.currentLat, driver.currentLng, currentStop.lat, currentStop.lng)
          : activeDelivery.totalDistanceKm || 4;
      const nextEtaMin =
        step.next === 'arrived' ? 1 : Math.max(3, Math.round((distKm / 26) * 60));
      const etaLabel = computeEtaClock(nextEtaMin, lang);

      const batch = writeBatch(db);
      batch.update(doc(db, 'deliveries', activeDelivery.id), {
        status: step.next,
        estimatedDurationMin: nextEtaMin,
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
            etaMinutes: nextEtaMin,
            showLiveDriver: true,
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();

      // Emit real live notification to the sender (expéditeur)
      const statusMessages: Partial<Record<DeliveryStatus, string>> = {
        driver_approaching_pickup: t(
          `${driver.fullName} est en route vers le point de collecte. Appuyez pour suivre sur la carte.`,
          `${driver.fullName} is heading to pickup. Tap to follow live.`
        ),
        package_collected: t(
          `${driver.fullName} a récupéré la marchandise et démarre la livraison (arrivée estimée ${etaLabel}).`,
          `${driver.fullName} collected the cargo and is departing (est. arrival ${etaLabel}).`
        ),
        in_transit: t(
          `${driver.fullName} est en route avec votre marchandise · Arrivée estimée ${etaLabel}. Appuyez pour suivre.`,
          `${driver.fullName} is in transit with your shipment · Est. arrival ${etaLabel}. Tap to track.`
        ),
        arrived: t(
          `${driver.fullName} est arrivé chez ${currentStop?.recipientName || 'le destinataire'} pour la remise.`,
          `${driver.fullName} has arrived at ${currentStop?.recipientName || 'the recipient'} for handover.`
        ),
      };

      await addDoc(collection(db, 'notifications'), {
        userId: activeDelivery.merchantUid,
        title: `${getStatusLabel(step.next, lang)} · ${activeDelivery.reference}`,
        message:
          statusMessages[step.next] ||
          t('Mise à jour en direct de votre livraison. Appuyez pour suivre.', 'Live delivery update. Tap to view.'),
        eventType: step.next,
        deliveryId: activeDelivery.id,
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});

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
          etaMinutes: 0,
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

      // Notify sender of handover completion
      await addDoc(collection(db, 'notifications'), {
        userId: activeDelivery.merchantUid,
        title: isFinalStop
          ? t(`Livraison terminée · ${activeDelivery.reference}`, `Delivery completed · ${activeDelivery.reference}`)
          : t(`Arrêt #${podStop.sequence} livré · ${activeDelivery.reference}`, `Stop #${podStop.sequence} delivered · ${activeDelivery.reference}`),
        message: isFinalStop
          ? t(
              `${driver.fullName} a remis le colis à ${podStop.recipientName} avec preuve validée.`,
              `${driver.fullName} delivered to ${podStop.recipientName} with verified proof.`
            )
          : t(
              `Remis à ${podStop.recipientName}. En route vers l’arrêt suivant.`,
              `Delivered to ${podStop.recipientName}. Heading to next stop.`
            ),
        eventType: isFinalStop ? 'delivered' : 'in_transit',
        deliveryId: activeDelivery.id,
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});

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

  const firstName = useMemo(() => {
    const raw = driver?.fullName || profile?.displayName || firebaseUser?.displayName || '';
    return raw.trim().split(' ')[0] || '';
  }, [driver?.fullName, profile?.displayName, firebaseUser?.displayName]);

  const driverNavItems: Array<{
    id: DriverTab;
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    badge?: number;
  }> = [
    { id: 'radar', label: t('Accueil', 'Home'), icon: Home, badge: pendingJobs.length },
    { id: 'active', label: t('Courses', 'Runs'), icon: Navigation, badge: activeDelivery ? 1 : 0 },
    { id: 'earnings', label: t('Revenus', 'Earnings'), icon: DollarSign },
    { id: 'profile', label: t('Compte', 'Account'), icon: User },
  ];

  return (
    <div className="min-h-screen bg-[#f8f8f9] text-neutral-950 flex flex-col">
      {/* Unified Main Content Area — Exact same responsive structure as RovaHomeView / RovaShipmentsView */}
      <main className="flex-1 pb-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-7 pb-8 space-y-6">
          {/* Minimal Auto-Hide Mobile Header matching main ROVA app */}
          <header
            className={`sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center justify-between gap-3 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none sm:static sm:mx-0 sm:px-0 sm:py-0 sm:translate-y-0 sm:pointer-events-auto sm:bg-transparent sm:backdrop-blur-none sm:border-none ${
              headerHidden ? '-translate-y-full pointer-events-none' : 'translate-y-0'
            } ${
              headerScrolled
                ? 'bg-[#f8f8f9]/92 backdrop-blur-md border-b border-neutral-200/70'
                : 'bg-transparent border-b border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <RovaWordmark size="md" />
              <span className="text-neutral-300 text-sm" aria-hidden="true">
                /
              </span>
              <span className="text-xs font-medium text-neutral-500 whitespace-nowrap">
                {t('Livreur', 'Driver')}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onBackToClient && (
                <button
                  type="button"
                  onClick={onBackToClient}
                  className="min-h-[40px] px-3.5 rounded-full bg-white border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-neutral-500" />
                  <span>{t('Mode Client', 'Client App')}</span>
                </button>
              )}

              {workspaceSwitcher}

              <button
                type="button"
                disabled={busy}
                onClick={handleToggleOnline}
                className={`min-h-[40px] px-3.5 sm:px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                  driver?.isOnline
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-neutral-950 text-white hover:bg-neutral-800'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>
                  {driver?.isOnline ? t('En ligne', 'Online') : t('Passer en ligne', 'Go online')}
                </span>
              </button>
            </div>
          </header>

          {/* Inline Live Status / GPS Toast Strip */}
          {(banner || gpsNotice) && (
            <div className="rounded-2xl bg-neutral-950 text-white px-4 py-3 text-xs flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                <span className="truncate">{banner || gpsNotice}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setBanner(null);
                  setGpsNotice(null);
                }}
                aria-label={t('Fermer', 'Close')}
                className="text-neutral-400 hover:text-white shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {loadingDriver ? (
            <div className="py-20 text-center text-xs text-neutral-500">
              {t('Chargement de votre espace livreur...', 'Loading your driver workspace...')}
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* TAB 1: ACCUEIL & RADAR DE COURSES */}
                {tab === 'radar' && (
                  <div className="space-y-6">
                    {/* Greeting + Urban Horizon Illustration (Matches RovaHomeView) */}
                    <section className="flex items-end justify-between gap-4 pt-1">
                      <div className="space-y-1 min-w-0">
                        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950">
                          {firstName
                            ? t(`Bonjour, ${firstName}`, `Hello, ${firstName}`)
                            : t('Prêt à livrer avec ROVA', 'Ready to deliver with ROVA')}
                        </h1>
                        <p className="text-sm text-neutral-500 max-w-lg">
                          {driver?.isOnline
                            ? t(
                                'Position GPS diffusée en direct · Les nouvelles courses apparaissent ci-dessous.',
                                'Live GPS active · Incoming delivery requests appear below.'
                              )
                            : t(
                                'Passez en ligne pour recevoir des courses et partager votre trajet en temps réel.',
                                'Go online to accept deliveries and share real-time progress.'
                              )}
                        </p>
                      </div>
                      <div aria-hidden="true" className="shrink-0 pointer-events-none opacity-90">
                        <UrbanHorizonIllustration className="w-24 h-10 sm:w-44 sm:h-16" />
                      </div>
                    </section>

                    {/* Dominant Primary Hero Card (Black / White / Red matching RovaHomeView) */}
                    <section className="rounded-3xl bg-neutral-950 text-white p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-5 relative overflow-hidden">
                      <div className="space-y-2 relative z-10 max-w-xl">
                        <p className="text-xs font-medium text-neutral-400 flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              driver?.isOnline ? 'bg-red-600' : 'bg-neutral-600'
                            }`}
                            aria-hidden="true"
                          />
                          <span>
                            {driver
                              ? `${getVehicleLabel(driver.vehicleCategory, lang)} · ${driver.vehiclePlate}`
                              : t('Aucun véhicule enregistré', 'No vehicle registered yet')}
                          </span>
                        </p>
                        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                          {activeDelivery
                            ? t(
                                `Course active : ${activeDelivery.reference}`,
                                `Active run: ${activeDelivery.reference}`
                              )
                            : driver?.isOnline
                            ? t('Radar actif sur votre zone', 'Live radar active in your zone')
                            : t('Activez votre disponibilité GPS', 'Activate your live GPS status')}
                        </h2>
                        <p className="text-xs sm:text-sm text-neutral-400">
                          {activeDelivery
                            ? `${getStatusLabel(activeDelivery.status, lang)} · ${activeDelivery.pickupAddress}`
                            : t(
                                `${pendingJobs.length} course(s) en attente · ${driver?.completedDeliveries || 0} livraisons réalisées.`,
                                `${pendingJobs.length} pending request(s) · ${driver?.completedDeliveries || 0} completed trips.`
                              )}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 relative z-10 shrink-0">
                        {activeDelivery ? (
                          <button
                            type="button"
                            onClick={() => setTab('active')}
                            className="min-h-[44px] px-5 rounded-full bg-white text-neutral-950 hover:bg-red-600 hover:text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                          >
                            <span>{t('Ouvrir la course', 'Open active run')}</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={handleToggleOnline}
                            className={`min-h-[44px] px-5 rounded-full text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                              driver?.isOnline
                                ? 'bg-white text-neutral-950 hover:bg-neutral-200'
                                : 'bg-red-600 text-white hover:bg-red-500'
                            }`}
                          >
                            <Power className="w-4 h-4" />
                            <span>
                              {driver?.isOnline
                                ? t('Passer hors ligne', 'Go offline')
                                : driver
                                ? t('Passer en ligne', 'Go online')
                                : t('Enregistrer mon véhicule', 'Register my vehicle')}
                            </span>
                          </button>
                        )}
                      </div>
                    </section>

                    {/* Clean 3-Column KPI Strip (Matches RovaActivityView) */}
                    <section className="grid grid-cols-3 gap-3">
                      <div className="rounded-2xl bg-white border border-neutral-200/80 p-4">
                        <p className="text-xs text-neutral-500 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                          <span>{t('Disponibles', 'Available')}</span>
                        </p>
                        <p className="font-mono text-xl font-bold text-neutral-950 mt-1 tabular-nums">
                          {pendingJobs.length}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white border border-neutral-200/80 p-4">
                        <p className="text-xs text-neutral-500">{t('Livrées', 'Delivered')}</p>
                        <p className="font-mono text-xl font-bold text-neutral-950 mt-1 tabular-nums">
                          {driver?.completedDeliveries || 0}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white border border-neutral-200/80 p-4">
                        <p className="text-xs text-neutral-500">{t('Revenus', 'Earnings')}</p>
                        <p className="font-mono text-base sm:text-xl font-bold text-neutral-950 mt-1 tabular-nums truncate">
                          {formatLocalMoney(driver?.earningsTotal || 0, region.currency)}
                        </p>
                      </div>
                    </section>

                    {driver && driver.approvalStatus !== 'approved' && (
                      <div className="rounded-2xl border border-neutral-300 bg-white p-4 text-xs text-neutral-700 space-y-1">
                        <p className="font-semibold text-neutral-950 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-600" aria-hidden="true" />
                          {t('Validation en attente par les Opérations', 'Operations verification pending')}
                        </p>
                        <p className="text-neutral-500">
                          {t(
                            'Votre dossier est enregistré. Une fois validé dans le Centre d’Opérations, vous pourrez accepter des courses.',
                            'Your profile is pending review. Once approved in Operations, you can accept deliveries.'
                          )}
                        </p>
                      </div>
                    )}

                    {/* Available Deliveries Radar */}
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="font-display text-base font-bold text-neutral-950">
                          {t('Radar de courses', 'Dispatch radar')}
                        </h2>
                        <span className="font-mono text-xs text-neutral-500 tabular-nums">
                          {pendingJobs.length} {t('en attente', 'pending')}
                        </span>
                      </div>

                      {pendingJobs.length === 0 ? (
                        <div className="rounded-3xl bg-white border border-neutral-200/80 p-8 sm:p-10 text-center space-y-3">
                          <div className="flex justify-center">
                            <TrackingParcelIllustration className="w-28 h-20" />
                          </div>
                          <p className="font-display text-base font-bold text-neutral-950">
                            {t('Aucune course en attente', 'No pending deliveries')}
                          </p>
                          <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                            {t(
                              'Dès qu’un client ou commerçant confirme une expédition dans votre zone, elle s’affiche ici en temps réel.',
                              'As soon as a client or merchant confirms a delivery in your area, it appears here live.'
                            )}
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {pendingJobs.map((job) => (
                            <div
                              key={job.id}
                              className="rounded-3xl bg-white border border-neutral-200/80 p-5 flex flex-col justify-between gap-4 hover:border-neutral-950 transition-colors"
                            >
                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-center shrink-0">
                                      <VehicleIllustration
                                        category={job.vehicleCategory}
                                        className="w-8 h-5 text-neutral-900"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="font-mono text-xs font-bold text-neutral-950">
                                        {job.reference}
                                      </p>
                                      <p className="text-[11px] text-neutral-500 truncate">
                                        {getVehicleLabel(job.vehicleCategory, lang)} ·{' '}
                                        {job.totalDistanceKm.toFixed(1)} km · {job.stopCount}{' '}
                                        {t('arrêt(s)', 'stop(s)')}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="font-mono text-sm font-bold text-neutral-950 tabular-nums shrink-0">
                                    {formatLocalMoney(job.quotedPrice * 0.85, job.currency)}
                                  </span>
                                </div>

                                <div className="text-xs text-neutral-600 space-y-1.5 border-t border-neutral-100 pt-3">
                                  <p className="truncate">
                                    <strong className="text-neutral-950">{t('Collecte', 'Pickup')}:</strong>{' '}
                                    {job.pickupAddress}
                                  </p>
                                  {job.primaryDestinationLabel && (
                                    <p className="truncate">
                                      <strong className="text-neutral-950">{t('Destination', 'Drop-off')}:</strong>{' '}
                                      {job.primaryDestinationLabel}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={busy || driver?.approvalStatus !== 'approved'}
                                onClick={() => handleClaimJob(job)}
                                className="w-full min-h-[44px] rounded-full bg-neutral-950 hover:bg-red-600 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40"
                              >
                                {t('Accepter la course', 'Accept delivery')}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {/* TAB 2: COURSES EN COURS & NAVIGATION CARTE */}
                {tab === 'active' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
                          {t('Course en cours', 'Active run')}
                        </h1>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {t(
                            'Mettez à jour chaque étape : l’expéditeur et le destinataire sont notifiés en direct.',
                            'Update each milestone: sender and recipient are notified live.'
                          )}
                        </p>
                      </div>
                      {activeDelivery && (
                        <button
                          type="button"
                          onClick={() => setIncidentOpen(true)}
                          className="min-h-[40px] px-3.5 rounded-full bg-white border border-neutral-200 hover:border-red-600 text-xs font-medium text-neutral-700 hover:text-red-600 inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{t('Incident', 'Issue')}</span>
                        </button>
                      )}
                    </div>

                    {!activeDelivery ? (
                      <div className="rounded-3xl bg-white border border-neutral-200/80 p-10 text-center space-y-3">
                        <div className="w-12 h-12 rounded-2xl bg-neutral-100 mx-auto flex items-center justify-center">
                          <Navigation className="w-5 h-5 text-neutral-700" />
                        </div>
                        <p className="font-display text-base font-bold text-neutral-950">
                          {t('Aucune course active', 'No active delivery')}
                        </p>
                        <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                          {t(
                            'Acceptez une livraison depuis l’onglet Accueil pour démarrer le guidage et les notifications en direct.',
                            'Accept a delivery from the Home tab to start live navigation and alerts.'
                          )}
                        </p>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => setTab('radar')}
                            className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-red-600 transition-colors cursor-pointer"
                          >
                            {t('Voir le radar', 'Open radar')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* Left column: Map & Live Status */}
                        <div className="lg:col-span-7 space-y-4">
                          <div className="rounded-3xl bg-white border border-neutral-200/80 p-5 space-y-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-xs text-neutral-500">
                                  {activeDelivery.reference}
                                </p>
                                <p className="font-display text-lg font-bold text-neutral-950 mt-0.5">
                                  {getStatusLabel(activeDelivery.status, lang)}
                                </p>
                                <p className="text-xs text-neutral-500 mt-0.5">
                                  {activeDelivery.merchantName} · {activeDelivery.completedStopCount}/
                                  {activeDelivery.stopCount} {t('arrêts livrés', 'stops completed')}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-950">
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      STATUS_META[activeDelivery.status]?.dot || 'bg-red-600'
                                    }`}
                                  />
                                  <Clock className="w-3.5 h-3.5 text-neutral-500" />
                                  <span className="font-mono tabular-nums">
                                    ~{Math.max(1, activeDelivery.estimatedDurationMin)} min
                                  </span>
                                </p>
                                <p className="font-mono text-xs font-bold text-neutral-950 mt-1 tabular-nums">
                                  {formatLocalMoney(activeDelivery.quotedPrice * 0.85, activeDelivery.currency)}
                                </p>
                              </div>
                            </div>

                            <RovaMap
                              center={[activeDelivery.pickupLat, activeDelivery.pickupLng]}
                              zoom={13}
                              markers={activeMapMarkers}
                              routeCoordinates={routeCoords}
                              heightClass="h-[260px] sm:h-[320px]"
                            />

                            {/* Primary Status Progression Action */}
                            {(() => {
                              const nextStep = getNextDriverStatus(activeDelivery.status, lang);
                              if (nextStep) {
                                return (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={handleAdvanceStatus}
                                    className="w-full min-h-[48px] rounded-full bg-neutral-950 hover:bg-red-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40"
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
                                    className="w-full min-h-[48px] rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors cursor-pointer"
                                  >
                                    {t('Valider la preuve de livraison', 'Capture Proof of Delivery')}
                                  </button>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>

                        {/* Right column: Stop Sequence & Recipient Alerts */}
                        <div className="lg:col-span-5 space-y-3">
                          <h2 className="font-display text-sm font-bold text-neutral-950">
                            {t('Arrêts & notifications destinataires', 'Stops & recipient alerts')}
                          </h2>
                          <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                            <div className="p-4 bg-neutral-50/70 flex items-start gap-3">
                              <div className="w-6 h-6 rounded-full bg-neutral-950 text-white font-mono text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                P
                              </div>
                              <div className="min-w-0">
                                <p className="text-[11px] text-neutral-500">{t('Collecte', 'Pickup')}</p>
                                <p className="text-sm font-semibold text-neutral-950">
                                  {activeDelivery.pickupAddress}
                                </p>
                              </div>
                            </div>

                            {activeStops.map((s) => (
                              <div key={s.id} className="p-4 space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-start gap-3 min-w-0">
                                    <div
                                      className={`w-6 h-6 rounded-full font-mono text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                                        s.status === 'delivered'
                                          ? 'bg-neutral-950 text-white'
                                          : 'border-2 border-neutral-950 text-neutral-950'
                                      }`}
                                    >
                                      {s.status === 'delivered' ? '✓' : s.sequence}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-neutral-950 truncate">
                                        {s.recipientName}
                                      </p>
                                      <p className="text-xs text-neutral-600">{s.address}</p>
                                      <p className="text-[11px] font-mono text-neutral-500 mt-0.5">
                                        {s.recipientPhone} · {getStatusLabel(s.status, lang)}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 pl-9">
                                  {s.trackingToken && onOpenTrackingToken && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenTrackingToken(s.trackingToken)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-xs font-medium text-neutral-900 transition-colors cursor-pointer"
                                    >
                                      <MapPin className="w-3 h-3" />
                                      <span>{t('Fenêtre suivi', 'Tracking window')}</span>
                                    </button>
                                  )}
                                  {s.status !== 'delivered' && activeDelivery.status === 'arrived' && (
                                    <button
                                      type="button"
                                      onClick={() => setPodStop(s)}
                                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-neutral-950 hover:bg-red-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      <span>{t('Remettre', 'Deliver')}</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: REVENUS & ACTIVITÉ (Matches RovaActivityView) */}
                {tab === 'earnings' && (
                  <div className="space-y-6">
                    <div>
                      <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
                        {t('Revenus', 'Earnings')}
                      </h1>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {t(
                          'Suivi net de vos courses livrées et performances sur le réseau ROVA.',
                          'Net earnings summary and completed runs on the ROVA network.'
                        )}
                      </p>
                    </div>

                    <div className="rounded-3xl bg-neutral-950 text-white p-6 sm:p-7 space-y-2">
                      <p className="text-xs text-neutral-400 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
                        <span>{t('Gains cumulés (85% net)', 'Total net earnings (85%)')}</span>
                      </p>
                      <p className="font-mono text-3xl sm:text-4xl font-bold tabular-nums">
                        {formatLocalMoney(driver?.earningsTotal || 0, region.currency)}
                      </p>
                      <div className="flex items-center gap-3 pt-2 text-xs text-neutral-300 font-mono">
                        <span>
                          {driver?.completedDeliveries || 0} {t('courses', 'trips')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('Note', 'Rating')}: {(driver?.rating || 5).toFixed(1)}/5
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('Acceptation', 'Acceptance')}: {Math.round(driver?.acceptanceRate || 100)}%
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h2 className="font-display text-sm font-bold text-neutral-950">
                        {t('Historique des courses terminées', 'Completed deliveries')}
                      </h2>
                      {completedDeliveries.length === 0 ? (
                        <div className="rounded-3xl bg-white border border-neutral-200/80 p-10 text-center space-y-3">
                          <div className="flex justify-center">
                            <ActivityLedgerIllustration className="w-32 h-24" />
                          </div>
                          <p className="font-display text-base font-bold text-neutral-950">
                            {t('Aucune course terminée', 'No completed trips yet')}
                          </p>
                          <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                            {t(
                              'Vos revenus apparaîtront automatiquement après chaque livraison validée.',
                              'Your earnings will appear here automatically after each completed run.'
                            )}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                          {completedDeliveries.map((d) => (
                            <div
                              key={d.id}
                              className="p-4 sm:p-5 flex items-center justify-between gap-4"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                                  <Package className="w-4 h-4 text-neutral-800" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-mono text-sm font-bold text-neutral-950 truncate">
                                    {d.reference}
                                  </p>
                                  <p className="text-xs text-neutral-500 truncate">
                                    {d.merchantName} · {d.primaryDestinationLabel || d.pickupAddress}
                                  </p>
                                </div>
                              </div>
                              <span className="font-mono text-sm font-bold text-neutral-950 tabular-nums shrink-0">
                                +{formatLocalMoney(d.quotedPrice * 0.85, d.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 4: COMPTE CHAUFFEUR & VÉHICULE (Matches RovaAccountView) */}
                {tab === 'profile' && (
                  <div className="space-y-6 max-w-3xl">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
                          {t('Compte livreur', 'Driver account')}
                        </h1>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {t(
                            'Dossier chauffeur, véhicule, équipements ROVA et préférences.',
                            'Driver dossier, vehicle details, ROVA gear, and preferences.'
                          )}
                        </p>
                      </div>
                      <LanguageSelector compact />
                    </div>

                    {!driver ? (
                      <form
                        onSubmit={handleSubmitRegistration}
                        className="rounded-3xl bg-white border border-neutral-200/80 p-6 space-y-4"
                      >
                        <div className="space-y-1">
                          <h2 className="font-display text-base font-bold text-neutral-950">
                            {t('Enregistrer mon véhicule', 'Register my vehicle')}
                          </h2>
                          <p className="text-xs text-neutral-500">
                            {t(
                              'Soumettez votre dossier au Centre d’Opérations ROVA pour activer le radar GPS.',
                              'Submit your dossier to ROVA Operations to activate the live GPS radar.'
                            )}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <input
                            type="text"
                            required
                            placeholder={t('Nom complet', 'Full name')}
                            value={regForm.fullName}
                            onChange={(e) => setRegForm((p) => ({ ...p, fullName: e.target.value }))}
                            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                          />
                          <input
                            type="tel"
                            required
                            placeholder={t('Téléphone', 'Phone number')}
                            value={regForm.phone}
                            onChange={(e) => setRegForm((p) => ({ ...p, phone: e.target.value }))}
                            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                          />
                          <select
                            value={regForm.vehicleCategory}
                            onChange={(e) =>
                              setRegForm((p) => ({
                                ...p,
                                vehicleCategory: e.target.value as VehicleCategory,
                              }))
                            }
                            className="sm:col-span-2 w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                          >
                            {VEHICLE_CATALOG.map((v) => (
                              <option key={v.id} value={v.id}>
                                {lang === 'fr' ? v.labelFr : v.label} (≤ {v.maxWeightKg} kg)
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            required
                            placeholder={t('Immatriculation', 'Plate number')}
                            value={regForm.vehiclePlate}
                            onChange={(e) =>
                              setRegForm((p) => ({ ...p, vehiclePlate: e.target.value }))
                            }
                            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                          />
                          <input
                            type="text"
                            required
                            placeholder={t('N° de permis', 'License #')}
                            value={regForm.licenseNumber}
                            onChange={(e) =>
                              setRegForm((p) => ({ ...p, licenseNumber: e.target.value }))
                            }
                            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                          />
                          <input
                            type="text"
                            placeholder={t('Zone de service', 'Service area')}
                            value={regForm.serviceArea}
                            onChange={(e) =>
                              setRegForm((p) => ({ ...p, serviceArea: e.target.value }))
                            }
                            className="sm:col-span-2 w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full min-h-[46px] rounded-full bg-neutral-950 hover:bg-red-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40"
                        >
                          {uid
                            ? t('Soumettre mon dossier chauffeur', 'Submit driver dossier')
                            : t('Se connecter pour s’inscrire', 'Sign in to register')}
                        </button>
                      </form>
                    ) : (
                      <div className="rounded-3xl bg-white border border-neutral-200/80 p-6 space-y-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-12 h-12 rounded-full bg-neutral-950 text-white font-display text-base font-bold flex items-center justify-center shrink-0">
                              {firstName ? firstName.charAt(0).toUpperCase() : 'R'}
                            </div>
                            <div className="min-w-0">
                              <p className="font-display text-base font-bold text-neutral-950 truncate">
                                {driver.fullName}
                              </p>
                              <p className="text-xs text-neutral-500 truncate">
                                {getVehicleLabel(driver.vehicleCategory, lang)} · {driver.vehiclePlate}
                              </p>
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-900">
                            <ShieldCheck className="w-4 h-4 text-red-600" />
                            <span>{driver.approvalStatus}</span>
                          </span>
                        </div>
                        <div className="border-t border-neutral-100 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-neutral-600">
                          <p>
                            <span className="text-neutral-400">{t('Permis :', 'License:')}</span>{' '}
                            <span className="font-mono text-neutral-900">{driver.licenseNumber}</span>
                          </p>
                          <p>
                            <span className="text-neutral-400">{t('Zone :', 'Zone:')}</span>{' '}
                            <span className="text-neutral-900">{driver.serviceArea}</span>
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Assigned Equipment */}
                    <div className="space-y-2.5">
                      <h2 className="font-display text-sm font-bold text-neutral-950">
                        {t('Équipements ROVA attribués', 'Assigned ROVA equipment')}
                      </h2>
                      {equipmentList.length === 0 ? (
                        <div className="rounded-2xl bg-white border border-neutral-200/80 p-5 text-xs text-neutral-500">
                          {t('Aucun équipement attribué pour le moment.', 'No equipment issued yet.')}
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                          {equipmentList.map((eq) => (
                            <div
                              key={eq.id}
                              className="p-4 flex items-center justify-between text-xs"
                            >
                              <span className="font-semibold text-neutral-950">
                                {eq.quantity}x {eq.equipmentName}
                              </span>
                              <span className="font-mono text-[11px] text-neutral-500 uppercase">
                                {eq.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Session & Mode Switcher */}
                    <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
                      {onBackToClient && (
                        <button
                          type="button"
                          onClick={onBackToClient}
                          className="w-full py-4 px-1 flex items-center justify-between gap-4 text-left hover:bg-neutral-100/60 transition-colors cursor-pointer"
                        >
                          <div>
                            <p className="text-sm font-semibold text-neutral-950">
                              {t('Revenir à l’espace Client / Expéditeur', 'Switch to Client / Sender app')}
                            </p>
                            <p className="text-xs text-neutral-500 mt-0.5">
                              {t(
                                'Créer une livraison, réserver un véhicule ou suivre vos expéditions.',
                                'Create shipments, book vehicles, or track active deliveries.'
                              )}
                            </p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-neutral-400 shrink-0" />
                        </button>
                      )}

                      {uid ? (
                        <button
                          type="button"
                          onClick={logout}
                          className="w-full py-4 px-1 flex items-center justify-between gap-4 text-left hover:bg-neutral-100/60 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <LogOut className="w-4 h-4 text-red-600 shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-red-700">
                                {t('Se déconnecter', 'Sign out')}
                              </p>
                              <p className="text-xs text-neutral-500">{firebaseUser?.email}</p>
                            </div>
                          </div>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={onRequestSignIn}
                          className="w-full py-4 px-1 flex items-center justify-between gap-4 text-left hover:bg-neutral-100/60 transition-colors cursor-pointer"
                        >
                          <p className="text-sm font-semibold text-neutral-950">
                            {t('Se connecter à mon compte chauffeur', 'Sign in to my driver account')}
                          </p>
                          <ArrowRight className="w-4 h-4 text-neutral-400 shrink-0" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* IDENTICAL Floating Glassmorphism 4-Tab Bottom Navigation Bar (White / Black / Red) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-auto max-w-[calc(100vw-1rem)] pointer-events-none pb-[env(safe-area-inset-bottom,0px)]">
        <nav
          aria-label={t('Navigation livreur', 'Driver navigation')}
          className="pointer-events-auto relative flex items-center gap-1.5 sm:gap-2 p-1.5 rounded-full bg-transparent backdrop-blur-md border border-white/60 ring-1 ring-black/[0.08] shadow-[0_12px_36px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.65)]"
        >
          {driverNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                aria-current={isActive ? 'page' : undefined}
                className="group relative flex flex-col items-center justify-center min-w-[74px] sm:min-w-[92px] h-[52px] px-3 sm:px-5 rounded-full cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 transition-transform duration-150 active:scale-95"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full transition-all duration-200 ${
                    isActive
                      ? 'opacity-0'
                      : 'bg-transparent backdrop-blur-sm border border-white/40 group-hover:border-white/75'
                  }`}
                />

                {isActive && (
                  <motion.span
                    layoutId="rova-driver-active-glass-pill"
                    transition={{
                      type: 'spring',
                      stiffness: 420,
                      damping: 32,
                      mass: 0.75,
                    }}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-transparent backdrop-blur-lg border border-white/85 ring-1 ring-black/[0.10] shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.8),0_4px_14px_rgba(0,0,0,0.08)]"
                  />
                )}

                <span className="relative z-10 flex flex-col items-center justify-center gap-0.5">
                  <span className="relative">
                    <motion.span
                      animate={isActive ? { y: [0, -2, 0], scale: [1, 1.12, 1] } : { y: 0, scale: 1 }}
                      transition={isActive ? { duration: 0.34, ease: [0.2, 0.8, 0.2, 1] } : { duration: 0.18 }}
                      className="inline-flex"
                    >
                      <Icon
                        strokeWidth={isActive ? 2.3 : 1.85}
                        className={`w-[19px] h-[19px] transition-colors duration-200 ${
                          isActive ? 'text-neutral-950' : 'text-neutral-600 group-hover:text-neutral-900'
                        }`}
                      />
                    </motion.span>
                    {item.badge && item.badge > 0 ? (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white font-mono text-[9px] font-bold flex items-center justify-center tabular-nums shadow-[0_2px_8px_rgba(220,38,38,0.45)]">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    {isActive && (
                      <motion.span
                        layoutId="rova-driver-active-red-dot"
                        transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                        className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`text-[10px] leading-none tracking-tight whitespace-nowrap transition-colors duration-200 ${
                        isActive
                          ? 'font-semibold text-neutral-950'
                          : 'font-medium text-neutral-600 group-hover:text-neutral-900'
                      }`}
                    >
                      {item.label}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Proof of Delivery Bottom Sheet */}
      <BottomSheet
        open={Boolean(podStop && activeDelivery)}
        onClose={() => setPodStop(null)}
        size="sm"
        title={
          podStop
            ? `${t('Preuve de livraison', 'Proof of Delivery')} · #${podStop.sequence}`
            : t('Preuve de livraison', 'Proof of Delivery')
        }
        subtitle={podStop ? `${podStop.recipientName} — ${podStop.address}` : undefined}
      >
        {podStop && activeDelivery && (
          <form onSubmit={handleCompleteStopWithPod} className="space-y-4">
            {(activeDelivery.proofRequired === 'otp' || activeDelivery.proofRequired === 'pin') && (
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Code OTP du destinataire', 'Recipient OTP code')}
                </label>
                <input
                  type="text"
                  required
                  value={podOtp}
                  onChange={(e) => setPodOtp(e.target.value)}
                  placeholder="4 chiffres"
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:border-neutral-950"
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
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            )}

            <input
              type="text"
              placeholder={t('Notes de remise (optionnel)', 'Handover notes (optional)')}
              value={podNotes}
              onChange={(e) => setPodNotes(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
            />

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[46px] rounded-full bg-neutral-950 hover:bg-red-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40"
            >
              {t('Confirmer la remise', 'Confirm delivery')}
            </button>
          </form>
        )}
      </BottomSheet>

      {/* Incident Report Bottom Sheet */}
      <BottomSheet
        open={incidentOpen}
        onClose={() => setIncidentOpen(false)}
        size="sm"
        title={t('Signaler un incident', 'Report an incident')}
        subtitle={t(
          'Transmission directe au Centre d’Opérations ROVA.',
          'Direct report to ROVA Operations Center.'
        )}
      >
        <form onSubmit={handleSubmitIncident} className="space-y-4">
          <select
            value={incidentCategory}
            onChange={(e) => setIncidentCategory(e.target.value as typeof incidentCategory)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
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
            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[46px] rounded-full bg-neutral-950 hover:bg-red-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40"
          >
            {t('Envoyer aux Opérations', 'Send to Operations')}
          </button>
        </form>
      </BottomSheet>
    </div>
  );
}
