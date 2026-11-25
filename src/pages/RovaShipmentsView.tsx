import React, { useMemo, useState } from 'react';
import { Calendar, ChevronRight, MapPin, Plus, Search, XCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { ShipmentFilter, useRovaApp } from '../context/RovaAppContext';
import { VehicleIllustration } from '../components/VehicleIllustration';
import { ShipmentDetailContent } from '../components/ShipmentDetailSheet';
import {
  formatMoney,
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';

interface RovaShipmentsViewProps {
  onOpenPublicTracking: (token: string) => void;
}

export function RovaShipmentsView({ onOpenPublicTracking }: RovaShipmentsViewProps) {
  const { lang, t } = useLanguage();
  const {
    loadingData,
    deliveries,
    reservations,
    shipmentFilter,
    setShipmentFilter,
    openComposer,
    openReservationSheet,
    openShipmentDetail,
    cancelReservation,
    busy,
  } = useRovaApp();

  const [search, setSearch] = useState('');
  const [desktopSelectedId, setDesktopSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const active = deliveries.filter(
      (d) => !['delivered', 'failed', 'cancelled', 'scheduled'].includes(d.status)
    ).length;
    const upcomingDeliveries = deliveries.filter((d) => d.status === 'scheduled').length;
    const upcomingRes = reservations.filter((r) =>
      ['pending_approval', 'confirmed', 'in_progress'].includes(r.status)
    ).length;
    const completed = deliveries.filter((d) => d.status === 'delivered').length;
    const cancelled = deliveries.filter((d) => d.status === 'cancelled' || d.status === 'failed').length;
    return {
      all: deliveries.length + reservations.length,
      active,
      upcoming: upcomingDeliveries + upcomingRes,
      completed,
      cancelled,
    };
  }, [deliveries, reservations]);

  const filteredDeliveries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (shipmentFilter === 'active' && ['delivered', 'failed', 'cancelled', 'scheduled'].includes(d.status)) {
        return false;
      }
      if (shipmentFilter === 'upcoming' && d.status !== 'scheduled') return false;
      if (shipmentFilter === 'completed' && d.status !== 'delivered') return false;
      if (shipmentFilter === 'cancelled' && d.status !== 'cancelled' && d.status !== 'failed') return false;
      if (!q) return true;
      return (
        d.reference.toLowerCase().includes(q) ||
        d.pickupAddress.toLowerCase().includes(q) ||
        (d.primaryDestinationLabel || '').toLowerCase().includes(q) ||
        (d.driverName || '').toLowerCase().includes(q)
      );
    });
  }, [deliveries, shipmentFilter, search]);

  const filteredReservations = useMemo(() => {
    if (shipmentFilter !== 'all' && shipmentFilter !== 'upcoming') return [];
    const q = search.trim().toLowerCase();
    return reservations.filter((r) => {
      if (shipmentFilter === 'upcoming' && !['pending_approval', 'confirmed', 'in_progress'].includes(r.status)) {
        return false;
      }
      if (!q) return true;
      return (
        r.pickupAddress.toLowerCase().includes(q) ||
        r.reservationDate.toLowerCase().includes(q) ||
        getVehicleLabel(r.vehicleCategory, lang).toLowerCase().includes(q)
      );
    });
  }, [reservations, shipmentFilter, search, lang]);

  const desktopSelected = useMemo(() => {
    if (filteredDeliveries.length === 0) return null;
    return filteredDeliveries.find((d) => d.id === desktopSelectedId) || filteredDeliveries[0];
  }, [filteredDeliveries, desktopSelectedId]);

  const filters: Array<{ id: ShipmentFilter; label: string; count: number }> = [
    { id: 'all', label: t('Toutes', 'All'), count: counts.all },
    { id: 'active', label: t('Actives', 'Active'), count: counts.active },
    { id: 'upcoming', label: t('À venir', 'Upcoming'), count: counts.upcoming },
    { id: 'completed', label: t('Terminées', 'Completed'), count: counts.completed },
    { id: 'cancelled', label: t('Annulées', 'Cancelled'), count: counts.cancelled },
  ];

  const handleSelectRow = (id: string) => {
    setDesktopSelectedId(id);
    // On mobile/tablet (< xl), open bottom sheet immediately; on xl, right pane displays inline
    if (window.innerWidth < 1280) {
      openShipmentDetail(id);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-8 space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
            {t('Expéditions', 'Shipments')}
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t('Suivez vos courses actives, planifiées et terminées.', 'Track active, scheduled, and completed shipments.')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => openComposer('single')}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>{t('Nouvelle livraison', 'New delivery')}</span>
        </button>
      </header>

      {/* Lightweight Segmented Filters + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {filters.map((f) => {
            const active = shipmentFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setShipmentFilter(f.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-neutral-950 text-white'
                    : 'bg-white border border-neutral-200 text-neutral-700 hover:border-neutral-400'
                }`}
              >
                <span>{f.label}</span>
                {f.count > 0 && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      active ? 'text-neutral-300' : 'text-neutral-400'
                    }`}
                  >
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-64 shrink-0">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Référence, adresse, livreur...', 'Reference, address, driver...')}
            className="w-full pl-9 pr-3.5 py-2 rounded-full bg-white border border-neutral-200 text-xs focus:outline-none focus:border-neutral-950"
          />
        </div>
      </div>

      {/* Master-Detail Split on Desktop, Single Stream on Mobile */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 space-y-4">
          {loadingData ? (
            <div className="rounded-2xl bg-white border border-neutral-200/80 p-5 space-y-4 animate-pulse">
              <div className="h-4 w-36 bg-neutral-200 rounded" />
              <div className="h-3 w-full bg-neutral-100 rounded" />
              <div className="h-4 w-32 bg-neutral-200 rounded pt-2" />
              <div className="h-3 w-4/5 bg-neutral-100 rounded" />
            </div>
          ) : filteredDeliveries.length === 0 && filteredReservations.length === 0 ? (
            <div className="rounded-3xl bg-white border border-neutral-200/80 p-8 text-center space-y-3">
              <p className="font-display text-base font-bold text-neutral-950">
                {shipmentFilter === 'upcoming'
                  ? t('Aucune réservation à venir', 'No upcoming reservations')
                  : t('Aucune expédition trouvée', 'No shipments yet')}
              </p>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                {shipmentFilter === 'upcoming'
                  ? t(
                      'Planifiez un véhicule dédié à l’avance pour vos tournées commerciales.',
                      'Reserve a dedicated vehicle ahead of time for your commercial runs.'
                    )
                  : t(
                      'Créez votre première livraison pour suivre vos colis et partager le lien client.',
                      'Create your first delivery to track parcels live and share recipient links.'
                    )}
              </p>
              <div className="pt-1 flex justify-center gap-2">
                {shipmentFilter === 'upcoming' ? (
                  <button
                    type="button"
                    onClick={openReservationSheet}
                    className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    {t('Planifier un véhicule', 'Schedule a vehicle')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openComposer('single')}
                    className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    {t('Créer votre première livraison', 'Create your first delivery')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Deliveries List */}
              {filteredDeliveries.length > 0 && (
                <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                  {filteredDeliveries.map((del) => {
                    const selected = desktopSelected?.id === del.id;
                    const createdLabel = del.createdAt?.toDate
                      ? del.createdAt.toDate().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                          day: 'numeric',
                          month: 'short',
                        })
                      : '';
                    return (
                      <button
                        key={del.id}
                        type="button"
                        onClick={() => handleSelectRow(del.id)}
                        className={`w-full text-left p-4 sm:p-5 transition-colors cursor-pointer flex items-start justify-between gap-3 ${
                          selected ? 'xl:bg-neutral-100/80 hover:bg-neutral-50' : 'hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-start gap-3.5 min-w-0">
                          <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0 mt-0.5">
                            <VehicleIllustration
                              category={del.vehicleCategory}
                              className="w-8 h-6 text-neutral-900"
                            />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 text-xs text-neutral-500 flex-wrap">
                              <span className="font-mono font-semibold text-neutral-950">
                                {del.reference}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className={`font-medium ${STATUS_META[del.status]?.text || 'text-neutral-700'}`}>
                                {getStatusLabel(del.status, lang)}
                              </span>
                              {createdLabel && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{createdLabel}</span>
                                </>
                              )}
                            </div>
                            <p className="text-sm font-medium text-neutral-950 truncate">
                              {del.pickupAddress} → {del.primaryDestinationLabel || t('Destination', 'Destination')}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {getVehicleLabel(del.vehicleCategory, lang)}
                              {del.driverName ? ` · ${del.driverName}` : ''}
                              {del.isMultiStop ? ` · ${del.stopCount} ${t('arrêts', 'stops')}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0 flex flex-col items-end gap-1">
                          <span className="font-mono text-xs font-semibold text-neutral-950 tabular-nums">
                            {formatMoney(del.quotedPrice, del.currency)}
                          </span>
                          <ChevronRight className="w-4 h-4 text-neutral-400 xl:hidden" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Upcoming / Scheduled Vehicle Reservations */}
              {filteredReservations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-neutral-500 px-1">
                    {t('Réservations de véhicules', 'Vehicle reservations')}
                  </p>
                  <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                    {filteredReservations.map((res) => (
                      <div key={res.id} className="p-4 flex items-center justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0">
                            <Calendar className="w-4 h-4 text-neutral-800" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-neutral-950 truncate">
                              {getVehicleLabel(res.vehicleCategory, lang)} · {res.reservationDate}
                            </p>
                            <p className="text-xs text-neutral-500 truncate">
                              {res.startTime}–{res.endTime} · {res.pickupAddress}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                              {res.status === 'pending_approval'
                                ? t('En attente de confirmation', 'Pending confirmation')
                                : res.status === 'confirmed'
                                ? t('Confirmée', 'Confirmed')
                                : res.status === 'cancelled'
                                ? t('Annulée', 'Cancelled')
                                : res.status}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-xs font-semibold tabular-nums">
                            {formatMoney(res.quotedPrice, res.currency)}
                          </span>
                          {(res.status === 'pending_approval' || res.status === 'confirmed') && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => cancelReservation(res.id)}
                              aria-label={t('Annuler la réservation', 'Cancel reservation')}
                              className="p-1.5 rounded-full text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Desktop Inline Detail & Live Tracking Panel */}
        <div className="hidden xl:block xl:col-span-7 sticky top-6">
          <div className="rounded-3xl bg-white border border-neutral-200/80 p-6">
            {desktopSelected ? (
              <ShipmentDetailContent
                delivery={desktopSelected}
                onOpenPublicTracking={onOpenPublicTracking}
              />
            ) : (
              <div className="py-20 text-center space-y-2">
                <MapPin className="w-6 h-6 mx-auto text-neutral-300" />
                <p className="text-sm font-semibold text-neutral-800">
                  {t('Aperçu de l’expédition', 'Shipment inspector')}
                </p>
                <p className="text-xs text-neutral-500">
                  {t(
                    'Sélectionnez une livraison à gauche pour afficher sa carte et sa chronologie.',
                    'Select a delivery on the left to inspect its live map and timeline.'
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
