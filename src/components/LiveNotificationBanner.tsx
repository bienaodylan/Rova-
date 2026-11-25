import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bell, X } from 'lucide-react';
import { useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';
import { getStatusLabel } from '../lib/logistics';
import { DeliveryStatus } from '../types/rova';

export interface LiveAlertPayload {
  id: string;
  title: string;
  message: string;
  deliveryId?: string;
  etaLabel?: string;
}

interface LiveNotificationBannerProps {
  onOpenDelivery: (deliveryId: string) => void;
}

function formatArrivalClock(etaMinutes: number, lang: 'fr' | 'en'): string {
  const safeMin = Math.max(1, Math.round(etaMinutes));
  const target = new Date(Date.now() + safeMin * 60_000);
  const clock = target.toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return lang === 'fr'
    ? `Arrivée estimée ${clock} (~${safeMin} min)`
    : `Est. arrival ${clock} (~${safeMin} min)`;
}

/**
 * Interactive top live notification banner for senders/merchants.
 * Watches incoming delivery notifications and live status transitions;
 * tapping the banner opens the fixed live tracking window directly on that delivery.
 */
export function LiveNotificationBanner({ onOpenDelivery }: LiveNotificationBannerProps) {
  const { lang, t } = useLanguage();
  const { notifications, deliveries, notificationsEnabled } = useRovaApp();

  const [activeAlert, setActiveAlert] = useState<LiveAlertPayload | null>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const emittedDeliveryEventsRef = useRef<Set<string>>(new Set());
  const initializedNotifsRef = useRef(false);
  const deliveryStatusMapRef = useRef<Map<string, DeliveryStatus>>(new Map());
  const initializedDeliveriesRef = useRef(false);
  const dismissTimerRef = useRef<number | null>(null);

  const claimDeliveryEvent = (deliveryId: string, eventType: string): boolean => {
    const key = `${deliveryId}:${eventType}`;
    if (emittedDeliveryEventsRef.current.has(key)) return false;
    emittedDeliveryEventsRef.current.add(key);
    // Keep the in-memory deduplication set bounded during long-lived sessions.
    if (emittedDeliveryEventsRef.current.size > 200) {
      const oldest = emittedDeliveryEventsRef.current.values().next().value;
      if (oldest) emittedDeliveryEventsRef.current.delete(oldest);
    }
    return true;
  };

  const triggerAlert = (payload: LiveAlertPayload) => {
    if (!notificationsEnabled) return;
    setActiveAlert(payload);
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      setActiveAlert((curr) => (curr?.id === payload.id ? null : curr));
    }, 9000);

    // Optional native browser push notification when permission is already granted
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        const nativeNotif = new Notification(payload.title, {
          body: payload.etaLabel ? `${payload.message} · ${payload.etaLabel}` : payload.message,
          tag: payload.deliveryId || payload.id,
        });
        nativeNotif.onclick = () => {
          window.focus();
          if (payload.deliveryId) onOpenDelivery(payload.deliveryId);
        };
      }
    } catch {
      // Ignore Notification API restrictions in iframe/iOS Safari
    }
  };

  // Watch newly arriving unread notification records
  useEffect(() => {
    if (!initializedNotifsRef.current) {
      notifications.forEach((n) => seenNotifIdsRef.current.add(n.id));
      initializedNotifsRef.current = true;
      return;
    }

    const newestUnread = notifications.find((n) => !n.read && !seenNotifIdsRef.current.has(n.id));
    notifications.forEach((n) => seenNotifIdsRef.current.add(n.id));

    if (newestUnread) {
      const eventType = newestUnread.eventType || '';
      if (newestUnread.deliveryId && eventType.startsWith('delivery.') && !claimDeliveryEvent(newestUnread.deliveryId, eventType)) return;
      const linkedDelivery = newestUnread.deliveryId
        ? deliveries.find((d) => d.id === newestUnread.deliveryId)
        : undefined;
      const etaLabel =
        linkedDelivery &&
        !['delivered', 'cancelled', 'failed'].includes(linkedDelivery.status) &&
        linkedDelivery.estimatedDurationMin > 0
          ? formatArrivalClock(linkedDelivery.estimatedDurationMin, lang)
          : undefined;

      triggerAlert({
        id: `notif_${newestUnread.id}`,
        title: newestUnread.title,
        message: newestUnread.message,
        deliveryId: newestUnread.deliveryId,
        etaLabel,
      });
    }
  }, [notifications, deliveries, lang, notificationsEnabled]);

  // Also watch real-time status progressions on active deliveries directly
  useEffect(() => {
    if (!initializedDeliveriesRef.current) {
      deliveries.forEach((d) => deliveryStatusMapRef.current.set(d.id, d.status));
      initializedDeliveriesRef.current = true;
      return;
    }

    for (const d of deliveries) {
      const prev = deliveryStatusMapRef.current.get(d.id);
      if (prev && prev !== d.status) {
        if (!claimDeliveryEvent(d.id, `delivery.${d.status}`)) {
          deliveryStatusMapRef.current.set(d.id, d.status);
          continue;
        }
        const statusText = getStatusLabel(d.status, lang);
        const etaLabel =
          !['delivered', 'cancelled', 'failed'].includes(d.status) && d.estimatedDurationMin > 0
            ? formatArrivalClock(d.estimatedDurationMin, lang)
            : undefined;
        triggerAlert({
          id: `status_${d.id}_${d.status}_${Date.now()}`,
          title: `${d.reference} · ${statusText}`,
          message: d.driverName
            ? t(
                `${d.driverName} — appuyez pour ouvrir le suivi en direct.`,
                `${d.driverName} — tap to open live tracking.`
              )
            : t('Appuyez pour voir l’évolution en direct.', 'Tap to view live progress.'),
          deliveryId: d.id,
          etaLabel,
        });
      }
      deliveryStatusMapRef.current.set(d.id, d.status);
    }
  }, [deliveries, lang, t, notificationsEnabled]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, []);

  return (
    <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[85] w-full max-w-md px-4 pointer-events-none">
      <AnimatePresence>
        {activeAlert && (
          <motion.div
            key={activeAlert.id}
            initial={{ opacity: 0, y: -20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="assertive"
            className="pointer-events-auto rounded-2xl bg-neutral-950 text-white border border-white/10 shadow-[0_18px_48px_rgba(0,0,0,0.28)] overflow-hidden"
          >
            <div className="flex items-start gap-3 p-3.5">
              <button
                type="button"
                onClick={() => {
                  const id = activeAlert.deliveryId;
                  setActiveAlert(null);
                  if (id) onOpenDelivery(id);
                }}
                className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer focus:outline-none"
              >
                <span className="relative mt-0.5 w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4 text-white" />
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-neutral-950"
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-semibold text-white truncate">{activeAlert.title}</p>
                  <p className="text-xs text-neutral-300 line-clamp-2 leading-snug">
                    {activeAlert.message}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    {activeAlert.etaLabel && (
                      <span className="font-mono text-neutral-200 tabular-nums">
                        {activeAlert.etaLabel}
                      </span>
                    )}
                    {activeAlert.deliveryId && (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-400">
                        {t('Ouvrir le suivi', 'Open tracking')}
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveAlert(null)}
                aria-label={t('Fermer', 'Dismiss')}
                className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
