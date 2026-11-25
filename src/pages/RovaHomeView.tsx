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
import { VehicleIllustration } from '../components/VehicleIllustration';
import {
  HeroDeliveryScene,
  MultiStopRouteIllustration,
  ScheduleVehicleIllustration,
  ShortcutCardIllustration,
  TrackingParcelIllustration,
  UrbanHorizonIllustration,
} from '../components/RovaIllustrations';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import { BottomSheet } from '../components/BottomSheet';
import { PrimaryTab } from '../components/InterfaceExplorerBar';
import { GeoPlace } from '../types/rova';
import {
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';

interface RovaHomeViewProps {
  onNavigateTab: (tab: PrimaryTab) => void;
}

export function RovaHomeView({ onNavigateTab }: RovaHomeViewProps) {
  const { firebaseUser, profile } = useAuth();
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const {
    loadingData,
    business,
    activeDeliveries,
    onlineDrivers,
    upcomingReservations,
    notifications,
    unreadNotifCount,
    openComposer,
    openReservationSheet,
    openShipmentDetail,
    openTrackSheet,
    openSupportSheet,
    markAllNotificationsRead,
    requestSignIn,
  } = useRovaApp();

  const [notifsOpen, setNotifsOpen] = useState(false);
  const [pickedPlace, setPickedPlace] = useState<GeoPlace | null>(null);
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();

  const homeMapCenter = useMemo<[number, number]>(() => {
    if (pickedPlace) return [pickedPlace.lat, pickedPlace.lng];
    const firstActive = activeDeliveries[0];
    if (firstActive && Number.isFinite(firstActive.pickupLat) && Number.isFinite(firstActive.pickupLng)) {
      return [firstActive.pickupLat, firstActive.pickupLng];
    }
    if (business?.defaultPickupLat && business?.defaultPickupLng) {
      return [business.defaultPickupLat, business.defaultPickupLng];
    }
    return [region.lat, region.lng];
  }, [pickedPlace, activeDeliveries, business?.defaultPickupLat, business?.defaultPickupLng, region.lat, region.lng]);

  const homeMapMarkers = useMemo<MapMarkerItem[]>(() => {
    const list: MapMarkerItem[] = [];
    if (pickedPlace) {
      list.push({
        id: 'home_picked',
        lat: pickedPlace.lat,
        lng: pickedPlace.lng,
        kind: 'pickup',
        label: pickedPlace.shortName || pickedPlace.displayName,
        draggable: true,
      });
    } else if (activeDeliveries[0]) {
      const del = activeDeliveries[0];
      list.push({
        id: `home_del_${del.id}`,
        lat: del.pickupLat,
        lng: del.pickupLng,
        kind: 'pickup',
        label: `${del.reference} · ${del.pickupAddress}`,
      });
      if (typeof del.driverLat === 'number' && typeof del.driverLng === 'number') {
        list.push({
          id: `home_drv_${del.id}`,
          lat: del.driverLat,
          lng: del.driverLng,
          kind: 'driver',
          label: del.driverName || t('Livreur ROVA', 'ROVA Driver'),
        });
      }
    }
    onlineDrivers.slice(0, 6).forEach((d) => {
      if (typeof d.currentLat === 'number' && typeof d.currentLng === 'number') {
        list.push({
          id: `online_${d.uid}`,
          lat: d.currentLat,
          lng: d.currentLng,
          kind: 'driver',
          label: d.firstName || t('Livreur disponible', 'Available driver'),
        });
      }
    });
    return list;
  }, [pickedPlace, activeDeliveries, onlineDrivers, t]);

  const firstName = useMemo(() => {
    const raw = profile?.displayName || firebaseUser?.displayName || '';
    return raw.trim().split(' ')[0] || '';
  }, [profile?.displayName, firebaseUser?.displayName]);

  const openNotifs = () => {
    setNotifsOpen(true);
    void markAllNotificationsRead();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-7 pb-8 space-y-6">
      {/* Minimal App Header — Mobile Auto-Hide on Scroll Down, Reveal on Scroll Up */}
      <header
        className={`sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center justify-between gap-4 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none sm:static sm:mx-0 sm:px-0 sm:py-0 sm:translate-y-0 sm:pointer-events-auto sm:bg-transparent sm:backdrop-blur-none sm:border-none ${
          headerHidden ? '-translate-y-full pointer-events-none' : 'translate-y-0'
        } ${
          headerScrolled
            ? 'bg-[#f8f8f9]/92 backdrop-blur-md border-b border-neutral-200/70'
            : 'bg-transparent border-b border-transparent'
        }`}
      >
        <span className="font-display text-lg font-extrabold tracking-[0.22em] text-neutral-950 select-none inline-flex items-baseline">
          ROVA<span className="text-red-600 tracking-normal">.</span>
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
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white font-mono text-[9px] font-bold flex items-center justify-center shadow-[0_2px_6px_rgba(220,38,38,0.4)]">
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
      <div className="grid grid-cols-1 gap-6 items-start">
        <div className="w-full space-y-6">
          {/* Greeting with Minimalist Urban Horizon Illustration */}
          <section className="flex items-end justify-between gap-4 pt-1">
            <div className="space-y-1 min-w-0">
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950">
                {firstName
                  ? t(`Bonjour, ${firstName}`, `Hello, ${firstName}`)
                  : t('Expédiez en toute simplicité', 'Ship with clarity')}
              </h1>
              <p className="text-sm text-neutral-500 max-w-lg">
                {t(
                  'Créez une livraison, réservez un véhicule ou suivez vos colis en direct.',
                  'Create a delivery, reserve a vehicle, or track active shipments live.'
                )}
              </p>
            </div>
            <div aria-hidden="true" className="shrink-0 pointer-events-none opacity-90">
              <UrbanHorizonIllustration className="w-24 h-10 sm:w-44 sm:h-16" />
            </div>
          </section>

          {/* Prioritized Main Actions with Custom Editorial Illustrations */}
          <section aria-label={t('Actions principales', 'Main actions')} className="space-y-3">
            {/* Dominant Primary Action — Black / White / Red Illustrated Hero Card */}
            <button
              type="button"
              onClick={() => openComposer('single')}
              className="group relative w-full overflow-hidden text-left rounded-3xl bg-neutral-950 text-white p-5 sm:p-7 shadow-sm hover:bg-neutral-900 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-between gap-4"
            >
              <div className="relative z-10 space-y-1.5 min-w-0 max-w-lg">
                <p className="inline-flex items-center gap-2 text-xs text-neutral-300 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                  <span>{t('Expédition immédiate ou planifiée', 'Instant or scheduled dispatch')}</span>
                </p>
                <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                  {t('Nouvelle livraison', 'New delivery')}
                </h2>
                <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
                  {t(
                    'Sélectionnez la collecte sur Google Maps, choisissez votre véhicule et confirmez en quelques secondes.',
                    'Pick pickup on Google Maps, choose your vehicle, and confirm in seconds.'
                  )}
                </p>
              </div>

              <div className="relative z-10 flex items-center gap-4 shrink-0">
                <div
                  aria-hidden="true"
                  className="hidden sm:block pointer-events-none transition-transform duration-500 group-hover:translate-x-1"
                >
                  <HeroDeliveryScene className="w-52 h-28" />
                </div>
                <div className="w-12 h-12 rounded-full bg-white text-neutral-950 flex items-center justify-center shrink-0 group-hover:bg-red-600 group-hover:text-white group-hover:translate-x-0.5 transition-all">
                  <ArrowRight className="w-5 h-5" />
                </div>
              </div>

              {/* Mobile Atmospheric Illustration Backdrop */}
              <div
                aria-hidden="true"
                className="sm:hidden pointer-events-none absolute -right-4 -bottom-4 opacity-45 transition-transform duration-500 group-hover:-translate-x-1"
              >
                <HeroDeliveryScene className="w-44 h-24" />
              </div>
            </button>

            {/* Secondary Actions with Bespoke Corner Illustrations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={openReservationSheet}
                className="group relative overflow-hidden text-left rounded-3xl bg-white border border-neutral-200/90 hover:border-neutral-950 p-5 sm:p-6 transition-all active:scale-[0.99] cursor-pointer min-h-[144px] flex flex-col justify-between"
              >
                <div className="relative z-10 w-10 h-10 rounded-full bg-neutral-100 group-hover:bg-neutral-950 group-hover:text-white flex items-center justify-center transition-colors">
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="relative z-10 max-w-[66%] pt-3">
                  <h3 className="font-display text-sm sm:text-base font-bold text-neutral-950">
                    {t('Planifier un véhicule', 'Schedule a vehicle')}
                  </h3>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                    {t('Créneau horaire ou journée dédiée', 'Time window or full-day charter')}
                  </p>
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2 bottom-2 opacity-90 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                >
                  <ScheduleVehicleIllustration className="w-24 h-20 sm:w-28 sm:h-24" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => openComposer('multi')}
                className="group relative overflow-hidden text-left rounded-3xl bg-white border border-neutral-200/90 hover:border-neutral-950 p-5 sm:p-6 transition-all active:scale-[0.99] cursor-pointer min-h-[144px] flex flex-col justify-between"
              >
                <div className="relative z-10 w-10 h-10 rounded-full bg-neutral-100 group-hover:bg-neutral-950 group-hover:text-white flex items-center justify-center transition-colors">
                  <Route className="w-4 h-4" />
                </div>
                <div className="relative z-10 max-w-[66%] pt-3">
                  <h3 className="font-display text-sm sm:text-base font-bold text-neutral-950">
                    {t('Tournée multi-arrêts', 'Multi-stop delivery')}
                  </h3>
                  <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                    {t('Plusieurs clients, trajet optimisé', 'Multiple stops, optimized route')}
                  </p>
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2 bottom-2 opacity-90 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                >
                  <MultiStopRouteIllustration className="w-24 h-20 sm:w-28 sm:h-24" />
                </div>
              </button>
            </div>
          </section>

          {/* Interactive Live Google Map — Directly Visible on Mobile & Desktop */}
          <section aria-label={t('Carte en direct', 'Live map')} className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-display text-base font-bold text-neutral-950 truncate">
                  {t('Carte en direct', 'Live map')}
                </h2>
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {region.city}, {region.countryName}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  pickedPlace
                    ? openComposer('single', undefined, {
                        address: pickedPlace.shortName || pickedPlace.displayName,
                        landmark: pickedPlace.landmark,
                        lat: pickedPlace.lat,
                        lng: pickedPlace.lng,
                      })
                    : openComposer('single')
                }
                className="text-xs font-semibold text-neutral-950 hover:text-red-600 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <MapPin className="w-3.5 h-3.5 text-red-600" />
                <span>
                  {pickedPlace
                    ? t('Expédier d’ici', 'Ship from here')
                    : t('Choisir sur la carte', 'Pick on map')}
                </span>
              </button>
            </div>

            <div className="rounded-3xl bg-white border border-neutral-200/80 p-2 sm:p-2.5 shadow-xs space-y-2">
              <RovaMap
                center={homeMapCenter}
                zoom={13}
                markers={homeMapMarkers}
                interactivePick
                showSearchBar
                initialSearchText={pickedPlace?.shortName || ''}
                searchPlaceholder={t(
                  `Rechercher une adresse à ${region.city} ou ailleurs...`,
                  `Search an address in ${region.city} or anywhere...`
                )}
                heightClass="h-[240px] sm:h-[300px]"
                onLocationSelected={(place) => setPickedPlace(place)}
              />

              {pickedPlace && (
                <div className="px-2.5 py-2 rounded-2xl bg-neutral-50 border border-neutral-200/70 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-neutral-500">
                      {t('Point de collecte sélectionné', 'Selected pickup point')}
                    </p>
                    <p className="text-xs font-semibold text-neutral-950 truncate">
                      {pickedPlace.shortName || pickedPlace.displayName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      openComposer('single', undefined, {
                        address: pickedPlace.shortName || pickedPlace.displayName,
                        landmark: pickedPlace.landmark,
                        lat: pickedPlace.lat,
                        lng: pickedPlace.lng,
                      })
                    }
                    className="px-3.5 py-2 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {t('Expédier ici', 'Ship here')}
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Active Shipments Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-bold text-neutral-950">
                  {t('Expéditions en cours', 'Active shipments')}
                </h2>
                {activeDeliveries.length > 0 && (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-600 tabular-nums">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
                    {activeDeliveries.length}
                  </span>
                )}
              </div>
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
              <div className="rounded-3xl bg-white border border-neutral-200/80 p-5 space-y-3 animate-pulse">
                <div className="h-4 w-32 bg-neutral-200 rounded" />
                <div className="h-3 w-64 bg-neutral-100 rounded" />
                <div className="h-3 w-48 bg-neutral-100 rounded" />
              </div>
            ) : activeDeliveries.length === 0 ? (
              <div className="rounded-3xl bg-white border border-neutral-200/80 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                <div className="flex items-center gap-4">
                  <div className="shrink-0">
                    <TrackingParcelIllustration className="w-24 h-20 sm:w-28 sm:h-22" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-neutral-950">
                      {t('Aucune livraison en cours', 'No active shipments right now')}
                    </p>
                    <p className="text-xs text-neutral-500 max-w-sm leading-relaxed">
                      {t(
                        'Vos prochaines courses et leur suivi Google Maps en direct apparaîtront ici.',
                        'Your upcoming deliveries and live Google Maps tracking will appear here.'
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openComposer('single')}
                  className="px-4 py-2.5 rounded-full bg-neutral-950 text-white hover:bg-neutral-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t('Créer votre première livraison', 'Create your first delivery')}
                </button>
              </div>
            ) : (
              <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
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
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                            <span className={`font-medium ${STATUS_META[del.status]?.text || 'text-neutral-700'}`}>
                              {getStatusLabel(del.status, lang)}
                            </span>
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
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-bold text-neutral-950">
                    {t('Réservations à venir', 'Upcoming reservations')}
                  </h2>
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-600 tabular-nums">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
                    {upcomingReservations.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('shipments')}
                  className="text-xs font-medium text-neutral-600 hover:text-neutral-950 inline-flex items-center gap-0.5 cursor-pointer"
                >
                  {t('Gérer', 'Manage')}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="relative rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                {upcomingReservations.slice(0, 2).map((res) => (
                  <div key={res.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-10 rounded-2xl bg-neutral-50 border border-neutral-200/80 flex items-center justify-center shrink-0">
                        <ScheduleVehicleIllustration className="w-9 h-7" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-950 truncate">
                          {getVehicleLabel(res.vehicleCategory, lang)} · {res.reservationDate}
                        </p>
                        <p className="text-xs text-neutral-500 truncate mt-0.5">
                          {res.startTime}–{res.endTime} · {res.pickupAddress}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-neutral-950 tabular-nums shrink-0">
                      {formatLocalMoney(res.quotedPrice, res.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Contextual Useful Shortcuts with Minimalist Editorial Corner Motifs */}
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold text-neutral-500">
              {t('Raccourcis', 'Shortcuts')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                {
                  kind: 'addresses' as const,
                  label: t('Adresses', 'Addresses'),
                  icon: Bookmark,
                  onClick: () => onNavigateTab('account'),
                },
                {
                  kind: 'payments' as const,
                  label: 'Payments',
                  icon: CreditCard,
                  onClick: () => onNavigateTab('account'),
                },
                {
                  kind: 'history' as const,
                  label: t('Historique', 'History'),
                  icon: Package,
                  onClick: () => onNavigateTab('activity'),
                },
                {
                  kind: 'support' as const,
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
                    className="group relative overflow-hidden flex flex-col justify-between gap-3 px-4 py-3.5 min-h-[82px] rounded-2xl bg-white border border-neutral-200/80 hover:border-neutral-950 text-left text-xs font-medium text-neutral-800 transition-colors cursor-pointer"
                  >
                    <div className="relative z-10 flex items-center justify-between w-full">
                      <Icon className="w-4 h-4 text-neutral-500 group-hover:text-neutral-950 transition-colors shrink-0" />
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-neutral-200 group-hover:bg-red-600 transition-colors shrink-0"
                        aria-hidden="true"
                      />
                    </div>
                    <span className="relative z-10 font-semibold text-neutral-900 truncate">{s.label}</span>
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute right-1 bottom-1 opacity-75 group-hover:opacity-100 transition-transform duration-200 group-hover:scale-105"
                    >
                      <ShortcutCardIllustration kind={s.kind} className="w-12 h-10" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
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
                <p className="text-sm font-semibold text-neutral-950 flex items-center gap-2">
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />}
                  <span>{n.title}</span>
                </p>
                <p className="text-xs text-neutral-600">{n.message}</p>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
