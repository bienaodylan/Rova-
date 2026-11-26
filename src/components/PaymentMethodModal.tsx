import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CreditCard,
  Lock,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { PAYMENT_METHODS_EN } from '../lib/logistics';
import { PaymentMethod } from '../types/rova';
import { useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';

interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  mode: 'live_ready' | 'setup_required' | 'active';
}

interface PaymentMethodModalProps {
  open: boolean;
  onClose: () => void;
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
  title?: string;
  subtitle?: string;
  /** Elevate z-index when opened from inside another bottom sheet (e.g., Delivery Checkout). */
  elevated?: boolean;
}

const METHOD_ICONS: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  mobile_money: Smartphone,
  card: CreditCard,
  invoice: Building2,
  wallet: Wallet,
};

/**
 * Stripe × Apple contextual payment method selector.
 * Displays strictly digital/electronic payment methods with English labels,
 * real backend provider readiness, real wallet balance, and honest corporate invoice gating.
 * Cash is intentionally excluded.
 */
export function PaymentMethodModal({
  open,
  onClose,
  selected,
  onSelect,
  title = 'Payment Method',
  subtitle,
  elevated = false,
}: PaymentMethodModalProps) {
  const { t, formatLocalMoney } = useLanguage();
  const { business } = useRovaApp();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/payments/providers')
      .then((r) => r.json())
      .then((data: { providers?: ProviderStatus[] }) => {
        if (active && Array.isArray(data.providers)) {
          setProviders(data.providers);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  const providerMap = useMemo(() => {
    const map = new Map<string, ProviderStatus>();
    providers.forEach((p) => map.set(p.id, p));
    return map;
  }, [providers]);

  const isCorporateVerified = business?.verificationStatus === 'verified';
  const walletBalance = business?.walletBalance ?? 0;
  const walletCurrency = business?.currency || 'GHS';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="sm"
      elevated={elevated}
      title={title}
      subtitle={
        subtitle ||
        t(
          'Sélectionnez un moyen de paiement électronique vérifié.',
          'Choose a verified electronic settlement method.'
        )
      }
    >
      <div className="space-y-4">
        <div className="rounded-3xl border border-[#E5E5E5] bg-white overflow-hidden divide-y divide-[#E5E5E5]">
          {PAYMENT_METHODS_EN.map((pm) => {
            const Icon = METHOD_ICONS[pm.id] || CreditCard;
            const isSelected = selected === pm.id;
            const liveProvider = providerMap.get(pm.id);
            const isSetupRequired =
              Boolean(liveProvider) &&
              liveProvider?.mode === 'setup_required' &&
              !liveProvider.configured;
            const invoiceRestricted = pm.id === 'invoice' && Boolean(business) && !isCorporateVerified;

            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => {
                  onSelect(pm.id);
                  onClose();
                }}
                className={`w-full py-4 px-4 text-left flex items-center justify-between gap-3.5 transition-colors cursor-pointer ${
                  isSelected ? 'bg-[#F3F3F3]/80' : 'hover:bg-[#F3F3F3]/50'
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-[#171717] text-white'
                        : 'bg-[#F3F3F3] text-[#171717]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#171717]">
                        {pm.label}
                      </span>
                      {pm.id === 'wallet' && (
                        <span className="font-mono text-xs font-medium text-[#777777] tabular-nums">
                          {formatLocalMoney(walletBalance, walletCurrency)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#777777] leading-relaxed">
                      {pm.subtitle}
                    </p>
                    {isSetupRequired && (
                      <p className="text-[11px] font-medium text-amber-700 pt-0.5">
                        {t('Passerelle en attente de configuration', 'Gateway setup required')}
                      </p>
                    )}
                    {invoiceRestricted && (
                      <p className="text-[11px] text-[#777777] pt-0.5">
                        {t(
                          'Facturation B2B activée après vérification entreprise',
                          'B2B billing unlocks upon business verification'
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
                    isSelected
                      ? 'border-[#E52B32] bg-[#E52B32] text-white'
                      : 'border-[#E5E5E5] bg-white'
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[#777777] pt-1">
          <Lock className="w-3.5 h-3.5 shrink-0 text-[#171717]" />
          <span>
            {t(
              'Paiements chiffrés · Aucun numéro de carte stocké sur votre appareil.',
              'Encrypted payments · No card numbers are stored on your device.'
            )}
          </span>
        </div>
      </div>
    </BottomSheet>
  );
}
