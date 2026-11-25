import React, { useState } from 'react';
import { Loader2, Search, Send } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';

export function TrackLookupSheet({
  onOpenTracking,
}: {
  onOpenTracking: (token: string) => void;
}) {
  const { t } = useLanguage();
  const { trackSheetOpen, closeTrackSheet } = useRovaApp();
  const [token, setToken] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    closeTrackSheet();
    onOpenTracking(token.trim());
    setToken('');
  };

  return (
    <BottomSheet
      open={trackSheetOpen}
      onClose={closeTrackSheet}
      size="sm"
      title={t('Suivre un colis', 'Track a parcel')}
      subtitle={t(
        'Saisissez le code de suivi reçu par le destinataire (sans compte requis).',
        'Enter the recipient tracking code (no account required).'
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="rvt_..."
            className="w-full pl-10 pr-4 py-3 rounded-2xl border border-neutral-300 font-mono text-sm focus:outline-none focus:border-neutral-950"
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          {t('Afficher le suivi en direct', 'Open live tracking')}
        </button>
      </form>
    </BottomSheet>
  );
}

export function SupportSheet() {
  const { t } = useLanguage();
  const {
    supportSheetOpen,
    closeSupportSheet,
    supportContextDeliveryId,
    busy,
    submitSupportMessage,
  } = useRovaApp();

  const [category, setCategory] = useState<
    'failed_delivery' | 'damage' | 'delay' | 'dispute' | 'refund' | 'driver_report'
  >('delay');
  const [description, setDescription] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    const ok = await submitSupportMessage({
      category,
      description,
      deliveryId: supportContextDeliveryId,
    });
    if (ok) setDescription('');
  };

  return (
    <BottomSheet
      open={supportSheetOpen}
      onClose={closeSupportSheet}
      size="sm"
      title={t('Support ROVA', 'ROVA Support')}
      subtitle={t(
        'Signalez un incident ou posez une question à notre équipe opérations.',
        'Report an issue or reach our operations support team.'
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">
            {t('Objet de la demande', 'Topic')}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
          >
            <option value="delay">{t('Retard ou suivi en cours', 'Delay or active tracking')}</option>
            <option value="failed_delivery">{t('Échec de livraison', 'Failed delivery')}</option>
            <option value="damage">{t('Colis endommagé', 'Damaged package')}</option>
            <option value="refund">{t('Facturation ou remboursement', 'Billing or refund')}</option>
            <option value="driver_report">{t('Signaler un livreur', 'Driver feedback')}</option>
            <option value="dispute">{t('Autre demande', 'Other inquiry')}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">
            {t('Détails', 'Details')}
          </label>
          <textarea
            rows={4}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('Décrivez votre besoin en quelques mots...', 'Describe how we can help...')}
            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
          />
        </div>

        <button
          type="submit"
          disabled={busy || !description.trim()}
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>{t('Envoyer au support', 'Send to support')}</span>
        </button>
      </form>
    </BottomSheet>
  );
}
