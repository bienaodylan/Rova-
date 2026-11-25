import React, { useMemo } from 'react';
import { Calendar, ChevronRight, CreditCard, Package, RefreshCw } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { ActivityFilter, useRovaApp } from '../context/RovaAppContext';
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import {
  getPaymentMethodLabelEn,
  getStatusLabel,
  getVehicleLabel,
} from '../lib/logistics';

export function RovaActivityView() {
  const { lang, t, formatLocalMoney } = useLanguage();
  const {
    deliveries,
    reservations,
    activityFilter,
    setActivityFilter,
    openShipmentDetail,
    repeatDelivery,
    openComposer,
  } = useRovaApp();
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();

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
          amount: formatLocalMoney(d.quotedPrice, d.currency),
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
          amount: formatLocalMoney(r.quotedPrice, r.currency),
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
            amount: formatLocalMoney(d.quotedPrice, d.currency),
            deliveryObj: d,
          });
        });
    }

    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }, [deliveries, reservations, activityFilter, lang, t, formatLocalMoney]);

  const filters: Array<{ id: ActivityFilter; label: string }> = [
    { id: 'all', label: t('Tout', 'All') },
    { id: 'deliveries', label: t('Livraisons', 'Deliveries') },
    { id: 'reservations', label: t('Réservations', 'Reservations') },
    { id: 'payments', label: 'Payments' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-7 pb-10 space-y-6">
      <header
        className={`sticky top-0 z-30 -mx-4 px-4 py-3 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none sm:static sm:mx-0 sm:px-0 sm:py-0 sm:translate-y-0 sm:pointer-events-auto sm:bg-transparent sm:backdrop-blur-none sm:border-none ${
          headerHidden ? '-translate-y-full pointer-events-none' : 'translate-y-0'
        } ${
          headerScrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-[#E5E5E5]'
            : 'bg-white border-b border-transparent'
        }`}
      >
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#171717]">
          {t('Activité', 'Activity')}
        </h1>
        <p className="text-xs text-[#777777] mt-0.5">
          {t(
            'Historique complet de vos expéditions, réservations et règlements.',
            'Full ledger of your deliveries, reservations, and settlements.'
          )}
        </p>
      </header>

      {/* Hairline-Divided Metric Summary Strip (Linear precision, no decorative card grid) */}
      <div className="grid grid-cols-3 divide-x divide-[#E5E5E5] border-y border-[#E5E5E5] py-4">
        <div className="pr-3">
          <p className="text-xs text-[#777777]">{t('Livrées', 'Delivered')}</p>
          <p className="font-mono text-xl font-bold text-[#171717] mt-1 tabular-nums">
            {summary.completedCount}
          </p>
        </div>
        <div className="px-4">
          <p className="text-xs text-[#777777]">{t('Réservations', 'Reservations')}</p>
          <p className="font-mono text-xl font-bold text-[#171717] mt-1 tabular-nums">
            {summary.reservationsCount}
          </p>
        </div>
        <div className="pl-4">
          <p className="text-xs text-[#777777]">{t('Volume total', 'Total spend')}</p>
          <p className="font-mono text-base sm:text-xl font-bold text-[#171717] mt-1 tabular-nums truncate">
            {formatLocalMoney(summary.totalSpend, summary.currency)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {filters.map((f) => {
          const isActive = activityFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActivityFilter(f.id)}
              className={`min-h-[36px] px-3.5 rounded-lg text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#171717] text-white font-semibold'
                  : 'text-[#777777] hover:text-[#171717] hover:bg-[#F3F3F3] font-medium'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Activity Ledger */}
      {timelineItems.length === 0 ? (
        <div className="border-y border-[#E5E5E5] py-12 text-center space-y-3">
          <Package className="w-6 h-6 text-[#777777] mx-auto" />
          <p className="font-display text-base font-bold text-[#171717]">
            {t('Aucune activité enregistrée', 'No activity recorded yet')}
          </p>
          <p className="text-xs text-[#777777] max-w-sm mx-auto leading-relaxed">
            {t(
              'Votre historique apparaîtra automatiquement dès votre première livraison ou réservation.',
              'Your history and receipts will appear here after your first completed operation.'
            )}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => openComposer('single')}
              className="min-h-[42px] px-5 rounded-xl bg-[#E52B32] text-white text-xs font-semibold hover:bg-[#CC2229] transition-colors cursor-pointer"
            >
              {t('Créer une livraison', 'Create a delivery')}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-y border-[#E5E5E5] divide-y divide-[#E5E5E5]">
          {timelineItems.map((item) => (
            <div
              key={item.id}
              onClick={() => item.deliveryObj && openShipmentDetail(item.deliveryObj.id)}
              className={`py-4 px-2 -mx-2 rounded-xl flex items-center justify-between gap-4 transition-colors ${
                item.deliveryObj ? 'hover:bg-[#F3F3F3]/60 cursor-pointer' : ''
              }`}
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
                  {item.kind === 'payment' ? (
                    <CreditCard className="w-4 h-4 text-[#171717]" />
                  ) : item.kind === 'reservation' ? (
                    <Calendar className="w-4 h-4 text-[#171717]" />
                  ) : (
                    <Package className="w-4 h-4 text-[#171717]" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#171717] truncate">{item.title}</p>
                  <p className="text-xs text-[#777777] truncate mt-0.5">{item.subtitle}</p>
                  {item.meta && <p className="text-[11px] text-[#777777]/80 mt-0.5">{item.meta}</p>}
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <span className="font-mono text-xs sm:text-sm font-semibold text-[#171717] tabular-nums">
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
                    className="min-w-[36px] min-h-[36px] rounded-lg border border-[#E5E5E5] hover:border-[#171717] text-[#777777] hover:text-[#171717] flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                {item.deliveryObj && <ChevronRight className="w-4 h-4 text-[#777777]" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
