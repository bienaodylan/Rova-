import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, CreditCard, FileText, Lock, Receipt } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useRovaApp } from '../../context/RovaAppContext';
import { BottomSheet } from '../BottomSheet';
import {
  getPaymentMethodLabelEn,
  getVehicleLabel,
  PAYMENT_METHODS_EN,
} from '../../lib/logistics';
import { PaymentMethod } from '../../types/rova';
import { formatExactCurrency } from './accountTypes';

interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  mode: 'live_ready' | 'setup_required' | 'active';
}

interface LedgerEntry {
  id: string;
  kind: 'delivery' | 'reservation';
  reference: string;
  title: string;
  subtitle: string;
  dateLabel: string;
  timestampMs: number;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
}

export function PaymentsSection() {
  const { lang, t, currency, formatLocalMoney } = useLanguage();
  const {
    business,
    deliveries,
    reservations,
    preferredPayment,
    setPreferredPayment,
    showToast,
  } = useRovaApp();

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<LedgerEntry | null>(null);

  useEffect(() => {
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
  }, []);

  const providerMap = useMemo(() => {
    const map = new Map<string, ProviderStatus>();
    providers.forEach((p) => map.set(p.id, p));
    return map;
  }, [providers]);

  const ledger = useMemo<LedgerEntry[]>(() => {
    const items: LedgerEntry[] = [];
    const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';

    deliveries.forEach((d) => {
      const date = d.createdAt?.toDate ? d.createdAt.toDate() : null;
      items.push({
        id: `del_${d.id}`,
        kind: 'delivery',
        reference: d.reference,
        title: `${d.pickupAddress} → ${d.primaryDestinationLabel || t('Destination', 'Destination')}`,
        subtitle: `${getVehicleLabel(d.vehicleCategory, lang)} · ${d.totalDistanceKm.toFixed(1)} km`,
        dateLabel: date
          ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
          : '—',
        timestampMs: date ? date.getTime() : 0,
        amount: d.quotedPrice,
        currency: d.currency || 'GHS',
        paymentMethod: getPaymentMethodLabelEn(d.paymentMethod),
        paymentStatus: d.paymentStatus || 'authorized',
      });
    });

    reservations.forEach((r) => {
      const date = r.createdAt?.toDate ? r.createdAt.toDate() : null;
      items.push({
        id: `res_${r.id}`,
        kind: 'reservation',
        reference: `RES-${r.id.slice(0, 6).toUpperCase()}`,
        title: `${getVehicleLabel(r.vehicleCategory, lang)} · ${r.reservationDate}`,
        subtitle: `${r.startTime}–${r.endTime} · ${r.pickupAddress}`,
        dateLabel: date
          ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
          : r.reservationDate,
        timestampMs: date ? date.getTime() : 0,
        amount: r.quotedPrice,
        currency: r.currency || 'GHS',
        paymentMethod: getPaymentMethodLabelEn(preferredPayment),
        paymentStatus: r.status === 'cancelled' ? 'refunded' : r.status === 'completed' ? 'paid' : 'authorized',
      });
    });

    return items.sort((a, b) => b.timestampMs - a.timestampMs);
  }, [deliveries, reservations, lang, preferredPayment, t]);

  const paymentStatusLabel = (status: string) => {
    if (status === 'paid') return t('Payé', 'Paid');
    if (status === 'invoiced') return t('Facturé', 'Invoiced');
    if (status === 'refunded') return t('Remboursé', 'Refunded');
    if (status === 'authorized') return t('Autorisé', 'Authorized');
    return t('En attente', 'Pending');
  };

  const copyReference = (ref: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ref).catch(() => {});
    }
    showToast(t('Référence copiée.', 'Reference copied.'), 'success');
  };

  const walletCurrency = business?.currency || 'GHS';
  const walletAmount = business?.walletBalance ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-5 border-b border-neutral-200/80 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
            {t('Paiements', 'Payments')}
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            {t(
              'Méthode de règlement par défaut, solde du compte et historique des reçus.',
              'Default settlement method, account balance, and itemized receipts.'
            )}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
            Business Wallet
          </p>
          <p className="font-mono text-base font-bold text-neutral-950 tabular-nums">
            {formatExactCurrency(walletAmount, walletCurrency, lang)}
          </p>
          {walletCurrency.toUpperCase() !== currency.toUpperCase() && (
            <p className="font-mono text-[11px] text-neutral-500 tabular-nums">
              ≈ {formatLocalMoney(walletAmount, walletCurrency)}
            </p>
          )}
        </div>
      </div>

      {/* Payment Methods — Strictly in English per standing rule */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
            Payment Methods
          </h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
            <Lock className="w-3 h-3" />
            <span>{t('Aucune donnée de carte stockée localement', 'No card numbers stored locally')}</span>
          </span>
        </div>

        <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
          {PAYMENT_METHODS_EN.map((pm) => {
            const active = preferredPayment === pm.id;
            const liveProvider = providerMap.get(pm.id);
            const isActiveMode = liveProvider
              ? liveProvider.mode === 'active' || liveProvider.mode === 'live_ready'
              : true;

            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => {
                  setPreferredPayment(pm.id as PaymentMethod);
                  showToast(
                    t(`Méthode par défaut : ${pm.label}`, `Default payment method: ${pm.label}`),
                    'success'
                  );
                }}
                className="w-full py-4 text-left flex items-center justify-between gap-4 hover:bg-neutral-100/60 transition-colors cursor-pointer px-1"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <CreditCard className="w-4 h-4 text-neutral-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-neutral-950">{pm.label}</p>
                      {liveProvider && !isActiveMode && (
                        <span className="text-[11px] text-neutral-400 font-mono">
                          Setup required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 truncate mt-0.5">{pm.subtitle}</p>
                  </div>
                </div>

                {active ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-950 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
                    <Check className="w-4 h-4 text-red-600" />
                    <span>Default</span>
                  </span>
                ) : (
                  <span className="text-xs text-neutral-400 hover:text-neutral-950 shrink-0">
                    Select
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Real Transaction & Receipts History */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
            {t('Historique des transactions & reçus', 'Transactions & receipts')}
          </h3>
          <span className="font-mono text-xs text-neutral-400 tabular-nums">
            {ledger.length}
          </span>
        </div>

        {ledger.length === 0 ? (
          <div className="py-10 text-center border-y border-neutral-200/70 space-y-1.5">
            <Receipt className="w-5 h-5 text-neutral-400 mx-auto" />
            <p className="text-sm font-medium text-neutral-900">
              {t('Aucune transaction enregistrée', 'No transactions yet')}
            </p>
            <p className="text-xs text-neutral-500">
              {t(
                'Les reçus de vos livraisons et réservations apparaîtront automatiquement ici.',
                'Receipts for your deliveries and reservations will appear here automatically.'
              )}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
            {ledger.slice(0, 20).map((item) => {
              const showConverted = item.currency.toUpperCase() !== currency.toUpperCase();
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveReceipt(item)}
                  className="w-full py-4 px-1 text-left flex items-start justify-between gap-4 hover:bg-neutral-100/60 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-xs text-neutral-500 flex-wrap">
                      <span className="font-mono font-semibold text-neutral-950">
                        {item.reference}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.dateLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-neutral-700 font-medium">
                        {paymentStatusLabel(item.paymentStatus)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-neutral-950 truncate">{item.title}</p>
                    <p className="text-xs text-neutral-500 truncate">
                      {item.paymentMethod} · {item.subtitle}
                    </p>
                  </div>

                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="font-mono text-xs font-bold text-neutral-950 tabular-nums">
                      {formatExactCurrency(item.amount, item.currency, lang)}
                    </p>
                    {showConverted && (
                      <p className="font-mono text-[11px] text-neutral-400 tabular-nums">
                        ≈ {formatLocalMoney(item.amount, item.currency)}
                      </p>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
                      <FileText className="w-3 h-3" />
                      {t('Reçu', 'Receipt')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Itemized Receipt Sheet */}
      <BottomSheet
        open={Boolean(activeReceipt)}
        onClose={() => setActiveReceipt(null)}
        size="sm"
        title={t('Reçu de transaction', 'Transaction receipt')}
        subtitle={activeReceipt?.reference}
        footer={
          activeReceipt ? (
            <button
              type="button"
              onClick={() => copyReference(activeReceipt.reference)}
              className="w-full py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{t('Copier la référence du reçu', 'Copy receipt reference')}</span>
            </button>
          ) : undefined
        }
      >
        {activeReceipt && (
          <div className="space-y-4">
            <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70 text-xs">
              <div className="py-3 flex justify-between gap-4">
                <span className="text-neutral-500">{t('Référence', 'Reference')}</span>
                <span className="font-mono font-semibold text-neutral-950">{activeReceipt.reference}</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-neutral-500">{t('Date', 'Date')}</span>
                <span className="text-neutral-950">{activeReceipt.dateLabel}</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-neutral-500">{t('Prestation', 'Service')}</span>
                <span className="text-neutral-950 text-right">{activeReceipt.title}</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-neutral-500">Payment Method</span>
                <span className="text-neutral-950 font-medium">{activeReceipt.paymentMethod}</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-neutral-500">{t('Statut', 'Status')}</span>
                <span className="text-neutral-950 font-medium">
                  {paymentStatusLabel(activeReceipt.paymentStatus)}
                </span>
              </div>
              <div className="py-3.5 flex justify-between gap-4 items-baseline">
                <span className="text-neutral-500 font-medium">
                  {t('Montant facturé (devise d’origine)', 'Billed amount (original currency)')}
                </span>
                <span className="font-mono text-base font-bold text-neutral-950 tabular-nums">
                  {formatExactCurrency(activeReceipt.amount, activeReceipt.currency, lang)}
                </span>
              </div>
              {activeReceipt.currency.toUpperCase() !== currency.toUpperCase() && (
                <div className="py-3 flex justify-between gap-4">
                  <span className="text-neutral-500">
                    {t('Équivalent affiché (indicatif)', 'Display equivalent (estimate)')}
                  </span>
                  <span className="font-mono text-neutral-600 tabular-nums">
                    ≈ {formatLocalMoney(activeReceipt.amount, activeReceipt.currency)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
