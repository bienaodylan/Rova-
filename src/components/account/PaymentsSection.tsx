import React, { useMemo, useState } from 'react';
import {
  Building2,
  ChevronRight,
  Copy,
  CreditCard,
  FileText,
  Lock,
  Receipt,
  Wallet,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useRovaApp } from '../../context/RovaAppContext';
import { BottomSheet } from '../BottomSheet';
import { PaymentMethodModal } from '../PaymentMethodModal';
import {
  getPaymentMethodLabelEn,
  getVehicleLabel,
  PAYMENT_METHODS_EN,
} from '../../lib/logistics';
import { PaymentMethod } from '../../types/rova';
import { formatExactCurrency } from './accountTypes';

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

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<LedgerEntry | null>(null);

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
        paymentStatus:
          r.status === 'cancelled'
            ? 'refunded'
            : r.status === 'completed'
            ? 'paid'
            : 'authorized',
      });
    });

    return items.sort((a, b) => b.timestampMs - a.timestampMs);
  }, [deliveries, reservations, lang, preferredPayment, t]);

  const paymentStatusMeta = (status: string): { label: string; colorClass: string } => {
    switch (status) {
      case 'paid':
        return { label: t('Confirmé', 'Confirmed'), colorClass: 'text-emerald-700' };
      case 'invoiced':
        return { label: t('Facturé', 'Invoiced'), colorClass: 'text-[#171717]' };
      case 'refunded':
        return { label: t('Remboursé', 'Refunded'), colorClass: 'text-[#777777]' };
      case 'failed':
        return { label: t('Échec', 'Failed'), colorClass: 'text-[#E52B32]' };
      case 'authorized':
        return { label: t('Autorisé', 'Authorized'), colorClass: 'text-amber-700' };
      default:
        return { label: t('En attente', 'Pending'), colorClass: 'text-amber-700' };
    }
  };

  const copyReference = (ref: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ref).catch(() => {});
    }
    showToast(t('Référence copiée.', 'Reference copied.'), 'success');
  };

  const walletCurrency = business?.currency || 'GHS';
  const walletAmount = business?.walletBalance ?? 0;
  const isCorporateVerified = business?.verificationStatus === 'verified';
  const currentPaymentMeta = PAYMENT_METHODS_EN.find((m) => m.id === preferredPayment);

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="pb-5 border-b border-[#E5E5E5] space-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight text-[#171717]">
          {t('Paiements', 'Payments')}
        </h2>
        <p className="text-xs text-[#777777]">
          {t(
            'Moyen de paiement par défaut, solde entreprise, facturation et reçus.',
            'Default settlement method, business balance, billing status, and itemized receipts.'
          )}
        </p>
      </div>

      {/* 1. Default Payment Method (Contextual Stripe × Apple Selector) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-[#777777]">Default Payment Method</h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#777777]">
            <Lock className="w-3 h-3 text-[#171717]" />
            <span>{t('Chiffré', 'Encrypted')}</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setPaymentModalOpen(true)}
          className="w-full min-h-[68px] px-5 py-3.5 rounded-3xl border border-[#E5E5E5] hover:border-[#171717] bg-white flex items-center justify-between gap-4 text-left transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] text-[#171717] flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#171717] truncate">
                {getPaymentMethodLabelEn(preferredPayment)}
              </p>
              <p className="text-xs text-[#777777] truncate mt-0.5">
                {currentPaymentMeta?.subtitle || 'Verified electronic settlement'}
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#E52B32] shrink-0">
            <span>{t('Modifier', 'Change')}</span>
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
      </div>

      {/* 2. Balances & Corporate Billing Eligibility (Separated Clearly) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#E5E5E5] border border-[#E5E5E5] rounded-3xl overflow-hidden bg-white">
        <div className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#777777]">
            <Wallet className="w-3.5 h-3.5 text-[#171717]" />
            <span>Business Wallet</span>
          </div>
          <p className="font-mono text-lg font-bold text-[#171717] tabular-nums">
            {formatExactCurrency(walletAmount, walletCurrency, lang)}
          </p>
          {walletCurrency.toUpperCase() !== currency.toUpperCase() && (
            <p className="font-mono text-[11px] text-[#777777] tabular-nums">
              ≈ {formatLocalMoney(walletAmount, walletCurrency)}
            </p>
          )}
        </div>

        <div className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#777777]">
            <Building2 className="w-3.5 h-3.5 text-[#171717]" />
            <span>Corporate Invoice</span>
          </div>
          <p className="text-sm font-semibold text-[#171717]">
            {isCorporateVerified
              ? t('Éligible · Net 15 / Net 30', 'Eligible · Net 15 / Net 30')
              : t('Vérification entreprise requise', 'Business verification required')}
          </p>
          <p className="text-[11px] text-[#777777]">
            {isCorporateVerified
              ? t('Facturation mensuelle activée sur votre compte.', 'Monthly consolidated billing active.')
              : t(
                  'Complétez votre profil commerçant pour activer la facturation différée.',
                  'Complete business verification to unlock monthly invoicing.'
                )}
          </p>
        </div>
      </div>

      {/* 3. Real Transactions & Receipts History */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-[#777777]">
            {t('Historique des transactions & reçus', 'Transactions & receipts')}
          </h3>
          <span className="font-mono text-xs text-[#777777] tabular-nums">
            {ledger.length}
          </span>
        </div>

        {ledger.length === 0 ? (
          <div className="rounded-3xl border border-[#E5E5E5] bg-white py-10 px-6 text-center space-y-1.5">
            <Receipt className="w-5 h-5 text-[#777777] mx-auto" />
            <p className="text-sm font-semibold text-[#171717]">
              {t('Aucune transaction enregistrée', 'No transactions yet')}
            </p>
            <p className="text-xs text-[#777777] max-w-sm mx-auto">
              {t(
                'Les reçus de vos livraisons et réservations apparaîtront automatiquement ici.',
                'Receipts for your deliveries and vehicle reservations will appear here automatically.'
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-[#E5E5E5] bg-white divide-y divide-[#E5E5E5] overflow-hidden">
            {ledger.slice(0, 20).map((item) => {
              const showConverted = item.currency.toUpperCase() !== currency.toUpperCase();
              const statusInfo = paymentStatusMeta(item.paymentStatus);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveReceipt(item)}
                  className="w-full py-4 px-5 text-left flex items-start justify-between gap-4 hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-xs text-[#777777] flex-wrap">
                      <span className="font-mono font-semibold text-[#171717]">
                        {item.reference}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.dateLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${statusInfo.colorClass}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[#171717] truncate">{item.title}</p>
                    <p className="text-xs text-[#777777] truncate">
                      {item.paymentMethod} · {item.subtitle}
                    </p>
                  </div>

                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="font-mono text-xs sm:text-sm font-bold text-[#171717] tabular-nums">
                      {formatExactCurrency(item.amount, item.currency, lang)}
                    </p>
                    {showConverted && (
                      <p className="font-mono text-[11px] text-[#777777] tabular-nums">
                        ≈ {formatLocalMoney(item.amount, item.currency)}
                      </p>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#777777]">
                      <FileText className="w-3 h-3" />
                      <span>{t('Reçu', 'Receipt')}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Contextual Payment Method Selector Modal */}
      <PaymentMethodModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        selected={preferredPayment}
        onSelect={(method: PaymentMethod) => {
          setPreferredPayment(method);
          showToast(
            t(
              `Méthode par défaut : ${getPaymentMethodLabelEn(method)}`,
              `Default payment method: ${getPaymentMethodLabelEn(method)}`
            ),
            'success'
          );
        }}
        title="Default Payment Method"
      />

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
              className="w-full min-h-[44px] rounded-full bg-[#171717] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{t('Copier la référence du reçu', 'Copy receipt reference')}</span>
            </button>
          ) : undefined
        }
      >
        {activeReceipt && (
          <div className="rounded-3xl border border-[#E5E5E5] bg-white divide-y divide-[#E5E5E5] px-4 text-xs">
            <div className="py-3 flex justify-between gap-4">
              <span className="text-[#777777]">{t('Référence', 'Reference')}</span>
              <span className="font-mono font-semibold text-[#171717]">{activeReceipt.reference}</span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-[#777777]">{t('Date', 'Date')}</span>
              <span className="text-[#171717]">{activeReceipt.dateLabel}</span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-[#777777]">{t('Prestation', 'Service')}</span>
              <span className="text-[#171717] text-right">{activeReceipt.title}</span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-[#777777]">Payment Method</span>
              <span className="text-[#171717] font-medium">{activeReceipt.paymentMethod}</span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-[#777777]">{t('Statut', 'Status')}</span>
              <span className={`font-semibold ${paymentStatusMeta(activeReceipt.paymentStatus).colorClass}`}>
                {paymentStatusMeta(activeReceipt.paymentStatus).label}
              </span>
            </div>
            <div className="py-3.5 flex justify-between gap-4 items-baseline">
              <span className="text-[#777777] font-medium">
                {t('Montant facturé', 'Billed amount')}
              </span>
              <span className="font-mono text-base font-bold text-[#171717] tabular-nums">
                {formatExactCurrency(activeReceipt.amount, activeReceipt.currency, lang)}
              </span>
            </div>
            {activeReceipt.currency.toUpperCase() !== currency.toUpperCase() && (
              <div className="py-3 flex justify-between gap-4">
                <span className="text-[#777777]">
                  {t('Équivalent affiché (indicatif)', 'Display equivalent (estimate)')}
                </span>
                <span className="font-mono text-[#777777] tabular-nums">
                  ≈ {formatLocalMoney(activeReceipt.amount, activeReceipt.currency)}
                </span>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
