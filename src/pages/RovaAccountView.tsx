import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
  CreditCard,
  Edit3,
  HelpCircle,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  Send,
  Shield,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LanguageSelector, useLanguage } from '../context/LanguageContext';
import { useRovaApp } from '../context/RovaAppContext';
import { BottomSheet } from '../components/BottomSheet';
import { RovaMap } from '../components/RovaMap';
import { PAYMENT_METHODS_EN } from '../lib/logistics';
import { PaymentMethod, SavedRecipient } from '../types/rova';

interface RovaAccountViewProps {
  onOpenWorkspace: (workspace: 'driver' | 'operations' | 'tracking') => void;
}

export function RovaAccountView({ onOpenWorkspace }: RovaAccountViewProps) {
  const { firebaseUser, profile, logout } = useAuth();
  const { t, formatLocalMoney } = useLanguage();
  const {
    business,
    recipients,
    preferredPayment,
    setPreferredPayment,
    notificationsEnabled,
    setNotificationsEnabled,
    openComposer,
    openSupportSheet,
    saveRecipient,
    deleteRecipient,
    saveBusinessProfile,
    requestSignIn,
    busy,
  } = useRovaApp();

  // Edit Profile Sheet
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    phone: '',
    businessName: '',
    city: '',
    country: '',
    defaultPickupAddress: '',
    defaultPickupLat: 5.3235,
    defaultPickupLng: -4.0267,
  });

  // Saved Address Editor Sheet
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedRecipient | null>(null);
  const [addressForm, setAddressForm] = useState({
    name: '',
    phone: '',
    address: '',
    landmark: '',
    instructions: '',
    lat: 5.3235,
    lng: -4.0267,
  });

  const openProfileEditor = () => {
    setProfileForm({
      displayName: profile?.displayName || firebaseUser?.displayName || '',
      phone: profile?.phone || '',
      businessName: business?.name || '',
      city: business?.city || 'Abidjan',
      country: business?.country || 'Côte d’Ivoire',
      defaultPickupAddress: business?.defaultPickupAddress || '',
      defaultPickupLat: business?.defaultPickupLat ?? 5.3235,
      defaultPickupLng: business?.defaultPickupLng ?? -4.0267,
    });
    setProfileSheetOpen(true);
  };

  const openAddressEditor = (existing?: SavedRecipient) => {
    if (existing) {
      setEditingAddress(existing);
      setAddressForm({
        name: existing.name,
        phone: existing.phone,
        address: existing.address,
        landmark: existing.landmark || '',
        instructions: existing.instructions || '',
        lat: existing.lat,
        lng: existing.lng,
      });
    } else {
      setEditingAddress(null);
      setAddressForm({
        name: '',
        phone: '',
        address: '',
        landmark: '',
        instructions: '',
        lat: business?.defaultPickupLat ?? 5.3235,
        lng: business?.defaultPickupLng ?? -4.0267,
      });
    }
    setAddressSheetOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveBusinessProfile({
      displayName: profileForm.displayName,
      phone: profileForm.phone,
      name: profileForm.businessName || profileForm.displayName,
      city: profileForm.city,
      country: profileForm.country,
      defaultPickupAddress: profileForm.defaultPickupAddress,
      defaultPickupLat: profileForm.defaultPickupLat,
      defaultPickupLng: profileForm.defaultPickupLng,
    });
    if (ok) setProfileSheetOpen(false);
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressForm.name.trim() || !addressForm.address.trim()) return;
    const ok = await saveRecipient({
      id: editingAddress?.id,
      name: addressForm.name,
      phone: addressForm.phone || '+225 00 00 00 00',
      address: addressForm.address,
      landmark: addressForm.landmark,
      instructions: addressForm.instructions,
      lat: addressForm.lat,
      lng: addressForm.lng,
    });
    if (ok) setAddressSheetOpen(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-8 space-y-6">
      {/* Header */}
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
          {t('Compte', 'Account')}
        </h1>
        <p className="text-xs text-neutral-500 mt-0.5">
          {t('Profil, adresses, moyens de paiement et préférences.', 'Profile, saved addresses, payment methods, and preferences.')}
        </p>
      </header>

      {/* 1. Personal & Business Profile */}
      <section className="rounded-3xl bg-white border border-neutral-200/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-full bg-neutral-950 text-white font-display text-base font-bold flex items-center justify-center shrink-0">
            {(profile?.displayName || firebaseUser?.displayName || 'R').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-neutral-950 truncate">
              {business?.name || profile?.displayName || firebaseUser?.displayName || t('Compte invité', 'Guest account')}
            </h2>
            <p className="text-xs text-neutral-500 truncate">
              {firebaseUser?.email || t('Connectez-vous pour synchroniser vos expéditions', 'Sign in to sync your shipments')}
            </p>
            {(profile?.phone || business?.city) && (
              <p className="text-xs text-neutral-500 mt-0.5">
                {[profile?.phone, business?.city].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {firebaseUser ? (
            <>
              <button
                type="button"
                onClick={openProfileEditor}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-900 transition-colors cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {t('Modifier', 'Edit')}
              </button>
              <button
                type="button"
                onClick={logout}
                aria-label={t('Déconnexion', 'Sign out')}
                className="p-2.5 rounded-full border border-neutral-200 hover:border-red-300 hover:text-red-700 text-neutral-600 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void requestSignIn()}
              className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {t('Connexion Google', 'Sign in with Google')}
            </button>
          )}
        </div>
      </section>

      {/* 2. Saved Addresses */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-display text-sm font-bold text-neutral-950">
            {t('Adresses enregistrées', 'Saved addresses')}
          </h2>
          <button
            type="button"
            onClick={() => openAddressEditor()}
            className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-950 hover:underline cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('Ajouter', 'Add')}
          </button>
        </div>

        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
          {recipients.length === 0 ? (
            <div className="p-6 text-center space-y-2.5">
              <p className="text-sm font-medium text-neutral-900">
                {t('Aucune adresse enregistrée', 'No saved addresses yet')}
              </p>
              <p className="text-xs text-neutral-500">
                {t(
                  'Enregistrez vos points de collecte ou clients fréquents pour commander en un geste.',
                  'Save frequent pickup points or customers for one-tap dispatch.'
                )}
              </p>
              <button
                type="button"
                onClick={() => openAddressEditor()}
                className="px-4 py-2 rounded-full bg-neutral-100 hover:bg-neutral-950 hover:text-white text-xs font-semibold text-neutral-900 transition-colors cursor-pointer"
              >
                {t('Ajouter une adresse', 'Add an address')}
              </button>
            </div>
          ) : (
            recipients.map((rec) => (
              <div key={rec.id} className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-neutral-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-950 truncate">{rec.name}</p>
                    <p className="text-xs text-neutral-600 truncate">{rec.address}</p>
                    <p className="text-[11px] text-neutral-400">{rec.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openComposer('single', rec)}
                    className="px-3 py-1.5 rounded-full bg-neutral-950 text-white text-[11px] font-medium hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t('Livrer', 'Ship')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAddressEditor(rec)}
                    aria-label={t('Modifier', 'Edit')}
                    className="p-2 rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteRecipient(rec.id)}
                    aria-label={t('Supprimer', 'Delete')}
                    className="p-2 rounded-full text-neutral-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 3. Payment Methods — Strictly in English */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-display text-sm font-bold text-neutral-950">Payment Methods</h2>
          <span className="font-mono text-xs text-neutral-500 tabular-nums">
            Wallet: {formatLocalMoney(business?.walletBalance ?? 0, business?.currency || 'GHS')}
          </span>
        </div>

        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
          {PAYMENT_METHODS_EN.map((pm) => {
            const active = preferredPayment === pm.id;
            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => setPreferredPayment(pm.id as PaymentMethod)}
                className="w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-neutral-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4 text-neutral-800" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-950">{pm.label}</p>
                    <p className="text-xs text-neutral-500 truncate">{pm.subtitle}</p>
                  </div>
                </div>
                {active ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-950 shrink-0">
                    <Check className="w-4 h-4" />
                    Default
                  </span>
                ) : (
                  <span className="text-xs text-neutral-400 shrink-0">Select</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. Preferences (Language & Notifications) */}
      <section className="space-y-2.5">
        <h2 className="font-display text-sm font-bold text-neutral-950 px-1">
          {t('Préférences', 'Preferences')}
        </h2>
        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-neutral-950">{t('Langue de l’application', 'App language')}</p>
              <p className="text-xs text-neutral-500">
                {t('Français pur par défaut (moyens de paiement en anglais)', 'Pure French by default (payment methods in English)')}
              </p>
            </div>
            <LanguageSelector compact />
          </div>

          <label className="p-4 flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-neutral-950">
                {t('Notifications de suivi', 'Delivery notifications')}
              </p>
              <p className="text-xs text-neutral-500">
                {t('Alertes d’affectation livreur et preuve de livraison', 'Driver dispatch and proof-of-delivery alerts')}
              </p>
            </div>
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => setNotificationsEnabled(e.target.checked)}
              className="w-4 h-4 accent-neutral-950"
            />
          </label>
        </div>
      </section>

      {/* 5. Support & Help */}
      <section className="space-y-2.5">
        <h2 className="font-display text-sm font-bold text-neutral-950 px-1">
          {t('Aide & Support', 'Help & Support')}
        </h2>
        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
          <button
            type="button"
            onClick={() => openSupportSheet()}
            className="w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-neutral-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center">
                <HelpCircle className="w-4 h-4 text-neutral-800" />
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-950">
                  {t('Contacter le support ou signaler un incident', 'Contact support or report an issue')}
                </p>
                <p className="text-xs text-neutral-500">
                  {t('Réponse directe de l’équipe Opérations ROVA', 'Direct response from ROVA Operations')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
          </button>
        </div>
      </section>

      {/* 6. ROVA Ecosystem Workspaces (Preserves Driver App, Operations Center & Public Tracking seamlessly) */}
      <section className="space-y-2.5">
        <h2 className="font-display text-sm font-bold text-neutral-950 px-1">
          {t('Autres espaces ROVA', 'Other ROVA workspaces')}
        </h2>
        <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
          {[
            {
              id: 'driver' as const,
              title: t('Application Livreur', 'Driver App'),
              subtitle: t('Radar GPS, courses actives et revenus chauffeur', 'GPS radar, active deliveries, and earnings'),
              icon: Smartphone,
            },
            {
              id: 'operations' as const,
              title: t('Centre d’Opérations', 'Operations Center'),
              subtitle: t('Dispatch temps réel, flotte, validation livreurs et tarifs', 'Live dispatch, fleet, driver verification, and pricing'),
              icon: Shield,
            },
            {
              id: 'tracking' as const,
              title: t('Page de suivi destinataire', 'Recipient Tracking Page'),
              subtitle: t('Vue isolée sans connexion pour vos clients finaux', 'Isolated no-login view for end recipients'),
              icon: Send,
            },
          ].map((ws) => {
            const Icon = ws.icon;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => onOpenWorkspace(ws.id)}
                className="w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-neutral-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-neutral-800" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-950 truncate">{ws.title}</p>
                    <p className="text-xs text-neutral-500 truncate">{ws.subtitle}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
              </button>
            );
          })}
        </div>
      </section>

      {/* Edit Profile Bottom Sheet */}
      <BottomSheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        size="md"
        title={t('Modifier le profil', 'Edit profile')}
        footer={
          <button
            type="submit"
            form="rova-profile-form"
            disabled={busy}
            className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('Enregistrer', 'Save changes')}
          </button>
        }
      >
        <form id="rova-profile-form" onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Nom complet', 'Full name')}
              </label>
              <input
                type="text"
                required
                value={profileForm.displayName}
                onChange={(e) => setProfileForm((p) => ({ ...p, displayName: e.target.value }))}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Téléphone', 'Phone')}
              </label>
              <input
                type="tel"
                value={profileForm.phone}
                onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Nom de l’entreprise', 'Business name')}
              </label>
              <input
                type="text"
                value={profileForm.businessName}
                onChange={(e) => setProfileForm((p) => ({ ...p, businessName: e.target.value }))}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Ville', 'City')}
              </label>
              <input
                type="text"
                value={profileForm.city}
                onChange={(e) => setProfileForm((p) => ({ ...p, city: e.target.value }))}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Pays', 'Country')}
              </label>
              <input
                type="text"
                value={profileForm.country}
                onChange={(e) => setProfileForm((p) => ({ ...p, country: e.target.value }))}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Adresse de collecte par défaut', 'Default pickup address')}
              </label>
              <input
                type="text"
                value={profileForm.defaultPickupAddress}
                onChange={(e) => setProfileForm((p) => ({ ...p, defaultPickupAddress: e.target.value }))}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
          </div>
        </form>
      </BottomSheet>

      {/* Add / Edit Saved Address Bottom Sheet */}
      <BottomSheet
        open={addressSheetOpen}
        onClose={() => setAddressSheetOpen(false)}
        size="md"
        title={editingAddress ? t('Modifier l’adresse', 'Edit address') : t('Nouvelle adresse', 'New address')}
        footer={
          <button
            type="submit"
            form="rova-address-form"
            disabled={busy || !addressForm.name.trim() || !addressForm.address.trim()}
            className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('Enregistrer l’adresse', 'Save address')}
          </button>
        }
      >
        <form id="rova-address-form" onSubmit={handleSaveAddress} className="space-y-4">
          <RovaMap
            center={[addressForm.lat, addressForm.lng]}
            markers={[
              {
                id: 'addr_pin',
                lat: addressForm.lat,
                lng: addressForm.lng,
                kind: 'selected',
                label: addressForm.address || t('Emplacement', 'Location'),
                draggable: true,
              },
            ]}
            interactivePick
            showSearchBar
            initialSearchText={addressForm.address}
            heightClass="h-[200px]"
            onLocationSelected={(place) =>
              setAddressForm((p) => ({
                ...p,
                address: place.shortName || place.displayName,
                landmark: place.landmark || p.landmark,
                lat: place.lat,
                lng: place.lng,
              }))
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={addressForm.name}
              onChange={(e) => setAddressForm((p) => ({ ...p, name: e.target.value }))}
              placeholder={t('Nom (ex. Bureau, Entrepôt, Client...)', 'Label (e.g. Office, Warehouse, Client...)')}
              className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
            />
            <input
              type="tel"
              value={addressForm.phone}
              onChange={(e) => setAddressForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder={t('Téléphone', 'Phone')}
              className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
            />
            <div className="sm:col-span-2">
              <input
                type="text"
                required
                value={addressForm.address}
                onChange={(e) => setAddressForm((p) => ({ ...p, address: e.target.value }))}
                placeholder={t('Adresse complète *', 'Full address *')}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="text"
                value={addressForm.instructions}
                onChange={(e) => setAddressForm((p) => ({ ...p, instructions: e.target.value }))}
                placeholder={t('Instructions d’accès (optionnel)', 'Access instructions (optional)')}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
