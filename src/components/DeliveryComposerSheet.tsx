import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Check,
  Loader2,
  MapPin,
  Plus,
  Route,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { MapMarkerItem, RovaMap } from './RovaMap';
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
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);
  const [routeDurationMin, setRouteDurationMin] = useState(0);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const safeStopIdx = Math.min(activeStopIdx, Math.max(0, draft.stops.length - 1));
  const currentStop = draft.stops[safeStopIdx] || draft.stops[0];

  // Fetch real road route from /api/geo/route whenever pickup or stops change
  useEffect(() => {
    if (!composerOpen) return;
    const validStops = draft.stops.filter((s) => s.address.trim().length > 0);
    if (!draft.pickup.address.trim() || validStops.length === 0) {
      setRouteCoords([]);
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
        if (Array.isArray(data.geometry) && data.geometry.length >= 2) {
          setRouteCoords(data.geometry);
        } else {
          setRouteCoords(points.map((p) => [p.lat, p.lng]));
        }
        setRouteDistanceKm(Number(data.distanceKm) || 0);
        setRouteDurationMin(Number(data.durationMin) || 0);
      })
      .catch(() => {
        if (cancelled) return;
        let km = 0;
        for (let i = 0; i < points.length - 1; i++) {
          km += haversineDistanceKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
        }
        setRouteCoords(points.map((p) => [p.lat, p.lng]));
        setRouteDistanceKm(Number(km.toFixed(2)));
        setRouteDurationMin(Math.max(8, Math.round(km * 3)));
      });

    return () => {
      cancelled = true;
    };
  }, [composerOpen, draft.pickup.address, draft.pickup.lat, draft.pickup.lng, draft.stops]);

  // Live dynamic quote from /api/pricing/quote
  useEffect(() => {
    if (!composerOpen) return;
    const rule = getEffectivePricingRule(pricingRules, draft.vehicleCategory);
    const validStopsCount = Math.max(1, draft.stops.filter((s) => s.address.trim()).length);
    const dist = Math.max(1, routeDistanceKm || 4);

    let cancelled = false;
    fetch('/api/pricing/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicleCategory: draft.vehicleCategory,
        distanceKm: dist,
        stopCount: validStopsCount,
        timingType: draft.timingType,
        weightKg: draft.weightKg,
        fragile: draft.fragile,
        rule,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && typeof data.total === 'number') {
          setQuote(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const fallbackTotal = Math.max(
            rule.minimumFare,
            rule.baseFee + dist * rule.perKmRate + Math.max(0, validStopsCount - 1) * rule.multiStopFee
          );
          setQuote({
            currency: rule.currency || 'GHS',
            total: Number(fallbackTotal.toFixed(2)),
            breakdown: [{ label: t('Tarif estimé', 'Estimated fare'), amount: Number(fallbackTotal.toFixed(2)) }],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    composerOpen,
    pricingRules,
    draft.vehicleCategory,
    draft.stops,
    draft.timingType,
    draft.weightKg,
    draft.fragile,
    routeDistanceKm,
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

  const mapMarkers: MapMarkerItem[] = useMemo(() => {
    const m: MapMarkerItem[] = [];
    if (draft.step === 1) {
      m.push({
        id: 'pickup',
        lat: draft.pickup.lat,
        lng: draft.pickup.lng,
        kind: 'pickup',
        label: draft.pickup.address || t('Point de collecte', 'Pickup point'),
        draggable: true,
      });
    } else {
      m.push({
        id: 'pickup',
        lat: draft.pickup.lat,
        lng: draft.pickup.lng,
        kind: 'pickup',
        label: draft.pickup.address || t('Collecte', 'Pickup'),
      });
      draft.stops.forEach((s, idx) => {
        if (!s.address.trim() && idx !== safeStopIdx) return;
        m.push({
          id: s.id,
          lat: s.lat,
          lng: s.lng,
          kind: 'stop',
          sequence: idx + 1,
          label: s.recipientName || s.address || `${t('Arrêt', 'Stop')} #${idx + 1}`,
          draggable: draft.step === 2 && idx === safeStopIdx,
        });
      });
    }
    return m;
  }, [draft.step, draft.pickup, draft.stops, safeStopIdx, t]);

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
          recipientPhone: phone || '+225 07 00 00 00 00',
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

  const steps: Array<{ id: 1 | 2 | 3 | 4 | 5; label: string }> = [
    { id: 1, label: t('Collecte', 'Pickup') },
    { id: 2, label: t('Lieu de livraison', 'Delivery location') },
    { id: 3, label: t('Véhicule', 'Vehicle') },
    { id: 4, label: t('Détails', 'Details') },
    { id: 5, label: t('Confirmation', 'Confirm') },
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

  const sheetTitle =
    draft.mode === 'multi'
      ? t('Tournée multi-arrêts', 'Multi-stop delivery')
      : draft.mode === 'scheduled'
      ? t('Livraison planifiée', 'Scheduled delivery')
      : t('Nouvelle livraison', 'New delivery');

  return (
    <BottomSheet
      open={composerOpen}
      onClose={closeComposer}
      size="lg"
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
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-full border border-neutral-200 text-sm font-medium text-neutral-800 hover:border-neutral-950 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('Retour', 'Back')}
            </button>
          ) : (
            <div className="text-xs text-neutral-500">
              {routeDistanceKm > 0 && (
                <span className="font-mono tabular-nums">
                  {routeDistanceKm.toFixed(1)} km · ~{routeDurationMin} min
                </span>
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
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>{t('Continuer', 'Continue')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !draft.pickup.address.trim() || validStopsCount === 0}
              onClick={() =>
                submitDelivery(
                  routeDistanceKm,
                  routeDurationMin,
                  quote?.total ?? getEffectivePricingRule(pricingRules, draft.vehicleCategory).minimumFare
                )
              }
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
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
      <div className="space-y-5">
        {/* Compact Interactive Progress Stepper */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {steps.map((s) => {
            const active = draft.step === s.id;
            const completed = draft.step > s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (s.id <= draft.step || (s.id === 2 && draft.pickup.address.trim())) {
                    setDraft((p) => ({ ...p, step: s.id }));
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-neutral-950 text-white'
                    : completed
                    ? 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200'
                    : 'text-neutral-400'
                }`}
              >
                <span className="font-mono text-[11px]">{s.id}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* ============================================================== */}
        {/* STEP 1 — PICKUP LOCATION (Map-First)                           */}
        {/* ============================================================== */}
        {draft.step === 1 && (
          <div className="space-y-4">
            <RovaMap
              center={[draft.pickup.lat, draft.pickup.lng]}
              markers={mapMarkers}
              interactivePick
              showSearchBar
              initialSearchText={draft.pickup.address}
              searchPlaceholder={t(
                'Rechercher l’adresse ou le lieu de collecte...',
                'Search pickup street, business, or landmark...'
              )}
              heightClass="h-[240px] sm:h-[280px]"
              onLocationSelected={(place) => {
                setDraft((p) => ({
                  ...p,
                  pickup: {
                    ...p.pickup,
                    address: place.shortName || place.displayName,
                    landmark: place.landmark || p.pickup.landmark,
                    lat: place.lat,
                    lng: place.lng,
                  },
                }));
              }}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Adresse de collecte', 'Pickup address')}
                </label>
                <input
                  type="text"
                  value={draft.pickup.address}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, pickup: { ...p.pickup, address: e.target.value } }))
                  }
                  placeholder={t('Ex. Boutique Plateau, Rue du Commerce', 'e.g. Downtown Store, Main St')}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Point de repère (optionnel)', 'Landmark (optional)')}
                </label>
                <input
                  type="text"
                  value={draft.pickup.landmark}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, pickup: { ...p.pickup, landmark: e.target.value } }))
                  }
                  placeholder={t('Face à la pharmacie, portail noir...', 'Opposite pharmacy, black gate...')}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Instructions de collecte', 'Pickup instructions')}
                </label>
                <input
                  type="text"
                  value={draft.pickup.instructions}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, pickup: { ...p.pickup, instructions: e.target.value } }))
                  }
                  placeholder={t('Demander le comptoir expédition...', 'Ask for dispatch desk...')}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
              </div>
            </div>

            {recipients.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-neutral-500">
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-neutral-200 bg-neutral-50 hover:border-neutral-950 text-xs text-neutral-800 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      <Bookmark className="w-3 h-3 text-neutral-500" />
                      <span>{rec.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 2 — DESTINATION(S) & MULTI-STOP MANAGEMENT                */}
        {/* ============================================================== */}
        {draft.step === 2 && currentStop && (
          <div className="space-y-4">
            <RovaMap
              center={[currentStop.lat, currentStop.lng]}
              markers={mapMarkers}
              routeCoordinates={routeCoords}
              interactivePick
              showSearchBar
              initialSearchText={currentStop.address}
              searchPlaceholder={t(
                `Rechercher le lieu de livraison #${safeStopIdx + 1}...`,
                `Search delivery location #${safeStopIdx + 1}...`
              )}
              heightClass="h-[220px] sm:h-[260px]"
              onLocationSelected={(place) => {
                updateStop(safeStopIdx, {
                  address: place.shortName || place.displayName,
                  landmark: place.landmark || currentStop.landmark,
                  lat: place.lat,
                  lng: place.lng,
                });
              }}
            />

            {/* Stop Selector Strip + Multi-Stop Controls */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {draft.stops.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveStopIdx(idx)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      idx === safeStopIdx
                        ? 'bg-neutral-950 text-white'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    <span className="font-mono">#{idx + 1}</span>
                    <span className="max-w-[90px] truncate">
                      {s.recipientName || s.address || t('Arrêt', 'Stop')}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addStop}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-neutral-300 hover:border-neutral-950 text-xs font-medium text-neutral-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('Ajouter un arrêt', 'Add stop')}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {draft.stops.length > 1 && (
                  <button
                    type="button"
                    disabled={optimizing}
                    onClick={handleOptimizeRoute}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-800 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {optimizing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Route className="w-3.5 h-3.5" />
                    )}
                    {t('Optimiser', 'Optimize')}
                  </button>
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-700 cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  <span>CSV</span>
                  <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                </label>
              </div>
            </div>

            {/* Active Stop Editor */}
            <div className="rounded-2xl border border-neutral-200 p-4 space-y-3 bg-neutral-50/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-900">
                  {t(`Lieu de livraison #${safeStopIdx + 1}`, `Delivery location #${safeStopIdx + 1}`)}
                </span>
                {draft.stops.length > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={safeStopIdx === 0}
                      onClick={() => moveStop(safeStopIdx, -1)}
                      aria-label={t('Monter cet arrêt', 'Move stop up')}
                      className="p-1.5 rounded-full hover:bg-neutral-200 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={safeStopIdx === draft.stops.length - 1}
                      onClick={() => moveStop(safeStopIdx, 1)}
                      aria-label={t('Descendre cet arrêt', 'Move stop down')}
                      className="p-1.5 rounded-full hover:bg-neutral-200 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStop(safeStopIdx)}
                      aria-label={t('Supprimer cet arrêt', 'Remove stop')}
                      className="p-1.5 rounded-full text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={currentStop.address}
                    onChange={(e) => updateStop(safeStopIdx, { address: e.target.value })}
                    placeholder={t('Adresse de livraison *', 'Delivery address *')}
                    className="w-full rounded-xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                  />
                </div>
                <input
                  type="text"
                  value={currentStop.recipientName}
                  onChange={(e) => updateStop(safeStopIdx, { recipientName: e.target.value })}
                  placeholder={t('Nom du destinataire', 'Recipient name')}
                  className="w-full rounded-xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
                <input
                  type="tel"
                  value={currentStop.recipientPhone}
                  onChange={(e) => updateStop(safeStopIdx, { recipientPhone: e.target.value })}
                  placeholder={t('Téléphone du destinataire', 'Recipient phone')}
                  className="w-full rounded-xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={currentStop.instructions}
                    onChange={(e) => updateStop(safeStopIdx, { instructions: e.target.value })}
                    placeholder={t('Instructions pour le livreur (code porte, étage...)', 'Delivery instructions (gate code, floor...)')}
                    className="w-full rounded-xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                  />
                </div>
              </div>
            </div>

            {/* Quick pick from Saved Addresses */}
            {recipients.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-neutral-500">
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-neutral-200 bg-white hover:border-neutral-950 text-xs text-neutral-800 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      <MapPin className="w-3 h-3 text-neutral-500" />
                      <span>{rec.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 3 — VISUAL VEHICLE SELECTION                              */}
        {/* ============================================================== */}
        {draft.step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-neutral-500">
              {t(
                'Choisissez le véhicule adapté à votre chargement. Le tarif s’actualise instantanément.',
                'Choose the right vehicle for your cargo. Pricing updates immediately.'
              )}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {VEHICLE_CATALOG.map((v) => {
                const selected = draft.vehicleCategory === v.id;
                const availableCount = onlineDrivers.filter((d) => d.vehicleCategory === v.id).length;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, vehicleCategory: v.id }))}
                    className={`text-left p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                      selected
                        ? 'border-neutral-950 bg-neutral-950 text-white shadow-md'
                        : 'border-neutral-200 bg-white hover:border-neutral-400 text-neutral-950'
                    }`}
                  >
                    <div
                      className={`w-14 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                        selected ? 'bg-white/10 text-white' : 'bg-neutral-100 text-neutral-900'
                      }`}
                    >
                      <VehicleIllustration category={v.id} className="w-11 h-8" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-display text-sm font-bold truncate">
                          {lang === 'fr' ? v.labelFr : v.label}
                        </h3>
                        <span className="font-mono text-xs font-semibold tabular-nums shrink-0">
                          {estimateVehiclePrice(v.id)}
                        </span>
                      </div>
                      <p
                        className={`text-xs mt-1 line-clamp-2 ${
                          selected ? 'text-neutral-300' : 'text-neutral-500'
                        }`}
                      >
                        {lang === 'fr' ? v.summaryFr : v.summary}
                      </p>
                      <div
                        className={`flex items-center gap-2 text-[11px] mt-2 ${
                          selected ? 'text-neutral-300' : 'text-neutral-500'
                        }`}
                      >
                        <span className="font-mono">≤ {v.maxWeightKg} kg</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {availableCount > 0
                            ? t(`${availableCount} en ligne`, `${availableCount} online`)
                            : t('Dispatch sur demande', 'On-demand dispatch')}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 4 — DELIVERY DETAILS & TIMING (Conditional, Concise)      */}
        {/* ============================================================== */}
        {draft.step === 4 && (
          <div className="space-y-4">
            {/* Timing Toggle */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-neutral-700">
                {t('Quand souhaitez-vous expédier ?', 'When should this delivery run?')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, timingType: 'instant', scheduledFor: '' }))}
                  className={`py-2.5 px-4 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                    draft.timingType === 'instant'
                      ? 'bg-neutral-950 text-white border-neutral-950'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
                  }`}
                >
                  {t('Immédiat', 'Now (Instant)')}
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, timingType: 'scheduled' }))}
                  className={`py-2.5 px-4 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                    draft.timingType === 'scheduled'
                      ? 'bg-neutral-950 text-white border-neutral-950'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
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
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
              )}
            </div>

            {/* Cargo Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Description du colis', 'Package description')}
                </label>
                <input
                  type="text"
                  value={draft.packageType}
                  onChange={(e) => setDraft((p) => ({ ...p, packageType: e.target.value }))}
                  placeholder={t('Ex. Cartons vêtements, documents, matériel...', 'e.g. Apparel boxes, documents, hardware...')}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Poids estimé (kg)', 'Estimated weight (kg)')}
                </label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={draft.weightKg}
                  onChange={(e) => setDraft((p) => ({ ...p, weightKg: Number(e.target.value) || 1 }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Quantité de colis', 'Quantity')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={draft.quantity}
                  onChange={(e) => setDraft((p) => ({ ...p, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-neutral-950"
                />
              </div>
            </div>

            {/* Proof of Delivery & Fragile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Preuve de remise', 'Proof of delivery')}
                </label>
                <select
                  value={draft.proofRequired}
                  onChange={(e) => setDraft((p) => ({ ...p, proofRequired: e.target.value as ProofType }))}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                >
                  <option value="otp">{t('Code secret OTP (Recommandé)', 'OTP Secret Code (Recommended)')}</option>
                  <option value="signature">{t('Signature destinataire', 'Recipient signature')}</option>
                  <option value="photo">{t('Photo de remise', 'Photo confirmation')}</option>
                  <option value="recipient_confirm">{t('Confirmation directe', 'Direct confirmation')}</option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 cursor-pointer">
                  <span className="text-sm font-medium text-neutral-800">
                    {t('Colis fragile', 'Fragile cargo')}
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.fragile}
                    onChange={(e) => setDraft((p) => ({ ...p, fragile: e.target.checked }))}
                    className="w-4 h-4 accent-neutral-950"
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                {t('Notes complémentaires (optionnel)', 'Additional notes (optional)')}
              </label>
              <input
                type="text"
                value={draft.specialHandling}
                onChange={(e) => setDraft((p) => ({ ...p, specialHandling: e.target.value }))}
                placeholder={t('Manutention particulière, horaire d’ouverture...', 'Special handling, opening hours...')}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 5 — SUMMARY, PAYMENT METHOD (ENGLISH) & CONFIRMATION      */}
        {/* ============================================================== */}
        {draft.step === 5 && (
          <div className="space-y-4">
            {/* Route & Vehicle Summary */}
            <div className="rounded-2xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-neutral-950 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                  P
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-neutral-500">{t('Collecte', 'Pickup')}</p>
                  <p className="text-sm font-semibold text-neutral-950">{draft.pickup.address}</p>
                </div>
              </div>

              {draft.stops
                .filter((s) => s.address.trim())
                .map((s, idx) => (
                  <div key={s.id} className="p-4 flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full border-2 border-neutral-950 text-neutral-950 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-neutral-500">
                        {s.recipientName || t('Lieu de livraison', 'Delivery location')}
                        {s.recipientPhone ? ` · ${s.recipientPhone}` : ''}
                      </p>
                      <p className="text-sm font-medium text-neutral-950">{s.address}</p>
                    </div>
                  </div>
                ))}

              <div className="p-4 bg-neutral-50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <VehicleIllustration category={draft.vehicleCategory} className="w-10 h-7 text-neutral-900" />
                  <div>
                    <p className="text-sm font-semibold text-neutral-950">
                      {getVehicleLabel(draft.vehicleCategory, lang)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {draft.quantity}x {draft.packageType || t('Colis', 'Parcel')} · {draft.weightKg} kg
                      {routeDistanceKm > 0 ? ` · ${routeDistanceKm.toFixed(1)} km` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-base font-bold text-neutral-950 tabular-nums">
                    {quote
                      ? formatLocalMoney(quote.total, quote.currency)
                      : estimateVehiclePrice(draft.vehicleCategory)}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {matchedDrivers.length > 0
                      ? t(`~${matchedDrivers[0].etaMinutes} min d’approche`, `~${matchedDrivers[0].etaMinutes} min ETA`)
                      : t('Affectation auto', 'Auto dispatch')}
                  </p>
                </div>
              </div>
            </div>

            {/* Matched Driver Preview (if any live online driver matches) */}
            {matchedDrivers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-neutral-600 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('Livreur disponible à proximité', 'Nearby available driver')}
                </p>
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {matchedDrivers.slice(0, 3).map((m) => {
                    const picked = (draft.selectedDriverUid || matchedDrivers[0].driver.uid) === m.driver.uid;
                    return (
                      <button
                        key={m.driver.uid}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, selectedDriverUid: m.driver.uid }))}
                        className={`px-3.5 py-2 rounded-xl border text-left text-xs shrink-0 transition-colors cursor-pointer ${
                          picked
                            ? 'border-neutral-950 bg-neutral-950 text-white'
                            : 'border-neutral-200 bg-white text-neutral-800'
                        }`}
                      >
                        <p className="font-semibold">{m.driver.firstName}</p>
                        <p className={picked ? 'text-neutral-300' : 'text-neutral-500'}>
                          {m.distanceKm} km · {m.etaMinutes} min
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Payment Methods — Strictly in English */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-700">Payment Method</label>
                <span className="text-xs text-neutral-500">
                  {getPaymentMethodLabelEn(draft.paymentMethod)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PAYMENT_METHODS_EN.map((pm) => {
                  const active = draft.paymentMethod === pm.id;
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, paymentMethod: pm.id as PaymentMethod }))}
                      className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-neutral-950 bg-neutral-950 text-white'
                          : 'border-neutral-200 bg-white hover:border-neutral-400 text-neutral-900'
                      }`}
                    >
                      <p className="text-xs font-semibold">{pm.label}</p>
                      <p className={`text-[11px] mt-0.5 ${active ? 'text-neutral-300' : 'text-neutral-500'}`}>
                        {pm.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

type DeliveryDraftStep = 1 | 2 | 3 | 4 | 5;
