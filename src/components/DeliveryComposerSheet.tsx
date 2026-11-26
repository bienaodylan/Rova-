import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Check,
  ChevronRight,
  CreditCard,
  Loader2,
  MapPin,
  Plus,
  Route,
  Trash2,
  Upload,
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { LocationSearchField } from './LocationSearchField';
import { PaymentMethodModal } from './PaymentMethodModal';
import { VehicleIllustration } from './VehicleIllustration';
import { DraftStop, useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';
import {
  getEffectivePricingRule,
  getPaymentMethodLabelEn,
  getVehicleLabel,
  haversineDistanceKm,
  PAYMENT_METHODS_EN,
  rankSuitableDrivers,
  VEHICLE_CATALOG,
} from '../lib/logistics';
import { PaymentMethod, ProofType, QuoteResult } from '../types/rova';

type DeliveryDraftStep = 1 | 2 | 3 | 4 | 5;

export function DeliveryComposerSheet() {
  const { lang, t, formatLocalMoney } = useLanguage();
  const {
    composerOpen,
    closeComposer,
    draft,
    setDraft,
    recipients,
    onlineDrivers,
    pricingRules,
    busy,
    submitDelivery,
    showToast,
  } = useRovaApp();

  const [activeStopIdx, setActiveStopIdx] = useState(0);
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);
  const [routeDurationMin, setRouteDurationMin] = useState(0);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteMeta, setQuoteMeta] = useState<{
    id: string;
    cityName: string;
    isFallbackEstimate: boolean;
    distanceSource: string;
    expiresAt: string;
  } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const safeStopIdx = Math.min(activeStopIdx, Math.max(0, draft.stops.length - 1));
  const currentStop = draft.stops[safeStopIdx] || draft.stops[0];

  // Fetch real road route from /api/geo/route whenever pickup or stops change
  useEffect(() => {
    if (!composerOpen) return;
    const validStops = draft.stops.filter((s) => s.address.trim().length > 0);
    if (!draft.pickup.address.trim() || validStops.length === 0) {
      setRouteDistanceKm(0);
      setRouteDurationMin(0);
      return;
    }

    let cancelled = false;
    const points = [
      { lat: draft.pickup.lat, lng: draft.pickup.lng },
      ...validStops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];

    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRouteDistanceKm(Number(data.distanceKm) || 0);
        setRouteDurationMin(Number(data.durationMin) || 0);
      })
      .catch(() => {
        if (cancelled) return;
        let km = 0;
        for (let i = 0; i < points.length - 1; i++) {
          km += haversineDistanceKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
        }
        setRouteDistanceKm(Number(km.toFixed(2)));
        setRouteDurationMin(Math.max(8, Math.round(km * 3)));
      });

    return () => {
      cancelled = true;
    };
  }, [composerOpen, draft.pickup.address, draft.pickup.lat, draft.pickup.lng, draft.stops]);

  // Authoritative server-side quote + city geospatial isolation via /api/v1/quotes
  useEffect(() => {
    if (!composerOpen) return;
    const validStops = draft.stops.filter((s) => s.address.trim().length > 0);
    if (!draft.pickup.address.trim() || validStops.length === 0) {
      setQuoteError(null);
      setQuoteMeta(null);
      return;
    }

    let cancelled = false;
    setQuoteError(null);

    fetch('/api/v1/quotes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': lang,
      },
      body: JSON.stringify({
        pickup: { lat: draft.pickup.lat, lng: draft.pickup.lng },
        stops: validStops.map((s) => ({ lat: s.lat, lng: s.lng })),
        vehicleCategory: draft.vehicleCategory,
        timingType: draft.timingType,
        weightKg: draft.weightKg,
        packageSize: draft.packageSize,
        fragile: draft.fragile,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setQuote(null);
          setQuoteMeta(null);
          setQuoteError(
            (lang === 'en' ? data.errorEn || data.error : data.error || data.errorEn) ||
              t(
                'Cet itinéraire est hors de nos zones de livraison urbaines actives.',
                'This route is outside supported urban service areas.'
              )
          );
          return;
        }
        if (data.quote) {
          setQuoteError(null);
          setRouteDistanceKm(Number(data.quote.distanceKm) || routeDistanceKm);
          setRouteDurationMin(Number(data.quote.durationMin) || routeDurationMin);
          setQuote({
            currency: data.quote.currency,
            total: data.quote.customerTotal,
            breakdown: Array.isArray(data.quote.breakdown)
              ? data.quote.breakdown.map((b: { labelFr?: string; labelEn?: string; label?: string; amount: number }) => ({
                  label: lang === 'fr' ? b.labelFr || b.label || '' : b.labelEn || b.label || '',
                  amount: b.amount,
                }))
              : [],
          });
          setQuoteMeta({
            id: data.quote.id,
            cityName: data.quote.cityName,
            isFallbackEstimate: Boolean(data.quote.isFallbackEstimate),
            distanceSource: String(data.quote.distanceSource || 'osrm'),
            expiresAt: String(data.quote.expiresAt || ''),
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        const rule = getEffectivePricingRule(pricingRules, draft.vehicleCategory);
        const dist = Math.max(1, routeDistanceKm || 4);
        const fallbackTotal = Math.max(
          rule.minimumFare,
          rule.baseFee + dist * rule.perKmRate + Math.max(0, validStops.length - 1) * rule.multiStopFee
        );
        setQuote({
          currency: rule.currency || 'XOF',
          total: Number(fallbackTotal.toFixed(2)),
          breakdown: [{ label: t('Tarif estimé', 'Estimated fare'), amount: Number(fallbackTotal.toFixed(2)) }],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    composerOpen,
    pricingRules,
    draft.pickup.address,
    draft.pickup.lat,
    draft.pickup.lng,
    draft.vehicleCategory,
    draft.stops,
    draft.timingType,
    draft.weightKg,
    draft.packageSize,
    draft.fragile,
    lang,
    t,
  ]);

  const matchedDrivers = useMemo(
    () =>
      rankSuitableDrivers(
        onlineDrivers,
        draft.pickup.lat,
        draft.pickup.lng,
        draft.vehicleCategory,
        draft.weightKg
      ),
    [onlineDrivers, draft.pickup.lat, draft.pickup.lng, draft.vehicleCategory, draft.weightKg]
  );

  const updateStop = (idx: number, patch: Partial<DraftStop>) => {
    setDraft((prev) => {
      const nextStops = [...prev.stops];
      if (!nextStops[idx]) return prev;
      nextStops[idx] = { ...nextStops[idx], ...patch };
      return { ...prev, stops: nextStops };
    });
  };

  const addStop = () => {
    const last = draft.stops[draft.stops.length - 1];
    const nextStop: DraftStop = {
      id: `stop_${Date.now()}_${draft.stops.length + 1}`,
      recipientName: '',
      recipientPhone: '',
      address: '',
      landmark: '',
      instructions: '',
      packageRef: '',
      lat: (last?.lat ?? draft.pickup.lat) + 0.008,
      lng: (last?.lng ?? draft.pickup.lng) + 0.008,
    };
    setDraft((prev) => ({
      ...prev,
      mode: 'multi',
      stops: [...prev.stops, nextStop],
    }));
    setActiveStopIdx(draft.stops.length);
  };

  const removeStop = (idx: number) => {
    if (draft.stops.length <= 1) return;
    setDraft((prev) => ({
      ...prev,
      stops: prev.stops.filter((_, i) => i !== idx),
    }));
    setActiveStopIdx((prev) => Math.max(0, prev - 1));
  };

  const moveStop = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= draft.stops.length) return;
    setDraft((prev) => {
      const copy = [...prev.stops];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return { ...prev, stops: copy };
    });
    setActiveStopIdx(target);
  };

  const handleOptimizeRoute = async () => {
    if (draft.stops.length < 2) return;
    setOptimizing(true);
    try {
      const res = await fetch('/api/geo/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: draft.pickup.lat, lng: draft.pickup.lng },
          stops: draft.stops.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
        }),
      });
      const data = await res.json();
      if (Array.isArray(data.orderedIds)) {
        const byId = new Map(draft.stops.map((s) => [s.id, s]));
        const reordered = data.orderedIds
          .map((id: string) => byId.get(id))
          .filter(Boolean) as DraftStop[];
        if (reordered.length === draft.stops.length) {
          setDraft((prev) => ({ ...prev, stops: reordered }));
          showToast(t('Ordre des arrêts optimisé.', 'Stop sequence optimized.'), 'success');
        }
      }
    } catch {
      showToast(t('Optimisation indisponible pour le moment.', 'Optimization currently unavailable.'), 'error');
    } finally {
      setOptimizing(false);
    }
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const imported: DraftStop[] = [];
      lines.slice(1).forEach((line, idx) => {
        const [name, phone, address, latStr, lngStr] = line.split(',').map((c) => c.trim());
        if (!address) return;
        const lat = Number(latStr);
        const lng = Number(lngStr);
        imported.push({
          id: `csv_${Date.now()}_${idx}`,
          recipientName: name || `${t('Destinataire', 'Recipient')} ${idx + 1}`,
          recipientPhone: phone || '',
          address,
          landmark: '',
          instructions: '',
          packageRef: `CSV-${idx + 1}`,
          lat: Number.isFinite(lat) ? lat : draft.pickup.lat + (idx + 1) * 0.008,
          lng: Number.isFinite(lng) ? lng : draft.pickup.lng + (idx + 1) * 0.006,
        });
      });
      if (imported.length > 0) {
        setDraft((prev) => ({
          ...prev,
          mode: 'multi',
          stops: [...prev.stops.filter((s) => s.address.trim()), ...imported],
        }));
        showToast(t(`${imported.length} arrêt(s) importé(s).`, `${imported.length} stop(s) imported.`), 'success');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const steps: Array<{ id: DeliveryDraftStep; label: string }> = [
    { id: 1, label: t('Collecte', 'Pickup') },
    { id: 2, label: t('Destination', 'Drop-off') },
    { id: 3, label: t('Véhicule', 'Vehicle') },
    { id: 4, label: t('Détails', 'Details') },
    { id: 5, label: t('Paiement', 'Checkout') },
  ];

  const validStopsCount = draft.stops.filter((s) => s.address.trim().length > 0).length;
  const canContinue =
    (draft.step === 1 && draft.pickup.address.trim().length > 0) ||
    (draft.step === 2 && validStopsCount > 0) ||
    draft.step === 3 ||
    draft.step === 4;

  const estimateVehiclePrice = (category: typeof draft.vehicleCategory) => {
    const rule = getEffectivePricingRule(pricingRules, category);
    const dist = Math.max(1, routeDistanceKm || 4);
    const total = Math.max(
      rule.minimumFare,
      rule.baseFee + dist * rule.perKmRate + Math.max(0, validStopsCount - 1) * rule.multiStopFee
    );
    return formatLocalMoney(Number(total.toFixed(2)), rule.currency || 'GHS');
  };

  const selectedPaymentMeta = PAYMENT_METHODS_EN.find((pm) => pm.id === draft.paymentMethod);

  const sheetTitle =
    draft.mode === 'multi'
      ? t('Tournée multi-arrêts', 'Multi-stop delivery')
      : draft.mode === 'scheduled'
      ? t('Livraison planifiée', 'Scheduled delivery')
      : t('Nouvelle livraison', 'New delivery');

  const inputClass =
    'w-full rounded-2xl bg-white border border-[#E5E5E5] px-4 py-2.5 text-sm text-[#171717] placeholder:text-[#777777] focus:outline-none focus:border-[#171717] transition-colors';

  return (
    <>
      <BottomSheet
        open={composerOpen}
        onClose={closeComposer}
        size="lg"
        scrollable={true}
        title={sheetTitle}
        subtitle={`${t('Étape', 'Step')} ${draft.step} / 5 · ${steps[draft.step - 1].label}`}
        footer={
          <div className="flex items-center justify-between gap-3">
            {draft.step > 1 ? (
              <button
                type="button"
                onClick={() =>
                  setDraft((p) => ({ ...p, step: Math.max(1, p.step - 1) as DeliveryDraftStep }))
                }
                className="min-h-[46px] inline-flex items-center gap-1.5 px-5 rounded-full border border-[#E5E5E5] bg-white text-sm font-semibold text-[#171717] hover:border-[#171717] hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('Retour', 'Back')}</span>
              </button>
            ) : (
              <div className="min-w-0">
                {routeDistanceKm > 0 ? (
                  <>
                    <p className="text-[11px] text-[#777777]">{t('Trajet estimé', 'Estimated route')}</p>
                    <p className="font-mono text-sm font-bold text-[#171717] tabular-nums">
                      {routeDistanceKm.toFixed(1)} km · ~{routeDurationMin} min
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-[#777777]">
                    {t('Tarif calculé selon l’itinéraire', 'Fare calculated by route')}
                  </p>
                )}
              </div>
            )}

            {draft.step < 5 ? (
              <button
                type="button"
                disabled={!canContinue}
                onClick={() =>
                  setDraft((p) => ({ ...p, step: Math.min(5, p.step + 1) as DeliveryDraftStep }))
                }
                className="min-h-[46px] inline-flex items-center gap-2 px-6 rounded-full bg-[#171717] text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap"
              >
                <span>{t('Continuer', 'Continue')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || Boolean(quoteError) || !draft.pickup.address.trim() || validStopsCount === 0}
                onClick={() =>
                  submitDelivery(
                    routeDistanceKm,
                    routeDurationMin,
                    quote?.total ?? getEffectivePricingRule(pricingRules, draft.vehicleCategory).minimumFare
                  )
                }
                className="min-h-[48px] inline-flex items-center gap-2 px-6 rounded-full bg-[#E52B32] text-white text-sm font-semibold hover:bg-[#CC2229] disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>
                  {busy
                    ? t('Confirmation...', 'Confirming...')
                    : t('Confirmer la livraison', 'Confirm delivery')}
                </span>
              </button>
            )}
          </div>
        }
      >
        <div className="min-h-0 flex flex-col gap-5">
          {/* Linear Segmented Progress Rail */}
          <div className="space-y-2 shrink-0">
            <div className="grid grid-cols-5 gap-1.5" aria-hidden="true">
              {steps.map((s) => {
                const isCurrent = draft.step === s.id;
                const isDone = draft.step > s.id;
                return (
                  <div
                    key={s.id}
                    className={`h-1 rounded-full transition-colors duration-200 ${
                      isCurrent
                        ? 'bg-[#E52B32]'
                        : isDone
                        ? 'bg-[#171717]'
                        : 'bg-[#E5E5E5]'
                    }`}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
              {steps.map((s) => {
                const isCurrent = draft.step === s.id;
                const canJump =
                  s.id <= draft.step || (s.id === 2 && draft.pickup.address.trim().length > 0);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!canJump}
                    onClick={() => canJump && setDraft((p) => ({ ...p, step: s.id }))}
                    className={`text-[11px] whitespace-nowrap transition-colors ${
                      isCurrent
                        ? 'font-semibold text-[#171717]'
                        : canJump
                        ? 'text-[#777777] hover:text-[#171717] cursor-pointer'
                        : 'text-[#777777]/50 cursor-default'
                    }`}
                  >
                    {s.id}. {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ============================================================== */}
          {/* STEP 1 — PICKUP LOCATION                                       */}
          {/* ============================================================== */}
          {draft.step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-[#171717]">
                  {t('Où récupérer le colis ?', 'Where should we pick up?')}
                </h3>
                <p className="text-xs text-[#777777]">
                  {t(
                    'Indiquez l’adresse de collecte et un repère si nécessaire.',
                    'Enter the pickup address and any helpful landmark.'
                  )}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#171717]">
                  {t('Adresse de collecte', 'Pickup address')}
                </label>
                <LocationSearchField
                  value={draft.pickup.address}
                  center={[draft.pickup.lat, draft.pickup.lng]}
                  placeholder={t(
                    'Rechercher une adresse, un quartier ou un repère...',
                    'Search an address, area, or landmark...'
                  )}
                  onChangeText={(text) =>
                    setDraft((p) => ({
                      ...p,
                      pickup: {
                        ...p.pickup,
                        address: text,
                      },
                    }))
                  }
                  onSelect={(place) =>
                    setDraft((p) => ({
                      ...p,
                      pickup: {
                        ...p.pickup,
                        address: place.shortName || place.displayName,
                        landmark: place.landmark || p.pickup.landmark,
                        lat: place.lat,
                        lng: place.lng,
                      },
                    }))
                  }
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">
                    {t('Point de repère (optionnel)', 'Landmark (optional)')}
                  </label>
                  <input
                    type="text"
                    value={draft.pickup.landmark}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, pickup: { ...p.pickup, landmark: e.target.value } }))
                    }
                    placeholder={t('Face à la pharmacie, portail noir...', 'Opposite pharmacy, black gate...')}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">
                    {t('Instructions de collecte', 'Pickup instructions')}
                  </label>
                  <input
                    type="text"
                    value={draft.pickup.instructions}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, pickup: { ...p.pickup, instructions: e.target.value } }))
                    }
                    placeholder={t('Demander le comptoir expédition...', 'Ask for dispatch desk...')}
                    className={inputClass}
                  />
                </div>
              </div>

              {recipients.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#E5E5E5]">
                  <p className="text-xs font-medium text-[#777777]">
                    {t('Adresses enregistrées', 'Saved addresses')}
                  </p>
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    {recipients.slice(0, 6).map((rec) => (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            pickup: {
                              ...p.pickup,
                              address: rec.address,
                              landmark: rec.landmark || '',
                              lat: rec.lat,
                              lng: rec.lng,
                            },
                          }))
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#E5E5E5] bg-white hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                      >
                        <Bookmark className="w-3.5 h-3.5 text-[#777777]" />
                        <span>{rec.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 2 — DESTINATION(S) & MULTI-STOP                           */}
          {/* ============================================================== */}
          {draft.step === 2 && currentStop && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="font-display text-base font-bold text-[#171717]">
                    {t('Où livrer le colis ?', 'Where is it going?')}
                  </h3>
                  <p className="text-xs text-[#777777]">
                    {t('Collecte :', 'Pickup:')} <span className="text-[#171717] font-medium">{draft.pickup.address}</span>
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {draft.stops.length > 1 && (
                    <button
                      type="button"
                      disabled={optimizing}
                      onClick={handleOptimizeRoute}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 rounded-full border border-[#E5E5E5] hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      {optimizing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Route className="w-3.5 h-3.5" />
                      )}
                      <span>{t('Optimiser', 'Optimize')}</span>
                    </button>
                  )}
                  <label className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 rounded-full border border-[#E5E5E5] hover:border-[#171717] text-xs font-medium text-[#777777] hover:text-[#171717] cursor-pointer whitespace-nowrap">
                    <Upload className="w-3.5 h-3.5" />
                    <span>CSV</span>
                    <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#171717]">
                  {draft.stops.length > 1
                    ? t(`Adresse de destination #${safeStopIdx + 1}`, `Drop-off address #${safeStopIdx + 1}`)
                    : t('Adresse de livraison', 'Drop-off address')}
                </label>
                <LocationSearchField
                  value={currentStop.address}
                  center={[currentStop.lat, currentStop.lng]}
                  placeholder={t(
                    `Rechercher la destination #${safeStopIdx + 1}...`,
                    `Search drop-off location #${safeStopIdx + 1}...`
                  )}
                  onChangeText={(text) => updateStop(safeStopIdx, { address: text })}
                  onSelect={(place) =>
                    updateStop(safeStopIdx, {
                      address: place.shortName || place.displayName,
                      landmark: place.landmark || currentStop.landmark,
                      lat: place.lat,
                      lng: place.lng,
                    })
                  }
                />
              </div>

              {/* Multi-Stop Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {draft.stops.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveStopIdx(idx)}
                    className={`min-h-[36px] inline-flex items-center gap-1.5 px-3.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      idx === safeStopIdx
                        ? 'bg-[#171717] text-white'
                        : 'bg-[#F3F3F3] text-[#171717] hover:bg-[#E5E5E5]'
                    }`}
                  >
                    <span className="font-mono">#{idx + 1}</span>
                    <span className="max-w-[110px] truncate">
                      {s.recipientName || s.address || t('Arrêt', 'Stop')}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addStop}
                  className="min-h-[36px] inline-flex items-center gap-1 px-3.5 rounded-full border border-dashed border-[#E5E5E5] hover:border-[#171717] text-xs font-medium text-[#777777] hover:text-[#171717] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('Ajouter un arrêt', 'Add stop')}</span>
                </button>
              </div>

              {/* Recipient Form */}
              <div className="rounded-3xl border border-[#E5E5E5] p-5 space-y-3 bg-white">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#171717]">
                    {t(`Destinataire #${safeStopIdx + 1}`, `Recipient #${safeStopIdx + 1}`)}
                  </span>
                  {draft.stops.length > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={safeStopIdx === 0}
                        onClick={() => moveStop(safeStopIdx, -1)}
                        aria-label={t('Monter cet arrêt', 'Move stop up')}
                        className="p-1.5 rounded-lg hover:bg-[#F3F3F3] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={safeStopIdx === draft.stops.length - 1}
                        onClick={() => moveStop(safeStopIdx, 1)}
                        aria-label={t('Descendre cet arrêt', 'Move stop down')}
                        className="p-1.5 rounded-lg hover:bg-[#F3F3F3] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStop(safeStopIdx)}
                        aria-label={t('Supprimer cet arrêt', 'Remove stop')}
                        className="p-1.5 rounded-lg text-[#E52B32] hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={currentStop.recipientName}
                    onChange={(e) => updateStop(safeStopIdx, { recipientName: e.target.value })}
                    placeholder={t('Nom du destinataire', 'Recipient name')}
                    className={inputClass}
                  />
                  <input
                    type="tel"
                    value={currentStop.recipientPhone}
                    onChange={(e) => updateStop(safeStopIdx, { recipientPhone: e.target.value })}
                    placeholder={t('Téléphone du destinataire', 'Recipient phone')}
                    className={inputClass}
                  />
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={currentStop.instructions}
                      onChange={(e) => updateStop(safeStopIdx, { instructions: e.target.value })}
                      placeholder={t(
                        'Instructions pour le livreur (code porte, étage...)',
                        'Delivery instructions (gate code, floor...)'
                      )}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {recipients.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-[#777777]">
                    {t('Remplir depuis vos adresses enregistrées', 'Fill from saved addresses')}
                  </p>
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    {recipients.map((rec) => (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() =>
                          updateStop(safeStopIdx, {
                            recipientName: rec.name,
                            recipientPhone: rec.phone,
                            address: rec.address,
                            landmark: rec.landmark || '',
                            instructions: rec.instructions || '',
                            lat: rec.lat,
                            lng: rec.lng,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#E5E5E5] bg-white hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5 text-[#777777]" />
                        <span>{rec.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 3 — VEHICLE SELECTION (Lalamove Scannable Rows)           */}
          {/* ============================================================== */}
          {draft.step === 3 && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-[#171717]">
                    {t('Choisissez votre véhicule', 'Choose a vehicle')}
                  </h3>
                  <p className="text-xs text-[#777777] mt-0.5">
                    {t(
                      'Capacité et tarif estimé pour votre trajet.',
                      'Cargo capacity and estimated rate for your route.'
                    )}
                  </p>
                </div>
                {routeDistanceKm > 0 && (
                  <span className="font-mono text-xs text-[#777777] tabular-nums shrink-0">
                    {routeDistanceKm.toFixed(1)} km
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {VEHICLE_CATALOG.map((v) => {
                  const selected = draft.vehicleCategory === v.id;
                  const availableCount = onlineDrivers.filter((d) => d.vehicleCategory === v.id).length;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, vehicleCategory: v.id }))}
                      className={`w-full text-left px-4 py-3.5 rounded-3xl border transition-all cursor-pointer flex items-center justify-between gap-3.5 ${
                        selected
                          ? 'border-[#E52B32] bg-[#FEF2F2]/40 ring-1 ring-[#E52B32]/20'
                          : 'border-[#E5E5E5] bg-white hover:border-[#171717]/40'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-12 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                            selected ? 'bg-white border border-[#E52B32]/25' : 'bg-[#F3F3F3]'
                          }`}
                        >
                          <VehicleIllustration category={v.id} className="w-10 h-7 text-[#171717]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-display text-sm font-bold text-[#171717] truncate">
                            {lang === 'fr' ? v.labelFr : v.label}
                          </p>
                          <p className="text-xs text-[#777777] truncate mt-0.5">
                            {lang === 'fr' ? v.summaryFr : v.summary}
                          </p>
                          <p className="text-[11px] text-[#777777] mt-1 font-mono tabular-nums">
                            ≤ {v.maxWeightKg} kg ·{' '}
                            {availableCount > 0
                              ? t(`${availableCount} en ligne`, `${availableCount} online`)
                              : t('Affectation auto', 'Auto dispatch')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono text-sm font-bold text-[#171717] tabular-nums">
                          {estimateVehiclePrice(v.id)}
                        </span>
                        <span
                          className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                            selected
                              ? 'border-[#E52B32] bg-[#E52B32] text-white'
                              : 'border-[#E5E5E5] bg-white'
                          }`}
                        >
                          {selected && <Check className="w-3 h-3 stroke-[2.5]" />}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 4 — PACKAGE DETAILS & TIMING                              */}
          {/* ============================================================== */}
          {draft.step === 4 && (
            <div className="space-y-5">
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-[#171717]">
                  {t('Détails du colis et horaire', 'Parcel details & timing')}
                </h3>
                <p className="text-xs text-[#777777]">
                  {t(
                    'Précisez le créneau souhaité et les informations de manutention.',
                    'Specify dispatch timing and handling preferences.'
                  )}
                </p>
              </div>

              {/* Segmented Timing Control */}
              <div className="space-y-2.5">
                <label className="block text-xs font-medium text-[#171717]">
                  {t('Quand expédier ?', 'Dispatch timing')}
                </label>
                <div className="grid grid-cols-2 p-1 rounded-full bg-[#F3F3F3] gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, timingType: 'instant', scheduledFor: '' }))}
                    className={`min-h-[40px] rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      draft.timingType === 'instant'
                        ? 'bg-white text-[#171717] shadow-xs'
                        : 'text-[#777777] hover:text-[#171717]'
                    }`}
                  >
                    {t('Immédiat', 'Now (Instant)')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, timingType: 'scheduled' }))}
                    className={`min-h-[40px] rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      draft.timingType === 'scheduled'
                        ? 'bg-white text-[#171717] shadow-xs'
                        : 'text-[#777777] hover:text-[#171717]'
                    }`}
                  >
                    {t('Planifier plus tard', 'Schedule for later')}
                  </button>
                </div>
                {draft.timingType === 'scheduled' && (
                  <input
                    type="datetime-local"
                    value={draft.scheduledFor}
                    onChange={(e) => setDraft((p) => ({ ...p, scheduledFor: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </div>

              {/* Cargo Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">
                    {t('Description du colis', 'Package description')}
                  </label>
                  <input
                    type="text"
                    value={draft.packageType}
                    onChange={(e) => setDraft((p) => ({ ...p, packageType: e.target.value }))}
                    placeholder={t(
                      'Ex. Cartons vêtements, documents, matériel...',
                      'e.g. Apparel boxes, documents, hardware...'
                    )}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">
                    {t('Poids estimé (kg)', 'Estimated weight (kg)')}
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={draft.weightKg}
                    onChange={(e) => setDraft((p) => ({ ...p, weightKg: Number(e.target.value) || 1 }))}
                    className={`${inputClass} font-mono`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">
                    {t('Quantité de colis', 'Quantity')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={draft.quantity}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, quantity: Math.max(1, Number(e.target.value) || 1) }))
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              {/* Proof of Delivery & Fragile */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-[#171717] mb-1.5">
                    {t('Preuve de remise', 'Proof of delivery')}
                  </label>
                  <select
                    value={draft.proofRequired}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, proofRequired: e.target.value as ProofType }))
                    }
                    className={inputClass}
                  >
                    <option value="otp">{t('Code secret OTP (Recommandé)', 'OTP Secret Code (Recommended)')}</option>
                    <option value="signature">{t('Signature destinataire', 'Recipient signature')}</option>
                    <option value="photo">{t('Photo de remise', 'Photo confirmation')}</option>
                    <option value="recipient_confirm">{t('Confirmation directe', 'Direct confirmation')}</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-2xl border border-[#E5E5E5] bg-[#F3F3F3]/50 cursor-pointer">
                    <span className="text-sm font-medium text-[#171717]">
                      {t('Colis fragile', 'Fragile cargo')}
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.fragile}
                      onChange={(e) => setDraft((p) => ({ ...p, fragile: e.target.checked }))}
                      className="w-4 h-4 accent-[#E52B32]"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1.5">
                  {t('Notes complémentaires (optionnel)', 'Additional notes (optional)')}
                </label>
                <input
                  type="text"
                  value={draft.specialHandling}
                  onChange={(e) => setDraft((p) => ({ ...p, specialHandling: e.target.value }))}
                  placeholder={t(
                    'Manutention particulière, horaire d’ouverture...',
                    'Special handling, opening hours...'
                  )}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 5 — SUMMARY, TRANSPARENT FARE & CONTEXTUAL PAYMENT        */}
          {/* ============================================================== */}
          {draft.step === 5 && (
            <div className="space-y-5">
              {/* Clean Route Ledger */}
              <div className="rounded-3xl border border-[#E5E5E5] bg-white px-4 divide-y divide-[#E5E5E5]">
                <div className="py-3.5 flex items-start gap-3">
                  <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-[#171717] shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#777777]">{t('Collecte', 'Pickup')}</p>
                    <p className="text-sm font-semibold text-[#171717]">{draft.pickup.address}</p>
                  </div>
                </div>

                {draft.stops
                  .filter((s) => s.address.trim())
                  .map((s, idx) => (
                    <div key={s.id} className="py-3.5 flex items-start gap-3">
                      <span
                        className="mt-1.5 w-2.5 h-2.5 rounded-[2px] bg-[#E52B32] shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#777777]">
                          {draft.stops.length > 1 ? `#${idx + 1} · ` : ''}
                          {s.recipientName || t('Destination', 'Drop-off')}
                          {s.recipientPhone ? ` · ${s.recipientPhone}` : ''}
                        </p>
                        <p className="text-sm font-medium text-[#171717]">{s.address}</p>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Vehicle & Route Summary Row */}
              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
                    <VehicleIllustration category={draft.vehicleCategory} className="w-9 h-6 text-[#171717]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#171717] truncate">
                      {getVehicleLabel(draft.vehicleCategory, lang)}
                    </p>
                    <p className="text-xs text-[#777777] truncate">
                      {draft.quantity}× {draft.packageType || t('Colis', 'Parcel')} · {draft.weightKg} kg
                      {routeDistanceKm > 0 ? ` · ${routeDistanceKm.toFixed(1)} km` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, step: 3 }))}
                  className="text-xs font-semibold text-[#777777] hover:text-[#171717] shrink-0 cursor-pointer"
                >
                  {t('Modifier', 'Change')}
                </button>
              </div>

              {/* Geospatial / City-Isolation Rejection Banner */}
              {quoteError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 leading-relaxed">
                  <p className="font-semibold text-red-900">
                    {t('Zone de livraison non desservie', 'Delivery route not supported')}
                  </p>
                  <p className="mt-0.5">{quoteError}</p>
                </div>
              )}

              {/* Stripe-Clarity Fare Breakdown */}
              {!quoteError && (
                <div className="rounded-3xl bg-[#F3F3F3]/60 border border-[#E5E5E5] p-5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-[#777777]">
                    <span>{t('Détail du tarif', 'Fare breakdown')}</span>
                    {quoteMeta && (
                      <span className="font-mono text-[11px]">
                        {quoteMeta.cityName} ·{' '}
                        {quoteMeta.isFallbackEstimate
                          ? t('Estimation', 'Estimate')
                          : t('Tarif vérifié', 'Verified quote')}
                      </span>
                    )}
                  </div>

                  {quote && quote.breakdown.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {quote.breakdown.map((item, idx) => (
                        <div
                          key={`${item.label}-${idx}`}
                          className="flex items-center justify-between text-xs text-[#777777]"
                        >
                          <span>{item.label}</span>
                          <span className="font-mono tabular-nums text-[#171717]">
                            {formatLocalMoney(item.amount, quote.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2.5 border-t border-[#E5E5E5] flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-[#171717]">
                      {t('Total à régler', 'Total due')}
                    </span>
                    <span className="font-mono text-lg font-bold text-[#171717] tabular-nums">
                      {quote
                        ? formatLocalMoney(quote.total, quote.currency)
                        : estimateVehiclePrice(draft.vehicleCategory)}
                    </span>
                  </div>
                </div>
              )}

              {/* Nearby Available Driver (only when real drivers are online) */}
              {matchedDrivers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#777777]">
                    {t('Livreur disponible à proximité', 'Available courier nearby')}
                  </p>
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                    {matchedDrivers.slice(0, 3).map((m) => {
                      const picked = (draft.selectedDriverUid || matchedDrivers[0].driver.uid) === m.driver.uid;
                      return (
                        <button
                          key={m.driver.uid}
                          type="button"
                          onClick={() => setDraft((p) => ({ ...p, selectedDriverUid: m.driver.uid }))}
                          className={`px-4 py-2.5 rounded-2xl border text-left text-xs shrink-0 transition-colors cursor-pointer ${
                            picked
                              ? 'border-[#171717] bg-[#171717] text-white'
                              : 'border-[#E5E5E5] bg-white text-[#171717] hover:border-[#171717]/40'
                          }`}
                        >
                          <p className="font-semibold">{m.driver.firstName}</p>
                          <p className={`font-mono text-[11px] ${picked ? 'text-neutral-300' : 'text-[#777777]'}`}>
                            {m.distanceKm} km · ~{m.etaMinutes} min
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Stripe × Apple Contextual Payment Method Selector Trigger */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#777777]">Payment Method</p>
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(true)}
                  className="w-full min-h-[60px] px-4 py-3 rounded-3xl border border-[#E5E5E5] hover:border-[#171717] bg-white flex items-center justify-between gap-3 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#F3F3F3] text-[#171717] flex items-center justify-center shrink-0">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#171717] truncate">
                        {getPaymentMethodLabelEn(draft.paymentMethod)}
                      </p>
                      <p className="text-xs text-[#777777] truncate">
                        {selectedPaymentMeta?.subtitle || 'Verified electronic settlement'}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#E52B32] shrink-0">
                    <span>{t('Changer', 'Change')}</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Contextual Payment Method Bottom Sheet / Modal */}
      <PaymentMethodModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        elevated
        selected={draft.paymentMethod}
        onSelect={(method: PaymentMethod) => setDraft((p) => ({ ...p, paymentMethod: method }))}
        title="Payment Method"
        subtitle={t(
          'Méthode utilisée pour régler cette livraison.',
          'Settlement method for this delivery.'
        )}
      />
    </>
  );
}
