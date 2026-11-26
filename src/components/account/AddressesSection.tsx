import React, { useState } from 'react';
import {
  Briefcase,
  Check,
  Edit3,
  Home,
  Loader2,
  MapPin,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useRovaApp } from '../../context/RovaAppContext';
import { BottomSheet } from '../BottomSheet';
import { LocationSearchField } from '../LocationSearchField';
import { SavedRecipient } from '../../types/rova';
import {
  AddressCategory,
  formatLandmarkWithTag,
  parseAddressTag,
} from './accountTypes';

export function AddressesSection() {
  const { firebaseUser, profile } = useAuth();
  const { t, region } = useLanguage();
  const {
    business,
    recipients,
    openComposer,
    saveRecipient,
    deleteRecipient,
    saveBusinessProfile,
    requestSignIn,
    busy,
  } = useRovaApp();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SavedRecipient | null>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<SavedRecipient | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState<{
    name: string;
    phone: string;
    address: string;
    category: AddressCategory;
    landmark: string;
    instructions: string;
    lat: number;
    lng: number;
  }>({
    name: '',
    phone: '',
    address: '',
    category: 'home',
    landmark: '',
    instructions: '',
    lat: business?.defaultPickupLat ?? region.lat,
    lng: business?.defaultPickupLng ?? region.lng,
  });

  const openEditor = (existing?: SavedRecipient) => {
    setFormError(null);
    if (existing) {
      const parsed = parseAddressTag(existing.landmark);
      setEditing(existing);
      setForm({
        name: existing.name,
        phone: existing.phone,
        address: existing.address,
        category: parsed.category,
        landmark: parsed.cleanLandmark,
        instructions: existing.instructions || '',
        lat: existing.lat,
        lng: existing.lng,
      });
    } else {
      setEditing(null);
      setForm({
        name: '',
        phone: profile?.phone || '',
        address: '',
        category: 'home',
        landmark: '',
        instructions: '',
        lat: business?.defaultPickupLat ?? region.lat,
        lng: business?.defaultPickupLng ?? region.lng,
      });
    }
    setEditorOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim() || !form.address.trim()) {
      setFormError(
        t('Indiquez un intitulé et une adresse complète.', 'Enter a label and a complete address.')
      );
      return;
    }

    const ok = await saveRecipient({
      id: editing?.id,
      name: form.name.trim(),
      phone: form.phone.trim() || profile?.phone || '+225 00 00 00 00',
      address: form.address.trim(),
      landmark: formatLandmarkWithTag(form.category, form.landmark),
      instructions: form.instructions.trim(),
      lat: form.lat,
      lng: form.lng,
    });
    if (ok) setEditorOpen(false);
  };

  const handleSetAsDefault = async (rec: SavedRecipient) => {
    await saveBusinessProfile({
      name: business?.name || profile?.displayName || 'Rovia',
      city: business?.city || region.city,
      country: business?.country || region.countryName,
      defaultPickupAddress: rec.address,
      defaultPickupLat: rec.lat,
      defaultPickupLng: rec.lng,
    });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteTarget) return;
    const ok = await deleteRecipient(confirmDeleteTarget.id);
    if (ok) setConfirmDeleteTarget(null);
  };

  const categoryLabel = (cat: AddressCategory) => {
    if (cat === 'home') return t('Domicile', 'Home');
    if (cat === 'office') return t('Bureau', 'Office');
    return t('Autre', 'Other');
  };

  const CategoryIcon = ({ cat }: { cat: AddressCategory }) => {
    if (cat === 'home') return <Home className="w-4 h-4 text-neutral-600" />;
    if (cat === 'office') return <Briefcase className="w-4 h-4 text-neutral-600" />;
    return <MapPin className="w-4 h-4 text-neutral-600" />;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-5 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
            {t('Adresses', 'Addresses')}
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            {t(
              'Gérez votre adresse par défaut et vos lieux de collecte ou livraison fréquents.',
              'Manage your default address and saved pickup or delivery locations.'
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => (firebaseUser ? openEditor() : void requestSignIn())}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('Ajouter une adresse', 'Add address')}</span>
        </button>
      </div>

      {/* Default Address Card */}
      {business?.defaultPickupAddress && (
        <div className="rounded-3xl border border-[#E5E5E5] bg-white p-5 space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
            <span>{t('Adresse principale par défaut', 'Default primary address')}</span>
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {business.defaultPickupAddress}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {[business.city, business.country].filter(Boolean).join(', ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                openComposer('single', undefined, {
                  address: business.defaultPickupAddress || '',
                  landmark: business.defaultPickupLandmark,
                  lat: business.defaultPickupLat ?? region.lat,
                  lng: business.defaultPickupLng ?? region.lng,
                })
              }
              className="px-3.5 py-1.5 rounded-full border border-neutral-300 hover:border-neutral-950 text-xs font-medium text-neutral-900 transition-colors cursor-pointer"
            >
              {t('Expédier d’ici', 'Ship from here')}
            </button>
          </div>
        </div>
      )}

      {/* Saved Addresses Card */}
      {!firebaseUser ? (
        <div className="rounded-3xl border border-[#E5E5E5] bg-white py-10 px-6 text-center space-y-3">
          <p className="text-sm font-semibold text-neutral-900">
            {t('Connectez-vous pour retrouver vos adresses', 'Sign in to access saved addresses')}
          </p>
          <button
            type="button"
            onClick={() => void requestSignIn()}
            className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            {t('Se connecter', 'Sign in')}
          </button>
        </div>
      ) : recipients.length === 0 ? (
        <div className="rounded-3xl border border-[#E5E5E5] bg-white py-12 px-6 text-center space-y-3">
          <p className="text-sm font-semibold text-neutral-950">
            {t('Aucune adresse enregistrée', 'No saved addresses yet')}
          </p>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
            {t(
              'Ajoutez votre domicile, votre bureau ou vos destinataires habituels pour pré-remplir vos livraisons en un geste.',
              'Save your home, office, or frequent recipients to pre-fill deliveries in one tap.'
            )}
          </p>
          <button
            type="button"
            onClick={() => openEditor()}
            className="px-5 py-2 rounded-full border border-neutral-300 hover:border-neutral-950 text-xs font-semibold text-neutral-950 transition-colors cursor-pointer"
          >
            {t('Enregistrer une première adresse', 'Add first address')}
          </button>
        </div>
      ) : (
        <div className="rounded-3xl border border-[#E5E5E5] bg-white divide-y divide-neutral-200/70 px-5 overflow-hidden">
          {recipients.map((rec) => {
            const parsed = parseAddressTag(rec.landmark);
            const isDefault =
              Boolean(business?.defaultPickupAddress) &&
              business?.defaultPickupAddress?.trim().toLowerCase() === rec.address.trim().toLowerCase();

            return (
              <div
                key={rec.id}
                className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0 mt-0.5">
                    <CategoryIcon cat={parsed.category} />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-neutral-950 truncate">{rec.name}</p>
                      <span className="text-[11px] font-mono text-neutral-500">
                        {categoryLabel(parsed.category)}
                      </span>
                      {isDefault && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
                          {t('Par défaut', 'Default')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600">{rec.address}</p>
                    <p className="text-[11px] text-neutral-400">
                      {[rec.phone, parsed.cleanLandmark, rec.instructions].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pl-12 sm:pl-0">
                  <button
                    type="button"
                    onClick={() => openComposer('single', rec)}
                    className="px-3 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    {t('Expédier', 'Ship')}
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSetAsDefault(rec)}
                      title={t('Définir comme adresse par défaut', 'Set as default address')}
                      aria-label={t('Définir par défaut', 'Set as default')}
                      className="p-2 rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 transition-colors cursor-pointer"
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEditor(rec)}
                    aria-label={t('Modifier', 'Edit')}
                    className="p-2 rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTarget(rec)}
                    aria-label={t('Supprimer', 'Delete')}
                    className="p-2 rounded-full text-neutral-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Address Sheet with Google Maps + Places Autocomplete */}
      <BottomSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        size="md"
        title={editing ? t('Modifier l’adresse', 'Edit address') : t('Nouvelle adresse', 'New address')}
        footer={
          <button
            type="submit"
            form="rova-account-address-form"
            disabled={busy || !form.name.trim() || !form.address.trim()}
            className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{t('Enregistrer l’adresse', 'Save address')}</span>
          </button>
        }
      >
        <form id="rova-account-address-form" onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700">
              {formError}
            </div>
          )}

          {/* Category Selector */}
          <div className="flex items-center gap-2">
            {(['home', 'office', 'other'] as AddressCategory[]).map((cat) => {
              const active = form.category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, category: cat }))}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-neutral-950 text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden="true" />}
                  <span>{categoryLabel(cat)}</span>
                </button>
              );
            })}
          </div>

          {/* Address Search with On-Demand Full-Screen Map Icon */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#171717]">
              {t('Adresse complète *', 'Full address *')}
            </label>
            <LocationSearchField
              value={form.address}
              center={[form.lat, form.lng]}
              placeholder={t(
                'Rechercher une adresse ou cliquer sur l’icône carte...',
                'Search an address or tap the map icon...'
              )}
              onChangeText={(text) => setForm((p) => ({ ...p, address: text }))}
              onSelect={(place) =>
                setForm((p) => ({
                  ...p,
                  address: place.shortName || place.displayName,
                  landmark: place.landmark || p.landmark,
                  lat: place.lat,
                  lng: place.lng,
                }))
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder={t('Intitulé (ex. Maison, Boutique, Entrepôt)', 'Label (e.g. Home, Store, Warehouse)')}
              className="w-full rounded-2xl border border-[#E5E5E5] px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717]"
            />
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder={t('Téléphone de contact', 'Contact phone')}
              className="w-full rounded-2xl border border-[#E5E5E5] px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717]"
            />
            <input
              type="text"
              value={form.landmark}
              onChange={(e) => setForm((p) => ({ ...p, landmark: e.target.value }))}
              placeholder={t('Repère (optionnel)', 'Landmark (optional)')}
              className="w-full rounded-2xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
            />
            <input
              type="text"
              value={form.instructions}
              onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))}
              placeholder={t('Instructions d’accès', 'Access instructions')}
              className="w-full rounded-2xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
            />
          </div>
        </form>
      </BottomSheet>

      {/* Explicit Delete Confirmation Dialog */}
      <BottomSheet
        open={Boolean(confirmDeleteTarget)}
        onClose={() => setConfirmDeleteTarget(null)}
        size="sm"
        title={t('Supprimer cette adresse ?', 'Remove this address?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteTarget(null)}
              className="px-4 py-2.5 rounded-full border border-neutral-200 text-xs font-medium text-neutral-700 hover:border-neutral-950 transition-colors cursor-pointer"
            >
              {t('Annuler', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConfirmDelete()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('Supprimer définitivement', 'Delete address')}</span>
            </button>
          </div>
        }
      >
        <p className="text-sm text-neutral-600 leading-relaxed">
          {t(
            `L’adresse « ${confirmDeleteTarget?.name || ''} » (${confirmDeleteTarget?.address || ''}) sera retirée de votre carnet d’adresses. Vos livraisons existantes ne seront pas affectées.`,
            `“${confirmDeleteTarget?.name || ''}” (${confirmDeleteTarget?.address || ''}) will be removed from your saved addresses. Existing deliveries will not be affected.`
          )}
        </p>
      </BottomSheet>
    </div>
  );
}
