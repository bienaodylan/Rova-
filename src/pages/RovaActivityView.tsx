import React, { useMemo } from 'react';
import { Calendar, ChevronRight, CreditCard, Package, RefreshCw } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { ActivityFilter, useRovaApp } from '../context/RovaAppContext';
import {
  formatMoney,
  getPaymentMethodLabelEn,
  getStatusLabel,
  getVehicleLabel,
} from '../lib/logistics';

export function RovaActivityView() {
  const { lang, t } = useLanguage();
  const {
    deliveries,
    reservations,
    activityFilter,
    setActivityFilter,
    openShipmentDetail,
    repeatDelivery,
    openComposer,
  } = useRovaApp();

  const summary = useMemo(() => {
    const completed = deliveries.filter((d) => d.status === 'delivered');
    const billable = deliveries.filter((d) => d.status !== 'cancelled');
    const totalSpend =
      billable.reduce((sum, d) => sum + (d.quotedPrice || 0), 0) +
      reservations
        .filter((r) => r.status !== 'cancelled')
        .reduce((sum, r) => sum + (r.quotedPrice || 0), 0);
    return {
      completedCount: completed.length,
      reservationsCount: reservations.length,
      totalSpend,
      currency: deliveries[0]?.currency || reservations[0]?.currency || 'GHS',
    };
  }, [deliveries, reservations]);

  const timelineItems = useMemo(() => {
    type Row = {
      id: string;
      kind: 'delivery' | 'reservation' | 'payment';
      timestamp: number;
      title: string;
      subtitle: string;
      meta: string;
      amount: string;
      deliveryObj?: (typeof deliveries)[number];
    };

    const rows: Row[] = [];

    if (activityFilter === 'all' || activityFilter === 'deliveries') {
      deliveries.forEach((d) => {
        const ts = d.createdAt?.toMillis ? d.createdAt.toMillis() : 0;
        const dateStr = d.createdAt?.toDate
          ? d.createdAt.toDate().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : '';
        rows.push({
          id: `del_${d.id}`,
          kind: 'delivery',
          timestamp: ts,
          title: `${d.reference} · ${d.primaryDestinationLabel || d.pickupAddress}`,
          subtitle: `${getStatusLabel(d.status, lang)} · ${getVehicleLabel(d.vehicleCategory, lang)}`,
          meta: dateStr,
          amount: formatMoney(d.quotedPrice, d.currency),
          deliveryObj: d,
        });
      });
    }

    if (activityFilter === 'all' || activityFilter === 'reservations') {
      reservations.forEach((r) => {
        const ts = r.createdAt?.toMillis ? r.createdAt.toMillis() : 0;
        rows.push({
          id: `res_${r.id}`,
          kind: 'reservation',
          timestamp: ts,
          title: `${t('Réservation', 'Reservation')} · ${getVehicleLabel(r.vehicleCategory, lang)}`,
          subtitle: `${r.reservationDate} (${r.startTime}–${r.endTime}) · ${r.pickupAddress}`,
          meta: r.status,
          amount: formatMoney(r.quotedPrice, r.currency),
        });
      });
    }

    if (activityFilter === 'payments') {
      deliveries
        .filter((d) => d.status !== 'cancelled')
        .forEach((d) => {
          const ts = d.createdAt?.toMillis ? d.createdAt.toMillis() : 0;
          rows.push({
            id: `pay_${d.id}`,
            kind: 'payment',
            timestamp: ts,
            title: `${getPaymentMethodLabelEn(d.paymentMethod)} · ${d.reference}`,
            subtitle: `${d.paymentStatus.toUpperCase()} · ${d.pickupAddress}`,
            meta: d.createdAt?.toDate
              ? d.createdAt.toDate().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                  day: 'numeric',
                  month: 'short',
                })
              : '',
            amount: formatMoney(d.quotedPrice, d.currency),
            deliveryObj: d,
          });
        });
    }

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [deliveries, reservations, activityFilter, lang, t]);

  const filters: Array<{ id: ActivityFilter; label: string }> = [
    { id: 'all', label: t('Tout', 'All') },
    { id: 'deliveries', label: t('Livraisons', 'Deliveries') },
    { id: 'reservations', label: t('Réservations', 'Reservations') },
    { id: 'payments', label: 'Payments' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-8 space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
          {t('Activité', 'Activity')}
        </h1>
        <p className="text-xs text-neutral-500 mt-0.5">
          {t('Historique complet de vos expéditions, réservations et règlements.', 'Full record of your deliveries, reservations, and payments.')}
        </p>
      </header>

      {/* Clean Numeric Summary Strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-neutral-200/80 p-4">
          <p className="text-xs text-neutral-500">{t('Livrées', 'Delivered')}</p>
          <p className="font-mono text-xl font-bold text-neutral-950 mt-1 tabular-nums">
            {summary.completedCount}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-neutral-200/80 p-4">
          <p className="text-xs text-neutral-500">{t('Réservations', 'Reservations')}</p>
          <p className="font-mono text-xl font-bold text-neutral-950 mt-1 tabular-nums">
            {summary.reservationsCount}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-neutral-200/80 p-4">
          <p className="text-xs text-neutral-500">{t('Volume', 'Total')}</p>
          <p className="font-mono text-base sm:text-xl font-bold text-neutral-950 mt-1 tabular-nums truncate">
            {formatMoney(summary.totalSpend, summary.currency)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActivityFilter(f.id)}
            className={`px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activityFilter === f.id
                ? 'bg-neutral-950 text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:border-neutral-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Activity Ledger */}
      {timelineItems.length === 0 ? (
        <div className="rounded-3xl bg-white border border-neutral-200/80 p-10 text-center space-y-3">
          <p className="font-display text-base font-bold text-neutral-950">
            {t('Aucune activité enregistrée', 'No activity recorded yet')}
          </p>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
            {t(
              'Votre historique apparaîtra automatiquement dès votre première livraison ou réservation.',
              'Your past operations and receipts will appear here after your first completed operation.'
            )}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => openComposer('single')}
              className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {t('Créer une livraison', 'Create a delivery')}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
          {timelineItems.map((item) => (
            <div
              key={item.id}
              onClick={() => item.deliveryObj && openShipmentDetail(item.deliveryObj.id)}
              className={`p-4 sm:p-5 flex items-center justify-between gap-4 transition-colors ${
                item.deliveryObj ? 'hover:bg-neutral-50 cursor-pointer' : ''
              }`}
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                  {item.kind === 'payment' ? (
                    <CreditCard className="w-4 h-4 text-neutral-800" />
                  ) : item.kind === 'reservation' ? (
                    <Calendar className="w-4 h-4 text-neutral-800" />
                  ) : (
                    <Package className="w-4 h-4 text-neutral-800" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-950 truncate">{item.title}</p>
                  <p className="text-xs text-neutral-500 truncate mt-0.5">{item.subtitle}</p>
                  {item.meta && <p className="text-[11px] text-neutral-400 mt-0.5">{item.meta}</p>}
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span className="font-mono text-xs sm:text-sm font-semibold text-neutral-950 tabular-nums">
                  {item.amount}
                </span>
                {item.deliveryObj && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void repeatDelivery(item.deliveryObj!);
                    }}
                    title={t('Répéter cette livraison', 'Repeat delivery')}
                    className="p-2 rounded-full border border-neutral-200 hover:border-neutral-950 text-neutral-700 hover:text-neutral-950 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                {item.deliveryObj && <ChevronRight className="w-4 h-4 text-neutral-400" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
