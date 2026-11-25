import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Bookmark,
  Calendar,
  ChevronRight,
  CreditCard,
  HelpCircle,
  MapPin,
  Package,
  Route,
  Search,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useRovaApp } from '../context/RovaAppContext';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';
import { VehicleIllustration } from '../components/VehicleIllustration';
import { BottomSheet } from '../components/BottomSheet';
import { PrimaryTab } from '../components/InterfaceExplorerBar';
import {
  formatMoney,
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';

interface RovaHomeViewProps {
  onNavigateTab: (tab: PrimaryTab) => void;
}

export function RovaHomeView({ onNavigateTab }: RovaHomeViewProps) {
  const { firebaseUser, profile } = useAuth();
  const { lang, t } = useLanguage();
  const {
    loadingData,
    business,
    activeDeliveries,
    upcomingReservations,
    onlineDrivers,
    notifications,
    unreadNotifCount,
    openComposer,
    openReservationSheet,
    openShipmentDetail,
    openTrackSheet,
    openSupportSheet,
    setDraft,
    markAllNotificationsRead,
    requestSignIn,
  } = useRovaApp();

  const [notifsOpen, setNotifsOpen] = useState(false);

  const firstName = useMemo(() => {
    const raw = profile?.displayName || firebaseUser?.displayName || '';
    return raw.trim().split(' ')[0] || '';
  }, [profile?.displayName, firebaseUser?.displayName]);

  const hubLat = business?.defaultPickupLat ?? 5.3235;
  const hubLng = business?.defaultPickupLng ?? -4.0267;

  const mapMarkers: MapMarkerItem[] = useMemo(() => {
    const list: MapMarkerItem[] = [];
    activeDeliveries.slice(0, 6).forEach((d) => {
      list.push({
        id: `home_del_${d.id}`,
        lat: d.pickupLat,
        lng: d.pickupLng,
        kind: 'pickup',
        label: `${d.reference} · ${d.pickupAddress}`,
      });
      if (typeof d.driverLat === 'number' && typeof d.driverLng === 'number') {
        list.push({
          id: `home_drv_${d.id}`,
          lat: d.driverLat,
          lng: d.driverLng,
          kind: 'driver',
          label: d.driverName || t('Livreur ROVA', 'ROVA Driver'),
        });
      }
    });
    if (list.length === 0) {
      onlineDrivers.slice(0, 8).forEach((drv) => {
        list.push({
          id: `online_${drv.uid}`,
          lat: drv.currentLat,
          lng: drv.currentLng,
          kind: 'driver',
          label: `${drv.firstName} · ${getVehicleLabel(drv.vehicleCategory, lang)}`,
        });
      });
    }
    if (list.length === 0) {
      list.push({
        id: 'hub',
        lat: hubLat,
        lng: hubLng,
        kind: 'selected',
        label: business?.defaultPickupAddress || t('Votre zone d’expédition', 'Your dispatch area'),
      });
    }
    return list;
  }, [activeDeliveries, onlineDrivers, hubLat, hubLng, business?.defaultPickupAddress, lang, t]);

  const openNotifs = () => {
    setNotifsOpen(true);
    void markAllNotificationsRead();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-7 pb-8 space-y-6">
      {/* Minimal App Header */}
      <header className="flex items-center justify-between gap-4">
        <span className="font-display text-lg font-extrabold tracking-[0.22em] text-neutral-950 select-none">
          ROVA
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openTrackSheet}
            aria-label={t('Suivre un colis', 'Track a parcel')}
            className="min-h-[40px] px-3.5 rounded-full bg-white border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5 text-neutral-500" />
            <span>{t('Suivre un code', 'Track code')}</span>
          </button>

          {firebaseUser ? (
            <>
              <button
                type="button"
                onClick={openNotifs}
                aria-label={t('Notifications', 'Notifications')}
                className="relative min-w-[40px] min-h-[40px] rounded-full bg-white border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-neutral-950 text-white font-mono text-[9px] font-bold flex items-center justify-center">
                    {unreadNotifCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('account')}
                aria-label={t('Mon compte', 'My account')}
                className="min-w-[40px] min-h-[40px] rounded-full bg-neutral-950 text-white font-display text-xs font-bold flex items-center justify-center hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                {firstName ? firstName.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void requestSignIn()}
              className="min-h-[40px] px-4 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('Se connecter', 'Sign in')}
            </button>
          )}
        </div>
      </header>

      {/* Main Responsive Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Left / Primary Operational Column */}
        <div className="lg:col-span-7 space-y-6">
          {/* Greeting */}
          <section className="space-y-1 pt-1">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950">
              {firstName
                ? t(`Bonjour, ${firstName}`, `Hello, ${firstName}`)
                : t('Expédiez en toute simplicité', 'Ship with clarity')}
            </h1>
            <p className="text-sm text-neutral-500">
              {t(
                'Créez une livraison, réservez un véhicule ou suivez vos colis en direct.',
                'Create a delivery, reserve a vehicle, or track active shipments live.'
              )}
            </p>
          </section>

          {/* Prioritized Main Actions */}
          <section aria-label={t('Actions principales', 'Main actions')} className="space-y-3">
            {/* Dominant Primary Action */}
            <button
              type="button"
              onClick={() => openComposer('single')}
              className="group w-full text-left rounded-3xl bg-neutral-950 text-white p-5 sm:p-6 shadow-sm hover:bg-neutral-900 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <p className="text-xs text-neutral-400 font-medium">
                  {t('Expédition immédiate ou planifiée', 'Instant or scheduled dispatch')}
                </p>
                <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                  {t('Nouvelle livraison', 'New delivery')}
                </h2>
                <p className="text-xs sm:text-sm text-neutral-300 max-w-md">
                  {t(
                    'Sélectionnez la collecte sur la carte, choisissez votre véhicule et confirmez en quelques secondes.',
                    'Pick pickup on the map, choose your vehicle, and confirm in seconds.'
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-white text-neutral-950 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform">
                <ArrowRight className="w-5 h-5" />
              </div>
            </button>

            {/* Secondary Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={openReservationSheet}
                className="group text-left rounded-2xl bg-white border border-neutral-200/90 hover:border-neutral-950 p-4 sm:p-5 transition-all active:scale-[0.99] cursor-pointer space-y-2.5"
              >
                <div className="w-10 h-10 rounded-full bg-neutral-100 group-hover:bg-neutral-950 group-hover:text-white flex items-center justify-center transition-colors">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-neutral-950">
                    {t('Planifier un véhicule', 'Schedule a vehicle')}
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Créneau horaire ou journée dédiée', 'Time window or full-day charter')}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => openComposer('multi')}
                className="group text-left rounded-2xl bg-white border border-neutral-200/90 hover:border-neutral-950 p-4 sm:p-5 transition-all active:scale-[0.99] cursor-pointer space-y-2.5"
              >
                <div className="w-10 h-10 rounded-full bg-neutral-100 group-hover:bg-neutral-950 group-hover:text-white flex items-center justify-center transition-colors">
                  <Route className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-neutral-950">
                    {t('Tournée multi-arrêts', 'Multi-stop delivery')}
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Plusieurs clients, trajet optimisé', 'Multiple stops, optimized route')}
                  </p>
                </div>
              </button>
            </div>
          </section>

          {/* Active Shipments Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-neutral-950">
                {t('Expéditions en cours', 'Active shipments')}
              </h2>
              {activeDeliveries.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('shipments')}
                  className="text-xs font-medium text-neutral-600 hover:text-neutral-950 inline-flex items-center gap-0.5 cursor-pointer"
                >
                  {t('Tout voir', 'View all')}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {loadingData ? (
              <div className="rounded-2xl bg-white border border-neutral-200/80 p-5 space-y-3 animate-pulse">
                <div className="h-4 w-32 bg-neutral-200 rounded" />
                <div className="h-3 w-64 bg-neutral-100 rounded" />
                <div className="h-3 w-48 bg-neutral-100 rounded" />
              </div>
            ) : activeDeliveries.length === 0 ? (
              <div className="rounded-2xl bg-white border border-neutral-200/80 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-neutral-950">
                    {t('Aucune livraison en cours', 'No active shipments right now')}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {t(
                      'Vos prochaines courses et leur suivi GPS en direct apparaîtront ici.',
                      'Your upcoming deliveries and live GPS tracking will appear here.'
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openComposer('single')}
                  className="px-4 py-2.5 rounded-full bg-neutral-100 hover:bg-neutral-950 hover:text-white text-xs font-semibold text-neutral-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t('Créer votre première livraison', 'Create your first delivery')}
                </button>
              </div>
            ) : (
              <div className="rounded-2xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                {activeDeliveries.slice(0, 3).map((del) => (
                  <div
                    key={del.id}
                    onClick={() => openShipmentDetail(del.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openShipmentDetail(del.id);
                    }}
                    className="p-4 sm:p-5 hover:bg-neutral-50 transition-colors cursor-pointer flex items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0">
                        <VehicleIllustration category={del.vehicleCategory} className="w-9 h-6 text-neutral-900" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-neutral-500 flex-wrap">
                          <span className="font-mono font-semibold text-neutral-950">{del.reference}</span>
                          <span aria-hidden="true">·</span>
                          <span className={`font-medium ${STATUS_META[del.status]?.text || 'text-neutral-700'}`}>
                            {getStatusLabel(del.status, lang)}
                          </span>
                          {del.driverName && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{del.driverName}</span>
                            </>
                          )}
                        </div>
                        <p className="text-sm font-medium text-neutral-950 truncate">
                          {del.pickupAddress} → {del.primaryDestinationLabel || t('Destination', 'Destination')}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {getVehicleLabel(del.vehicleCategory, lang)}
                          {del.isMultiStop ? ` · ${del.stopCount} ${t('arrêts', 'stops')}` : ''}
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono tabular-nums">~{del.estimatedDurationMin} min</span>
                        </p>
                      </div>
                    </div>

                    <span className="px-3.5 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium whitespace-nowrap shrink-0">
                      {t('Suivre', 'Track')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Upcoming Reservations (only shown when present) */}
          {upcomingReservations.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-neutral-950">
                  {t('Réservations à venir', 'Upcoming reservations')}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('shipments')}
                  className="text-xs font-medium text-neutral-600 hover:text-neutral-950 inline-flex items-center gap-0.5 cursor-pointer"
                >
                  {t('Gérer', 'Manage')}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="rounded-2xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                {upcomingReservations.slice(0, 2).map((res) => (
                  <div key={res.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-950 truncate">
                        {getVehicleLabel(res.vehicleCategory, lang)} · {res.reservationDate}
                      </p>
                      <p className="text-xs text-neutral-500 truncate mt-0.5">
                        {res.startTime}–{res.endTime} · {res.pickupAddress}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-semibold text-neutral-950 tabular-nums shrink-0">
                      {formatMoney(res.quotedPrice, res.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Contextual Useful Shortcuts */}
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold text-neutral-500">
              {t('Raccourcis', 'Shortcuts')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                {
                  label: t('Adresses', 'Addresses'),
                  icon: Bookmark,
                  onClick: () => onNavigateTab('account'),
                },
                {
                  label: 'Payments',
                  icon: CreditCard,
                  onClick: () => onNavigateTab('account'),
                },
                {
                  label: t('Historique', 'History'),
                  icon: Package,
                  onClick: () => onNavigateTab('activity'),
                },
                {
                  label: t('Support', 'Support'),
                  icon: HelpCircle,
                  onClick: () => openSupportSheet(),
                },
              ].map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={s.onClick}
                    className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-white border border-neutral-200/80 hover:border-neutral-950 text-xs font-medium text-neutral-800 transition-colors cursor-pointer"
                  >
                    <Icon className="w-4 h-4 text-neutral-500 shrink-0" />
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right / Contextual Map Column (Mobile below, Desktop sticky beside) */}
        <aside className="lg:col-span-5 lg:sticky lg:top-6 space-y-3">
          <div className="rounded-3xl bg-white border border-neutral-200/80 p-3.5 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <div>
                <h2 className="font-display text-sm font-bold text-neutral-950">
                  {t('Carte d’expédition', 'Dispatch map')}
                </h2>
                <p className="text-xs text-neutral-500">
                  {t(
                    'Touchez un lieu pour démarrer une collecte.',
                    'Tap or search a place to start a pickup.'
                  )}
                </p>
              </div>
              {onlineDrivers.length > 0 && (
                <span className="text-xs font-mono text-neutral-600 tabular-nums">
                  {onlineDrivers.length} {t('en ligne', 'online')}
                </span>
              )}
            </div>

            <RovaMap
              center={[hubLat, hubLng]}
              markers={mapMarkers}
              interactivePick
              showSearchBar
              searchPlaceholder={t('D’où part votre colis ?', 'Where is your parcel picked up?')}
              heightClass="h-[260px] lg:h-[420px]"
              onLocationSelected={(place) => {
                setDraft((p) => ({
                  ...p,
                  step: 2,
                  pickup: {
                    ...p.pickup,
                    address: place.shortName || place.displayName,
                    landmark: place.landmark || '',
                    lat: place.lat,
                    lng: place.lng,
                  },
                }));
                openComposer('single');
              }}
            />

            <div className="flex items-center justify-between px-1 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-neutral-700" />
                {business?.city || t('Abidjan & couverture nationale', 'City & nationwide network')}
              </span>
              <button
                type="button"
                onClick={() => openComposer('single')}
                className="font-semibold text-neutral-950 hover:underline cursor-pointer"
              >
                {t('Ouvrir le créateur', 'Open composer')}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Notifications Bottom Sheet */}
      <BottomSheet
        open={notifsOpen}
        onClose={() => setNotifsOpen(false)}
        size="sm"
        title={t('Notifications', 'Notifications')}
      >
        {notifications.length === 0 ? (
          <div className="py-10 text-center space-y-1">
            <p className="text-sm font-semibold text-neutral-900">
              {t('Aucune notification', 'No notifications yet')}
            </p>
            <p className="text-xs text-neutral-500">
              {t(
                'Les mises à jour de vos livraisons apparaîtront ici.',
                'Live updates on your shipments will appear here.'
              )}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {notifications.slice(0, 20).map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (n.deliveryId) {
                    setNotifsOpen(false);
                    openShipmentDetail(n.deliveryId);
                  }
                }}
                className={`py-3.5 space-y-0.5 ${n.deliveryId ? 'cursor-pointer hover:bg-neutral-50 -mx-2 px-2 rounded-xl' : ''}`}
              >
                <p className="text-sm font-semibold text-neutral-950">{n.title}</p>
                <p className="text-xs text-neutral-600">{n.message}</p>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
