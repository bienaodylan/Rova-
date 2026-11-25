import React from 'react';
import { Globe, Map as MapIcon, RefreshCw } from 'lucide-react';
import { AppCurrency, LanguageSelector, useLanguage } from '../../context/LanguageContext';
import { useMapsRuntime } from '../../context/MapsContext';
import { useRovaApp } from '../../context/RovaAppContext';
import { AccountLocalPrefs } from './accountTypes';

const SUPPORTED_DISPLAY_CURRENCIES: AppCurrency[] = [
  'XOF',
  'XAF',
  'EUR',
  'GHS',
  'USD',
  'GBP',
  'CAD',
  'CHF',
  'MAD',
  'NGN',
  'KES',
  'ZAR',
];

function EditorialSwitch({
  checked,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-neutral-950' : 'bg-neutral-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
      {checked && (
        <span
          className="absolute left-1.5 w-1.5 h-1.5 rounded-full bg-red-600"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

interface PrefsProps {
  prefs: AccountLocalPrefs;
  onUpdatePrefs: (patch: Partial<AccountLocalPrefs>) => void;
}

export function PreferencesSection({ prefs, onUpdatePrefs }: PrefsProps) {
  const { t, region, currency, setCurrency, refreshAutoRegion } = useLanguage();
  const {
    googleMapsAvailable,
    failureCode,
    serverGeocodingEnabled,
    serverRoutesEnabled,
  } = useMapsRuntime();
  const { showToast } = useRovaApp();

  const handleRefreshRegion = async () => {
    await refreshAutoRegion();
    showToast(
      t('Région et devise synchronisées automatiquement.', 'Region and display currency synced.'),
      'success'
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-5 border-b border-neutral-200/80">
        <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
          {t('Préférences', 'Preferences')}
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          {t(
            'Langue de l’interface, détection régionale, devise d’affichage et communications.',
            'Interface language, regional settings, display currency, and communication preferences.'
          )}
        </p>
      </div>

      {/* Regional & Display Settings */}
      <div className="divide-y divide-neutral-200/70 border-b border-neutral-200/70">
        {/* Language */}
        <div className="py-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-950">
              {t('Langue de l’application', 'Application language')}
            </p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {t(
                'Votre choix manuel est conservé entre chaque session.',
                'Your manual selection is preserved across sessions.'
              )}
            </p>
          </div>
          <LanguageSelector compact />
        </div>

        {/* Detected Region */}
        <div className="py-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold text-neutral-950 flex items-center gap-2">
              <Globe className="w-4 h-4 text-neutral-500 shrink-0" />
              <span>{t('Pays et région détectés', 'Detected country & region')}</span>
            </p>
            <p className="text-xs text-neutral-600 pl-6">
              {region.city}, {region.countryName} ({region.countryCode}) ·{' '}
              <span className="text-neutral-400">
                {t('Devise locale :', 'Local currency:')} {region.currency}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefreshRegion()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-neutral-300 hover:border-neutral-950 text-xs font-medium text-neutral-800 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('Actualiser', 'Refresh')}</span>
          </button>
        </div>

        {/* Display Currency — explicitly distinguished from settlement currency */}
        <div className="py-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-lg space-y-1">
            <p className="text-sm font-semibold text-neutral-950">
              {t('Devise d’affichage', 'Display currency')}
            </p>
            <p className="text-xs text-neutral-500 leading-relaxed">
              {t(
                'Sert uniquement à convertir les estimations affichées à l’écran. Les montants facturés et les reçus enregistrés conservent toujours leur devise d’origine.',
                'Used strictly to convert on-screen estimates. Historical transactions and billed orders always retain their original settlement currency.'
              )}
            </p>
          </div>
          <select
            aria-label={t('Devise d’affichage', 'Display currency')}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value as AppCurrency);
              showToast(
                t(`Devise d’affichage définie sur ${e.target.value}.`, `Display currency set to ${e.target.value}.`),
                'info'
              );
            }}
            className="rounded-xl border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono font-semibold text-neutral-950 focus:outline-none focus:border-neutral-950 cursor-pointer"
          >
            {SUPPORTED_DISPLAY_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Map Engine Status (Transparent, zero "API key required" error) */}
        <div className="py-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold text-neutral-950 flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-neutral-500 shrink-0" />
              <span>{t('Cartographie et itinéraires', 'Maps & routing')}</span>
            </p>
            <p className="text-xs text-neutral-500 pl-6">
              {googleMapsAvailable
                ? t(
                    'Google Maps Platform actif pour les cartes et la recherche d’adresses.',
                    'Google Maps Platform active for maps and address search.'
                  )
                : failureCode === 'referer_not_allowed'
                ? t(
                    'Bascule sur OpenStreetMap : ce domaine n’est pas encore autorisé dans les restrictions HTTP de votre clé Google Maps.',
                    'Using OpenStreetMap fallback: this domain is not yet allowed in your Google Maps key HTTP referrer restrictions.'
                  )
                : failureCode === 'api_not_activated'
                ? t(
                    'Bascule sur OpenStreetMap : activez Maps JavaScript API dans Google Cloud Console.',
                    'Using OpenStreetMap fallback: enable Maps JavaScript API in Google Cloud Console.'
                  )
                : failureCode === 'billing_not_enabled'
                ? t(
                    'Bascule sur OpenStreetMap : la facturation Google Cloud doit être activée pour cette clé.',
                    'Using OpenStreetMap fallback: Google Cloud billing must be enabled for this key.'
                  )
                : failureCode === 'invalid_key'
                ? t(
                    'Bascule sur OpenStreetMap : la clé Google Maps configurée est invalide.',
                    'Using OpenStreetMap fallback: the configured Google Maps key is invalid.'
                  )
                : t(
                    'Cartographie OpenStreetMap / CARTO active (bascule automatique sans interruption).',
                    'OpenStreetMap / CARTO mapping active (automatic seamless fallback).'
                  )}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-neutral-700 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
            {googleMapsAvailable
              ? serverRoutesEnabled || serverGeocodingEnabled
                ? 'Google Maps + Routes'
                : 'Google Maps'
              : 'OpenStreetMap'}
          </span>
        </div>
      </div>

      {/* Communication Preferences */}
      <div className="space-y-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
          {t('Préférences de communication', 'Communication preferences')}
        </h3>
        <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
          <div className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-950">
                {t('Récapitulatifs opérationnels', 'Operational summaries')}
              </p>
              <p className="text-xs text-neutral-500">
                {t('Synthèse de vos livraisons et réservations confirmées.', 'Summary of your confirmed deliveries and bookings.')}
              </p>
            </div>
            <EditorialSwitch
              checked={prefs.commOperationalSummary}
              onChange={(v) => onUpdatePrefs({ commOperationalSummary: v })}
              label={t('Récapitulatifs opérationnels', 'Operational summaries')}
            />
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-950">
                {t('Nouveautés et zones couvertes ROVA', 'ROVA product & coverage updates')}
              </p>
              <p className="text-xs text-neutral-500">
                {t('Annonces de nouvelles villes, flottes et fonctionnalités.', 'Announcements on new cities, vehicle classes, and features.')}
              </p>
            </div>
            <EditorialSwitch
              checked={prefs.commProductUpdates}
              onChange={(v) => onUpdatePrefs({ commProductUpdates: v })}
              label={t('Nouveautés ROVA', 'ROVA updates')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationsSection({ prefs, onUpdatePrefs }: PrefsProps) {
  const { t } = useLanguage();
  const { notificationsEnabled, setNotificationsEnabled, unreadNotifCount } = useRovaApp();

  const toggleDeliveries = (next: boolean) => {
    setNotificationsEnabled(next);
    onUpdatePrefs({ notifDeliveries: next });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-5 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
            {t('Notifications', 'Notifications')}
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            {t(
              'Choisissez les alertes importantes pour suivre vos livraisons sans distraction.',
              'Choose the operational alerts that matter without unnecessary noise.'
            )}
          </p>
        </div>
        {unreadNotifCount > 0 && (
          <span className="font-mono text-xs text-red-600 font-semibold">
            {unreadNotifCount} {t('non lue(s)', 'unread')}
          </span>
        )}
      </div>

      {/* Alert Categories */}
      <div className="space-y-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
          {t('Catégories d’alertes', 'Alert categories')}
        </h3>
        <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
          <div className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Suivi des livraisons', 'Delivery tracking')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t(
                  'Affectation livreur, collecte du colis, arrivée et preuve de remise OTP.',
                  'Driver assignment, parcel pickup, arrival, and OTP proof of delivery.'
                )}
              </p>
            </div>
            <EditorialSwitch
              checked={notificationsEnabled && prefs.notifDeliveries}
              onChange={toggleDeliveries}
              label={t('Suivi des livraisons', 'Delivery tracking')}
            />
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Commandes et réservations', 'Orders & reservations')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t(
                  'Confirmations de réservations véhicules et rappels de créneaux planifiés.',
                  'Vehicle reservation confirmations and scheduled dispatch reminders.'
                )}
              </p>
            </div>
            <EditorialSwitch
              checked={prefs.notifOrders}
              onChange={(v) => onUpdatePrefs({ notifOrders: v })}
              label={t('Commandes et réservations', 'Orders & reservations')}
            />
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Paiements et reçus', 'Payments & receipts')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t(
                  'Confirmation de règlement, facturation entreprise et remboursements.',
                  'Settlement confirmations, corporate invoices, and refunds.'
                )}
              </p>
            </div>
            <EditorialSwitch
              checked={prefs.notifPayments}
              onChange={(v) => onUpdatePrefs({ notifPayments: v })}
              label={t('Paiements et reçus', 'Payments & receipts')}
            />
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Communications ROVA', 'ROVA announcements')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('Évolutions du service et informations commerciales.', 'Service updates and news.')}
              </p>
            </div>
            <EditorialSwitch
              checked={prefs.notifMarketing}
              onChange={(v) => onUpdatePrefs({ notifMarketing: v })}
              label={t('Communications ROVA', 'ROVA announcements')}
            />
          </div>
        </div>
      </div>

      {/* Delivery Channels — Honest status without faking unsupported push/email servers */}
      <div className="space-y-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
          {t('Canaux de diffusion', 'Delivery channels')}
        </h3>
        <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70 text-xs">
          <div className="py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-950">
                {t('Notifications dans l’application', 'In-app notifications')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('Synchronisées en temps réel dans votre centre d’alertes ROVA.', 'Synced live in your ROVA notification feed.')}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 font-mono text-neutral-950 font-semibold shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
              {t('Actif', 'Active')}
            </span>
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-700">
                {t('Notifications Push (mobile & navigateur)', 'Push notifications (mobile & web)')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('Alertes natives hors application.', 'Native alerts outside the app.')}
              </p>
            </div>
            <span className="font-mono text-neutral-400 shrink-0">
              {t('Bientôt disponible', 'Coming soon')}
            </span>
          </div>

          <div className="py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-700">
                {t('Alertes par e-mail', 'Email digests')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('Envoi automatique des reçus et alertes par courrier électronique.', 'Automated email receipts and tracking alerts.')}
              </p>
            </div>
            <span className="font-mono text-neutral-400 shrink-0">
              {t('Bientôt disponible', 'Coming soon')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
