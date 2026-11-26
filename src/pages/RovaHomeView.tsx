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
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import { RovaWordmark } from '../components/RovaSplashScreen';
import { BottomSheet } from '../components/BottomSheet';
import { PrimaryTab } from '../components/InterfaceExplorerBar';
import {
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';

interface RovaHomeViewProps {
  onNavigateTab: (tab: PrimaryTab, accountSection?: string) => void;
}

export function RovaHomeView({ onNavigateTab }: RovaHomeViewProps) {
  const { firebaseUser, profile } = useAuth();
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const {
    loadingData,
    activeDeliveries,
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
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();

  const firstName = useMemo(() => {
    const raw = profile?.displayName || firebaseUser?.displayName || '';
    return raw.trim().split(' ')[0] || '';
  }, [profile?.displayName, firebaseUser?.displayName]);

  const openNotifs = () => {
    setNotifsOpen(true);
    void markAllNotificationsRead();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-7 pb-10 space-y-8">
      {/* Minimal Header — Mobile Auto-Hide on Scroll Down, Reveal on Scroll Up */}
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
            className="min-h-[40px] px-3.5 rounded-full bg-[#F3F3F3] hover:bg-[#E5E5E5] text-xs font-medium text-[#171717] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5 text-[#777777]" />
            <span>{t('Suivre un code', 'Track code')}</span>
          </button>

          {firebaseUser ? (
            <>
              <button
                type="button"
                onClick={openNotifs}
                aria-label={t('Notifications', 'Notifications')}
                className="relative min-w-[40px] min-h-[40px] rounded-full border border-[#E5E5E5] hover:border-[#171717] bg-white flex items-center justify-center text-[#171717] transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#E52B32] text-white font-mono text-[9px] font-bold flex items-center justify-center tabular-nums">
                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('account')}
                aria-label={t('Mon compte', 'My account')}
                className="min-w-[40px] min-h-[40px] rounded-full bg-[#171717] text-white font-display text-xs font-bold flex items-center justify-center hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                {firstName ? firstName.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void requestSignIn()}
              className="min-h-[40px] px-4 rounded-full bg-[#171717] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('Se connecter', 'Sign in')}
            </button>
          )}
        </div>
      </header>

      {/* ================================================================== */}
      {/* EDITORIAL DISPATCH HERO — Clear Primary vs. Secondary Hierarchy    */}
      {/* ================================================================== */}
      <section aria-label={t('Expédition rapide', 'Quick dispatch')} className="space-y-5">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#777777] sm:hidden inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            <span>{region.city}, {region.countryName}</span>
          </p>
          <h1 className="font-display text-2xl sm:text-[34px] sm:leading-[1.15] font-bold tracking-tight text-[#171717]">
            {firstName
              ? t(`Bonjour ${firstName}, où expédiez-vous ?`, `Hello ${firstName}, where are we delivering?`)
              : t('Où expédiez-vous aujourd’hui ?', 'Where are we delivering today?')}
          </h1>
        </div>

        {/* Dominant Primary Action — Single Focal Dispatch Entry */}
        <div className="rounded-[28px] bg-[#171717] text-white p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="space-y-1.5 min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
              {t('Nouvelle livraison', 'New delivery')}
            </h2>
            <p className="text-xs sm:text-sm text-neutral-300 max-w-md leading-relaxed">
              {t(
                'Saisissez la collecte et la destination, comparez nos véhicules et suivez votre livreur en direct.',
                'Set pickup and drop-off, compare vehicles, and follow your courier live.'
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => openComposer('single')}
            className="min-h-[48px] px-6 rounded-full bg-[#E52B32] hover:bg-[#CC2229] text-white text-sm font-semibold inline-flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{t('Créer une livraison', 'Create delivery')}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Secondary Actions — Clean, Restrained Hairline Utility Rows (Not competing hero cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#E5E5E5] border border-[#E5E5E5] rounded-[28px] bg-white overflow-hidden">
          <button
            type="button"
            onClick={openReservationSheet}
            className="group w-full px-5 py-4 text-left flex items-center justify-between gap-3.5 hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer min-h-[68px]"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] text-[#171717] flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#171717] truncate">
                  {t('Planifier un véhicule', 'Schedule a vehicle')}
                </p>
                <p className="text-xs text-[#777777] truncate mt-0.5">
                  {t('Créneau horaire ou journée dédiée', 'Time window or full-day charter')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#777777] group-hover:text-[#171717] group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => openComposer('multi')}
            className="group w-full px-5 py-4 text-left flex items-center justify-between gap-3.5 hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer min-h-[68px]"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] text-[#171717] flex items-center justify-center shrink-0">
                <Route className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#171717] truncate">
                  {t('Tournée multi-arrêts', 'Multi-stop delivery')}
                </p>
                <p className="text-xs text-[#777777] truncate mt-0.5">
                  {t('Plusieurs destinations, itinéraire optimisé', 'Multiple stops, optimized route')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#777777] group-hover:text-[#171717] group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>
        </div>
      </section>

      {/* ================================================================== */}
      {/* ACTIVE SHIPMENTS — Linear List Composition                         */}
      {/* ================================================================== */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-base font-bold text-[#171717]">
              {t('Expéditions en cours', 'Active shipments')}
            </h2>
            {activeDeliveries.length > 0 && (
              <span className="font-mono text-xs font-semibold text-[#777777] tabular-nums">
                {activeDeliveries.length}
              </span>
            )}
          </div>
          {activeDeliveries.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigateTab('shipments')}
              className="text-xs font-medium text-[#777777] hover:text-[#171717] inline-flex items-center gap-0.5 cursor-pointer py-1"
            >
              <span>{t('Tout voir', 'View all')}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loadingData ? (
          <div className="rounded-3xl border border-[#E5E5E5] bg-white p-5 space-y-3 animate-pulse">
            <div className="h-4 w-36 bg-[#F3F3F3] rounded-full" />
            <div className="h-3.5 w-72 bg-[#F3F3F3] rounded-full" />
          </div>
        ) : activeDeliveries.length === 0 ? (
          <div className="rounded-3xl border border-[#E5E5E5] bg-white px-5 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#171717]">
                {t('Aucune expédition en cours', 'No active shipments')}
              </p>
              <p className="text-xs text-[#777777] max-w-md leading-relaxed">
                {t(
                  'Vos livraisons actives, leur progression et le suivi en direct apparaîtront ici dès confirmation.',
                  'Active deliveries, milestone progress, and live map tracking appear here as soon as confirmed.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openComposer('single')}
              className="min-h-[40px] px-5 rounded-full border border-[#E5E5E5] hover:border-[#171717] text-xs font-semibold text-[#171717] transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
            >
              {t('Démarrer une livraison', 'Start a delivery')}
            </button>
          </div>
        ) : (
          <div className="rounded-3xl border border-[#E5E5E5] bg-white overflow-hidden divide-y divide-[#E5E5E5]">
            {activeDeliveries.slice(0, 4).map((del) => {
              const hasLiveGps =
                typeof del.driverLat === 'number' && typeof del.driverLng === 'number';
              return (
                <button
                  key={del.id}
                  type="button"
                  onClick={() => openShipmentDetail(del.id)}
                  className="w-full py-4 px-5 hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer flex items-center justify-between gap-4 text-left"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
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
                        {del.driverName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{del.driverName}</span>
                          </>
                        )}
                      </div>
                      <p className="text-sm font-medium text-[#171717] truncate">
                        {del.pickupAddress} → {del.primaryDestinationLabel || t('Destination', 'Destination')}
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
                    <span className="px-4 py-2 rounded-full bg-[#171717] text-white text-xs font-medium whitespace-nowrap">
                      {t('Suivre', 'Track')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* UPCOMING RESERVATIONS (Conditional List)                           */}
      {/* ================================================================== */}
      {upcomingReservations.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-base font-bold text-[#171717]">
                {t('Réservations planifiées', 'Scheduled vehicles')}
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
            {upcomingReservations.slice(0, 3).map((res) => (
              <div key={res.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-[#171717]" />
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
        </section>
      )}

      {/* ================================================================== */}
      {/* RESTRAINED UTILITY ACCESS STRIP                                    */}
      {/* ================================================================== */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-medium text-[#777777]">
          {t('Accès direct', 'Quick access')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
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
              label: t('Historique', 'History'),
              icon: Package,
              onClick: () => onNavigateTab('activity'),
            },
            {
              label: t('Support', 'Support'),
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
                className="min-h-[48px] px-4 py-3 rounded-2xl bg-[#F3F3F3]/75 hover:bg-[#F3F3F3] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
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
