import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  Bell,
  BellRing,
  Check,
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
          : t('Votre livreur Rovia progresse vers votre adresse.', 'Your Rovia courier is on the way.');

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
        label: record.driverFirstName || t('Livreur Rovia', 'Rovia Driver'),
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
              'Alertes en direct activées pour cette livraison.',
              'Live alerts enabled for this delivery.'
            ),
            'success'
          );
          return;
        }
      }
    } catch {
      // Fallback to in-app alerts
    }
    showToast(
      t(
        'Alertes en direct activées dans cette fenêtre.',
        'Live alerts enabled inside this window.'
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
    ? record && record.status !== 'delivered' && record.status !== 'cancelled' && record.status !== 'failed'
      ? formatArrivalTime(record.etaMinutes, lang)
      : null
    : delivery && !['delivered', 'cancelled', 'failed'].includes(delivery.status)
    ? formatArrivalTime(delivery.estimatedDurationMin, lang)
    : null;

  const hasLiveGps = isTokenMode
    ? Boolean(record?.showLiveDriver && typeof record.driverLat === 'number' && typeof record.driverLng === 'number')
    : Boolean(delivery && typeof delivery.driverLat === 'number' && typeof delivery.driverLng === 'number');

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={t('Suivi de livraison en direct', 'Live delivery tracking')}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#171717]/45 backdrop-blur-[2px]"
          />

          {/* Fixed In-App Tracking Window */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full sm:max-w-2xl h-[94dvh] sm:h-[min(860px,90dvh)] bg-white rounded-t-[32px] sm:rounded-[32px] shadow-[0_24px_64px_rgba(23,23,23,0.18)] border border-[#E5E5E5] flex flex-col overflow-hidden"
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
              <span className="w-9 h-1 rounded-full bg-[#E5E5E5]" aria-hidden="true" />
            </div>

            {/* Clean Operational Header */}
            <header className="px-5 sm:px-6 pt-2.5 sm:pt-4 pb-3.5 border-b border-[#E5E5E5] flex items-center justify-between gap-3 shrink-0 bg-white">
              <div className="min-w-0 flex items-center gap-3">
                <RovaWordmark size="sm" />
                <span className="text-[#E5E5E5]" aria-hidden="true">/</span>
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-[#171717] truncate">
                    {isTokenMode
                      ? record?.reference || t('Suivi en direct', 'Live tracking')
                      : delivery?.reference || t('Suivi en direct', 'Live tracking')}
                  </p>
                  <p className="text-[11px] text-[#777777] truncate">
                    {isTokenMode
                      ? t('Suivi destinataire', 'Recipient tracking')
                      : t('Suivi expéditeur', 'Sender tracking')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isTokenMode && record && record.status !== 'delivered' && (
                  <button
                    type="button"
                    onClick={() => void enableRecipientAlerts()}
                    className={`min-h-[40px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      recipientAlertsOn
                        ? 'bg-[#171717] text-white'
                        : 'border border-[#E5E5E5] hover:border-[#171717] text-[#171717]'
                    }`}
                  >
                    {recipientAlertsOn ? (
                      <BellRing className="w-3.5 h-3.5 text-[#E52B32]" />
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
                  className="min-w-[44px] min-h-[44px] -mr-1.5 rounded-full hover:bg-[#F3F3F3] flex items-center justify-center text-[#777777] hover:text-[#171717] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Operational ETA Strip (only when real reliable ETA exists) */}
            {activeEta && (
              <div className="px-5 sm:px-6 py-3 bg-[#171717] text-white flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {hasLiveGps && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                  )}
                  <p className="text-xs font-medium text-neutral-200 truncate">
                    {isTokenMode && record
                      ? getStatusLabel(record.status, lang)
                      : delivery
                      ? getStatusLabel(delivery.status, lang)
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 font-mono text-xs tabular-nums">
                  <Clock className="w-3.5 h-3.5 text-[#E52B32]" />
                  <span className="font-bold text-white">{activeEta.clock}</span>
                  <span className="text-neutral-400">({activeEta.relative})</span>
                </div>
              </div>
            )}

            {/* Live Push Update Banner */}
            <AnimatePresence>
              {liveUpdateBanner && (
                <motion.div
                  key={liveUpdateBanner.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mx-5 sm:mx-6 mt-3 rounded-2xl bg-[#E52B32] text-white px-4 py-3 flex items-center justify-between gap-3 shrink-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{liveUpdateBanner.title}</p>
                    <p className="text-[11px] text-red-100 truncate">{liveUpdateBanner.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLiveUpdateBanner(null)}
                    aria-label={t('Fermer', 'Dismiss')}
                    className="p-1.5 rounded-full hover:bg-white/15 shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scrollable Body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 bg-white">
              {!isTokenMode && delivery ? (
                <ShipmentDetailContent
                  delivery={delivery}
                  onOpenPublicTracking={(token) => onSwitchToToken(token)}
                />
              ) : (
                <div className="space-y-5">
                  {/* Inline Tracking Code Bar */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (inputCode.trim()) onLookupToken(inputCode.trim());
                    }}
                    className="flex items-center gap-2 rounded-full border border-[#E5E5E5] bg-[#F3F3F3]/60 pl-4 pr-1.5 py-1.5 focus-within:border-[#171717] focus-within:bg-white transition-colors"
                  >
                    <Search className="w-4 h-4 text-[#777777] shrink-0" />
                    <input
                      type="text"
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value)}
                      placeholder={t('Code de suivi (ex. rvt_...)', 'Tracking code (e.g. rvt_...)')}
                      className="flex-1 bg-transparent font-mono text-xs sm:text-sm text-[#171717] focus:outline-none min-w-0 py-1.5"
                    />
                    <button
                      type="submit"
                      className="min-h-[34px] px-4 rounded-full bg-[#171717] text-white text-xs font-semibold hover:bg-[#E52B32] transition-colors shrink-0 cursor-pointer"
                    >
                      {t('Suivre', 'Track')}
                    </button>
                  </form>

                  {loadingToken && (
                    <div className="py-12 text-center space-y-2">
                      <Clock className="w-5 h-5 mx-auto text-[#777777] animate-spin" />
                      <p className="text-sm text-[#777777]">
                        {t('Connexion au suivi en direct...', 'Connecting to live tracking...')}
                      </p>
                    </div>
                  )}

                  {!loadingToken && !record && (
                    <div className="rounded-3xl border border-[#E5E5E5] bg-white px-6 py-10 text-center space-y-2.5">
                      <MapPin className="w-5 h-5 text-[#777777] mx-auto" />
                      <h2 className="font-display text-base font-bold text-[#171717]">
                        {notFound
                          ? t('Aucun colis trouvé pour ce code', 'No parcel found for this code')
                          : t('Suivi en direct Rovia', 'Rovia Live Tracking')}
                      </h2>
                      <p className="text-xs text-[#777777] max-w-sm mx-auto leading-relaxed">
                        {t(
                          'Vérifiez le code communiqué par l’expéditeur pour suivre le livreur et connaître l’heure d’arrivée estimée.',
                          'Verify the tracking code shared by the sender to follow your courier and estimated arrival.'
                        )}
                      </p>
                    </div>
                  )}

                  {!loadingToken && record && (
                    <div className="space-y-5">
                      {/* Map-First View */}
                      <div className="overflow-hidden rounded-3xl border border-[#E5E5E5]">
                        <RovaMap
                          center={[record.destinationLat, record.destinationLng]}
                          zoom={14}
                          markers={recipientMarkers}
                          routeCoordinates={routeCoords}
                          heightClass="h-[250px] sm:h-[290px]"
                          className="rounded-3xl border-0"
                        />
                      </div>

                      {/* Recipient & Courier Header */}
                      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E5E5E5]">
                        <div className="space-y-1 min-w-0">
                          <h2 className="font-display text-lg font-bold text-[#171717]">
                            {t('Bonjour', 'Hello')} {record.recipientFirstName}
                          </h2>
                          <p className="text-xs text-[#777777]">{record.destinationLabel}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#777777] pt-0.5">
                            <span className="inline-flex items-center gap-1.5">
                              <Truck className="w-3.5 h-3.5 text-[#171717]" />
                              {getVehicleLabel(record.vehicleCategory, lang)}
                            </span>
                            {record.driverFirstName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {t('Livreur', 'Courier')}:{' '}
                                  <strong className="text-[#171717] font-semibold">{record.driverFirstName}</strong>
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <span className={`text-xs font-semibold ${STATUS_META[record.status]?.text || 'text-[#171717]'}`}>
                          {getStatusLabel(record.status, lang)}
                        </span>
                      </div>

                      {!record.showLiveDriver && record.status !== 'delivered' && (
                        <div className="rounded-2xl bg-[#F3F3F3]/75 border border-[#E5E5E5] px-4 py-3 text-xs text-[#777777] leading-relaxed">
                          {t(
                            'La position GPS du livreur s’affichera automatiquement dès que votre arrêt sera le prochain sur la tournée.',
                            'Live courier GPS activates automatically once your stop is next on the route.'
                          )}
                        </div>
                      )}

                      {/* Linear Vertical Progress Spine */}
                      <div className="space-y-3">
                        <p className="text-xs font-medium text-[#777777]">
                          {t('Progression de la livraison', 'Delivery progress')}
                        </p>
                        <div className="relative pl-6 space-y-3.5">
                          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#E5E5E5]" aria-hidden="true" />
                          {recipientMilestones.map((m) => {
                            const currentRank = DELIVERY_STATUS_ORDER.indexOf(record.status);
                            const stepRank = DELIVERY_STATUS_ORDER.indexOf(m.key);
                            const done =
                              (currentRank >= stepRank && currentRank >= 0) ||
                              (m.key === 'driver_assigned' && Boolean(record.driverUid));
                            const isCurrent = record.status === m.key;
                            return (
                              <div key={m.key} className="relative flex items-center gap-3 text-sm">
                                <span
                                  className={`absolute -left-6 w-4 h-4 rounded-full flex items-center justify-center border ${
                                    isCurrent
                                      ? 'border-[#E52B32] bg-[#E52B32] text-white'
                                      : done
                                      ? 'border-[#171717] bg-[#171717] text-white'
                                      : 'border-[#E5E5E5] bg-white'
                                  }`}
                                >
                                  {(done || isCurrent) && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </span>
                                <span
                                  className={
                                    isCurrent
                                      ? 'font-semibold text-[#171717]'
                                      : done
                                      ? 'text-[#171717]'
                                      : 'text-[#777777]'
                                  }
                                >
                                  {m.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* OTP Handover Code */}
                      {record.otpHint && record.status !== 'delivered' && (
                        <div className="rounded-3xl bg-[#171717] text-white px-5 py-4 flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-white">
                              {t('Code de remise sécurisé (OTP)', 'Secure handover code (OTP)')}
                            </p>
                            <p className="text-[11px] text-neutral-400">
                              {t('À communiquer au livreur à son arrivée', 'Share with courier upon arrival')}
                            </p>
                          </div>
                          <span className="font-mono text-xl font-bold tracking-[0.2em] text-white tabular-nums">
                            {record.otpHint}
                          </span>
                        </div>
                      )}

                      {/* Privacy Footer */}
                      <div className="flex items-center gap-2 pt-3 border-t border-[#E5E5E5] text-[11px] text-[#777777]">
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#171717]" />
                        <span>
                          {t(
                            'Suivi isolé et protégé Rovia · Mises à jour automatiques',
                            'Isolated protected Rovia tracking · Automatic updates'
                          )}
                        </span>
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
