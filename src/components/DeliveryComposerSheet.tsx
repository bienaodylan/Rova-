import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Loader2,
  MapPin,
  Package,
  Plus,
  Route,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { LocationSearchField } from './LocationSearchField';
import { PaymentMethodModal } from './PaymentMethodModal';
import { MapMarkerItem, RovaMap } from './RovaMap';
import { VehicleStudioImage } from './VehicleIllustration';
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
import { GeoPlace, PaymentMethod, ProofType, QuoteResult } from '../types/rova';

type MapTarget = 'pickup' | 'stop';

function normalizeRouteCoords(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [number, number][] = [];
  for (const pt of raw) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const a = Number(pt[0]);
      const b = Number(pt[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        out.push([a, b]);
      }
    } else if (pt && typeof pt === 'object' && 'lat' in pt && 'lng' in pt) {
      const a = Number((pt as { lat: unknown }).lat);
      const b = Number((pt as { lng: unknown }).lng);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        out.push([a, b]);
      }
    }
  }
  return out;
}

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
  const [activeMapTarget, setActiveMapTarget] = useState<MapTarget>('stop');
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);
  const [routeDurationMin, setRouteDurationMin] = useState(0);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
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
  const [showExtraParcelOptions, setShowExtraParcelOptions] = useState(false);

  const safeStopIdx = Math.min(activeStopIdx, Math.max(0, draft.stops.length - 1));
  const currentStop = draft.stops[safeStopIdx] || draft.stops[0];
  const isConfirmStage = draft.step === 5;

  // Reset active target sensibly whenever the composer opens
  useEffect(() => {
    if (!composerOpen) return;
    setActiveStopIdx(0);
    setActiveMapTarget(draft.pickup.address.trim() ? 'stop' : 'pickup');
    setShowExtraParcelOptions(false);
  }, [composerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch real road route & polyline from /api/geo/route whenever pickup or stops change
  useEffect(() => {
    if (!composerOpen) return;
    const validStops = draft.stops.filter((s) => s.address.trim().length > 0);
    if (!draft.pickup.address.trim() || validStops.length === 0) {
      setRouteDistanceKm(0);
      setRouteDurationMin(0);
      setRouteCoords([]);
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
        const poly = normalizeRouteCoords(data.geometry || data.coordinates);
        setRouteCoords(
          poly.length >= 2
            ? poly
            : points.map((p) => [p.lat, p.lng] as [number, number])
        );
      })
      .catch(() => {
        if (cancelled) return;
        let km = 0;
        for (let i = 0; i < points.length - 1; i++) {
          km += haversineDistanceKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
        }
        setRouteDistanceKm(Number(km.toFixed(2)));
        setRouteDurationMin(Math.max(8, Math.round(km * 3)));
        setRouteCoords(points.map((p) => [p.lat, p.lng] as [number, number]));
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
      setQuote(null);
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
              ? data.quote.breakdown.map(
                  (b: { labelFr?: string; labelEn?: string; label?: string; amount: number }) => ({
                    label: lang === 'fr' ? b.labelFr || b.label || '' : b.labelEn || b.label || '',
                    amount: b.amount,
                  })
                )
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
  ]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Live markers rendered on RovaMap (pickup, valid stops, nearby online drivers)
  const mapMarkers = useMemo<MapMarkerItem[]>(() => {
    const items: MapMarkerItem[] = [];
    if (Number.isFinite(draft.pickup.lat) && Number.isFinite(draft.pickup.lng)) {
      items.push({
        id: 'composer-pickup',
        lat: draft.pickup.lat,
        lng: draft.pickup.lng,
        label: draft.pickup.address || t('Point de collecte', 'Pickup point'),
        kind: 'pickup',
      });
    }
    draft.stops.forEach((s, idx) => {
      if (s.address.trim() && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
        items.push({
          id: `composer-stop-${s.id}`,
          lat: s.lat,
          lng: s.lng,
          label: s.address,
          kind: 'stop',
          sequence: idx + 1,
          meta: s.recipientName || undefined,
        });
      }
    });
    matchedDrivers.slice(0, 5).forEach((m) => {
      const lat = m.driver.currentLat;
      const lng = m.driver.currentLng;
      if (typeof lat === 'number' && typeof lng === 'number') {
        items.push({
          id: `composer-driver-${m.driver.uid}`,
          lat,
          lng,
          label: `${m.driver.firstName} · ~${m.etaMinutes} min`,
          kind: 'driver',
        });
      }
    });
    return items;
  }, [draft.pickup.address, draft.pickup.lat, draft.pickup.lng, draft.stops, matchedDrivers, t]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (activeMapTarget === 'stop' && currentStop && currentStop.address.trim()) {
      return [currentStop.lat, currentStop.lng];
    }
    return [draft.pickup.lat, draft.pickup.lng];
  }, [activeMapTarget, currentStop, draft.pickup.lat, draft.pickup.lng]);

  const updateStop = (idx: number, patch: Partial<DraftStop>) => {
    setDraft((prev) => {
      const nextStops = [...prev.stops];
      if (!nextStops[idx]) return prev;
      nextStops[idx] = { ...nextStops[idx], ...patch };
      return { ...prev, stops: nextStops };
    });
  };

  const handleMapLocationPick = (place: GeoPlace) => {
    const label = place.shortName || place.displayName;
    if (activeMapTarget === 'pickup') {
      setDraft((p) => ({
        ...p,
        pickup: {
          ...p.pickup,
          address: label,
          landmark: place.landmark || p.pickup.landmark,
          lat: place.lat,
          lng: place.lng,
        },
      }));
      // Smooth inDrive flow: automatically advance tap target to destination
      setActiveMapTarget('stop');
    } else if (currentStop) {
      updateStop(safeStopIdx, {
        address: label,
        landmark: place.landmark || currentStop.landmark,
        lat: place.lat,
        lng: place.lng,
      });
    }
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
    setActiveMapTarget('stop');
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

  const validStopsCount = draft.stops.filter((s) => s.address.trim().length > 0).length;
  const canContinueToConfirm = draft.pickup.address.trim().length > 0 && validStopsCount > 0;

  const estimateVehiclePrice = (category: typeof draft.vehicleCategory) => {
    const rule = getEffectivePricingRule(pricingRules, category);
    const dist = Math.max(1, routeDistanceKm || 4);
    const total = Math.max(
      rule.minimumFare,
      rule.baseFee + dist * rule.perKmRate + Math.max(0, validStopsCount - 1) * rule.multiStopFee
    );
    return formatLocalMoney(Number(total.toFixed(2)), rule.currency || 'XOF');
  };

  const displayedPrice = quote
    ? formatLocalMoney(quote.total, quote.currency)
    : estimateVehiclePrice(draft.vehicleCategory);

  const selectedPaymentMeta = PAYMENT_METHODS_EN.find((pm) => pm.id === draft.paymentMethod);

  const sheetTitle =
    draft.mode === 'multi'
      ? t('Rovia Tournée', 'Rovia Multi-Stop')
      : draft.mode === 'scheduled'
      ? t('Livraison planifiée', 'Scheduled delivery')
      : getVehicleLabel(draft.vehicleCategory, lang);

  const sheetSubtitle = isConfirmStage
    ? t('Étape 2 / 2 · Destinataire, paiement et confirmation', 'Step 2 / 2 · Recipient, payment & confirmation')
    : t('Étape 1 / 2 · Itinéraire sur carte et choix du véhicule', 'Step 1 / 2 · Route on map & vehicle selection');

  const inputClass =
    'w-full rounded-2xl bg-white border border-[#E5E5E5] px-4 py-2.5 text-base sm:text-sm text-[#171717] placeholder:text-[#777777] focus:outline-none focus:border-[#171717] transition-colors';

  return (
    <>
      <BottomSheet
        open={composerOpen}
        onClose={closeComposer}
        size="full"
        scrollable={true}
        title={sheetTitle}
        subtitle={sheetSubtitle}
        headerExtra={
          <div className="hidden sm:flex items-center gap-1.5" aria-hidden="true">
            <span className={`h-1.5 w-8 rounded-full transition-colors ${!isConfirmStage ? 'bg-[#E52B32]' : 'bg-[#171717]'}`} />
            <span className={`h-1.5 w-8 rounded-full transition-colors ${isConfirmStage ? 'bg-[#E52B32]' : 'bg-[#E5E5E5]'}`} />
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            {isConfirmStage ? (
              <button
                type="button"
                onClick={() => setDraft((p) => ({ ...p, step: 1 }))}
                className="min-h-[48px] inline-flex items-center gap-1.5 px-4 sm:px-5 rounded-full border border-[#E5E5E5] bg-white text-sm font-semibold text-[#171717] hover:border-[#171717] hover:bg-[#F3F3F3]/60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('Modifier', 'Edit')}</span>
              </button>
            ) : (
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-[#777777] truncate">
                  {routeDistanceKm > 0
                    ? `${routeDistanceKm.toFixed(1)} km · ~${routeDurationMin} min`
                    : t('Tarif estimé', 'Estimated fare')}
                </p>
                <p className="font-mono text-base sm:text-lg font-bold text-[#171717] tabular-nums leading-tight">
                  {displayedPrice}
                </p>
              </div>
            )}

            {!isConfirmStage ? (
              <button
                type="button"
                disabled={!canContinueToConfirm}
                onClick={() => setDraft((p) => ({ ...p, step: 5 }))}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 px-6 sm:px-7 rounded-full bg-[#E52B32] text-white text-sm font-semibold hover:bg-[#CC2229] disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap shadow-[0_6px_18px_rgba(229,43,50,0.22)]"
              >
                <span>{t('Continuer', 'Continue')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || Boolean(quoteError) || !canContinueToConfirm}
                onClick={() =>
                  submitDelivery(
                    routeDistanceKm,
                    routeDurationMin,
                    quote?.total ?? getEffectivePricingRule(pricingRules, draft.vehicleCategory).minimumFare
                  )
                }
                className="flex-1 sm:flex-initial min-h-[48px] inline-flex items-center justify-center gap-2 px-6 sm:px-7 rounded-full bg-[#E52B32] text-white text-sm font-semibold hover:bg-[#CC2229] disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap shadow-[0_6px_18px_rgba(229,43,50,0.24)]"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>
                  {busy
                    ? t('Confirmation...', 'Confirming...')
                    : `${t('Confirmer', 'Confirm')} · ${displayedPrice}`}
                </span>
              </button>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
          {/* ================================================================ */}
          {/* INTERACTIVE LIVE MAP (inDrive-style immediate spatial context)   */}
          {/* ================================================================ */}
          <div className="lg:col-span-6 lg:sticky lg:top-0 space-y-2.5">
            <div className="relative rounded-[24px] overflow-hidden border border-[#E5E5E5] bg-[#F3F3F3]">
              <RovaMap
                center={mapCenter}
                zoom={routeCoords.length >= 2 ? 12 : 14}
                markers={mapMarkers}
                routeCoordinates={routeCoords}
                interactivePick={!isConfirmStage}
                onLocationSelected={!isConfirmStage ? handleMapLocationPick : undefined}
                heightClass="h-[210px] sm:h-[245px] lg:h-[520px]"
              />

              {/* Top-left floating tap-target selector (Stage 1 only) */}
              {!isConfirmStage && (
                <div className="absolute top-3 left-3 z-20 flex items-center gap-1 p-1 rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E5] shadow-[0_6px_20px_rgba(23,23,23,0.12)]">
                  <button
                    type="button"
                    onClick={() => setActiveMapTarget('pickup')}
                    className={`min-h-[32px] px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeMapTarget === 'pickup'
                        ? 'bg-[#171717] text-white'
                        : 'text-[#777777] hover:text-[#171717]'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${activeMapTarget === 'pickup' ? 'bg-white' : 'bg-[#171717]'}`} />
                    <span>{t('Départ', 'Pickup')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMapTarget('stop')}
                    className={`min-h-[32px] px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeMapTarget === 'stop'
                        ? 'bg-[#E52B32] text-white'
                        : 'text-[#777777] hover:text-[#171717]'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-[2px] ${activeMapTarget === 'stop' ? 'bg-white' : 'bg-[#E52B32]'}`} />
                    <span>
                      {draft.stops.length > 1
                        ? `${t('Arrêt', 'Stop')} #${safeStopIdx + 1}`
                        : t('Destination', 'Drop-off')}
                    </span>
                  </button>
                </div>
              )}

              {/* Top-right live route distance / ETA pill */}
              {routeDistanceKm > 0 && (
                <div className="absolute top-3 right-3 z-20 px-3 py-1.5 rounded-full bg-[#171717]/90 backdrop-blur-md text-white text-[11px] font-mono font-semibold tabular-nums shadow-sm">
                  {routeDistanceKm.toFixed(1)} km · ~{routeDurationMin} min
                </div>
              )}

              {/* Bottom subtle map guidance bar */}
              {!isConfirmStage && (
                <div className="absolute bottom-3 left-3 right-3 z-20 pointer-events-none flex justify-center">
                  <span className="px-3 py-1 rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E5] text-[11px] font-medium text-[#171717] shadow-xs">
                    {activeMapTarget === 'pickup'
                      ? t('Touchez la carte pour placer le point de départ', 'Tap the map to pin pickup')
                      : t('Touchez la carte pour placer la destination', 'Tap the map to pin destination')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ================================================================ */}
          {/* RIGHT / BOTTOM PANEL — STAGE 1 OR STAGE 2                        */}
          {/* ================================================================ */}
          <div className="lg:col-span-6 space-y-5">
            {/* ============================================================== */}
            {/* STAGE 1 — ITINÉRAIRE A → B + CHOIX DU VÉHICULE                 */}
            {/* ============================================================== */}
            {!isConfirmStage && currentStop && (
              <>
                {/* Connected A → B Address Card (Yango × inDrive clarity) */}
                <div className="rounded-[26px] border border-[#E5E5E5] bg-[#FAFAFA] p-4 space-y-3.5">
                  {/* Pickup Input */}
                  <div
                    onFocusCapture={() => setActiveMapTarget('pickup')}
                    onClick={() => setActiveMapTarget('pickup')}
                    className="flex items-start gap-3"
                  >
                    <div className="flex flex-col items-center pt-3.5 shrink-0" aria-hidden="true">
                      <span
                        className={`w-3 h-3 rounded-full border-2 transition-colors ${
                          activeMapTarget === 'pickup'
                            ? 'bg-[#171717] border-[#171717] ring-4 ring-[#171717]/10'
                            : 'bg-[#171717] border-[#171717]'
                        }`}
                      />
                      <span className="w-[1.5px] h-10 bg-[#D4D4D4] mt-1.5" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#777777]">
                        {t('Point de départ', 'Pickup point')}
                      </label>
                      <LocationSearchField
                        value={draft.pickup.address}
                        center={[draft.pickup.lat, draft.pickup.lng]}
                        placeholder={t('Où récupérer le colis ?', 'Where should we pick up?')}
                        onChangeText={(text) =>
                          setDraft((p) => ({
                            ...p,
                            pickup: { ...p.pickup, address: text },
                          }))
                        }
                        onSelect={(place) => {
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
                          setActiveMapTarget('stop');
                        }}
                      />
                    </div>
                  </div>

                  {/* Destination Input */}
                  <div
                    onFocusCapture={() => setActiveMapTarget('stop')}
                    onClick={() => setActiveMapTarget('stop')}
                    className="flex items-start gap-3"
                  >
                    <div className="flex flex-col items-center pt-3.5 shrink-0" aria-hidden="true">
                      <span
                        className={`w-3 h-3 rounded-[3px] transition-colors ${
                          activeMapTarget === 'stop'
                            ? 'bg-[#E52B32] ring-4 ring-[#E52B32]/15'
                            : 'bg-[#E52B32]'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#777777]">
                          {draft.stops.length > 1
                            ? t(`Destination #${safeStopIdx + 1}`, `Drop-off #${safeStopIdx + 1}`)
                            : t('Destination', 'Destination')}
                        </label>
                        {draft.stops.length > 1 && (
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={safeStopIdx === 0}
                              onClick={() => moveStop(safeStopIdx, -1)}
                              aria-label={t('Monter cet arrêt', 'Move stop up')}
                              className="p-1 rounded-lg hover:bg-[#E5E5E5]/60 disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5 text-[#171717]" />
                            </button>
                            <button
                              type="button"
                              disabled={safeStopIdx === draft.stops.length - 1}
                              onClick={() => moveStop(safeStopIdx, 1)}
                              aria-label={t('Descendre cet arrêt', 'Move stop down')}
                              className="p-1 rounded-lg hover:bg-[#E5E5E5]/60 disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5 text-[#171717]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeStop(safeStopIdx)}
                              aria-label={t('Supprimer cet arrêt', 'Remove stop')}
                              className="p-1 rounded-lg text-[#E52B32] hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <LocationSearchField
                        value={currentStop.address}
                        center={[currentStop.lat, currentStop.lng]}
                        placeholder={t('Où livrer votre colis ?', 'Where is it going?')}
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
                  </div>

                  {/* Multi-Stop Strip + Optimize + CSV */}
                  <div className="pt-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    {draft.stops.length > 1 &&
                      draft.stops.map((s, idx) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setActiveStopIdx(idx);
                            setActiveMapTarget('stop');
                          }}
                          className={`min-h-[34px] inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                            idx === safeStopIdx
                              ? 'bg-[#171717] text-white'
                              : 'bg-white border border-[#E5E5E5] text-[#171717] hover:border-[#171717]'
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
                      className="min-h-[34px] inline-flex items-center gap-1 px-3 rounded-full bg-white border border-dashed border-[#D4D4D4] hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t('Ajouter un arrêt', 'Add stop')}</span>
                    </button>

                    {draft.stops.length > 1 && (
                      <button
                        type="button"
                        disabled={optimizing}
                        onClick={handleOptimizeRoute}
                        className="min-h-[34px] inline-flex items-center gap-1 px-3 rounded-full bg-white border border-[#E5E5E5] hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {optimizing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Route className="w-3.5 h-3.5" />
                        )}
                        <span>{t('Optimiser', 'Optimize')}</span>
                      </button>
                    )}

                    <label className="min-h-[34px] inline-flex items-center gap-1 px-3 rounded-full bg-white border border-[#E5E5E5] hover:border-[#171717] text-xs font-medium text-[#777777] hover:text-[#171717] whitespace-nowrap shrink-0 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>CSV</span>
                      <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                    </label>
                  </div>

                  {/* Quick Saved Places Chips */}
                  {recipients.length > 0 && (
                    <div className="pt-2 border-t border-[#E5E5E5]/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                      <span className="text-[11px] font-medium text-[#777777] shrink-0 mr-0.5">
                        {activeMapTarget === 'pickup'
                          ? t('Départ rapide :', 'Quick pickup:')
                          : t('Favoris :', 'Saved:')}
                      </span>
                      {recipients.slice(0, 6).map((rec) => (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={() => {
                            if (activeMapTarget === 'pickup') {
                              setDraft((p) => ({
                                ...p,
                                pickup: {
                                  ...p.pickup,
                                  address: rec.address,
                                  landmark: rec.landmark || '',
                                  lat: rec.lat,
                                  lng: rec.lng,
                                },
                              }));
                              setActiveMapTarget('stop');
                            } else {
                              updateStop(safeStopIdx, {
                                recipientName: rec.name,
                                recipientPhone: rec.phone,
                                address: rec.address,
                                landmark: rec.landmark || '',
                                instructions: rec.instructions || '',
                                lat: rec.lat,
                                lng: rec.lng,
                              });
                            }
                          }}
                          className="min-h-[32px] inline-flex items-center gap-1.5 px-3 rounded-full border border-[#E5E5E5] bg-white hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                        >
                          <Bookmark className="w-3 h-3 text-[#777777]" />
                          <span>{rec.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Geospatial Warning (shown early if route outside active city) */}
                {quoteError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 leading-relaxed">
                    <p className="font-semibold text-red-900">
                      {t('Zone de livraison non desservie', 'Delivery route not supported')}
                    </p>
                    <p className="mt-0.5">{quoteError}</p>
                  </div>
                )}

                {/* Vehicle Selection Grid with Cohesive Studio 3D Renders */}
                <div className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-[#171717]">
                      {t('Choisir un véhicule', 'Choose a vehicle')}
                    </h3>
                    <span className="text-[11px] text-[#777777]">
                      {t('Tarif estimé selon trajet', 'Estimated by route')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {VEHICLE_CATALOG.map((v) => {
                      const selected = draft.vehicleCategory === v.id;
                      const availableCount = onlineDrivers.filter((d) => d.vehicleCategory === v.id).length;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setDraft((p) => ({ ...p, vehicleCategory: v.id }))}
                          className={`group relative text-left rounded-[22px] border p-3 transition-all cursor-pointer active:scale-[0.985] flex flex-col justify-between gap-2 ${
                            selected
                              ? 'border-[#E52B32] bg-[#FEF2F2]/45 ring-1 ring-[#E52B32]/20'
                              : 'border-[#E5E5E5] bg-white hover:border-[#171717]/35'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10px] font-mono font-semibold text-[#777777] tabular-nums">
                              ≤ {v.maxWeightKg} kg
                            </span>
                            <span
                              className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                                selected
                                  ? 'border-[#E52B32] bg-[#E52B32] text-white'
                                  : 'border-[#E5E5E5] bg-white'
                              }`}
                            >
                              {selected && <Check className="w-3 h-3 stroke-[2.5]" />}
                            </span>
                          </div>

                          <div className="h-[62px] rounded-2xl bg-[#F3F3F3] flex items-center justify-center overflow-hidden px-1">
                            <VehicleStudioImage
                              category={v.id}
                              alt={lang === 'fr' ? v.labelFr : v.label}
                              className="w-full h-full"
                            />
                          </div>

                          <div className="space-y-0.5">
                            <p className="font-display text-xs sm:text-sm font-bold text-[#171717] truncate">
                              {lang === 'fr' ? v.labelFr : v.label}
                            </p>
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-xs font-bold text-[#171717] tabular-nums">
                                {estimateVehiclePrice(v.id)}
                              </span>
                              {availableCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  {availableCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Timing Switch (Now vs Schedule) */}
                <div className="rounded-[22px] border border-[#E5E5E5] bg-white p-3 space-y-2.5">
                  <div className="grid grid-cols-2 p-1 rounded-full bg-[#F3F3F3] gap-1">
                    <button
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, timingType: 'instant', scheduledFor: '' }))}
                      className={`min-h-[38px] rounded-full text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        draft.timingType === 'instant'
                          ? 'bg-white text-[#171717] shadow-xs'
                          : 'text-[#777777] hover:text-[#171717]'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-[#E52B32]" />
                      <span>{t('Maintenant', 'Now')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, timingType: 'scheduled' }))}
                      className={`min-h-[38px] rounded-full text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        draft.timingType === 'scheduled'
                          ? 'bg-white text-[#171717] shadow-xs'
                          : 'text-[#777777] hover:text-[#171717]'
                      }`}
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      <span>{t('Planifier', 'Schedule')}</span>
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
              </>
            )}

            {/* ============================================================== */}
            {/* STAGE 2 — DESTINATAIRE, OPTIONS, TARIF & PAIEMENT              */}
            {/* ============================================================== */}
            {isConfirmStage && currentStop && (
              <>
                {/* Route + Vehicle Summary Strip */}
                <div className="rounded-[24px] border border-[#E5E5E5] bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-14 h-11 rounded-2xl bg-[#F3F3F3] flex items-center justify-center overflow-hidden shrink-0 px-1">
                        <VehicleStudioImage
                          category={draft.vehicleCategory}
                          alt={getVehicleLabel(draft.vehicleCategory, lang)}
                          className="w-full h-full"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="font-display text-sm font-bold text-[#171717] truncate">
                          {getVehicleLabel(draft.vehicleCategory, lang)}
                        </p>
                        <p className="text-xs text-[#777777] truncate">
                          {draft.timingType === 'scheduled'
                            ? t('Livraison planifiée', 'Scheduled delivery')
                            : t('Départ immédiat', 'Instant dispatch')}
                          {routeDistanceKm > 0 ? ` · ${routeDistanceKm.toFixed(1)} km` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, step: 1 }))}
                      className="min-h-[34px] px-3 rounded-full border border-[#E5E5E5] hover:border-[#171717] text-xs font-semibold text-[#171717] shrink-0 cursor-pointer transition-colors"
                    >
                      {t('Modifier', 'Change')}
                    </button>
                  </div>

                  <div className="pt-2.5 border-t border-[#E5E5E5] space-y-2">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-[#171717] shrink-0" />
                      <p className="text-xs font-medium text-[#171717] leading-snug">{draft.pickup.address}</p>
                    </div>
                    {draft.stops
                      .filter((s) => s.address.trim())
                      .map((s, idx) => (
                        <div key={s.id} className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-2 h-2 rounded-[2px] bg-[#E52B32] shrink-0" />
                          <p className="text-xs font-medium text-[#171717] leading-snug">
                            {draft.stops.length > 1 ? `#${idx + 1} · ` : ''}
                            {s.address}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Recipient Info Card */}
                <div className="rounded-[24px] border border-[#E5E5E5] bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-[#171717]">
                      {draft.stops.length > 1
                        ? t(`Destinataire #${safeStopIdx + 1}`, `Recipient #${safeStopIdx + 1}`)
                        : t('Coordonnées du destinataire', 'Recipient details')}
                    </h3>
                    {draft.stops.length > 1 && (
                      <div className="flex items-center gap-1">
                        {draft.stops.map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setActiveStopIdx(idx)}
                            className={`min-h-[28px] px-2.5 rounded-full text-[11px] font-mono font-semibold cursor-pointer ${
                              idx === safeStopIdx
                                ? 'bg-[#171717] text-white'
                                : 'bg-[#F3F3F3] text-[#777777] hover:text-[#171717]'
                            }`}
                          >
                            #{idx + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                      placeholder={t('Téléphone', 'Phone number')}
                      className={inputClass}
                    />
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        value={currentStop.instructions}
                        onChange={(e) => updateStop(safeStopIdx, { instructions: e.target.value })}
                        placeholder={t(
                          'Instructions pour le livreur (code, étage, repère...)',
                          'Delivery instructions (gate code, floor, landmark...)'
                        )}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {recipients.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
                      {recipients.slice(0, 5).map((rec) => (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={() =>
                            updateStop(safeStopIdx, {
                              recipientName: rec.name,
                              recipientPhone: rec.phone,
                              instructions: rec.instructions || currentStop.instructions,
                            })
                          }
                          className="min-h-[30px] inline-flex items-center gap-1.5 px-3 rounded-full border border-[#E5E5E5] bg-[#FAFAFA] hover:border-[#171717] text-xs font-medium text-[#171717] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <MapPin className="w-3 h-3 text-[#777777]" />
                          <span>{rec.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Parcel & Proof Options (Clean Collapsible to Keep Mobile Ultra-Simple) */}
                <div className="rounded-[24px] border border-[#E5E5E5] bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowExtraParcelOptions((v) => !v)}
                    className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#FAFAFA] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Package className="w-4 h-4 text-[#171717] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#171717]">
                          {t('Détails du colis et preuve de remise', 'Parcel details & proof')}
                        </p>
                        <p className="text-xs text-[#777777] truncate">
                          {draft.quantity}× {draft.packageType || t('Colis', 'Parcel')} · {draft.weightKg} kg ·{' '}
                          {draft.proofRequired === 'otp'
                            ? 'OTP'
                            : draft.proofRequired === 'signature'
                            ? t('Signature', 'Signature')
                            : draft.proofRequired === 'photo'
                            ? 'Photo'
                            : t('Directe', 'Direct')}
                          {draft.fragile ? ` · ${t('Fragile', 'Fragile')}` : ''}
                        </p>
                      </div>
                    </div>
                    {showExtraParcelOptions ? (
                      <ChevronUp className="w-4 h-4 text-[#777777] shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#777777] shrink-0" />
                    )}
                  </button>

                  {showExtraParcelOptions && (
                    <div className="px-4 pb-4 pt-2 border-t border-[#E5E5E5] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-[#777777] mb-1">
                            {t('Description du colis', 'Package description')}
                          </label>
                          <input
                            type="text"
                            value={draft.packageType}
                            onChange={(e) => setDraft((p) => ({ ...p, packageType: e.target.value }))}
                            placeholder={t('Ex. Cartons, documents, matériel...', 'e.g. Boxes, documents, gear...')}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[#777777] mb-1">
                            {t('Poids estimé (kg)', 'Weight (kg)')}
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
                          <label className="block text-xs font-medium text-[#777777] mb-1">
                            {t('Quantité', 'Quantity')}
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
                        <div>
                          <label className="block text-xs font-medium text-[#777777] mb-1">
                            {t('Preuve de remise', 'Proof of delivery')}
                          </label>
                          <select
                            value={draft.proofRequired}
                            onChange={(e) =>
                              setDraft((p) => ({ ...p, proofRequired: e.target.value as ProofType }))
                            }
                            className={inputClass}
                          >
                            <option value="otp">{t('Code secret OTP', 'OTP Secret Code')}</option>
                            <option value="signature">{t('Signature destinataire', 'Recipient signature')}</option>
                            <option value="photo">{t('Photo de remise', 'Photo confirmation')}</option>
                            <option value="recipient_confirm">{t('Confirmation directe', 'Direct confirmation')}</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <label className="w-full min-h-[44px] flex items-center justify-between px-4 py-2 rounded-2xl border border-[#E5E5E5] bg-[#FAFAFA] cursor-pointer">
                            <span className="text-sm font-medium text-[#171717]">
                              {t('Colis fragile', 'Fragile')}
                            </span>
                            <input
                              type="checkbox"
                              checked={draft.fragile}
                              onChange={(e) => setDraft((p) => ({ ...p, fragile: e.target.checked }))}
                              className="w-4 h-4 accent-[#E52B32]"
                            />
                          </label>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-[#777777] mb-1">
                            {t('Repère ou note de collecte (optionnel)', 'Pickup landmark or note (optional)')}
                          </label>
                          <input
                            type="text"
                            value={draft.pickup.instructions || draft.specialHandling}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                pickup: { ...p.pickup, instructions: e.target.value },
                                specialHandling: e.target.value,
                              }))
                            }
                            placeholder={t('Portail noir, appeler à l’arrivée...', 'Black gate, call on arrival...')}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </div>
                  )}
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

                {/* Transparent Fare Breakdown */}
                {!quoteError && (
                  <div className="rounded-[24px] bg-[#F3F3F3]/70 border border-[#E5E5E5] p-4 space-y-2.5">
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
                        {displayedPrice}
                      </span>
                    </div>
                  </div>
                )}

                {/* Nearby Available Couriers */}
                {matchedDrivers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[#777777]">
                      {t('Livreur disponible à proximité', 'Available courier nearby')}
                    </p>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                      {matchedDrivers.slice(0, 3).map((m) => {
                        const picked =
                          (draft.selectedDriverUid || matchedDrivers[0].driver.uid) === m.driver.uid;
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

                {/* Contextual Payment Method Selector */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[#777777]">
                    {t('Mode de paiement', 'Payment method')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPaymentModalOpen(true)}
                    className="w-full min-h-[58px] px-4 py-3 rounded-[24px] border border-[#E5E5E5] hover:border-[#171717] bg-white flex items-center justify-between gap-3 transition-colors cursor-pointer text-left"
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
              </>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Contextual Payment Method Bottom Sheet / Modal */}
      <PaymentMethodModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        elevated
        selected={draft.paymentMethod}
        onSelect={(method: PaymentMethod) => setDraft((p) => ({ ...p, paymentMethod: method }))}
        title={t('Mode de paiement', 'Payment Method')}
        subtitle={t(
          'Méthode utilisée pour régler cette livraison.',
          'Settlement method for this delivery.'
        )}
      />
    </>
  );
}
