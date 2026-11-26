import crypto from 'crypto';
import { logOperationalEvent } from './observability.ts';

export type NotificationChannel = 'in_app' | 'realtime' | 'push' | 'sms' | 'email';
export type NotificationLocale = 'fr' | 'en';
export type OutboxStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'dead_letter'
  | 'skipped_unconfigured';

export interface NotificationTemplateVars {
  reference: string;
  courierName?: string;
  etaMinutes?: number;
  cityName?: string;
  reason?: string;
  offeredEarnings?: string;
  expiresInSec?: number;
}

export interface RenderedNotification {
  title: string;
  message: string;
}

interface TemplateEntry {
  fr: (v: NotificationTemplateVars) => RenderedNotification;
  en: (v: NotificationTemplateVars) => RenderedNotification;
  defaultChannels: NotificationChannel[];
}

// ============================================================================
// CENTRALIZED NOTIFICATION TEMPLATES (ZERO HARDCODED UI STRINGS)
// ============================================================================
const TEMPLATES: Record<string, TemplateEntry> = {
  'delivery.created': {
    fr: (v) => ({
      title: `Commande confirmée · ${v.reference}`,
      message: `Votre expédition est enregistrée. Recherche d’un livreur ROVA à ${v.cityName || 'proximité'} en cours.`,
    }),
    en: (v) => ({
      title: `Order confirmed · ${v.reference}`,
      message: `Your shipment is confirmed. Searching for an available ROVA courier in ${v.cityName || 'your area'}.`,
    }),
    defaultChannels: ['in_app', 'realtime'],
  },
  'delivery.searching_courier': {
    fr: (v) => ({
      title: `Recherche d’un livreur · ${v.reference}`,
      message: `Nous contactons les livreurs disponibles les plus proches pour votre collecte.`,
    }),
    en: (v) => ({
      title: `Searching for a courier · ${v.reference}`,
      message: `Contacting nearby verified couriers for your pickup.`,
    }),
    defaultChannels: ['in_app', 'realtime'],
  },
  'delivery.courier_assigned': {
    fr: (v) => ({
      title: `Livreur assigné · ${v.reference}`,
      message: `${v.courierName || 'Un livreur ROVA'} a accepté votre course${v.etaMinutes ? ` (collecte estimée ~${v.etaMinutes} min)` : ''}.`,
    }),
    en: (v) => ({
      title: `Courier assigned · ${v.reference}`,
      message: `${v.courierName || 'A ROVA courier'} accepted your delivery${v.etaMinutes ? ` (pickup ETA ~${v.etaMinutes} min)` : ''}.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.courier_approaching_pickup': {
    fr: (v) => ({
      title: `Livreur en route vers la collecte · ${v.reference}`,
      message: `${v.courierName || 'Votre livreur'} se dirige vers le point de collecte.`,
    }),
    en: (v) => ({
      title: `Courier heading to pickup · ${v.reference}`,
      message: `${v.courierName || 'Your courier'} is on the way to the pickup point.`,
    }),
    defaultChannels: ['in_app', 'realtime'],
  },
  'delivery.courier_at_pickup': {
    fr: (v) => ({
      title: `Livreur arrivé à la collecte · ${v.reference}`,
      message: `${v.courierName || 'Votre livreur'} est arrivé pour récupérer le colis.`,
    }),
    en: (v) => ({
      title: `Courier arrived at pickup · ${v.reference}`,
      message: `${v.courierName || 'Your courier'} has arrived at the pickup point.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.package_collected': {
    fr: (v) => ({
      title: `Colis pris en charge · ${v.reference}`,
      message: `${v.courierName || 'Votre livreur'} a récupéré le colis et prépare le trajet vers le destinataire.`,
    }),
    en: (v) => ({
      title: `Parcel collected · ${v.reference}`,
      message: `${v.courierName || 'Your courier'} has collected the parcel and is preparing for delivery.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push', 'sms'],
  },
  'delivery.in_transit': {
    fr: (v) => ({
      title: `Livraison en cours · ${v.reference}`,
      message: `${v.courierName || 'Votre livreur'} est en route vers le destinataire${v.etaMinutes ? ` (~${v.etaMinutes} min)` : ''}.`,
    }),
    en: (v) => ({
      title: `In transit · ${v.reference}`,
      message: `${v.courierName || 'Your courier'} is on the way to the recipient${v.etaMinutes ? ` (~${v.etaMinutes} min)` : ''}.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.approaching_recipient': {
    fr: (v) => ({
      title: `Arrivée imminente · ${v.reference}`,
      message: `${v.courierName || 'Le livreur'} approche du point de livraison.`,
    }),
    en: (v) => ({
      title: `Approaching destination · ${v.reference}`,
      message: `${v.courierName || 'The courier'} is approaching the destination.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.arrived': {
    fr: (v) => ({
      title: `Livreur arrivé à destination · ${v.reference}`,
      message: `${v.courierName || 'Votre livreur'} est arrivé sur place pour remettre le colis.`,
    }),
    en: (v) => ({
      title: `Courier arrived · ${v.reference}`,
      message: `${v.courierName || 'Your courier'} has arrived at the destination.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push', 'sms'],
  },
  'delivery.delivered': {
    fr: (v) => ({
      title: `Livraison terminée · ${v.reference}`,
      message: `Le colis a été remis avec succès par ${v.courierName || 'votre livreur ROVA'}.`,
    }),
    en: (v) => ({
      title: `Delivery completed · ${v.reference}`,
      message: `Your parcel was successfully delivered by ${v.courierName || 'your ROVA courier'}.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push', 'email'],
  },
  'delivery.cancelled': {
    fr: (v) => ({
      title: `Livraison annulée · ${v.reference}`,
      message: v.reason ? `Votre livraison a été annulée (${v.reason}).` : `Votre livraison a été annulée.`,
    }),
    en: (v) => ({
      title: `Delivery cancelled · ${v.reference}`,
      message: v.reason ? `Your delivery has been cancelled (${v.reason}).` : `Your delivery has been cancelled.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.failed': {
    fr: (v) => ({
      title: `Échec de remise · ${v.reference}`,
      message: v.reason
        ? `La livraison n’a pas pu aboutir (${v.reason}). Le colis reste sécurisé avec le livreur.`
        : `La livraison n’a pas pu aboutir. Le colis reste sécurisé avec le livreur.`,
    }),
    en: (v) => ({
      title: `Delivery attempt failed · ${v.reference}`,
      message: v.reason
        ? `Delivery could not be completed (${v.reason}). Parcel remains safely in courier custody.`
        : `Delivery could not be completed. Parcel remains safely in courier custody.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.return_required': {
    fr: (v) => ({
      title: `Retour expéditeur initié · ${v.reference}`,
      message: `Le colis est programmé pour être retourné à l’adresse de collecte.`,
    }),
    en: (v) => ({
      title: `Return to sender initiated · ${v.reference}`,
      message: `The parcel has been scheduled for return to the pickup address.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.return_completed': {
    fr: (v) => ({
      title: `Colis retourné · ${v.reference}`,
      message: `Le colis a bien été restitué à l’expéditeur.`,
    }),
    en: (v) => ({
      title: `Return completed · ${v.reference}`,
      message: `The parcel has been safely returned to the sender.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'delivery.no_courier_found': {
    fr: (v) => ({
      title: `Aucun livreur disponible · ${v.reference}`,
      message: `Tous nos livreurs dans votre zone sont actuellement occupés. Vous pouvez relancer la recherche ou annuler gratuitement.`,
    }),
    en: (v) => ({
      title: `No courier currently available · ${v.reference}`,
      message: `All couriers in your area are currently busy. You can retry dispatch or cancel for free.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'offer.sent': {
    fr: (v) => ({
      title: `Nouvelle course disponible · ${v.reference}`,
      message: `Gain estimé : ${v.offeredEarnings || 'voir détail'}. Répondez sous ${v.expiresInSec || 30}s.`,
    }),
    en: (v) => ({
      title: `New delivery offer · ${v.reference}`,
      message: `Estimated payout: ${v.offeredEarnings || 'see details'}. Respond within ${v.expiresInSec || 30}s.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'reservation.confirmed': {
    fr: (v) => ({
      title: `Réservation confirmée · ${v.reference}`,
      message: `Votre véhicule est réservé${v.cityName ? ` à ${v.cityName}` : ''}. L’affectation du chauffeur démarrera automatiquement avant votre créneau.`,
    }),
    en: (v) => ({
      title: `Reservation confirmed · ${v.reference}`,
      message: `Your vehicle is booked${v.cityName ? ` in ${v.cityName}` : ''}. Courier assignment will start automatically ahead of your pickup window.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'email'],
  },
  'reservation.payment_failed': {
    fr: (v) => ({
      title: `Paiement non finalisé · ${v.reference}`,
      message: v.reason
        ? `Le paiement de votre réservation n’a pas abouti (${v.reason}). Le créneau reste bloqué temporairement.`
        : `Le paiement de votre réservation n’a pas abouti. Veuillez réessayer avant l’expiration du créneau.`,
    }),
    en: (v) => ({
      title: `Payment unsuccessful · ${v.reference}`,
      message: v.reason
        ? `Payment for your reservation failed (${v.reason}). Your slot hold remains active temporarily.`
        : `Payment for your reservation could not be completed. Please retry before your hold expires.`,
    }),
    defaultChannels: ['in_app', 'realtime'],
  },
  'reservation.reminder': {
    fr: (v) => ({
      title: `Rappel de prise en charge · ${v.reference}`,
      message: `Votre créneau planifié approche${v.etaMinutes ? ` (dans environ ${v.etaMinutes} min)` : ''}. Préparez votre chargement.`,
    }),
    en: (v) => ({
      title: `Upcoming scheduled pickup · ${v.reference}`,
      message: `Your scheduled pickup window is approaching${v.etaMinutes ? ` (in ~${v.etaMinutes} min)` : ''}. Please have cargo ready.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'reservation.courier_assigned': {
    fr: (v) => ({
      title: `Chauffeur assigné · ${v.reference}`,
      message: `${v.courierName || 'Un chauffeur ROVA'} est confirmé pour votre créneau planifié.`,
    }),
    en: (v) => ({
      title: `Courier assigned · ${v.reference}`,
      message: `${v.courierName || 'A ROVA courier'} is confirmed for your scheduled pickup.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'reservation.courier_reassigned': {
    fr: (v) => ({
      title: `Réaffectation de chauffeur · ${v.reference}`,
      message: v.courierName
        ? `${v.courierName} prend désormais en charge votre réservation planifiée.`
        : `Nous réaffectons un nouveau chauffeur ROVA pour maintenir votre créneau.`,
    }),
    en: (v) => ({
      title: `Courier reassignment · ${v.reference}`,
      message: v.courierName
        ? `${v.courierName} has been assigned to your scheduled reservation.`
        : `We are assigning a replacement ROVA courier to keep your pickup window on track.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'push'],
  },
  'reservation.rescheduled': {
    fr: (v) => ({
      title: `Réservation replanifiée · ${v.reference}`,
      message: v.reason || `Votre créneau de prise en charge a été mis à jour avec succès.`,
    }),
    en: (v) => ({
      title: `Reservation rescheduled · ${v.reference}`,
      message: v.reason || `Your scheduled pickup window has been updated successfully.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'email'],
  },
  'reservation.cancelled': {
    fr: (v) => ({
      title: `Réservation annulée · ${v.reference}`,
      message: v.reason ? `Votre réservation a été annulée (${v.reason}).` : `Votre réservation a été annulée.`,
    }),
    en: (v) => ({
      title: `Reservation cancelled · ${v.reference}`,
      message: v.reason ? `Your reservation was cancelled (${v.reason}).` : `Your reservation has been cancelled.`,
    }),
    defaultChannels: ['in_app', 'realtime', 'email'],
  },
  'reservation.at_risk': {
    fr: (v) => ({
      title: `Alerte planification · ${v.reference}`,
      message: v.reason || `La réservation nécessite une intervention opérationnelle urgente.`,
    }),
    en: (v) => ({
      title: `Scheduling escalation · ${v.reference}`,
      message: v.reason || `Scheduled reservation requires immediate operations intervention.`,
    }),
    defaultChannels: ['in_app', 'realtime'],
  },
};

export function renderNotificationTemplate(
  templateKey: string,
  locale: NotificationLocale,
  vars: NotificationTemplateVars
): RenderedNotification {
  const entry = TEMPLATES[templateKey];
  if (!entry) {
    return {
      title:
        locale === 'fr'
          ? `Mise à jour livraison · ${vars.reference}`
          : `Delivery update · ${vars.reference}`,
      message:
        locale === 'fr'
          ? `Le statut de votre expédition a été mis à jour.`
          : `Your delivery status has been updated.`,
    };
  }
  return locale === 'fr' ? entry.fr(vars) : entry.en(vars);
}

export function getChannelsForTemplate(templateKey: string): NotificationChannel[] {
  return TEMPLATES[templateKey]?.defaultChannels || ['in_app', 'realtime'];
}

export interface NotificationOutboxItem {
  id: string;
  eventId: string;
  deliveryId?: string;
  recipientUid?: string;
  recipientContact?: string;
  recipientRole: 'customer' | 'recipient' | 'courier' | 'admin';
  channel: NotificationChannel;
  templateKey: string;
  locale: NotificationLocale;
  dedupeKey: string;
  title: string;
  message: string;
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAtMs: number | null;
  lastError?: string | null;
  sentAtMs?: number | null;
  createdAtMs: number;
}

export interface ChannelDispatchResult {
  status: 'sent' | 'failed' | 'skipped_unconfigured';
  provider: string;
  error?: string;
}

export type ChannelSender = (item: NotificationOutboxItem) => Promise<ChannelDispatchResult>;

export function computeBackoffMs(attemptCount: number): number {
  const baseMs = 15_000; // 15s, 30s, 60s, 120s, 240s
  return baseMs * Math.pow(2, Math.max(0, attemptCount - 1));
}

export function buildNotificationDedupeKey(
  eventId: string,
  recipientId: string,
  channel: NotificationChannel
): string {
  return `${eventId}:${recipientId}:${channel}`;
}

export class EventNotificationEngine {
  private seenDedupeKeys = new Set<string>();
  public outbox: NotificationOutboxItem[] = [];
  private senders: Partial<Record<NotificationChannel, ChannelSender>>;

  constructor(senders: Partial<Record<NotificationChannel, ChannelSender>> = {}) {
    this.senders = senders;
  }

  /**
   * Enqueues notifications for a lifecycle event with strict deduplication.
   * Never throws on channel failure so delivery state is never corrupted.
   */
  async emitEventNotifications(params: {
    eventId: string;
    deliveryId?: string;
    templateKey: string;
    locale?: NotificationLocale;
    vars: NotificationTemplateVars;
    recipients: Array<{
      uid?: string;
      contact?: string;
      role: 'customer' | 'recipient' | 'courier' | 'admin';
      channels?: NotificationChannel[];
    }>;
    nowMs?: number;
  }): Promise<NotificationOutboxItem[]> {
    const nowMs = params.nowMs ?? Date.now();
    const locale = params.locale || 'fr';
    const rendered = renderNotificationTemplate(params.templateKey, locale, params.vars);
    const created: NotificationOutboxItem[] = [];

    for (const rec of params.recipients) {
      const recipientKey = rec.uid || rec.contact || 'unknown';
      const channels = rec.channels || getChannelsForTemplate(params.templateKey);

      for (const channel of channels) {
        const dedupeKey = buildNotificationDedupeKey(params.eventId, recipientKey, channel);
        if (this.seenDedupeKeys.has(dedupeKey)) {
          continue; // Strict deduplication
        }
        this.seenDedupeKeys.add(dedupeKey);

        const item: NotificationOutboxItem = {
          id: `ntf_${crypto.randomBytes(6).toString('hex')}`,
          eventId: params.eventId,
          deliveryId: params.deliveryId,
          recipientUid: rec.uid,
          recipientContact: rec.contact,
          recipientRole: rec.role,
          channel,
          templateKey: params.templateKey,
          locale,
          dedupeKey,
          title: rendered.title,
          message: rendered.message,
          status: 'pending',
          attemptCount: 0,
          maxAttempts: 5,
          nextRetryAtMs: nowMs,
          createdAtMs: nowMs,
        };

        this.outbox.push(item);
        created.push(item);
        await this.deliverItemSafely(item, nowMs);
      }
    }

    return created;
  }

  async deliverItemSafely(item: NotificationOutboxItem, nowMs = Date.now()): Promise<OutboxStatus> {
    if (item.status === 'sent' || item.status === 'dead_letter' || item.status === 'skipped_unconfigured') {
      return item.status;
    }

    item.attemptCount += 1;
    item.status = 'processing';

    try {
      const sender = this.senders[item.channel];
      if (!sender) {
        // Honest reporting: do NOT fake SMS/Push/Email delivery when credentials/providers are not configured
        if (item.channel === 'in_app' || item.channel === 'realtime') {
          item.status = 'sent';
          item.sentAtMs = nowMs;
          item.nextRetryAtMs = null;
          item.lastError = null;
          return item.status;
        }
        item.status = 'skipped_unconfigured';
        item.nextRetryAtMs = null;
        item.lastError = `Channel "${item.channel}" provider credentials are not configured.`;
        return item.status;
      }

      const result = await sender(item);
      if (result.status === 'sent') {
        item.status = 'sent';
        item.sentAtMs = nowMs;
        item.nextRetryAtMs = null;
        item.lastError = null;
      } else if (result.status === 'skipped_unconfigured') {
        item.status = 'skipped_unconfigured';
        item.nextRetryAtMs = null;
        item.lastError = result.error || `Provider ${result.provider} not configured.`;
      } else {
        item.lastError = result.error || `Provider ${result.provider} failed.`;
        if (item.attemptCount >= item.maxAttempts) {
          item.status = 'dead_letter';
          item.nextRetryAtMs = null;
        } else {
          item.status = 'failed';
          item.nextRetryAtMs = nowMs + computeBackoffMs(item.attemptCount);
        }
      }
    } catch (err) {
      // Notification failure must NEVER corrupt delivery state
      const message = err instanceof Error ? err.message : 'Unknown channel error';
      item.lastError = message;
      if (item.attemptCount >= item.maxAttempts) {
        item.status = 'dead_letter';
        item.nextRetryAtMs = null;
      } else {
        item.status = 'failed';
        item.nextRetryAtMs = nowMs + computeBackoffMs(item.attemptCount);
      }
      logOperationalEvent('warn', 'notification.channel_error', {
        deliveryId: item.deliveryId,
        eventId: item.eventId,
        channel: item.channel,
        attemptCount: item.attemptCount,
        error: message,
      });
    }
    return item.status;
  }

  async retryEligibleOutbox(nowMs = Date.now()): Promise<{ retried: number; sent: number; deadLettered: number }> {
    let retried = 0;
    let sent = 0;
    let deadLettered = 0;

    for (const item of this.outbox) {
      if (
        (item.status === 'failed' || item.status === 'pending') &&
        item.nextRetryAtMs !== null &&
        item.nextRetryAtMs <= nowMs
      ) {
        retried += 1;
        const finalStatus = await this.deliverItemSafely(item, nowMs);
        if (finalStatus === 'sent') sent += 1;
        if (finalStatus === 'dead_letter') deadLettered += 1;
      }
    }

    return { retried, sent, deadLettered };
  }
}
