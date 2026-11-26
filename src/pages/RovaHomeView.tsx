import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Bell,
  Bookmark,
  CalendarClock,
  ChevronRight,
  CreditCard,
  HelpCircle,
  MapPin,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useRovaApp } from '../context/RovaAppContext';
import { VehicleIllustration, VehicleStudioImage } from '../components/VehicleIllustration';
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import { RovaWordmark } from '../components/RovaSplashScreen';
import { BottomSheet } from '../components/BottomSheet';
import { PrimaryTab } from '../components/InterfaceExplorerBar';
import {
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';
import { VehicleCategory } from '../types/rova';

interface RovaHomeViewProps {
  onNavigateTab: (tab: PrimaryTab, accountSection?: string) => void;
}

interface HomeServiceCard {
  id: string;
  title: string;
  subtitleFr: string;
  subtitleEn: string;
  vehicle: VehicleCategory;
  mode: 'single' | 'multi';
}

const HOME_SERVICES: HomeServiceCard[] = [
  {
    id: 'express',
    title: 'Rovia Express',
    subtitleFr: 'Colis rapide · Moto',
    subtitleEn: 'Fast parcel · Bike',
    vehicle: 'motorcycle',
    mode: 'single',
  },
  {
    id: 'tournee',
    title: 'Rovia Tournée',
    subtitleFr: 'Multi-arrêts optimisés',
    subtitleEn: 'Multi-stop route',
    vehicle: 'cargo_motorcycle',
    mode: 'multi',
  },
  {
    id: 'cargo',
    title: 'Rovia Cargo',
    subtitleFr: 'Fourgon · Jusqu’à 800 kg',
    subtitleEn: 'Van · Up to 800 kg',
    vehicle: 'cargo_van',
    mode: 'single',
  },
  {
    id: 'fret',
    title: 'Rovia Fret',
    subtitleFr: 'Camion · Marchandises',
    subtitleEn: 'Truck · Heavy freight',
    vehicle: 'truck',
    mode: 'single',
  },
];

export function RovaHomeView({ onNavigateTab }: RovaHomeViewProps) {
  const { firebaseUser, profile } = useAuth();
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const {
    loadingData,
    deliveries,
    activeDeliveries,
    upcomingReservations,
    recipients,
    notifications,
    unreadNotifCount,
    openComposer,
    openReservationSheet,
    openShipmentDetail,
    openTrackSheet,
    openSupportSheet,
    repeatDelivery,
    markAllNotificationsRead,
    requestSignIn,
  } = useRovaApp();

  const [notifsOpen, setNotifsOpen] = useState(false);
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();

  const firstName = useMemo(() => {
    const raw = profile?.displayName || firebaseUser?.displayName || '';
    return raw.trim().split(' ')[0] || '';
  }, [profile?.displayName, firebaseUser?.displayName]);

  const recentCompleted = useMemo(
    () => deliveries.filter((d) => d.status === 'delivered').slice(0, 3),
    [deliveries]
  );

  const openNotifs = () => {
    setNotifsOpen(true);
    void markAllNotificationsRead();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-7 pb-10 space-y-7">
      {/* ================================================================== */}
      {/* 1. IDENTITÉ ROVIA & ACCÈS COMPTE                                   */}
      {/* ================================================================== */}
      <header
        className={`sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center justify-between gap-3 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none sm:static sm:mx-0 sm:px-0 sm:py-0 sm:translate-y-0 sm:pointer-events-auto sm:bg-transparent sm:backdrop-blur-none sm:border-none ${
          headerHidden ? '-translate-y-full pointer-events-none' : 'translate-y-0'
        } ${
          headerScrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-[#E5E5E5]'
            : 'bg-white border-b border-transparent'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <RovaWordmark size="md" />
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[#777777] truncate">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-[#777777]" />
            <span className="truncate">{region.city}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openTrackSheet}
            aria-label={t('Suivre un colis', 'Track a parcel')}
            className="min-h-[42px] px-3.5 rounded-full bg-[#F3F3F3] hover:bg-[#E5E5E5] text-xs font-medium text-[#171717] inline-flex items-center gap-1.5 transition-colors active:scale-[0.97] cursor-pointer whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5 text-[#777777]" />
            <span>{t('Suivre', 'Track')}</span>
          </button>

          {firebaseUser ? (
            <>
              <button
                type="button"
                onClick={openNotifs}
                aria-label={t('Notifications', 'Notifications')}
                className="relative min-w-[42px] min-h-[42px] rounded-full border border-[#E5E5E5] hover:border-[#171717] bg-white flex items-center justify-center text-[#171717] transition-colors active:scale-[0.97] cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#E52B32] text-white font-mono text-[9px] font-bold flex items-center justify-center tabular-nums ring-2 ring-white">
                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('account')}
                aria-label={t('Mon compte', 'My account')}
                className="min-w-[42px] min-h-[42px] rounded-full bg-[#171717] text-white font-display text-xs font-bold flex items-center justify-center hover:bg-neutral-800 transition-colors active:scale-[0.97] cursor-pointer"
              >
                {firstName ? firstName.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void requestSignIn()}
              className="min-h-[42px] px-4 rounded-full bg-[#171717] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors active:scale-[0.97] cursor-pointer whitespace-nowrap"
            >
              {t('Se connecter', 'Sign in')}
            </button>
          )}
        </div>
      </header>

      {/* ================================================================== */}
      {/* 2 & 3. ACCUEIL DISCRET + TITRE ACTION + BARRE « OÙ LIVRER ? »      */}
      {/* ================================================================== */}
      <section aria-label={t('Expédition rapide', 'Quick dispatch')} className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#777777] flex items-center gap-1.5">
            <span>
              {firstName
                ? t(`Bonjour ${firstName}`, `Hello ${firstName}`)
                : t('Bienvenue sur Rovia', 'Welcome to Rovia')}
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3 text-[#E52B32]" />
              {region.city}
            </span>
          </p>
          <h1 className="font-display text-[26px] leading-[1.16] sm:text-[36px] sm:leading-[1.12] font-bold tracking-tight text-[#171717]">
            {t('Où livrons-nous aujourd’hui ?', 'Where are we delivering today?')}
          </h1>
        </div>

        {/* Instant Yango / inDrive-Style Destination Entry Bar */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.985 }}
          onClick={() => openComposer('single', undefined, undefined, 'motorcycle')}
          className="group w-full min-h-[60px] px-4 sm:px-5 py-3 rounded-[26px] bg-[#F3F3F3] hover:bg-[#EAEAEA] border border-transparent hover:border-[#E5E5E5] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-10 h-10 rounded-full bg-[#171717] text-white flex items-center justify-center shrink-0">
              <Search className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-bold text-[#171717] truncate">
                {t('Où envoyer votre colis ?', 'Where is your parcel going?')}
              </p>
              <p className="text-xs text-[#777777] truncate">
                {t('Choisir départ & destination sur la carte', 'Pick pickup & drop-off on the map')}
              </p>
            </div>
          </div>
          <span className="w-10 h-10 rounded-full bg-[#E52B32] text-white flex items-center justify-center shrink-0 group-hover:bg-[#CC2229] transition-colors">
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </motion.button>

        {/* Quick Saved Destinations Strip (1-tap launch to map booking) */}
        {recipients.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-0.5">
            {recipients.slice(0, 5).map((rec) => (
              <button
                key={rec.id}
                type="button"
                onClick={() => openComposer('single', rec)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 rounded-full border border-[#E5E5E5] bg-white hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 transition-colors active:scale-[0.97] cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5 text-[#E52B32] shrink-0" />
                <span className="max-w-[140px] truncate">{rec.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* 4. SERVICES PRINCIPAUX — ILLUSTRATED 1-CLICK SERVICE CARDS         */}
      {/* ================================================================== */}
      <section aria-label={t('Nos services', 'Our services')} className="space-y-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-base sm:text-lg font-bold text-[#171717]">
            {t('Nos services', 'Services')}
          </h2>
          <span className="text-xs text-[#777777]">
            {t('Sélection en 1 clic', '1-tap booking')}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {HOME_SERVICES.map((service, index) => (
            <motion.button
              key={service.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.24,
                delay: index * 0.04,
                ease: [0.16, 1, 0.3, 1],
              }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => openComposer(service.mode, undefined, undefined, service.vehicle)}
              className="group relative rounded-[26px] bg-[#F3F3F3] hover:bg-[#ECECEC] border border-transparent hover:border-[#E5E5E5] p-3.5 sm:p-4 text-left flex flex-col justify-between min-h-[168px] sm:min-h-[192px] transition-colors cursor-pointer overflow-hidden"
            >
              {/* Cohesive Studio Vehicle Illustration */}
              <div className="w-full h-[86px] sm:h-[104px] flex items-center justify-center overflow-hidden">
                <VehicleStudioImage
                  category={service.vehicle}
                  alt={service.title}
                  className="w-full h-full object-contain scale-105 group-hover:scale-110 transition-transform duration-200 ease-out"
                />
              </div>

              {/* Crisp Title & Concise Subtitle */}
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-sm sm:text-[15px] font-bold tracking-tight text-[#171717] truncate">
                    {service.title}
                  </p>
                  <p className="text-[11.5px] sm:text-xs text-[#777777] truncate mt-0.5">
                    {lang === 'fr' ? service.subtitleFr : service.subtitleEn}
                  </p>
                </div>
                <span className="w-7 h-7 rounded-full bg-white text-[#171717] group-hover:bg-[#171717] group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      {/* ================================================================== */}
      {/* 5. ACTION DE PLANIFICATION SIMPLIFIÉE                              */}
      {/* ================================================================== */}
      <section aria-label={t('Planification', 'Scheduling')}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.985 }}
          onClick={openReservationSheet}
          className="group w-full rounded-[26px] border border-[#E5E5E5] hover:border-[#171717]/40 bg-white px-5 py-4 text-left flex items-center justify-between gap-4 transition-colors cursor-pointer min-h-[76px]"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#F3F3F3] text-[#171717] flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-bold text-[#171717] truncate">
                {t('Planifier une livraison', 'Schedule a delivery')}
              </p>
              <p className="text-xs text-[#777777] truncate mt-0.5">
                {t(
                  'Réserver un créneau horaire ou une journée dédiée avec chauffeur',
                  'Book a time slot or full day with a dedicated driver'
                )}
              </p>
            </div>
          </div>
          <span className="px-3.5 py-2 rounded-full bg-[#F3F3F3] group-hover:bg-[#171717] group-hover:text-white text-xs font-semibold text-[#171717] transition-colors shrink-0 inline-flex items-center gap-1 whitespace-nowrap">
            <span>{t('Planifier', 'Schedule')}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </motion.button>
      </section>

      {/* ================================================================== */}
      {/* 6. EXPÉDITIONS EN COURS & ACTIVITÉS RÉCENTES                       */}
      {/* ================================================================== */}
      {(loadingData || activeDeliveries.length > 0 || upcomingReservations.length > 0 || recentCompleted.length > 0) && (
        <section className="space-y-4">
          {loadingData && (
            <div className="rounded-3xl border border-[#E5E5E5] bg-white p-5 space-y-3 animate-pulse">
              <div className="h-4 w-36 bg-[#F3F3F3] rounded-full" />
              <div className="h-3.5 w-64 bg-[#F3F3F3] rounded-full" />
            </div>
          )}

          {/* Active Live Deliveries */}
          {!loadingData && activeDeliveries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-display text-base font-bold text-[#171717]">
                    {t('Livraisons en cours', 'Active deliveries')}
                  </h2>
                  <span className="font-mono text-xs font-semibold text-[#777777] tabular-nums">
                    {activeDeliveries.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('shipments')}
                  className="text-xs font-medium text-[#777777] hover:text-[#171717] inline-flex items-center gap-0.5 cursor-pointer py-1"
                >
                  <span>{t('Tout voir', 'View all')}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="rounded-3xl border border-[#E5E5E5] bg-white overflow-hidden divide-y divide-[#E5E5E5]">
                {activeDeliveries.slice(0, 3).map((del) => {
                  const hasLiveGps =
                    typeof del.driverLat === 'number' && typeof del.driverLng === 'number';
                  return (
                    <button
                      key={del.id}
                      type="button"
                      onClick={() => openShipmentDetail(del.id)}
                      className="w-full py-4 px-4 sm:px-5 hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer flex items-center justify-between gap-3.5 text-left"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0 mt-0.5">
                          <VehicleIllustration
                            category={del.vehicleCategory}
                            className="w-8 h-6 text-[#171717]"
                          />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-xs text-[#777777] flex-wrap">
                            <span className="font-mono font-semibold text-[#171717]">
                              {del.reference}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`font-medium inline-flex items-center gap-1.5 ${
                                STATUS_META[del.status]?.text || 'text-[#171717]'
                              }`}
                            >
                              {hasLiveGps && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0"
                                  aria-label={t('GPS actif', 'Live GPS')}
                                />
                              )}
                              {getStatusLabel(del.status, lang)}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-[#171717] truncate">
                            {del.pickupAddress} →{' '}
                            {del.primaryDestinationLabel || t('Destination', 'Destination')}
                          </p>
                          <p className="text-xs text-[#777777]">
                            {getVehicleLabel(del.vehicleCategory, lang)}
                            {del.isMultiStop ? ` · ${del.stopCount} ${t('arrêts', 'stops')}` : ''}
                            {del.estimatedDurationMin > 0 && (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span className="font-mono tabular-nums">
                                  ~{del.estimatedDurationMin} min
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="hidden sm:inline font-mono text-xs font-semibold text-[#171717] tabular-nums">
                          {formatLocalMoney(del.quotedPrice, del.currency)}
                        </span>
                        <span className="px-4 py-2 rounded-full bg-[#171717] text-white text-xs font-semibold whitespace-nowrap">
                          {t('Suivre', 'Track')}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming Scheduled Deliveries */}
          {!loadingData && upcomingReservations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-display text-base font-bold text-[#171717]">
                    {t('Livraisons planifiées', 'Scheduled deliveries')}
                  </h2>
                  <span className="font-mono text-xs font-semibold text-[#777777] tabular-nums">
                    {upcomingReservations.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('shipments')}
                  className="text-xs font-medium text-[#777777] hover:text-[#171717] inline-flex items-center gap-0.5 cursor-pointer py-1"
                >
                  <span>{t('Gérer', 'Manage')}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="rounded-3xl border border-[#E5E5E5] bg-white overflow-hidden divide-y divide-[#E5E5E5]">
                {upcomingReservations.slice(0, 2).map((res) => (
                  <div key={res.id} className="px-4 sm:px-5 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
                        <CalendarClock className="w-4 h-4 text-[#171717]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#171717] truncate">
                          {getVehicleLabel(res.vehicleCategory, lang)} · {res.reservationDate}
                        </p>
                        <p className="text-xs text-[#777777] truncate mt-0.5">
                          {res.startTime}–{res.endTime} · {res.pickupAddress}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#171717] tabular-nums shrink-0">
                      {formatLocalMoney(res.quotedPrice, res.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Completed Deliveries (shown when no active deliveries are in progress) */}
          {!loadingData && activeDeliveries.length === 0 && recentCompleted.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-base font-bold text-[#171717]">
                  {t('Trajets récents', 'Recent deliveries')}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('activity')}
                  className="text-xs font-medium text-[#777777] hover:text-[#171717] inline-flex items-center gap-0.5 cursor-pointer py-1"
                >
                  <span>{t('Historique', 'History')}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="rounded-3xl border border-[#E5E5E5] bg-white overflow-hidden divide-y divide-[#E5E5E5]">
                {recentCompleted.map((del) => (
                  <div
                    key={del.id}
                    className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => openShipmentDetail(del.id)}
                      className="flex items-center gap-3 min-w-0 text-left flex-1 cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
                        <VehicleIllustration
                          category={del.vehicleCategory}
                          className="w-8 h-6 text-[#171717]"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#171717] truncate">
                          {del.primaryDestinationLabel || del.pickupAddress}
                        </p>
                        <p className="text-xs text-[#777777] truncate mt-0.5">
                          {getVehicleLabel(del.vehicleCategory, lang)} ·{' '}
                          <span className="font-mono tabular-nums">
                            {formatLocalMoney(del.quotedPrice, del.currency)}
                          </span>
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => void repeatDelivery(del)}
                      className="min-h-[36px] px-3.5 rounded-full bg-[#F3F3F3] hover:bg-[#171717] hover:text-white text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{t('Refaire', 'Repeat')}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ================================================================== */}
      {/* 7. AUTRES FONCTIONNALITÉS SECONDAIRES                              */}
      {/* ================================================================== */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-medium text-[#777777]">
          {t('Accès direct', 'Quick access')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            {
              label: t('Suivre un code', 'Track code'),
              icon: Search,
              onClick: () => openTrackSheet(),
            },
            {
              label: t('Adresses', 'Addresses'),
              icon: Bookmark,
              onClick: () => onNavigateTab('account', 'addresses'),
            },
            {
              label: 'Payments',
              icon: CreditCard,
              onClick: () => onNavigateTab('account', 'payments'),
            },
            {
              label: t('Assistance', 'Support'),
              icon: HelpCircle,
              onClick: () => openSupportSheet(),
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className="min-h-[48px] px-4 py-3 rounded-2xl bg-[#F3F3F3]/80 hover:bg-[#EAEAEA] text-left flex items-center justify-between gap-2 transition-colors active:scale-[0.98] cursor-pointer"
              >
                <span className="inline-flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-[#171717] shrink-0" />
                  <span className="text-xs font-semibold text-[#171717] truncate">
                    {item.label}
                  </span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#777777] shrink-0" />
              </button>
            );
          })}
        </div>
      </section>

      {/* Notifications Bottom Sheet */}
      <BottomSheet
        open={notifsOpen}
        onClose={() => setNotifsOpen(false)}
        size="sm"
        title={t('Notifications', 'Notifications')}
      >
        {notifications.length === 0 ? (
          <div className="py-10 text-center space-y-1">
            <p className="text-sm font-semibold text-[#171717]">
              {t('Aucune notification', 'No notifications yet')}
            </p>
            <p className="text-xs text-[#777777]">
              {t(
                'Les mises à jour de vos livraisons apparaîtront ici.',
                'Live updates on your shipments will appear here.'
              )}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E5E5E5]">
            {notifications.slice(0, 20).map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (n.deliveryId) {
                    setNotifsOpen(false);
                    openShipmentDetail(n.deliveryId);
                  }
                }}
                className={`py-3.5 space-y-0.5 ${
                  n.deliveryId ? 'cursor-pointer hover:bg-[#F3F3F3]/60 -mx-2 px-3 rounded-2xl' : ''
                }`}
              >
                <p className="text-sm font-semibold text-[#171717] flex items-center gap-2">
                  {!n.read && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#E52B32] shrink-0" aria-hidden="true" />
                  )}
                  <span>{n.title}</span>
                </p>
                <p className="text-xs text-[#777777]">{n.message}</p>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
