import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { isSupabaseConfigured } from '../lib/supabase';
import { DeliveryRecord, DeliveryStatus, PublicTrackingRecord } from '../types/rova';
import {
  DELIVERY_STATUS_ORDER,
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';
import { MapMarkerItem, RovaMap } from './RovaMap';
import { RovaWordmark } from './RovaSplashScreen';
import { ShipmentDetailContent } from './ShipmentDetailSheet';
import { useLanguage } from '../context/LanguageContext';
import { useRovaApp } from '../context/RovaAppContext';

interface LiveTrackingWindowProps {
  /** Sender mode: active or selected delivery inside the user's account */
  delivery: DeliveryRecord | null;
  /** Recipient mode: tracking token opened via link or "Track code" — stays inside this same fixed window */
  trackingToken: string;
  onClose: () => void;
  onLookupToken: (token: string) => void;
  onSwitchToToken: (token: string) => void;
}

function formatArrivalTime(etaMinutes: number | undefined, lang: 'fr' | 'en'): {
  clock: string;
  relative: string;
} | null {
  if (typeof etaMinutes !== 'number' || !Number.isFinite(etaMinutes) || etaMinutes <= 0) {
    return null;
  }
  const safeMin = Math.max(1, Math.round(etaMinutes));
  const arrival = new Date(Date.now() + safeMin * 60_000);
  const clock = arrival.toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    clock,
    relative: `~${safeMin} min`,
  };
}

/**
 * Unified, fixed in-app live tracking window.
 * Replaces the separate "second recipient tracking page":
 * - Senders see live map, driver GPS, ETA, stops, and recipient alert triggers right in-app.
 * - Recipients opening a tracking link or code get the exact same fixed tracking window
 *   with live arrival-time updates and real-time recipient progress notifications.
 */
export function LiveTrackingWindow({
  delivery,
  trackingToken,
  onClose,
  onLookupToken,
  onSwitchToToken,
}: LiveTrackingWindowProps) {
  const { lang, t } = useLanguage();
  const { showToast } = useRovaApp();

  const isOpen = Boolean(delivery) || Boolean(trackingToken.trim());
  const isTokenMode = Boolean(trackingToken.trim());

  const [inputCode, setInputCode] = useState(trackingToken);
  const [record, setRecord] = useState<PublicTrackingRecord | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [recipientAlertsOn, setRecipientAlertsOn] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
    } catch {
      return false;
    }
  });
  const [liveUpdateBanner, setLiveUpdateBanner] = useState<{
    id: number;
    title: string;
    detail: string;
  } | null>(null);

  const prevRecipientStatusRef = useRef<DeliveryStatus | null>(null);

  // Lock background page scroll while the fixed window is open
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const scrollY = window.scrollY;
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow;
      document.body.style.overflow = prev.bodyOverflow;
      document.body.style.position = prev.bodyPosition;
      document.body.style.top = prev.bodyTop;
      document.body.style.width = prev.bodyWidth;
      window.scrollTo(0, scrollY);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  // Subscribe to public tracking record when in token mode
  useEffect(() => {
    setInputCode(trackingToken);
    const cleanToken = trackingToken.trim();
    if (!cleanToken) {
      setRecord(null);
      setNotFound(false);
      setLoadingToken(false);
      prevRecipientStatusRef.current = null;
      return;
    }

    setLoadingToken(true);
    setNotFound(false);

    if (isSupabaseConfigured()) {
      let cancelled = false;
      const loadTracking = async () => {
        try {
          const res = await fetch(`/api/v1/tracking/${encodeURIComponent(cleanToken)}`, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
          if (!res.ok) {
            if (!cancelled) {
              setRecord(null);
              setNotFound(true);
            }
            return;
          }
          const data = (await res.json()) as { tracking?: PublicTrackingRecord };
          if (!cancelled) {
            if (data.tracking) {
              setRecord(data.tracking);
              setNotFound(false);
            } else {
              setRecord(null);
              setNotFound(true);
            }
          }
        } catch {
          if (!cancelled) {
            setRecord(null);
            setNotFound(true);
          }
        } finally {
          if (!cancelled) setLoadingToken(false);
        }
      };

      void loadTracking();
      const poll = window.setInterval(() => void loadTracking(), 12_000);
      return () => {
        cancelled = true;
        window.clearInterval(poll);
      };
    }

    const unsub = onSnapshot(
      doc(db, 'publicTracking', cleanToken),
      (snap) => {
        if (snap.exists()) {
          setRecord(snap.data() as PublicTrackingRecord);
          setNotFound(false);
        } else {
          setRecord(null);
          setNotFound(true);
        }
        setLoadingToken(false);
      },
      () => {
        setRecord(null);
        setNotFound(true);
        setLoadingToken(false);
      }
    );

    return () => unsub();
  }, [trackingToken]);

  // Trigger real-time recipient notification whenever driver progresses delivery status
  useEffect(() => {
    if (!record) return;
    const prev = prevRecipientStatusRef.current;
    prevRecipientStatusRef.current = record.status;
    if (prev && prev !== record.status) {
      const statusText = getStatusLabel(record.status, lang);
      const eta = formatArrivalTime(record.etaMinutes, lang);
      const detail =
        record.status === 'delivered'
          ? t('Votre colis a été remis avec succès.', 'Your parcel has been delivered.')
          : eta
          ? t(
              `Arrivée estimée à ${eta.clock} (${eta.relative}).`,
              `Estimated arrival at ${eta.clock} (${eta.relative}).`
            )
          : t('Votre livreur ROVA progresse vers votre adresse.', 'Your ROVA driver is on the way.');

      setLiveUpdateBanner({
        id: Date.now(),
        title: `${record.reference} · ${statusText}`,
        detail,
      });

      try {
        if (recipientAlertsOn && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`${record.reference} · ${statusText}`, { body: detail });
        }
      } catch {
        // Ignore browser notification restrictions
      }
    }
  }, [record?.status, record?.etaMinutes, record?.reference, lang, t, recipientAlertsOn]);

  // Fetch road polyline for recipient mode
  useEffect(() => {
    if (!record || !record.showLiveDriver || !record.driverLat || !record.driverLng) {
      setRouteCoords([]);
      return;
    }
    let cancelled = false;
    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          { lat: record.driverLat, lng: record.driverLng },
          { lat: record.destinationLat, lng: record.destinationLng },
        ],
      }),
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
  }, [record?.driverLat, record?.driverLng, record?.destinationLat, record?.destinationLng, record?.showLiveDriver]);

  const recipientMarkers: MapMarkerItem[] = useMemo(() => {
    if (!record) return [];
    const list: MapMarkerItem[] = [
      {
        id: 'dest',
        lat: record.destinationLat,
        lng: record.destinationLng,
        kind: 'stop',
        sequence: 1,
        label: record.destinationLabel,
      },
    ];
    if (record.showLiveDriver && typeof record.driverLat === 'number' && typeof record.driverLng === 'number') {
      list.push({
        id: 'driver',
        lat: record.driverLat,
        lng: record.driverLng,
        kind: 'driver',
        label: record.driverFirstName || t('Livreur ROVA', 'ROVA Driver'),
      });
    }
    return list;
  }, [record, t]);

  const enableRecipientAlerts = async () => {
    setRecipientAlertsOn(true);
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          showToast(
            t(
              'Alertes en direct activées : vous serez notifié à chaque étape et heure d’arrivée.',
              'Live alerts enabled: you will be notified on every status & ETA update.'
            ),
            'success'
          );
          return;
        }
      }
    } catch {
      // Fallback to in-app live alerts
    }
    showToast(
      t(
        'Alertes en direct activées dans cette fenêtre de suivi.',
        'Live alerts enabled inside this tracking window.'
      ),
      'info'
    );
  };

  const recipientMilestones: Array<{ key: DeliveryStatus; label: string }> = [
    { key: 'driver_assigned', label: t('Livreur assigné', 'Driver assigned') },
    { key: 'package_collected', label: t('Colis récupéré', 'Package collected') },
    { key: 'in_transit', label: t('En route vers vous', 'On the way to you') },
    { key: 'arrived', label: t('Livreur arrivé', 'Driver arrived') },
    { key: 'delivered', label: t('Colis livré', 'Parcel delivered') },
  ];

  const activeEta = isTokenMode
    ? formatArrivalTime(record?.etaMinutes, lang)
    : delivery && !['delivered', 'cancelled', 'failed'].includes(delivery.status)
    ? formatArrivalTime(delivery.estimatedDurationMin, lang)
    : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t('Suivi de livraison en direct', 'Live delivery tracking')}
        >
          {/* Dimmed backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-neutral-950/50 backdrop-blur-[3px]"
          />

          {/* Fixed In-App Window */}
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.99 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full sm:max-w-2xl h-[94dvh] sm:h-[min(860px,90dvh)] bg-white rounded-t-[28px] sm:rounded-3xl shadow-2xl border border-neutral-200/80 flex flex-col overflow-hidden"
          >
            {/* Mobile drag bar */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1 rounded-full bg-neutral-200" aria-hidden="true" />
            </div>

            {/* Fixed Window Header */}
            <header className="px-5 sm:px-6 pt-2.5 sm:pt-5 pb-4 border-b border-neutral-100 flex items-center justify-between gap-3 shrink-0 bg-white">
              <div className="min-w-0 flex items-center gap-3">
                <RovaWordmark size="sm" />
                <span className="text-neutral-300" aria-hidden="true">
                  /
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-neutral-950 truncate">
                    {isTokenMode
                      ? record?.reference || t('Suivi en direct', 'Live tracking')
                      : delivery?.reference || t('Suivi en direct', 'Live tracking')}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate">
                    {isTokenMode
                      ? t('Fenêtre de suivi destinataire', 'Recipient tracking window')
                      : t('Fenêtre de suivi expéditeur', 'Sender tracking window')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isTokenMode && record && record.status !== 'delivered' && (
                  <button
                    type="button"
                    onClick={() => void enableRecipientAlerts()}
                    className={`min-h-[38px] px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      recipientAlertsOn
                        ? 'bg-neutral-950 text-white'
                        : 'border border-neutral-200 hover:border-neutral-950 text-neutral-900'
                    }`}
                  >
                    {recipientAlertsOn ? (
                      <BellRing className="w-3.5 h-3.5 text-red-500" />
                    ) : (
                      <Bell className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {recipientAlertsOn
                        ? t('Alertes actives', 'Alerts active')
                        : t('Me notifier', 'Notify me')}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('Fermer la fenêtre de suivi', 'Close tracking window')}
                  className="min-w-[38px] min-h-[38px] rounded-full bg-neutral-100 hover:bg-neutral-950 hover:text-white flex items-center justify-center text-neutral-700 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Live Arrival & ETA Banner pinned right under header */}
            {activeEta && (
              <div className="px-5 sm:px-6 py-3 bg-neutral-950 text-white flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                  <p className="text-xs font-medium text-neutral-200 truncate">
                    {isTokenMode && record
                      ? getStatusLabel(record.status, lang)
                      : delivery
                      ? getStatusLabel(delivery.status, lang)
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 font-mono text-xs tabular-nums">
                  <Clock className="w-3.5 h-3.5 text-red-500" />
                  <span className="font-bold text-white">{activeEta.clock}</span>
                  <span className="text-neutral-400">({activeEta.relative})</span>
                </div>
              </div>
            )}

            {/* Live Push Update Banner inside recipient window */}
            <AnimatePresence>
              {liveUpdateBanner && (
                <motion.div
                  key={liveUpdateBanner.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mx-5 sm:mx-6 mt-3 rounded-2xl bg-red-600 text-white px-4 py-3 flex items-center justify-between gap-3 shrink-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{liveUpdateBanner.title}</p>
                    <p className="text-[11px] text-red-100 truncate">{liveUpdateBanner.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLiveUpdateBanner(null)}
                    aria-label={t('Fermer', 'Dismiss')}
                    className="p-1 rounded-full hover:bg-white/15 shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scrollable Tracking Content Body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5">
              {!isTokenMode && delivery ? (
                <ShipmentDetailContent
                  delivery={delivery}
                  onOpenPublicTracking={(token) => onSwitchToToken(token)}
                />
              ) : (
                <div className="space-y-5">
                  {/* Inline Lookup Bar */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (inputCode.trim()) onLookupToken(inputCode.trim());
                    }}
                    className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2"
                  >
                    <Search className="w-4 h-4 text-neutral-400 shrink-0" />
                    <input
                      type="text"
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value)}
                      placeholder={t('Code de suivi (ex. rvt_...)', 'Tracking code (e.g. rvt_...)')}
                      className="flex-1 bg-transparent font-mono text-xs sm:text-sm text-neutral-950 focus:outline-none min-w-0"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-red-600 transition-colors shrink-0 cursor-pointer"
                    >
                      {t('Actualiser', 'Track')}
                    </button>
                  </form>

                  {loadingToken && (
                    <div className="py-12 text-center space-y-2">
                      <Clock className="w-5 h-5 mx-auto text-neutral-400 animate-spin" />
                      <p className="text-sm text-neutral-600">
                        {t('Connexion au suivi en direct...', 'Connecting to live tracking...')}
                      </p>
                    </div>
                  )}

                  {!loadingToken && !record && (
                    <div className="rounded-3xl border border-neutral-200 p-6 text-center space-y-3 bg-neutral-50/50">
                      <div className="w-11 h-11 rounded-2xl bg-white border border-neutral-200 mx-auto flex items-center justify-center">
                        <MapPin className="w-5 h-5 text-neutral-950" />
                      </div>
                      <h2 className="font-display text-lg font-bold text-neutral-950">
                        {notFound
                          ? t('Aucun colis trouvé pour ce code', 'No parcel found for this code')
                          : t('Suivi en direct ROVA', 'ROVA Live Tracking')}
                      </h2>
                      <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                        {t(
                          'Vérifiez le code reçu par notification ou auprès de l’expéditeur pour suivre le livreur et connaître l’heure d’arrivée estimée.',
                          'Check the tracking code sent by the sender to follow your driver and estimated arrival time.'
                        )}
                      </p>
                    </div>
                  )}

                  {!loadingToken && record && (
                    <div className="space-y-5">
                      {/* Recipient Greeting & Status Summary */}
                      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-neutral-100">
                        <div className="space-y-1 min-w-0">
                          <h2 className="font-display text-xl font-bold text-neutral-950">
                            {t('Bonjour', 'Hello')} {record.recipientFirstName}
                          </h2>
                          <p className="text-xs text-neutral-600">{record.destinationLabel}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 pt-1">
                            <span className="inline-flex items-center gap-1.5">
                              <Truck className="w-3.5 h-3.5 text-neutral-700" />
                              {getVehicleLabel(record.vehicleCategory, lang)}
                            </span>
                            {record.driverFirstName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {t('Livreur', 'Driver')}:{' '}
                                  <strong className="text-neutral-950">{record.driverFirstName}</strong>
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-950">
                            <span
                              className={`w-2 h-2 rounded-full ${STATUS_META[record.status]?.dot || 'bg-red-600'}`}
                            />
                            {getStatusLabel(record.status, lang)}
                          </span>
                        </div>
                      </div>

                      {/* Live Map */}
                      <RovaMap
                        center={[record.destinationLat, record.destinationLng]}
                        zoom={14}
                        markers={recipientMarkers}
                        routeCoordinates={routeCoords}
                        heightClass="h-[240px] sm:h-[280px]"
                      />

                      {!record.showLiveDriver && record.status !== 'delivered' && (
                        <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-xs text-neutral-600">
                          {t(
                            'La position GPS du livreur s’affichera automatiquement dès que votre arrêt sera le prochain sur la tournée.',
                            'Live driver GPS activates automatically once your stop is next on the route.'
                          )}
                        </div>
                      )}

                      {/* Delivery Progress Timeline */}
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-neutral-500">
                          {t('Évolution de votre livraison', 'Delivery progress')}
                        </p>
                        <div className="space-y-2.5">
                          {recipientMilestones.map((m) => {
                            const currentRank = DELIVERY_STATUS_ORDER.indexOf(record.status);
                            const stepRank = DELIVERY_STATUS_ORDER.indexOf(m.key);
                            const done =
                              (currentRank >= stepRank && currentRank >= 0) ||
                              (m.key === 'driver_assigned' && Boolean(record.driverUid));
                            const isCurrent = record.status === m.key;
                            return (
                              <div key={m.key} className="flex items-center gap-3 text-sm">
                                <CheckCircle2
                                  className={`w-4 h-4 shrink-0 ${
                                    isCurrent
                                      ? 'text-red-600'
                                      : done
                                      ? 'text-neutral-950'
                                      : 'text-neutral-300'
                                  }`}
                                />
                                <span
                                  className={
                                    isCurrent
                                      ? 'font-semibold text-neutral-950'
                                      : done
                                      ? 'text-neutral-700'
                                      : 'text-neutral-400'
                                  }
                                >
                                  {m.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* OTP Handover Card */}
                      {record.otpHint && record.status !== 'delivered' && (
                        <div className="rounded-2xl bg-neutral-950 text-white p-4 flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-white">
                              {t('Code de remise sécurisé (OTP)', 'Secure handover code (OTP)')}
                            </p>
                            <p className="text-[11px] text-neutral-400">
                              {t('À communiquer au livreur à son arrivée', 'Share with driver upon arrival')}
                            </p>
                          </div>
                          <span className="font-mono text-lg font-bold tracking-widest text-white">
                            {record.otpHint}
                          </span>
                        </div>
                      )}

                      {/* Privacy Footer */}
                      <div className="flex items-center gap-1.5 pt-2 border-t border-neutral-100 text-[11px] text-neutral-500">
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-neutral-700" />
                        <span>{t('Suivi isolé et protégé ROVA · Notifications automatiques activées', 'Isolated protected ROVA tracking · Automatic updates enabled')}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
