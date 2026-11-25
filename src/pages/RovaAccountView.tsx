import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  CreditCard,
  FileText,
  HelpCircle,
  LogOut,
  MapPin,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useRovaApp } from '../context/RovaAppContext';
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import { AppleLogo, GoogleLogo } from '../components/AuthSheet';
import { getPaymentMethodLabelEn } from '../lib/logistics';
import {
  AccountLocalPrefs,
  AccountSectionId,
  getRoleDisplayLabel,
  loadAccountPrefs,
  saveAccountPrefs,
} from '../components/account/accountTypes';
import { ProfileSection } from '../components/account/ProfileSection';
import { AddressesSection } from '../components/account/AddressesSection';
import { PaymentsSection } from '../components/account/PaymentsSection';
import {
  NotificationsSection,
  PreferencesSection,
} from '../components/account/PreferencesNotificationsSection';
import {
  LegalSection,
  SecuritySection,
  SupportSection,
} from '../components/account/SecuritySupportLegalSections';

interface RovaAccountViewProps {
  onOpenWorkspace: (workspace: 'driver' | 'operations' | 'tracking') => void;
  initialSection?: AccountSectionId | null;
  onConsumeInitialSection?: () => void;
}

const VALID_SECTIONS: AccountSectionId[] = [
  'profile',
  'addresses',
  'payments',
  'preferences',
  'notifications',
  'security',
  'support',
  'legal',
];

export function RovaAccountView({
  onOpenWorkspace,
  initialSection,
  onConsumeInitialSection,
}: RovaAccountViewProps) {
  const { firebaseUser, profile, logout, signInWithGoogle, signInWithApple } = useAuth();
  const { lang, t, region, currency } = useLanguage();
  const {
    business,
    recipients,
    preferredPayment,
    notificationsEnabled,
    unreadNotifCount,
  } = useRovaApp();
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();

  const [activeSection, setActiveSection] = useState<AccountSectionId>('profile');
  const [mobileSection, setMobileSection] = useState<AccountSectionId | null>(null);
  const [localPrefs, setLocalPrefs] = useState<AccountLocalPrefs>(() =>
    loadAccountPrefs(firebaseUser?.uid || '')
  );

  // Sync user-scoped local preferences when authenticated user changes
  useEffect(() => {
    setLocalPrefs(loadAccountPrefs(firebaseUser?.uid || ''));
  }, [firebaseUser?.uid]);

  // Honor deep-links from Home shortcuts (e.g., Addresses or Payments)
  useEffect(() => {
    if (initialSection && VALID_SECTIONS.includes(initialSection)) {
      setActiveSection(initialSection);
      setMobileSection(initialSection);
      onConsumeInitialSection?.();
    }
  }, [initialSection, onConsumeInitialSection]);

  const handleUpdatePrefs = (patch: Partial<AccountLocalPrefs>) => {
    setLocalPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveAccountPrefs(firebaseUser?.uid || 'guest', next);
      return next;
    });
  };

  const fullName =
    profile?.displayName ||
    firebaseUser?.displayName ||
    business?.name ||
    t('Compte invité', 'Guest account');
  const initials = (fullName || 'R').trim().charAt(0).toUpperCase();
  const roleLabel = getRoleDisplayLabel(profile?.role, lang);
  const emailDisplay =
    firebaseUser?.email ||
    t('Connectez-vous pour synchroniser vos données', 'Sign in to sync your account');
  const phoneDisplay = profile?.phone || t('Non renseigné', 'Not set');

  const navItems = useMemo(
    () => [
      {
        id: 'profile' as const,
        label: t('Profil personnel', 'Personal profile'),
        hint: firebaseUser ? roleLabel : t('Identité et coordonnées', 'Identity & details'),
        icon: User,
      },
      {
        id: 'addresses' as const,
        label: t('Adresses', 'Addresses'),
        hint:
          recipients.length > 0
            ? t(
                `${recipients.length} enregistrée${recipients.length > 1 ? 's' : ''}`,
                `${recipients.length} saved`
              )
            : t('Domicile, bureau, clients', 'Home, office, recipients'),
        icon: MapPin,
      },
      {
        id: 'payments' as const,
        label: t('Paiements', 'Payments'),
        hint: getPaymentMethodLabelEn(preferredPayment),
        icon: CreditCard,
      },
      {
        id: 'preferences' as const,
        label: t('Préférences', 'Preferences'),
        hint: `${lang === 'fr' ? 'Français' : 'English'} · ${currency}`,
        icon: SlidersHorizontal,
      },
      {
        id: 'notifications' as const,
        label: t('Notifications', 'Notifications'),
        hint:
          unreadNotifCount > 0
            ? t(`${unreadNotifCount} non lue(s)`, `${unreadNotifCount} unread`)
            : notificationsEnabled
            ? t('Alertes actives', 'Alerts active')
            : t('Désactivées', 'Muted'),
        icon: Bell,
      },
      {
        id: 'security' as const,
        label: t('Sécurité et confidentialité', 'Security & privacy'),
        hint: firebaseUser?.emailVerified
          ? t('Compte vérifié', 'Verified account')
          : t('Connexion et session', 'Sign-in & session'),
        icon: Shield,
      },
      {
        id: 'support' as const,
        label: t('Assistance', 'Help & support'),
        hint: t('Centre d’aide et FAQ', 'Help center & FAQ'),
        icon: HelpCircle,
      },
      {
        id: 'legal' as const,
        label: t('Informations légales', 'Legal information'),
        hint: t('CGU, confidentialité, espaces ROVA', 'Terms, privacy, ROVA spaces'),
        icon: FileText,
      },
    ],
    [
      t,
      firebaseUser,
      roleLabel,
      recipients.length,
      preferredPayment,
      lang,
      currency,
      unreadNotifCount,
      notificationsEnabled,
    ]
  );

  const selectSection = (id: AccountSectionId) => {
    setActiveSection(id);
    setMobileSection(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderSectionContent = (sectionId: AccountSectionId) => {
    switch (sectionId) {
      case 'profile':
        return <ProfileSection onOpenWorkspace={onOpenWorkspace} />;
      case 'addresses':
        return <AddressesSection />;
      case 'payments':
        return <PaymentsSection />;
      case 'preferences':
        return <PreferencesSection prefs={localPrefs} onUpdatePrefs={handleUpdatePrefs} />;
      case 'notifications':
        return <NotificationsSection prefs={localPrefs} onUpdatePrefs={handleUpdatePrefs} />;
      case 'security':
        return <SecuritySection />;
      case 'support':
        return <SupportSection />;
      case 'legal':
        return <LegalSection onOpenWorkspace={onOpenWorkspace} />;
    }
  };

  const activeNavMeta = navItems.find((item) => item.id === (mobileSection || activeSection));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-8 pb-10">
      {/* DESKTOP HEADER (lg+) */}
      <div className="hidden lg:flex items-end justify-between gap-6 pb-6 border-b border-[#E5E5E5]">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#171717]">
            {t('Mon compte', 'My account')}
          </h1>
          <p className="text-sm text-[#777777] mt-1">
            {t(
              'Gérez votre identité, vos adresses, vos paiements et les paramètres de votre espace ROVA.',
              'Manage your identity, addresses, payments, and ROVA workspace preferences.'
            )}
          </p>
        </div>

        {firebaseUser ? (
          <button
            type="button"
            onClick={() => selectSection('profile')}
            className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E5] hover:border-[#171717] text-xs font-semibold text-[#171717] transition-colors cursor-pointer"
          >
            {t('Modifier le profil', 'Edit profile')}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void signInWithGoogle().catch(() => {})}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 rounded-xl bg-white border border-[#E5E5E5] hover:border-[#171717] text-xs font-semibold text-[#171717] transition-colors cursor-pointer"
            >
              <GoogleLogo className="w-3.5 h-3.5" />
              <span>Google</span>
            </button>
            <button
              type="button"
              onClick={() => void signInWithApple().catch(() => {})}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 rounded-xl bg-[#171717] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <AppleLogo className="w-3.5 h-3.5" />
              <span>Apple</span>
            </button>
          </div>
        )}
      </div>

      {/* DESKTOP TWO-COLUMN EDITORIAL LAYOUT (lg+) */}
      <div className="hidden lg:grid lg:grid-cols-12 gap-10 pt-8 items-start">
        <aside className="lg:col-span-4 xl:col-span-3 sticky top-6 space-y-6">
          <div className="pb-5 border-b border-[#E5E5E5] flex items-center gap-3.5">
            {firebaseUser?.photoURL ? (
              <img
                src={firebaseUser.photoURL}
                alt={fullName}
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-full object-cover border border-[#E5E5E5] shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-[#171717] text-white font-display text-sm font-bold flex items-center justify-center shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#171717] truncate">{fullName}</p>
              <p className="text-xs text-[#777777] truncate">{emailDisplay}</p>
              {firebaseUser && (
                <p className="text-[11px] text-[#777777] mt-0.5 truncate">
                  {roleLabel}
                  {profile?.phone ? ` · ${profile.phone}` : ''}
                </p>
              )}
            </div>
          </div>

          <nav aria-label={t('Navigation du compte', 'Account navigation')} className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectSection(item.id)}
                  className={`group relative w-full text-left pl-4 pr-3 py-3 rounded-xl transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-[#F3F3F3] text-[#171717]'
                      : 'text-[#777777] hover:text-[#171717] hover:bg-[#F3F3F3]/60'
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded-full bg-[#E52B32]"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-[#171717]' : 'text-[#777777] group-hover:text-[#171717]'
                      }`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm truncate ${
                          isActive ? 'font-semibold text-[#171717]' : 'font-medium'
                        }`}
                      >
                        {item.label}
                      </p>
                      <p className="text-[11px] text-[#777777] truncate">{item.hint}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          {firebaseUser && (
            <div className="pt-4 border-t border-[#E5E5E5]">
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-medium text-[#777777] hover:text-[#E52B32] hover:bg-[#F3F3F3]/70 transition-colors cursor-pointer inline-flex items-center gap-2.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t('Se déconnecter', 'Sign out')}</span>
              </button>
            </div>
          )}
        </aside>

        <section className="lg:col-span-8 xl:col-span-9 bg-white border border-[#E5E5E5] rounded-2xl p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderSectionContent(activeSection)}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>

      {/* MOBILE & TABLET ARCHITECTURE (< lg) */}
      <div className="lg:hidden">
        {mobileSection === null ? (
          <div className="space-y-6">
            <header
              className={`sticky top-0 z-30 -mx-4 px-4 py-3 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none ${
                headerHidden ? '-translate-y-full pointer-events-none' : 'translate-y-0'
              } ${
                headerScrolled
                  ? 'bg-white/95 backdrop-blur-md border-b border-[#E5E5E5]'
                  : 'bg-white border-b border-transparent'
              }`}
            >
              <h1 className="font-display text-2xl font-bold tracking-tight text-[#171717]">
                {t('Mon compte', 'My account')}
              </h1>
              <p className="text-xs text-[#777777] mt-0.5">
                {t(
                  'Identité, adresses, paiements et préférences.',
                  'Identity, addresses, payments, and preferences.'
                )}
              </p>
            </header>

            <section className="pb-6 border-b border-[#E5E5E5] space-y-4">
              <div className="flex items-center gap-4">
                {firebaseUser?.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={fullName}
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-full object-cover border border-[#E5E5E5] shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-[#171717] text-white font-display text-lg font-bold flex items-center justify-center shrink-0">
                    {initials}
                  </div>
                )}
                <div className="min-w-0 space-y-0.5">
                  <h2 className="font-display text-base font-bold text-[#171717] truncate">
                    {fullName}
                  </h2>
                  <p className="text-xs text-[#777777] truncate">{emailDisplay}</p>
                  {firebaseUser && (
                    <p className="text-xs text-[#777777] inline-flex items-center gap-1.5 pt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#171717] shrink-0" />
                      <span>
                        {firebaseUser.emailVerified
                          ? t('Vérifié', 'Verified')
                          : t('En attente', 'Pending')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{roleLabel}</span>
                    </p>
                  )}
                </div>
              </div>

              {firebaseUser ? (
                <button
                  type="button"
                  onClick={() => selectSection('profile')}
                  className="w-full min-h-[44px] rounded-xl border border-[#E5E5E5] bg-white hover:border-[#171717] text-xs font-semibold text-[#171717] transition-colors cursor-pointer"
                >
                  {t('Modifier le profil', 'Edit profile')}
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle().catch(() => {})}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 rounded-xl bg-white border border-[#E5E5E5] hover:border-[#171717] text-xs font-semibold text-[#171717] transition-colors cursor-pointer"
                  >
                    <GoogleLogo className="w-3.5 h-3.5" />
                    <span>Google</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void signInWithApple().catch(() => {})}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 rounded-xl bg-[#171717] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    <AppleLogo className="w-3.5 h-3.5" />
                    <span>Apple</span>
                  </button>
                </div>
              )}
            </section>

            {firebaseUser && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-[#777777]">
                  {t('Informations personnelles', 'Personal details')}
                </h2>
                <div className="border-y border-[#E5E5E5] divide-y divide-[#E5E5E5] text-xs">
                  <div className="py-3 flex items-center justify-between gap-4">
                    <span className="text-[#777777]">{t('Téléphone', 'Phone')}</span>
                    <span className="font-medium text-[#171717] truncate">{phoneDisplay}</span>
                  </div>
                  <div className="py-3 flex items-center justify-between gap-4">
                    <span className="text-[#777777]">{t('Localisation', 'Location')}</span>
                    <span className="font-medium text-[#171717] truncate">
                      {business?.city || region.city}, {business?.country || region.countryName}
                    </span>
                  </div>
                  {business?.defaultPickupAddress && (
                    <div className="py-3 flex items-center justify-between gap-4">
                      <span className="text-[#777777] shrink-0">{t('Adresse', 'Address')}</span>
                      <span className="font-medium text-[#171717] truncate text-right">
                        {business.defaultPickupAddress}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-xs font-medium text-[#777777]">
                {t('Paramètres', 'Settings')}
              </h2>
              <nav
                aria-label={t('Paramètres du compte', 'Account settings')}
                className="border-y border-[#E5E5E5] divide-y divide-[#E5E5E5]"
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectSection(item.id)}
                      className="w-full py-4 text-left flex items-center justify-between gap-3 active:bg-[#F3F3F3]/80 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <Icon className="w-4 h-4 text-[#171717] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#171717] truncate">
                            {item.label}
                          </p>
                          <p className="text-xs text-[#777777] truncate mt-0.5">{item.hint}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#777777] shrink-0" />
                    </button>
                  );
                })}
              </nav>
            </section>

            {firebaseUser && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="w-full min-h-[44px] rounded-xl border border-[#E5E5E5] bg-white hover:border-red-300 text-xs font-semibold text-[#777777] hover:text-[#E52B32] transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t('Se déconnecter', 'Sign out')}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="sticky top-0 z-30 -mx-4 px-4 py-3 bg-white/95 backdrop-blur-md border-b border-[#E5E5E5] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setMobileSection(null);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-semibold text-[#171717] hover:text-[#E52B32] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('Mon compte', 'My account')}</span>
              </button>
              <span className="text-xs font-medium text-[#777777] truncate">
                {activeNavMeta?.label}
              </span>
            </div>

            <motion.div
              key={mobileSection}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderSectionContent(mobileSection)}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
