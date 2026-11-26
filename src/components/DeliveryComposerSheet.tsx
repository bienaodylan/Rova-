import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Briefcase,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  Crosshair,
  DoorOpen,
  Home,
  Loader2,
  Map as MapIcon,
  MapPin,
  Navigation,
  Package,
  PhoneCall,
  Plus,
  RefreshCw,
  Route,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { PaymentMethodModal } from './PaymentMethodModal';
import { MapMarkerItem, RovaMap } from './RovaMap';
import { VehicleStudioImage } from './VehicleIllustration';
import { DraftStop, useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';
import {
  getEffectivePricingRule,
  getPaymentMethodLabelEn,
  getStatusLabel,
  getVehicleLabel,
  haversineDistanceKm,
  rankSuitableDrivers,
  STATUS_META,
  VEHICLE_CATALOG,
} from '../lib/logistics';
import {
  DeliveryRecord,
  DeliveryStatus,
  GeoPlace,
  PaymentMethod,
  ProofType,
  QuoteResult,
  VehicleCategory,
} from '../types/rova';

type BookingPanelState =
  | 'initial'
  | 'route_ready'
  | 'order_form'
  | 'searching'
  | 'driver_results'
  | 'confirmed';

type MapPickMode = 'none' | 'pickup' | 'stop';
type ActiveAddressInput = 'pickup' | 'stop';
type AddressTab = 'suggested' | 'saved';
type HandoffOptionId = 'door' | 'gate' | 'reception' | 'call';

interface SmartSuggestion {
  id: string;
  label: string;
  address: string;
  lat?: number;
  lng?: number;
  recipientName?: string;
  recipientPhone?: string;
  landmark?: string;
  instructions?: string;
  source: 'habit' | 'favorite' | 'history' | 'nearby';
  reasonFr: string;
  reasonEn: string;
  distanceKm?: number;
  score: number;
  icon: 'home' | 'work' | 'favorite' | 'recent' | 'nearby';
}

const CONFIRMED_STATUSES: DeliveryStatus[] = [
  'driver_assigned',
  'driver_approaching_pickup',
  'at_pickup',
  'package_collected',
  'in_transit',
  'approaching_recipient',
  'arrived',
  'delivered',
];

const CANCELLABLE_STATUSES: DeliveryStatus[] = ['pending', 'scheduled', 'driver_assigned'];

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const HANDOFF_OPTIONS: Array<{
  id: HandoffOptionId;
  labelFr: string;
  labelEn: string;
  icon: 'door' | 'gate' | 'reception' | 'call';
}> = [
  { id: 'door', labelFr: 'À la porte', labelEn: 'At the door', icon: 'door' },
  { id: 'gate', labelFr: 'Au portail / En bas', labelEn: 'At gate / Curbside', icon: 'gate' },
  { id: 'reception', labelFr: 'À l’accueil', labelEn: 'At reception', icon: 'reception' },
  { id: 'call', labelFr: 'Appeler à l’arrivée', labelEn: 'Call on arrival', icon: 'call' },
];

function normalizeRouteCoords(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [number, number][] = [];
  for (const pt of raw) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const a = Number(pt[0]);
      const b = Number(pt[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
    } else if (pt && typeof pt === 'object' && 'lat' in pt && 'lng' in pt) {
      const a = Number((pt as { lat: unknown }).lat);
      const b = Number((pt as { lng: unknown }).lng);
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
    }
  }
  return out;
}

function classifyPlaceIcon(label: string): 'home' | 'work' | 'favorite' {
  const lower = label.toLowerCase();
  if (lower.includes('maison') || lower.includes('domicile') || lower.includes('home')) return 'home';
  if (
    lower.includes('bureau') ||
    lower.includes('travail') ||
    lower.includes('work') ||
    lower.includes('office') ||
    lower.includes('boutique') ||
    lower.includes('magasin')
  ) {
    return 'work';
  }
  return 'favorite';
}

function extractRecordDate(createdAt: unknown): Date | null {
  if (!createdAt) return null;
  if (createdAt instanceof Date) return createdAt;
  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const d = new Date(createdAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof createdAt === 'object' && 'toDate' in createdAt && typeof (createdAt as { toDate: () => Date }).toDate === 'function') {
    return (createdAt as { toDate: () => Date }).toDate();
  }
  if (typeof createdAt === 'object' && 'seconds' in createdAt) {
    const secs = Number((createdAt as { seconds: unknown }).seconds);
    if (Number.isFinite(secs)) return new Date(secs * 1000);
  }
  return null;
}

function composeHandoffNote(option: HandoffOptionId, extra: string, lang: 'fr' | 'en'): string {
  const found = HANDOFF_OPTIONS.find((h) => h.id === option);
  const prefix = found ? (lang === 'fr' ? found.labelFr : found.labelEn) : '';
  const cleanExtra = extra.trim();
  if (!prefix) return cleanExtra;
  return cleanExtra ? `${prefix} · ${cleanExtra}` : prefix;
}

export function DeliveryComposerSheet() {
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const {
    composerOpen,
    closeComposer,
    openReservationSheet,
    draft,
    setDraft,
    resetDraft,
    deliveries,
    recipients,
    onlineDrivers,
    pricingRules,
    busy,
    submitDelivery,
    cancelDelivery,
    saveRecipient,
    openShipmentDetail,
    showToast,
  } = useRovaApp();

  // Dynamic bottom-panel state machine
  const [phaseOverride, setPhaseOverride] = useState<'auto' | 'order_form' | 'searching' | 'driver_results'>('auto');
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [createdSnapshot, setCreatedSnapshot] = useState<DeliveryRecord | null>(null);

  // Full-height From/To Address Sheet state
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [activeAddressInput, setActiveAddressInput] = useState<ActiveAddressInput>('stop');
  const [addressTab, setAddressTab] = useState<AddressTab>('suggested');
  const [pickupQuery, setPickupQuery] = useState('');
  const [stopQuery, setStopQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeoPlace[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);

  // Real nearby places around the user's current coordinates (always >= 3 suggestions)
  const [nearbyPlaces, setNearbyPlaces] = useState<GeoPlace[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);

  // Interactive map & geolocation state
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatusNote, setGpsStatusNote] = useState<string | null>(null);
  const [mapPickMode, setMapPickMode] = useState<MapPickMode>('none');
  const [activeStopIdx, setActiveStopIdx] = useState(0);

  // Order Form handoff options (Door, Gate, Reception, Call)
  const [pickupHandoff, setPickupHandoff] = useState<HandoffOptionId>('door');
  const [dropoffHandoff, setDropoffHandoff] = useState<HandoffOptionId>('door');
  const [pickupExtraNote, setPickupExtraNote] = useState('');
  const [dropoffExtraNote, setDropoffExtraNote] = useState('');

  // Modals & action states
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);

  // Live routing & authoritative quote state
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);
  const [routeDurationMin, setRouteDurationMin] = useState(0);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteMeta, setQuoteMeta] = useState<{
    id: string;
    cityName: string;
    isFallbackEstimate: boolean;
  } | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const pickupInputRef = useRef<HTMLInputElement | null>(null);
  const stopInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoLocatedRef = useRef(false);
  const nearbyFetchedKeyRef = useRef('');

  const safeStopIdx = Math.min(activeStopIdx, Math.max(0, draft.stops.length - 1));
  const currentStop = draft.stops[safeStopIdx] || draft.stops[0];
  const validStops = useMemo(
    () => draft.stops.filter((s) => s.address.trim().length > 0),
    [draft.stops]
  );

  // Live reactive delivery record from Firestore/Supabase stream
  const liveDelivery = useMemo(() => {
    if (!activeBookingId) return null;
    return deliveries.find((d) => d.id === activeBookingId) || createdSnapshot;
  }, [activeBookingId, deliveries, createdSnapshot]);

  // Derived dynamic bottom panel state
  const panelState: BookingPanelState = useMemo(() => {
    if (liveDelivery) {
      if (CONFIRMED_STATUSES.includes(liveDelivery.status)) {
        return 'confirmed';
      }
      return 'searching';
    }
    if (phaseOverride === 'driver_results') return 'driver_results';
    if (phaseOverride === 'searching') return 'searching';
    if (phaseOverride === 'order_form' && validStops.length > 0) return 'order_form';
    if (validStops.length > 0) return 'route_ready';
    return 'initial';
  }, [liveDelivery, phaseOverride, validStops.length]);

  // Reset all transient local states whenever composer opens or closes
  useEffect(() => {
    if (!composerOpen) {
      hasAutoLocatedRef.current = false;
      nearbyFetchedKeyRef.current = '';
      setPhaseOverride('auto');
      setActiveBookingId(null);
      setCreatedSnapshot(null);
      setAddressSheetOpen(false);
      setActiveAddressInput('stop');
      setAddressTab('suggested');
      setPickupQuery('');
      setStopQuery('');
      setSearchResults([]);
      setMapPickMode('none');
      setGpsStatusNote(null);
      setPickupHandoff('door');
      setDropoffHandoff('door');
      setPickupExtraNote('');
      setDropoffExtraNote('');
      return;
    }
    setActiveStopIdx(0);
    setPhaseOverride('auto');
    setActiveBookingId(null);
    setCreatedSnapshot(null);
    setAddressSheetOpen(false);
    setMapPickMode('none');
  }, [composerOpen]);

  // Lock background page scroll & handle Escape cleanly
  useEffect(() => {
    if (!composerOpen) return;
    const scrollY = window.scrollY;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyWidth = document.body.style.width;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !paymentModalOpen) {
        if (addressSheetOpen) {
          setAddressSheetOpen(false);
          setSearchResults([]);
        } else if (mapPickMode !== 'none') {
          setMapPickMode('none');
        } else if (panelState === 'order_form') {
          setPhaseOverride('auto');
        } else {
          closeComposer();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.width = prevBodyWidth;
      window.scrollTo(0, scrollY);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [composerOpen, paymentModalOpen, addressSheetOpen, mapPickMode, panelState, closeComposer]);

  // Reverse geocode helper
  const reverseGeocode = useCallback(async (lat: number, lng: number): Promise<GeoPlace> => {
    try {
      const res = await fetch(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      const data = await res.json();
      return {
        displayName: data.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: data.shortName || data.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        landmark: data.landmark,
        lat,
        lng,
      };
    } catch {
      return {
        displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
      };
    }
  }, []);

  // Detect live GPS location and auto-populate Pickup when granted
  const detectUserLocation = useCallback(
    (forceUpdatePickup = false) => {
      if (!navigator.geolocation) {
        setGpsStatusNote(
          t('Géolocalisation indisponible — indiquez votre départ.', 'Geolocation unavailable — enter pickup manually.')
        );
        return;
      }
      setGpsLoading(true);
      setGpsStatusNote(null);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setUserCoords([lat, lng]);
          if (forceUpdatePickup || !draft.pickup.address.trim()) {
            const place = await reverseGeocode(lat, lng);
            const label = place.shortName || place.displayName;
            setDraft((prev) => ({
              ...prev,
              pickup: {
                ...prev.pickup,
                address: label,
                landmark: place.landmark || prev.pickup.landmark,
                lat,
                lng,
              },
            }));
            setPickupQuery(label);
          }
          setGpsLoading(false);
        },
        (err) => {
          setGpsLoading(false);
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatusNote(
              t(
                'Localisation refusée — recherchez votre départ ou utilisez l’icône carte.',
                'Location denied — search pickup or tap the map icon.'
              )
            );
          } else {
            setGpsStatusNote(t('Position GPS indisponible.', 'GPS location unavailable.'));
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    },
    [draft.pickup.address, reverseGeocode, setDraft, t]
  );

  // Auto-detect user location once on opening
  useEffect(() => {
    if (!composerOpen || hasAutoLocatedRef.current) return;
    hasAutoLocatedRef.current = true;
    detectUserLocation(false);
  }, [composerOpen, detectUserLocation]);

  // Fetch REAL nearby places around the user's current coordinates so at least 3 nearby suggestions always appear
  useEffect(() => {
    if (!composerOpen) return;
    const anchorLat = userCoords?.[0] ?? draft.pickup.lat ?? region.lat;
    const anchorLng = userCoords?.[1] ?? draft.pickup.lng ?? region.lng;
    if (!Number.isFinite(anchorLat) || !Number.isFinite(anchorLng)) return;

    const key = `${anchorLat.toFixed(2)},${anchorLng.toFixed(2)},${region.city}`;
    if (nearbyFetchedKeyRef.current === key) return;
    nearbyFetchedKeyRef.current = key;

    let cancelled = false;
    setLoadingNearby(true);

    const cityTerm = (region.city || '').trim();
    const queries = [
      cityTerm || 'centre',
      lang === 'fr' ? 'marché' : 'market',
      lang === 'fr' ? 'pharmacie' : 'mall',
    ];

    Promise.all(
      queries.map(async (q) => {
        try {
          const params = new URLSearchParams({
            q,
            lat: String(anchorLat),
            lng: String(anchorLng),
          });
          const res = await fetch(`/api/geo/search?${params.toString()}`);
          const data = await res.json();
          return Array.isArray(data.results) ? (data.results as GeoPlace[]) : [];
        } catch {
          return [];
        }
      })
    )
      .then((batches) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const merged: GeoPlace[] = [];
        for (const list of batches) {
          for (const place of list) {
            const labelKey = (place.shortName || place.displayName || '').trim().toLowerCase();
            if (!labelKey || seen.has(labelKey)) continue;
            const dist = haversineDistanceKm(anchorLat, anchorLng, place.lat, place.lng);
            if (dist > 30) continue;
            seen.add(labelKey);
            merged.push(place);
          }
        }
        merged.sort(
          (a, b) =>
            haversineDistanceKm(anchorLat, anchorLng, a.lat, a.lng) -
            haversineDistanceKm(anchorLat, anchorLng, b.lat, b.lng)
        );
        setNearbyPlaces(merged.slice(0, 6));
      })
      .finally(() => {
        if (!cancelled) setLoadingNearby(false);
      });

    return () => {
      cancelled = true;
    };
  }, [composerOpen, userCoords, draft.pickup.lat, draft.pickup.lng, region.lat, region.lng, region.city, lang]);

  // Live location autocomplete inside Full-Height Address Sheet
  const activeSearchQuery = activeAddressInput === 'pickup' ? pickupQuery : stopQuery;

  useEffect(() => {
    if (!addressSheetOpen) {
      setSearchResults([]);
      return;
    }
    const q = activeSearchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const biasLat = userCoords?.[0] ?? draft.pickup.lat ?? region.lat;
    const biasLng = userCoords?.[1] ?? draft.pickup.lng ?? region.lng;

    const timer = window.setTimeout(async () => {
      setSearchingPlaces(true);
      try {
        const params = new URLSearchParams({ q });
        if (Number.isFinite(biasLat) && Number.isFinite(biasLng)) {
          params.set('lat', String(biasLat));
          params.set('lng', String(biasLng));
        }
        const res = await fetch(`/api/geo/search?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) {
          const places = Array.isArray(data.results) ? (data.results as GeoPlace[]) : [];
          setSearchResults(
            places.sort(
              (a, b) =>
                haversineDistanceKm(biasLat, biasLng, a.lat, a.lng) -
                haversineDistanceKm(biasLat, biasLng, b.lat, b.lng)
            )
          );
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchingPlaces(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addressSheetOpen, activeSearchQuery, userCoords, draft.pickup.lat, draft.pickup.lng, region.lat, region.lng]);

  // Real road route & polyline via /api/geo/route
  useEffect(() => {
    if (!composerOpen) return;
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
        setRouteCoords(poly.length >= 2 ? poly : points.map((p) => [p.lat, p.lng]));
      })
      .catch(() => {
        if (cancelled) return;
        let km = 0;
        for (let i = 0; i < points.length - 1; i++) {
          km += haversineDistanceKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
        }
        setRouteDistanceKm(Number(km.toFixed(2)));
        setRouteDurationMin(Math.max(8, Math.round(km * 3)));
        setRouteCoords(points.map((p) => [p.lat, p.lng]));
      });

    return () => {
      cancelled = true;
    };
  }, [composerOpen, draft.pickup.address, draft.pickup.lat, draft.pickup.lng, validStops]);

  // Authoritative quote + city geofencing via /api/v1/quotes
  useEffect(() => {
    if (!composerOpen) return;
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
          if (Number(data.quote.distanceKm) > 0) setRouteDistanceKm(Number(data.quote.distanceKm));
          if (Number(data.quote.durationMin) > 0) setRouteDurationMin(Number(data.quote.durationMin));
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
    draft.timingType,
    draft.weightKg,
    draft.packageSize,
    draft.fragile,
    validStops,
    lang,
    t,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real suitable online drivers ranked by distance, vehicle & rating
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

  // Per-vehicle real availability ETA map
  const vehicleEtaMap = useMemo(() => {
    const map: Partial<Record<VehicleCategory, { etaMin: number; count: number }>> = {};
    for (const v of VEHICLE_CATALOG) {
      const ranked = rankSuitableDrivers(
        onlineDrivers,
        draft.pickup.lat,
        draft.pickup.lng,
        v.id,
        Math.min(draft.weightKg, v.maxWeightKg)
      );
      if (ranked.length > 0) {
        map[v.id] = { etaMin: ranked[0].etaMinutes, count: ranked.length };
      }
    }
    return map;
  }, [onlineDrivers, draft.pickup.lat, draft.pickup.lng, draft.weightKg]);

  // =========================================================================
  // INTELLIGENT SUGGESTIONS: Day-of-week habits + Frequency + Favorites + Real Nearby (>= 3)
  // =========================================================================
  const smartSuggestions = useMemo<SmartSuggestion[]>(() => {
    const todayDow = new Date().getDay();
    const todayNameFr = DAYS_FR[todayDow];
    const todayNameEn = DAYS_EN[todayDow];
    const anchorLat = userCoords?.[0] ?? draft.pickup.lat ?? region.lat;
    const anchorLng = userCoords?.[1] ?? draft.pickup.lng ?? region.lng;

    // 1. Analyze real delivery history (total frequency + same day-of-week habit)
    const histMap = new Map<
      string,
      { address: string; count: number; sameDayCount: number; latestIdx: number }
    >();
    deliveries.forEach((del, idx) => {
      const addr = (del.primaryDestinationLabel || '').trim();
      if (!addr) return;
      const key = addr.toLowerCase();
      const dt = extractRecordDate(del.createdAt);
      const isSameDow = dt ? dt.getDay() === todayDow : false;
      const existing = histMap.get(key);
      if (existing) {
        existing.count += 1;
        if (isSameDow) existing.sameDayCount += 1;
      } else {
        histMap.set(key, {
          address: addr,
          count: 1,
          sameDayCount: isSameDow ? 1 : 0,
          latestIdx: idx,
        });
      }
    });

    const combined: SmartSuggestion[] = [];
    const seen = new Set<string>();

    // Saved favorites (boosted if delivered on this day of week or frequently)
    recipients.forEach((rec) => {
      const key = rec.address.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const hist = histMap.get(key);
      const dist = Number(haversineDistanceKm(anchorLat, anchorLng, rec.lat, rec.lng).toFixed(1));
      const isHabitToday = (hist?.sameDayCount || 0) >= 1;
      combined.push({
        id: `fav_${rec.id}`,
        label: rec.name,
        address: rec.address,
        lat: rec.lat,
        lng: rec.lng,
        recipientName: rec.name,
        recipientPhone: rec.phone,
        landmark: rec.landmark,
        instructions: rec.instructions,
        source: isHabitToday ? 'habit' : 'favorite',
        reasonFr: isHabitToday
          ? `Habituel le ${todayNameFr}`
          : hist && hist.count > 1
          ? `Fréquent · ${hist.count} envois`
          : 'Enregistré',
        reasonEn: isHabitToday
          ? `Usual on ${todayNameEn}`
          : hist && hist.count > 1
          ? `Frequent · ${hist.count} trips`
          : 'Saved',
        distanceKm: Number.isFinite(dist) && dist < 50 ? dist : undefined,
        score: (hist?.sameDayCount || 0) * 6 + (hist?.count || 0) * 2 + 4,
        icon: classifyPlaceIcon(rec.name),
      });
    });

    // Frequent & day-of-week habitual delivery history
    Array.from(histMap.entries()).forEach(([key, info]) => {
      if (seen.has(key)) return;
      seen.add(key);
      const isHabitToday = info.sameDayCount >= 1;
      combined.push({
        id: `hist_${key}`,
        label: info.address.split(',')[0].trim() || info.address,
        address: info.address,
        source: isHabitToday ? 'habit' : 'history',
        reasonFr: isHabitToday
          ? `Habituel le ${todayNameFr}`
          : info.count > 1
          ? `Fréquent · ${info.count} envois`
          : 'Destination récente',
        reasonEn: isHabitToday
          ? `Usual on ${todayNameEn}`
          : info.count > 1
          ? `Frequent · ${info.count} trips`
          : 'Recent destination',
        score: info.sameDayCount * 6 + info.count * 2 + Math.max(0, 3 - info.latestIdx * 0.2),
        icon: 'recent',
      });
    });

    // Real nearby places around the user's current position (guarantees >= 3 useful nearby defaults!)
    nearbyPlaces.forEach((place, idx) => {
      const addr = (place.displayName || place.shortName || '').trim();
      const short = (place.shortName || addr.split(',')[0] || '').trim();
      const key = addr.toLowerCase();
      const shortKey = short.toLowerCase();
      if (!shortKey || seen.has(key) || seen.has(shortKey)) return;
      // Avoid suggesting the exact pickup string itself
      if (draft.pickup.address.trim() && shortKey === draft.pickup.address.trim().toLowerCase()) return;
      seen.add(key);
      seen.add(shortKey);
      const dist = Number(haversineDistanceKm(anchorLat, anchorLng, place.lat, place.lng).toFixed(1));
      combined.push({
        id: `nearby_${idx}_${place.lat.toFixed(4)}`,
        label: short,
        address: addr,
        lat: place.lat,
        lng: place.lng,
        landmark: place.landmark,
        source: 'nearby',
        reasonFr: Number.isFinite(dist) ? `À proximité · ${dist} km` : 'À proximité',
        reasonEn: Number.isFinite(dist) ? `Nearby · ${dist} km` : 'Nearby',
        distanceKm: Number.isFinite(dist) ? dist : undefined,
        score: Math.max(0.5, 2 - idx * 0.2),
        icon: 'nearby',
      });
    });

    return combined.sort((a, b) => b.score - a.score).slice(0, 6);
  }, [deliveries, recipients, nearbyPlaces, userCoords, draft.pickup.lat, draft.pickup.lng, draft.pickup.address, region.lat, region.lng]);

  const estimateVehiclePriceNumber = useCallback(
    (category: VehicleCategory): { amount: number; currency: string } => {
      const rule = getEffectivePricingRule(pricingRules, category);
      const dist = Math.max(1, routeDistanceKm || 4);
      const total = Math.max(
        rule.minimumFare,
        rule.baseFee + dist * rule.perKmRate + Math.max(0, validStops.length - 1) * rule.multiStopFee
      );
      return { amount: Number(total.toFixed(2)), currency: rule.currency || 'XOF' };
    },
    [pricingRules, routeDistanceKm, validStops.length]
  );

  const displayedPrice = useMemo(() => {
    if (quote) return formatLocalMoney(quote.total, quote.currency);
    const est = estimateVehiclePriceNumber(draft.vehicleCategory);
    return formatLocalMoney(est.amount, est.currency);
  }, [quote, estimateVehiclePriceNumber, draft.vehicleCategory, formatLocalMoney]);

  // Live map markers
  const mapMarkers = useMemo<MapMarkerItem[]>(() => {
    const items: MapMarkerItem[] = [];

    if (liveDelivery) {
      if (Number.isFinite(liveDelivery.pickupLat) && Number.isFinite(liveDelivery.pickupLng)) {
        items.push({
          id: 'live-pickup',
          lat: liveDelivery.pickupLat,
          lng: liveDelivery.pickupLng,
          label: liveDelivery.pickupAddress,
          kind: 'pickup',
        });
      }
      validStops.forEach((s, idx) => {
        items.push({
          id: `live-stop-${s.id}`,
          lat: s.lat,
          lng: s.lng,
          label: s.address,
          kind: 'stop',
          sequence: idx + 1,
        });
      });
      if (typeof liveDelivery.driverLat === 'number' && typeof liveDelivery.driverLng === 'number') {
        items.push({
          id: `live-driver-${liveDelivery.driverUid || 'active'}`,
          lat: liveDelivery.driverLat,
          lng: liveDelivery.driverLng,
          label: liveDelivery.driverName || t('Livreur Rovia', 'Rovia Courier'),
          kind: 'driver',
        });
      }
      return items;
    }

    const pickupLat = userCoords?.[0] ?? draft.pickup.lat;
    const pickupLng = userCoords?.[1] ?? draft.pickup.lng;
    if (Number.isFinite(draft.pickup.lat) && Number.isFinite(draft.pickup.lng)) {
      items.push({
        id: 'booking-pickup',
        lat: draft.pickup.address.trim() ? draft.pickup.lat : pickupLat,
        lng: draft.pickup.address.trim() ? draft.pickup.lng : pickupLng,
        label: draft.pickup.address || t('Ma position', 'My location'),
        kind: draft.pickup.address.trim() ? 'pickup' : 'selected',
      });
    }

    validStops.forEach((s, idx) => {
      if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
        items.push({
          id: `booking-stop-${s.id}`,
          lat: s.lat,
          lng: s.lng,
          label: s.address,
          kind: 'stop',
          sequence: idx + 1,
          meta: s.recipientName || undefined,
        });
      }
    });

    matchedDrivers.slice(0, 6).forEach((m) => {
      if (typeof m.driver.currentLat === 'number' && typeof m.driver.currentLng === 'number') {
        items.push({
          id: `nearby-driver-${m.driver.uid}`,
          lat: m.driver.currentLat,
          lng: m.driver.currentLng,
          label: `${m.driver.firstName} · ~${m.etaMinutes} min`,
          kind: 'driver',
        });
      }
    });

    return items;
  }, [liveDelivery, userCoords, draft.pickup, validStops, matchedDrivers, t]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (liveDelivery && typeof liveDelivery.driverLat === 'number' && typeof liveDelivery.driverLng === 'number') {
      return [liveDelivery.driverLat, liveDelivery.driverLng];
    }
    if (mapPickMode === 'stop' && currentStop && currentStop.address.trim()) {
      return [currentStop.lat, currentStop.lng];
    }
    if (validStops.length > 0) {
      return [
        (draft.pickup.lat + validStops[0].lat) / 2,
        (draft.pickup.lng + validStops[0].lng) / 2,
      ];
    }
    if (userCoords) return userCoords;
    return [draft.pickup.lat || region.lat, draft.pickup.lng || region.lng];
  }, [liveDelivery, mapPickMode, currentStop, validStops, draft.pickup.lat, draft.pickup.lng, userCoords, region.lat, region.lng]);

  // Helper mutations
  const updateStop = useCallback(
    (idx: number, patch: Partial<DraftStop>) => {
      setDraft((prev) => {
        const nextStops = [...prev.stops];
        if (!nextStops[idx]) return prev;
        nextStops[idx] = { ...nextStops[idx], ...patch };
        return { ...prev, stops: nextStops };
      });
    },
    [setDraft]
  );

  const selectVehicle = (vehicleId: VehicleCategory) => {
    setDraft((prev) => {
      const next = { ...prev, vehicleCategory: vehicleId };
      if (vehicleId === 'truck') {
        next.packageSize = 'bulk';
        next.weightKg = Math.max(prev.weightKg, 250);
      } else if (vehicleId === 'cargo_van' || vehicleId === 'commercial_van') {
        next.packageSize = 'large';
        next.weightKg = Math.max(prev.weightKg, 40);
      } else if (vehicleId === 'motorcycle' && prev.weightKg > 15) {
        next.packageSize = 'small';
        next.weightKg = 3;
      }
      return next;
    });
  };

  // Open the Full-Height From -> To Address Sheet
  const openFullAddressSheet = (focusField: ActiveAddressInput, tab: AddressTab = 'suggested') => {
    setActiveAddressInput(focusField);
    setAddressTab(tab);
    setPickupQuery(draft.pickup.address);
    setStopQuery(currentStop?.address || '');
    setSearchResults([]);
    setMapPickMode('none');
    setAddressSheetOpen(true);
    window.setTimeout(() => {
      if (focusField === 'pickup') {
        pickupInputRef.current?.focus();
      } else {
        stopInputRef.current?.focus();
      }
    }, 60);
  };

  const applyGeoPlace = (target: ActiveAddressInput, place: GeoPlace) => {
    const label = place.shortName || place.displayName;
    if (target === 'pickup') {
      setDraft((prev) => ({
        ...prev,
        pickup: {
          ...prev.pickup,
          address: label,
          landmark: place.landmark || prev.pickup.landmark,
          lat: place.lat,
          lng: place.lng,
        },
      }));
      setPickupQuery(label);
      setSearchResults([]);
      // If destination isn't filled yet while in Address Sheet, automatically move focus to Destination!
      if (addressSheetOpen && !currentStop?.address.trim()) {
        setActiveAddressInput('stop');
        window.setTimeout(() => stopInputRef.current?.focus(), 40);
        return;
      }
    } else if (currentStop) {
      updateStop(safeStopIdx, {
        address: label,
        landmark: place.landmark || currentStop.landmark,
        lat: place.lat,
        lng: place.lng,
      });
      setStopQuery(label);
    }
    setAddressSheetOpen(false);
    setSearchResults([]);
    setMapPickMode('none');
  };

  const applySuggestion = async (item: SmartSuggestion, target: ActiveAddressInput = 'stop') => {
    if (typeof item.lat === 'number' && typeof item.lng === 'number') {
      if (target === 'pickup') {
        applyGeoPlace('pickup', {
          displayName: item.address,
          shortName: item.label || item.address,
          landmark: item.landmark,
          lat: item.lat,
          lng: item.lng,
        });
      } else {
        updateStop(safeStopIdx, {
          address: item.address,
          recipientName: item.recipientName || currentStop?.recipientName || '',
          recipientPhone: item.recipientPhone || currentStop?.recipientPhone || '',
          landmark: item.landmark || '',
          instructions: item.instructions || '',
          lat: item.lat,
          lng: item.lng,
        });
        setStopQuery(item.address);
        setAddressSheetOpen(false);
        setSearchResults([]);
      }
      return;
    }

    setSearchingPlaces(true);
    try {
      const biasLat = userCoords?.[0] ?? draft.pickup.lat ?? region.lat;
      const biasLng = userCoords?.[1] ?? draft.pickup.lng ?? region.lng;
      const res = await fetch(
        `/api/geo/search?q=${encodeURIComponent(item.address)}&lat=${encodeURIComponent(biasLat)}&lng=${encodeURIComponent(biasLng)}`
      );
      const data = await res.json();
      const first = Array.isArray(data.results) ? (data.results[0] as GeoPlace | undefined) : undefined;
      const resolvedLat = first?.lat ?? biasLat + 0.012;
      const resolvedLng = first?.lng ?? biasLng + 0.01;
      if (target === 'pickup') {
        applyGeoPlace('pickup', {
          displayName: item.address,
          shortName: item.label || item.address,
          lat: resolvedLat,
          lng: resolvedLng,
        });
      } else {
        updateStop(safeStopIdx, {
          address: item.address,
          lat: resolvedLat,
          lng: resolvedLng,
        });
        setStopQuery(item.address);
        setAddressSheetOpen(false);
      }
    } catch {
      if (target === 'stop') {
        updateStop(safeStopIdx, { address: item.address });
        setStopQuery(item.address);
        setAddressSheetOpen(false);
      }
    } finally {
      setSearchingPlaces(false);
      setSearchResults([]);
    }
  };

  const handleMapLocationSelected = (place: GeoPlace) => {
    if (panelState === 'searching' || panelState === 'confirmed' || panelState === 'order_form') return;
    if (mapPickMode === 'pickup') {
      applyGeoPlace('pickup', place);
    } else if (mapPickMode === 'stop') {
      applyGeoPlace('stop', place);
    } else if (panelState === 'initial') {
      applyGeoPlace('stop', place);
    }
  };

  // Context-aware Back action: cleanly forgets previous actions when stepping back!
  const handleSmartBack = () => {
    if (addressSheetOpen) {
      setAddressSheetOpen(false);
      setSearchResults([]);
      return;
    }
    if (mapPickMode !== 'none') {
      setMapPickMode('none');
      return;
    }
    if (panelState === 'driver_results') {
      setPhaseOverride('order_form');
      return;
    }
    if (panelState === 'order_form') {
      setPhaseOverride('auto');
      return;
    }
    if (panelState === 'route_ready') {
      // Stepping back from Route Preview forgets the selected destination cleanly & returns to State A
      const currentVehicle = draft.vehicleCategory;
      resetDraft('single');
      setDraft((prev) => ({
        ...prev,
        vehicleCategory: currentVehicle,
        pickup: draft.pickup,
      }));
      setPhaseOverride('auto');
      setStopQuery('');
      setRouteCoords([]);
      setRouteDistanceKm(0);
      setRouteDurationMin(0);
      setQuote(null);
      setQuoteError(null);
      return;
    }
    // Closing the entire flow forgets all draft state cleanly via closeComposer
    closeComposer();
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
    setStopQuery('');
    openFullAddressSheet('stop', 'suggested');
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

  const handleSaveDestinationAsFavorite = async () => {
    if (!currentStop?.address.trim()) return;
    setSavingFavorite(true);
    try {
      await saveRecipient({
        name: currentStop.recipientName.trim() || currentStop.address.split(',')[0].trim(),
        phone: currentStop.recipientPhone.trim() || '+225 00 00 00 00',
        address: currentStop.address.trim(),
        landmark: currentStop.landmark,
        instructions: currentStop.instructions,
        lat: currentStop.lat,
        lng: currentStop.lng,
      });
    } finally {
      setSavingFavorite(false);
    }
  };

  // Sync handoff chip + note into draft before dispatching
  const syncHandoffIntoDraft = useCallback(() => {
    const pNote = composeHandoffNote(pickupHandoff, pickupExtraNote, lang);
    const dNote = composeHandoffNote(dropoffHandoff, dropoffExtraNote, lang);
    setDraft((prev) => {
      const nextStops = [...prev.stops];
      if (nextStops[safeStopIdx]) {
        nextStops[safeStopIdx] = {
          ...nextStops[safeStopIdx],
          instructions: dNote,
        };
      }
      return {
        ...prev,
        pickup: { ...prev.pickup, instructions: pNote },
        stops: nextStops,
      };
    });
  }, [pickupHandoff, pickupExtraNote, dropoffHandoff, dropoffExtraNote, lang, safeStopIdx, setDraft]);

  // =========================================================================
  // REAL DRIVER SEARCH & REQUEST DISPATCH (Order Form -> C -> D -> E)
  // =========================================================================
  const dispatchDeliveryRequest = async (overrideDriverUid?: string) => {
    syncHandoffIntoDraft();
    const fallbackAmount = estimateVehiclePriceNumber(draft.vehicleCategory).amount;
    const totalAmount = quote?.total ?? fallbackAmount;
    setPhaseOverride('searching');

    const created = await submitDelivery(routeDistanceKm, routeDurationMin, totalAmount, {
      stayInBookingPanel: true,
      overrideDriverUid,
    });

    if (created) {
      setCreatedSnapshot(created);
      setActiveBookingId(created.id);
      setPhaseOverride('auto');
    } else {
      setPhaseOverride('order_form');
    }
  };

  const handleSubmitOrderForm = async () => {
    if (!draft.pickup.address.trim()) {
      showToast(t('Indiquez un point de départ.', 'Please enter a pickup location.'), 'error');
      openFullAddressSheet('pickup');
      return;
    }
    if (validStops.length === 0 || quoteError) return;
    syncHandoffIntoDraft();

    if (matchedDrivers.length > 0 && draft.timingType === 'instant') {
      setPhaseOverride('driver_results');
      return;
    }

    await dispatchDeliveryRequest();
  };

  const handleCancelActiveSearch = async () => {
    if (liveDelivery && CANCELLABLE_STATUSES.includes(liveDelivery.status)) {
      const ok = await cancelDelivery(liveDelivery.id);
      if (ok) {
        setActiveBookingId(null);
        setCreatedSnapshot(null);
        setPhaseOverride('auto');
      }
      return;
    }
    setActiveBookingId(null);
    setCreatedSnapshot(null);
    setPhaseOverride('auto');
  };

  const handleSearchAnotherDriver = () => {
    setActiveBookingId(null);
    setCreatedSnapshot(null);
    setPhaseOverride(matchedDrivers.length > 0 ? 'driver_results' : 'order_form');
  };

  const handleFinishAndTrack = () => {
    if (!liveDelivery) return;
    const id = liveDelivery.id;
    setActiveBookingId(null);
    setCreatedSnapshot(null);
    closeComposer();
    openShipmentDetail(id);
  };

  const handleSwitchToDedicatedReservation = () => {
    closeComposer();
    openReservationSheet();
  };

  const canProceedOrder =
    draft.pickup.address.trim().length > 0 &&
    validStops.length > 0 &&
    !quoteError &&
    !busy;

  const inputClass =
    'w-full rounded-xl bg-[#F5F5F5] border border-transparent focus:border-[#171717] focus:bg-white px-3.5 py-2.5 text-base sm:text-sm text-[#171717] placeholder:text-[#777777] focus:outline-none transition-colors';

  const renderSuggestionIcon = (icon: SmartSuggestion['icon']) => {
    if (icon === 'home') return <Home className="w-4 h-4 text-[#171717]" />;
    if (icon === 'work') return <Briefcase className="w-4 h-4 text-[#171717]" />;
    if (icon === 'favorite') return <Bookmark className="w-4 h-4 text-[#171717]" />;
    if (icon === 'recent') return <Clock className="w-4 h-4 text-[#E52B32]" />;
    return <MapPin className="w-4 h-4 text-[#777777]" />;
  };

  const renderHandoffIcon = (icon: 'door' | 'gate' | 'reception' | 'call') => {
    if (icon === 'door') return <DoorOpen className="w-3.5 h-3.5 shrink-0" />;
    if (icon === 'gate') return <MapPin className="w-3.5 h-3.5 shrink-0" />;
    if (icon === 'reception') return <Building2 className="w-3.5 h-3.5 shrink-0" />;
    return <PhoneCall className="w-3.5 h-3.5 shrink-0" />;
  };

  return (
    <>
      <AnimatePresence>
        {composerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] bg-[#EAEAEA] overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('Commander une livraison Rovia', 'Book a Rovia delivery')}
          >
            {/* ============================================================== */}
            {/* FULL-VIEWPORT INTERACTIVE MAP CANVAS                           */}
            {/* ============================================================== */}
            <div className="absolute inset-0">
              <RovaMap
                center={mapCenter}
                zoom={validStops.length > 0 ? 13 : 15}
                markers={mapMarkers}
                routeCoordinates={routeCoords}
                interactivePick={panelState === 'initial' || panelState === 'route_ready'}
                onLocationSelected={handleMapLocationSelected}
                followDriver={panelState === 'confirmed'}
                heightClass="h-full"
                className="h-full rounded-none border-0"
              />
            </div>

            {/* ============================================================== */}
            {/* FLOATING TOP MAP CONTROLS (Non-obstructive, >=44px touch)      */}
            {/* ============================================================== */}
            {!addressSheetOpen && (
              <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-4 pt-[max(0.875rem,env(safe-area-inset-top))] lg:left-[472px]">
                <button
                  type="button"
                  onClick={handleSmartBack}
                  aria-label={t('Retour', 'Back')}
                  className="pointer-events-auto lg:hidden min-w-[44px] min-h-[44px] rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E5] shadow-[0_6px_20px_rgba(23,23,23,0.14)] flex items-center justify-center text-[#171717] active:scale-95 transition-transform cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div className="flex-1 flex justify-center min-w-0">
                  {mapPickMode !== 'none' ? (
                    <button
                      type="button"
                      onClick={() => setMapPickMode('none')}
                      className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#171717] text-white text-xs font-semibold shadow-lg cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#E52B32]" />
                      <span className="truncate">
                        {mapPickMode === 'pickup'
                          ? t('Touchez la carte : Départ', 'Tap map: Pickup')
                          : t('Touchez la carte : Destination', 'Tap map: Destination')}
                      </span>
                      <X className="w-3.5 h-3.5 text-neutral-400" />
                    </button>
                  ) : routeDistanceKm > 0 ? (
                    <div className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E5] shadow-[0_6px_20px_rgba(23,23,23,0.12)] text-xs font-mono font-semibold text-[#171717] tabular-nums">
                      <span>{routeDistanceKm.toFixed(1)} km</span>
                      <span aria-hidden="true" className="text-[#A3A3A3]">·</span>
                      <span>~{routeDurationMin} min</span>
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => detectUserLocation(true)}
                  disabled={gpsLoading}
                  aria-label={t('Ma position GPS', 'My GPS location')}
                  title={t('Ma position GPS', 'My GPS location')}
                  className="pointer-events-auto min-w-[44px] min-h-[44px] rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E5] shadow-[0_6px_20px_rgba(23,23,23,0.14)] flex items-center justify-center text-[#171717] hover:text-[#E52B32] active:scale-95 transition-all cursor-pointer disabled:opacity-60"
                >
                  {gpsLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#E52B32]" />
                  ) : (
                    <Crosshair className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}

            {/* ============================================================== */}
            {/* FULL-HEIGHT FROM -> TO ADDRESS SHEET (Takes full page height)  */}
            {/* ============================================================== */}
            <AnimatePresence>
              {addressSheetOpen && (
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed inset-0 z-40 bg-white flex flex-col overflow-hidden lg:top-5 lg:left-5 lg:right-auto lg:bottom-5 lg:w-[440px] lg:rounded-[28px] lg:border lg:border-[#E5E5E5] lg:shadow-[0_20px_56px_rgba(23,23,23,0.2)]"
                >
                  {/* Top Header */}
                  <div className="shrink-0 px-4 pt-[max(0.875rem,env(safe-area-inset-top))] pb-3 border-b border-[#F0F0F0] flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAddressSheetOpen(false);
                        setSearchResults([]);
                      }}
                      aria-label={t('Retour', 'Back')}
                      className="min-w-[44px] min-h-[44px] -ml-1 rounded-full hover:bg-[#F3F3F3] flex items-center justify-center text-[#171717] cursor-pointer"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="font-display text-base font-bold text-[#171717]">
                      {t('Départ et destination', 'Pickup & destination')}
                    </h2>
                  </div>

                  {/* Connected From -> To Search Inputs with inline Maps Icon */}
                  <div className="shrink-0 px-4 py-3.5 bg-white border-b border-[#F0F0F0]">
                    <div className="rounded-2xl bg-[#F5F5F5] p-2.5 space-y-2">
                      {/* FROM (Pickup) Input */}
                      <div
                        className={`flex items-center gap-2.5 rounded-xl px-3 min-h-[46px] transition-colors ${
                          activeAddressInput === 'pickup'
                            ? 'bg-white ring-1 ring-[#171717]'
                            : 'bg-white/70'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-[#171717] shrink-0" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <span className="sr-only">{t('De (départ)', 'From')}</span>
                          <input
                            ref={pickupInputRef}
                            type="search"
                            value={pickupQuery}
                            onFocus={() => setActiveAddressInput('pickup')}
                            onChange={(e) => {
                              setActiveAddressInput('pickup');
                              setPickupQuery(e.target.value);
                            }}
                            placeholder={t('De · Votre position actuelle', 'From · Your current location')}
                            className="w-full bg-transparent text-base sm:text-sm font-medium text-[#171717] placeholder:text-[#777777] outline-none"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                          />
                        </div>
                        {activeAddressInput === 'pickup' && searchingPlaces && (
                          <Loader2 className="w-4 h-4 animate-spin text-[#777777] shrink-0" />
                        )}
                        <button
                          type="button"
                          onClick={() => detectUserLocation(true)}
                          aria-label={t('Ma position GPS', 'My GPS position')}
                          title={t('Ma position GPS', 'My GPS position')}
                          className="w-9 h-9 rounded-lg hover:bg-[#F3F3F3] text-[#777777] hover:text-[#171717] flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          {gpsLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[#E52B32]" />
                          ) : (
                            <Crosshair className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAddressSheetOpen(false);
                            setMapPickMode('pickup');
                          }}
                          aria-label={t('Placer le départ sur la carte', 'Pick departure on map')}
                          title={t('Sur la carte', 'On map')}
                          className="w-9 h-9 rounded-lg bg-[#171717] hover:bg-[#E52B32] text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                        >
                          <MapIcon className="w-4 h-4" />
                        </button>
                      </div>

                      {/* TO (Destination) Input */}
                      <div
                        className={`flex items-center gap-2.5 rounded-xl px-3 min-h-[46px] transition-colors ${
                          activeAddressInput === 'stop'
                            ? 'bg-white ring-1 ring-[#171717]'
                            : 'bg-white/70'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-[2px] bg-[#E52B32] shrink-0" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <span className="sr-only">{t('Vers (destination)', 'To')}</span>
                          <input
                            ref={stopInputRef}
                            type="search"
                            value={stopQuery}
                            onFocus={() => setActiveAddressInput('stop')}
                            onChange={(e) => {
                              setActiveAddressInput('stop');
                              setStopQuery(e.target.value);
                            }}
                            placeholder={t('Où envoyer votre colis ?', 'Where to send your package?')}
                            className="w-full bg-transparent text-base sm:text-sm font-medium text-[#171717] placeholder:text-[#777777] outline-none"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                          />
                        </div>
                        {activeAddressInput === 'stop' && searchingPlaces && (
                          <Loader2 className="w-4 h-4 animate-spin text-[#777777] shrink-0" />
                        )}
                        {stopQuery && !searchingPlaces && (
                          <button
                            type="button"
                            onClick={() => {
                              setStopQuery('');
                              setSearchResults([]);
                              stopInputRef.current?.focus();
                            }}
                            aria-label={t('Effacer', 'Clear')}
                            className="w-8 h-8 rounded-lg hover:bg-[#F3F3F3] text-[#777777] flex items-center justify-center shrink-0 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setAddressSheetOpen(false);
                            setMapPickMode('stop');
                          }}
                          aria-label={t('Placer la destination sur la carte', 'Pick destination on map')}
                          title={t('Sur la carte', 'On map')}
                          className="w-9 h-9 rounded-lg bg-[#171717] hover:bg-[#E52B32] text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                        >
                          <MapIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Segmented Tabs: Suggérés | Sauvegardés */}
                    {searchResults.length === 0 && (
                      <div className="mt-3 grid grid-cols-2 p-1 rounded-xl bg-[#F3F3F3] gap-1">
                        <button
                          type="button"
                          onClick={() => setAddressTab('suggested')}
                          className={`min-h-[38px] rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            addressTab === 'suggested'
                              ? 'bg-white text-[#171717] shadow-2xs'
                              : 'text-[#777777] hover:text-[#171717]'
                          }`}
                        >
                          {t('Suggérés', 'Suggested')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddressTab('saved')}
                          className={`min-h-[38px] rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            addressTab === 'saved'
                              ? 'bg-white text-[#171717] shadow-2xs'
                              : 'text-[#777777] hover:text-[#171717]'
                          }`}
                        >
                          {t('Sauvegardés', 'Saved')}
                          {recipients.length > 0 ? ` (${recipients.length})` : ''}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Full-height scrollable results / Suggested / Saved list */}
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                    {/* Live Autocomplete Results */}
                    {searchResults.length > 0 ? (
                      <div className="divide-y divide-[#F0F0F0]">
                        {searchResults.slice(0, 8).map((place, idx) => {
                          const anchorLat = userCoords?.[0] ?? draft.pickup.lat ?? region.lat;
                          const anchorLng = userCoords?.[1] ?? draft.pickup.lng ?? region.lng;
                          const dist = Number(
                            haversineDistanceKm(anchorLat, anchorLng, place.lat, place.lng).toFixed(1)
                          );
                          return (
                            <button
                              key={`${place.lat}-${place.lng}-${idx}`}
                              type="button"
                              onClick={() => applyGeoPlace(activeAddressInput, place)}
                              className="w-full min-h-[60px] py-3 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#F3F3F3] flex items-center justify-center shrink-0">
                                <MapPin className="w-4 h-4 text-[#171717]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[#171717] truncate">
                                  {place.shortName}
                                </span>
                                <span className="block text-xs text-[#777777] truncate">
                                  {place.displayName}
                                </span>
                              </span>
                              {Number.isFinite(dist) && dist < 80 && (
                                <span className="font-mono text-xs text-[#777777] tabular-nums shrink-0">
                                  {dist} km
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : activeSearchQuery.trim().length >= 2 && !searchingPlaces ? (
                      <div className="py-8 text-center space-y-3">
                        <p className="text-xs text-[#777777]">
                          {t('Aucun résultat exact trouvé pour cette recherche.', 'No exact match found for this search.')}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            applyGeoPlace(activeAddressInput, {
                              displayName: activeSearchQuery.trim(),
                              shortName: activeSearchQuery.trim(),
                              lat:
                                (userCoords?.[0] ?? draft.pickup.lat) +
                                (activeAddressInput === 'stop' ? 0.012 : 0),
                              lng:
                                (userCoords?.[1] ?? draft.pickup.lng) +
                                (activeAddressInput === 'stop' ? 0.01 : 0),
                            })
                          }
                          className="min-h-[42px] px-5 rounded-xl bg-[#171717] text-white text-xs font-semibold cursor-pointer"
                        >
                          {t(`Utiliser « ${activeSearchQuery.trim()} »`, `Use "${activeSearchQuery.trim()}"`)}
                        </button>
                      </div>
                    ) : addressTab === 'suggested' ? (
                      <div className="divide-y divide-[#F0F0F0]">
                        {loadingNearby && smartSuggestions.length === 0 ? (
                          <div className="py-6 space-y-3 animate-pulse">
                            {[1, 2, 3].map((k) => (
                              <div key={k} className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-[#F3F3F3]" />
                                <div className="flex-1 space-y-1.5">
                                  <div className="h-3.5 w-40 bg-[#F3F3F3] rounded" />
                                  <div className="h-3 w-56 bg-[#F3F3F3] rounded" />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          smartSuggestions.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => void applySuggestion(item, activeAddressInput)}
                              className="w-full min-h-[60px] py-3 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#F3F3F3] flex items-center justify-center shrink-0">
                                {renderSuggestionIcon(item.icon)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[#171717] truncate">
                                  {item.label}
                                </span>
                                <span className="block text-xs text-[#777777] truncate">
                                  {item.address}
                                </span>
                                <span className="block text-[11px] font-medium text-[#777777] mt-0.5">
                                  {lang === 'fr' ? item.reasonFr : item.reasonEn}
                                </span>
                              </span>
                              <ChevronRight className="w-4 h-4 text-[#BDBDBD] shrink-0" />
                            </button>
                          ))
                        )}
                      </div>
                    ) : (
                      /* Saved Addresses Tab */
                      <div className="divide-y divide-[#F0F0F0]">
                        {recipients.length > 0 ? (
                          recipients.map((rec) => {
                            const iconKind = classifyPlaceIcon(rec.name);
                            return (
                              <button
                                key={rec.id}
                                type="button"
                                onClick={() =>
                                  void applySuggestion(
                                    {
                                      id: rec.id,
                                      label: rec.name,
                                      address: rec.address,
                                      lat: rec.lat,
                                      lng: rec.lng,
                                      recipientName: rec.name,
                                      recipientPhone: rec.phone,
                                      landmark: rec.landmark,
                                      instructions: rec.instructions,
                                      source: 'favorite',
                                      reasonFr: 'Enregistré',
                                      reasonEn: 'Saved',
                                      score: 10,
                                      icon: iconKind,
                                    },
                                    activeAddressInput
                                  )
                                }
                                className="w-full min-h-[60px] py-3 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                              >
                                <span className="w-9 h-9 rounded-full bg-[#F3F3F3] flex items-center justify-center shrink-0">
                                  {renderSuggestionIcon(iconKind)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-[#171717] truncate">
                                    {rec.name}
                                  </span>
                                  <span className="block text-xs text-[#777777] truncate">
                                    {rec.address}
                                  </span>
                                </span>
                                <ChevronRight className="w-4 h-4 text-[#BDBDBD] shrink-0" />
                              </button>
                            );
                          })
                        ) : (
                          <div className="py-10 text-center space-y-2 px-4">
                            <Bookmark className="w-6 h-6 mx-auto text-[#BDBDBD]" />
                            <p className="text-sm font-semibold text-[#171717]">
                              {t('Aucune adresse sauvegardée', 'No saved places yet')}
                            </p>
                            <p className="text-xs text-[#777777]">
                              {t(
                                'Enregistrez vos destinations fréquentes (maison, boutique, bureau) depuis le formulaire de commande.',
                                'Save frequent destinations (home, store, office) directly from the order form.'
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ============================================================== */}
            {/* DYNAMIC EVOLVING BOTTOM PANEL (States A -> B -> Order -> C/D/E)*/}
            {/* ============================================================== */}
            {!addressSheetOpen && (
              <motion.aside
                layout="position"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={`absolute left-0 right-0 bottom-0 z-30 bg-white rounded-t-[28px] border-t border-[#E5E5E5] shadow-[0_-12px_40px_rgba(23,23,23,0.14)] flex flex-col overflow-hidden transition-[max-height] duration-200 ${
                  panelState === 'order_form'
                    ? 'max-h-[86dvh]'
                    : panelState === 'initial'
                    ? 'max-h-[60dvh]'
                    : 'max-h-[62dvh]'
                } lg:top-5 lg:left-5 lg:right-auto lg:bottom-5 lg:w-[440px] lg:max-h-[calc(100dvh-2.5rem)] lg:rounded-[28px] lg:border lg:shadow-[0_20px_56px_rgba(23,23,23,0.18)]`}
              >
                {/* Mobile drag handle + Desktop rail header */}
                <div className="shrink-0 pt-2.5 pb-1 px-5 flex items-center justify-between lg:pt-4 lg:pb-2.5 lg:border-b lg:border-[#F0F0F0]">
                  <div className="lg:hidden w-full flex justify-center">
                    <span className="w-10 h-1 rounded-full bg-[#DCDCDC]" aria-hidden="true" />
                  </div>
                  <div className="hidden lg:flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      {panelState !== 'initial' && panelState !== 'confirmed' && (
                        <button
                          type="button"
                          onClick={handleSmartBack}
                          aria-label={t('Retour', 'Back')}
                          className="w-8 h-8 -ml-1.5 rounded-full hover:bg-[#F3F3F3] text-[#171717] flex items-center justify-center cursor-pointer"
                        >
                          <ArrowLeft className="w-4 h-4" />
                        </button>
                      )}
                      <span className="font-display text-base font-bold tracking-tight text-[#171717]">
                        Rovia<span className="text-[#E52B32]">.</span>
                      </span>
                      <span className="text-xs text-[#777777]">·</span>
                      <span className="text-xs font-medium text-[#777777]">
                        {panelState === 'initial' && t('Livraison', 'Delivery')}
                        {panelState === 'route_ready' && t('Itinéraire', 'Route')}
                        {panelState === 'order_form' && t('Détails de la commande', 'Order details')}
                        {panelState === 'searching' && t('Recherche en cours', 'Searching')}
                        {panelState === 'driver_results' && t('Livreurs disponibles', 'Available drivers')}
                        {panelState === 'confirmed' && t('Livraison confirmée', 'Confirmed')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={closeComposer}
                      aria-label={t('Fermer', 'Close')}
                      className="min-w-[38px] min-h-[38px] rounded-full hover:bg-[#F3F3F3] text-[#777777] hover:text-[#171717] flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Scrollable Body */}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3.5">
                  {gpsStatusNote && panelState === 'initial' && (
                    <p className="text-xs text-[#777777] flex items-center justify-between gap-2 px-1">
                      <span className="truncate">{gpsStatusNote}</span>
                      <button
                        type="button"
                        onClick={() => setGpsStatusNote(null)}
                        className="text-[#171717] font-semibold shrink-0 cursor-pointer"
                      >
                        OK
                      </button>
                    </p>
                  )}

                  {/* ======================================================== */}
                  {/* STATE A — INITIAL MAP-FIRST SCREEN (inDrive-style)       */}
                  {/* ======================================================== */}
                  {panelState === 'initial' && (
                    <div className="space-y-3.5">
                      {/* Horizontal Swipable Vehicle Selector */}
                      <div
                        className="flex items-stretch gap-2.5 overflow-x-auto snap-x snap-mandatory no-scrollbar -mx-1 px-1 pb-0.5"
                        role="radiogroup"
                        aria-label={t('Choisir un véhicule', 'Choose a vehicle')}
                      >
                        {VEHICLE_CATALOG.map((v) => {
                          const selected = draft.vehicleCategory === v.id;
                          const liveInfo = vehicleEtaMap[v.id];
                          const est = estimateVehiclePriceNumber(v.id);
                          return (
                            <button
                              key={v.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => selectVehicle(v.id)}
                              className={`snap-start shrink-0 w-[124px] sm:w-[130px] rounded-2xl p-2.5 text-left transition-all cursor-pointer active:scale-[0.97] flex flex-col justify-between gap-1.5 border ${
                                selected
                                  ? 'border-[#171717] bg-[#FAFAFA] ring-1 ring-[#171717]'
                                  : 'border-[#E8E8E8] bg-white hover:border-[#BDBDBD]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-mono font-medium text-[#777777] tabular-nums truncate">
                                  {liveInfo ? `~${liveInfo.etaMin} min` : `≤ ${v.maxWeightKg} kg`}
                                </span>
                                {selected && (
                                  <span className="w-4 h-4 rounded-full bg-[#E52B32] text-white flex items-center justify-center shrink-0">
                                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                                  </span>
                                )}
                              </div>

                              <div className="h-[52px] rounded-xl bg-[#F3F3F3] flex items-center justify-center overflow-hidden px-1">
                                <VehicleStudioImage
                                  category={v.id}
                                  alt={lang === 'fr' ? v.labelFr : v.label}
                                  className="w-full h-full"
                                />
                              </div>

                              <div>
                                <p className="font-display text-xs font-bold text-[#171717] truncate">
                                  {lang === 'fr' ? v.labelFr : v.label}
                                </p>
                                <p className="font-mono text-[11px] font-semibold text-[#777777] tabular-nums truncate">
                                  {formatLocalMoney(est.amount, est.currency)}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Prominent "Où envoyer votre colis ?" bar with inline Maps icon */}
                      <div className="flex items-center gap-2 rounded-2xl bg-[#F3F3F3] p-1.5">
                        <button
                          type="button"
                          onClick={() => openFullAddressSheet('stop', 'suggested')}
                          className="flex-1 min-w-0 min-h-[46px] px-2.5 flex items-center gap-3 text-left cursor-pointer rounded-xl hover:bg-white/60 transition-colors"
                        >
                          <span className="w-9 h-9 rounded-full bg-white text-[#E52B32] flex items-center justify-center shrink-0 shadow-2xs">
                            <Search className="w-4 h-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-display text-[15px] font-bold text-[#171717] truncate">
                              {t('Où envoyer votre colis ?', 'Where to send your package?')}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setMapPickMode('stop')}
                          aria-label={t('Choisir sur la carte', 'Pick on map')}
                          title={t('Choisir sur la carte', 'Pick on map')}
                          className="w-10 h-10 rounded-xl bg-[#171717] hover:bg-[#E52B32] text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                        >
                          <MapIcon className="w-4 h-4" />
                        </button>
                      </div>

                      {/* At least 3 Smart / Nearby Default Places */}
                      <div className="divide-y divide-[#F2F2F2]">
                        {loadingNearby && smartSuggestions.length === 0 ? (
                          <div className="py-2 space-y-2.5 animate-pulse">
                            {[1, 2, 3].map((k) => (
                              <div key={k} className="flex items-center gap-3 py-1">
                                <div className="w-9 h-9 rounded-full bg-[#F3F3F3]" />
                                <div className="flex-1 space-y-1.5">
                                  <div className="h-3.5 w-36 bg-[#F3F3F3] rounded" />
                                  <div className="h-3 w-52 bg-[#F3F3F3] rounded" />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          smartSuggestions.slice(0, 4).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => void applySuggestion(item, 'stop')}
                              className="w-full min-h-[56px] py-2 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#F3F3F3] flex items-center justify-center shrink-0">
                                {renderSuggestionIcon(item.icon)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[#171717] truncate">
                                  {item.label}
                                </span>
                                <span className="block text-xs text-[#777777] truncate">
                                  {item.address}
                                </span>
                              </span>
                              <span className="text-[11px] font-medium text-[#777777] shrink-0 text-right">
                                {item.source === 'habit' ? (
                                  <span className="inline-flex items-center gap-1 text-[#E52B32] font-semibold">
                                    <Sparkles className="w-3 h-3" />
                                    {lang === 'fr' ? item.reasonFr : item.reasonEn}
                                  </span>
                                ) : item.distanceKm !== undefined ? (
                                  <span className="font-mono tabular-nums">{item.distanceKm} km</span>
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-[#BDBDBD]" />
                                )}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* STATE B — ROUTE PREVIEW ON MAP (From -> To + Vehicle)    */}
                  {/* ======================================================== */}
                  {panelState === 'route_ready' && currentStop && (
                    <div className="space-y-3.5">
                      {/* Editable From -> To Card */}
                      <div className="rounded-2xl bg-[#F6F6F6] p-2.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openFullAddressSheet('pickup')}
                            className="flex-1 min-w-0 min-h-[44px] px-2 py-1.5 rounded-xl hover:bg-white/80 flex items-center gap-3 text-left transition-colors cursor-pointer"
                          >
                            <span className="w-2.5 h-2.5 rounded-full bg-[#171717] shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] font-medium text-[#777777]">
                                {t('De · Départ', 'From · Pickup')}
                              </span>
                              <span className="block text-sm font-semibold text-[#171717] truncate">
                                {draft.pickup.address ||
                                  t('Indiquer le point de départ...', 'Set pickup location...')}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMapPickMode('pickup')}
                            aria-label={t('Départ sur la carte', 'Pickup on map')}
                            className="w-9 h-9 rounded-xl bg-white hover:bg-[#171717] hover:text-white text-[#171717] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                          >
                            <MapIcon className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="mx-3 border-t border-[#E6E6E6]" />

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openFullAddressSheet('stop')}
                            className="flex-1 min-w-0 min-h-[44px] px-2 py-1.5 rounded-xl hover:bg-white/80 flex items-center gap-3 text-left transition-colors cursor-pointer"
                          >
                            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#E52B32] shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] font-medium text-[#777777]">
                                {draft.stops.length > 1
                                  ? t(`Vers · Arrêt #${safeStopIdx + 1}/${draft.stops.length}`, `To · Stop #${safeStopIdx + 1}/${draft.stops.length}`)
                                  : t('Vers · Destination', 'To · Destination')}
                              </span>
                              <span className="block text-sm font-semibold text-[#171717] truncate">
                                {currentStop.address}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMapPickMode('stop')}
                            aria-label={t('Destination sur la carte', 'Destination on map')}
                            className="w-9 h-9 rounded-xl bg-white hover:bg-[#171717] hover:text-white text-[#171717] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                          >
                            <MapIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Horizontal Vehicle Selector */}
                      <div
                        className="flex items-stretch gap-2 overflow-x-auto snap-x snap-mandatory no-scrollbar -mx-1 px-1"
                        role="radiogroup"
                        aria-label={t('Véhicule', 'Vehicle')}
                      >
                        {VEHICLE_CATALOG.map((v) => {
                          const selected = draft.vehicleCategory === v.id;
                          const liveInfo = vehicleEtaMap[v.id];
                          const est = estimateVehiclePriceNumber(v.id);
                          return (
                            <button
                              key={v.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => selectVehicle(v.id)}
                              className={`snap-start shrink-0 w-[114px] rounded-2xl p-2 text-left transition-all cursor-pointer active:scale-[0.97] border ${
                                selected
                                  ? 'border-[#171717] bg-[#FAFAFA] ring-1 ring-[#171717]'
                                  : 'border-[#E8E8E8] bg-white hover:border-[#BDBDBD]'
                              }`}
                            >
                              <div className="h-[42px] rounded-xl bg-[#F3F3F3] flex items-center justify-center overflow-hidden px-1 mb-1.5">
                                <VehicleStudioImage
                                  category={v.id}
                                  alt={lang === 'fr' ? v.labelFr : v.label}
                                  className="w-full h-full"
                                />
                              </div>
                              <p className="font-display text-[11.5px] font-bold text-[#171717] truncate">
                                {lang === 'fr' ? v.labelFr : v.label}
                              </p>
                              <p className="font-mono text-[11px] font-semibold text-[#171717] tabular-nums truncate">
                                {formatLocalMoney(est.amount, est.currency)}
                              </p>
                              {liveInfo && (
                                <p className="font-mono text-[10px] text-[#777777] tabular-nums">
                                  ~{liveInfo.etaMin} min
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Unboxed Route & Fare Summary */}
                      {quoteError ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                          <p className="font-semibold text-red-900">
                            {t('Zone de livraison non desservie', 'Delivery route not supported')}
                          </p>
                          <p className="mt-0.5">{quoteError}</p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 px-1 text-xs text-[#777777]">
                          <div className="flex items-center gap-1.5 min-w-0 truncate">
                            <span className="font-medium text-[#171717] truncate">
                              {getVehicleLabel(draft.vehicleCategory, lang)}
                            </span>
                            {routeDistanceKm > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">{routeDistanceKm.toFixed(1)} km</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">~{routeDurationMin} min</span>
                              </>
                            )}
                            {quoteMeta && !quoteMeta.isFallbackEstimate && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{quoteMeta.cityName}</span>
                              </>
                            )}
                          </div>
                          <span className="font-mono text-sm font-bold text-[#171717] tabular-nums shrink-0">
                            {displayedPrice}
                          </span>
                        </div>
                      )}

                      {/* Primary CTA -> Clean 1-step Order Form */}
                      <button
                        type="button"
                        disabled={!canProceedOrder}
                        onClick={() => setPhaseOverride('order_form')}
                        className="w-full min-h-[52px] px-6 rounded-2xl bg-[#E52B32] hover:bg-[#CC2229] text-white font-display text-[15px] font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.985] disabled:opacity-40 cursor-pointer shadow-[0_8px_22px_rgba(229,43,50,0.28)]"
                      >
                        <span>
                          {t('Continuer la commande', 'Continue to order')} · {displayedPrice}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* ORDER FORM — 1 SINGLE CLEAN STRUCTURED SHEET             */}
                  {/* (Handoff options, Recipient, Parcel, Planning, Payment)  */}
                  {/* ======================================================== */}
                  {panelState === 'order_form' && currentStop && (
                    <div className="space-y-4">
                      {/* Header with Back & Price */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => setPhaseOverride('auto')}
                            aria-label={t('Retour à la carte', 'Back to map')}
                            className="lg:hidden min-w-[38px] min-h-[38px] -ml-1 rounded-full hover:bg-[#F3F3F3] flex items-center justify-center text-[#171717] cursor-pointer"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </button>
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-bold text-[#171717] truncate">
                              {t('Détails de la livraison', 'Delivery details')}
                            </h3>
                            <p className="text-xs text-[#777777] truncate">
                              {getVehicleLabel(draft.vehicleCategory, lang)}
                              {routeDistanceKm > 0 ? ` · ${routeDistanceKm.toFixed(1)} km` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-base font-bold text-[#171717] tabular-nums shrink-0">
                          {displayedPrice}
                        </span>
                      </div>

                      {/* 1. ACCÈS & REMISE (À la porte, Au portail, À l'accueil, Appel) */}
                      <div className="space-y-3 pt-2 border-t border-[#F0F0F0]">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-[#171717]">
                            {t('Collecte (Départ) · Où le livreur récupère le colis ?', 'Pickup · Where should the courier collect?')}
                          </p>
                          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                            {HANDOFF_OPTIONS.map((opt) => {
                              const active = pickupHandoff === opt.id;
                              return (
                                <button
                                  key={`p_${opt.id}`}
                                  type="button"
                                  onClick={() => setPickupHandoff(opt.id)}
                                  className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                                    active
                                      ? 'bg-[#171717] text-white'
                                      : 'bg-[#F3F3F3] text-[#171717] hover:bg-[#EAEAEA]'
                                  }`}
                                >
                                  {renderHandoffIcon(opt.icon)}
                                  <span>{lang === 'fr' ? opt.labelFr : opt.labelEn}</span>
                                </button>
                              );
                            })}
                          </div>
                          <input
                            type="text"
                            value={pickupExtraNote}
                            onChange={(e) => setPickupExtraNote(e.target.value)}
                            placeholder={t(
                              'Précision départ : étage, numéro de porte, repère...',
                              'Pickup note: floor, door number, landmark...'
                            )}
                            className={inputClass}
                          />
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-[#171717]">
                            {t('Remise (Destination) · Comment livrer au destinataire ?', 'Drop-off · How should the courier hand over?')}
                          </p>
                          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                            {HANDOFF_OPTIONS.map((opt) => {
                              const active = dropoffHandoff === opt.id;
                              return (
                                <button
                                  key={`d_${opt.id}`}
                                  type="button"
                                  onClick={() => setDropoffHandoff(opt.id)}
                                  className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                                    active
                                      ? 'bg-[#E52B32] text-white'
                                      : 'bg-[#F3F3F3] text-[#171717] hover:bg-[#EAEAEA]'
                                  }`}
                                >
                                  {renderHandoffIcon(opt.icon)}
                                  <span>{lang === 'fr' ? opt.labelFr : opt.labelEn}</span>
                                </button>
                              );
                            })}
                          </div>
                          <input
                            type="text"
                            value={dropoffExtraNote}
                            onChange={(e) => setDropoffExtraNote(e.target.value)}
                            placeholder={t(
                              'Précision livraison : code porte, bâtiment, appartement...',
                              'Drop-off note: gate code, building, apartment...'
                            )}
                            className={inputClass}
                          />
                        </div>
                      </div>

                      {/* 2. DESTINATAIRE & MULTI-ARRÊTS */}
                      <div className="space-y-2.5 pt-3 border-t border-[#F0F0F0]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[#171717]">
                            {draft.stops.length > 1
                              ? t(`Destinataire #${safeStopIdx + 1}`, `Recipient #${safeStopIdx + 1}`)
                              : t('Destinataire', 'Recipient')}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={savingFavorite}
                              onClick={() => void handleSaveDestinationAsFavorite()}
                              className="min-h-[32px] px-2.5 rounded-lg bg-[#F3F3F3] hover:bg-[#EAEAEA] text-[11px] font-semibold text-[#171717] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {savingFavorite ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Bookmark className="w-3 h-3" />
                              )}
                              <span>{t('Sauvegarder', 'Save')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={addStop}
                              className="min-h-[32px] px-2.5 rounded-lg bg-[#F3F3F3] hover:bg-[#EAEAEA] text-[11px] font-semibold text-[#171717] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>{t('Arrêt', 'Stop')}</span>
                            </button>
                          </div>
                        </div>

                        {draft.stops.length > 1 && (
                          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                            {draft.stops.map((s, idx) => (
                              <div
                                key={s.id}
                                className={`inline-flex items-center rounded-xl text-xs font-semibold shrink-0 ${
                                  idx === safeStopIdx
                                    ? 'bg-[#171717] text-white'
                                    : 'bg-[#F3F3F3] text-[#171717]'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => setActiveStopIdx(idx)}
                                  className="px-3 py-1.5 cursor-pointer"
                                >
                                  #{idx + 1}
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveStop(idx, -1)}
                                  className="p-1 opacity-70 hover:opacity-100 disabled:opacity-25 cursor-pointer"
                                  aria-label={t('Monter', 'Move up')}
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === draft.stops.length - 1}
                                  onClick={() => moveStop(idx, 1)}
                                  className="p-1 opacity-70 hover:opacity-100 disabled:opacity-25 cursor-pointer"
                                  aria-label={t('Descendre', 'Move down')}
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeStop(idx)}
                                  className="p-1.5 text-[#E52B32] cursor-pointer"
                                  aria-label={t('Supprimer', 'Remove')}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              disabled={optimizing}
                              onClick={handleOptimizeRoute}
                              className="min-h-[32px] px-2.5 rounded-xl bg-[#F3F3F3] text-xs font-semibold text-[#171717] inline-flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                              {optimizing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Route className="w-3 h-3" />
                              )}
                              <span>{t('Optimiser', 'Optimize')}</span>
                            </button>
                            <label className="min-h-[32px] px-2.5 rounded-xl bg-[#F3F3F3] text-xs font-semibold text-[#171717] inline-flex items-center gap-1 shrink-0 cursor-pointer">
                              <Upload className="w-3 h-3" />
                              <span>CSV</span>
                              <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                            </label>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                        </div>
                      </div>

                      {/* 3. PLANIFICATION INTÉGRÉE INTELLIGEMMENT */}
                      <div className="space-y-2.5 pt-3 border-t border-[#F0F0F0]">
                        <p className="text-xs font-semibold text-[#171717]">
                          {t('Horaire & planification', 'Timing & scheduling')}
                        </p>
                        <div className="grid grid-cols-2 p-1 rounded-xl bg-[#F3F3F3] gap-1">
                          <button
                            type="button"
                            onClick={() => setDraft((p) => ({ ...p, timingType: 'instant', scheduledFor: '' }))}
                            className={`min-h-[40px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                              draft.timingType === 'instant'
                                ? 'bg-white text-[#171717] shadow-2xs'
                                : 'text-[#777777]'
                            }`}
                          >
                            <Zap className="w-3.5 h-3.5 text-[#E52B32]" />
                            <span>{t('Maintenant', 'Now')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraft((p) => ({ ...p, timingType: 'scheduled' }))}
                            className={`min-h-[40px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                              draft.timingType === 'scheduled'
                                ? 'bg-white text-[#171717] shadow-2xs'
                                : 'text-[#777777]'
                            }`}
                          >
                            <CalendarClock className="w-3.5 h-3.5" />
                            <span>{t('Planifier', 'Schedule')}</span>
                          </button>
                        </div>

                        {draft.timingType === 'scheduled' && (
                          <div className="space-y-2">
                            <input
                              type="datetime-local"
                              value={draft.scheduledFor}
                              onChange={(e) => setDraft((p) => ({ ...p, scheduledFor: e.target.value }))}
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={handleSwitchToDedicatedReservation}
                              className="w-full py-2 px-3 rounded-xl bg-[#FAFAFA] hover:bg-[#F3F3F3] border border-[#E5E5E5] text-left flex items-center justify-between gap-2 text-xs text-[#777777] hover:text-[#171717] transition-colors cursor-pointer"
                            >
                              <span className="truncate">
                                {t(
                                  'Besoin d’un chauffeur dédié (demi-journée / journée) ?',
                                  'Need a dedicated driver (hours / full day)?'
                                )}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 4. COLIS & PREUVE DE REMISE */}
                      <div className="space-y-2.5 pt-3 border-t border-[#F0F0F0]">
                        <p className="text-xs font-semibold text-[#171717]">
                          {t('Colis et sécurité', 'Parcel & security')}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={draft.packageType}
                            onChange={(e) => setDraft((p) => ({ ...p, packageType: e.target.value }))}
                            placeholder={t('Contenu (documents, carton, repas...)', 'Contents (docs, box, food...)')}
                            className={`${inputClass} col-span-2`}
                          />
                          <div>
                            <label className="block text-[11px] text-[#777777] mb-1">
                              {t('Poids (kg)', 'Weight (kg)')}
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
                            <label className="block text-[11px] text-[#777777] mb-1">
                              {t('Preuve de remise', 'Proof of delivery')}
                            </label>
                            <select
                              value={draft.proofRequired}
                              onChange={(e) =>
                                setDraft((p) => ({ ...p, proofRequired: e.target.value as ProofType }))
                              }
                              className={inputClass}
                            >
                              <option value="otp">{t('Code OTP', 'OTP Code')}</option>
                              <option value="signature">{t('Signature', 'Signature')}</option>
                              <option value="photo">{t('Photo', 'Photo')}</option>
                              <option value="recipient_confirm">{t('Confirmation', 'Confirm')}</option>
                            </select>
                          </div>
                        </div>

                        <label className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#F5F5F5] text-xs font-medium text-[#171717] cursor-pointer">
                          <span className="inline-flex items-center gap-2">
                            <Package className="w-4 h-4 text-[#777777]" />
                            <span>{t('Colis fragile (manutention soignée)', 'Fragile parcel (careful handling)')}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={draft.fragile}
                            onChange={(e) => setDraft((p) => ({ ...p, fragile: e.target.checked }))}
                            className="w-4 h-4 accent-[#E52B32]"
                          />
                        </label>
                      </div>

                      {/* 5. MODE DE PAIEMENT */}
                      <div className="pt-3 border-t border-[#F0F0F0]">
                        <button
                          type="button"
                          onClick={() => setPaymentModalOpen(true)}
                          className="w-full min-h-[52px] px-3.5 py-2.5 rounded-2xl bg-[#F5F5F5] hover:bg-[#EAEAEA] flex items-center justify-between gap-3 transition-colors cursor-pointer text-left"
                        >
                          <span className="inline-flex items-center gap-2.5 min-w-0">
                            <CreditCard className="w-4 h-4 text-[#171717] shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-[11px] text-[#777777]">
                                {t('Mode de paiement', 'Payment method')}
                              </span>
                              <span className="block text-sm font-semibold text-[#171717] truncate">
                                {getPaymentMethodLabelEn(draft.paymentMethod)}
                              </span>
                            </span>
                          </span>
                          <span className="text-xs font-semibold text-[#E52B32] inline-flex items-center gap-0.5 shrink-0">
                            <span>{t('Changer', 'Change')}</span>
                            <ChevronRight className="w-4 h-4" />
                          </span>
                        </button>
                      </div>

                      {/* PRIMARY SUBMIT CTA */}
                      <button
                        type="button"
                        disabled={!canProceedOrder}
                        onClick={() => void handleSubmitOrderForm()}
                        className="w-full min-h-[52px] px-6 rounded-2xl bg-[#E52B32] hover:bg-[#CC2229] text-white font-display text-[15px] font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.985] disabled:opacity-40 cursor-pointer shadow-[0_8px_22px_rgba(229,43,50,0.28)]"
                      >
                        {busy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : draft.timingType === 'scheduled' ? (
                          <CalendarClock className="w-4 h-4" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                        <span>
                          {busy
                            ? t('Recherche en cours...', 'Searching...')
                            : draft.timingType === 'scheduled'
                            ? `${t('Confirmer la planification', 'Confirm scheduled delivery')} · ${displayedPrice}`
                            : `${t('Trouver un livreur', 'Find delivery drivers')} · ${displayedPrice}`}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* STATE D — DRIVER RESULTS (Real Online Drivers Matched)   */}
                  {/* ======================================================== */}
                  {panelState === 'driver_results' && (
                    <div className="space-y-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="font-display text-base font-bold text-[#171717]">
                            {t('Livreurs disponibles à proximité', 'Available drivers nearby')}
                          </h3>
                          <p className="text-xs text-[#777777]">
                            {matchedDrivers.length}{' '}
                            {matchedDrivers.length > 1
                              ? t('livreurs compatibles en ligne', 'matching drivers online')
                              : t('livreur compatible en ligne', 'matching driver online')}{' '}
                            · {displayedPrice}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPhaseOverride('order_form')}
                          className="min-h-[36px] px-3 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] cursor-pointer"
                        >
                          {t('Retour', 'Back')}
                        </button>
                      </div>

                      {matchedDrivers.length > 0 ? (
                        <div className="divide-y divide-[#EFEFEF]">
                          {matchedDrivers.slice(0, 5).map((match) => (
                            <div
                              key={match.driver.uid}
                              className="py-3 flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-full bg-[#171717] text-white font-display text-sm font-bold flex items-center justify-center shrink-0">
                                  {match.driver.firstName.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-display text-sm font-bold text-[#171717] truncate">
                                    {match.driver.firstName}
                                  </p>
                                  <p className="text-xs text-[#777777] flex items-center gap-1.5 flex-wrap">
                                    <span>{getVehicleLabel(match.driver.vehicleCategory, lang)}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">~{match.etaMinutes} min</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-0.5 font-mono tabular-nums text-[#171717]">
                                      <Star className="w-3 h-3 fill-[#171717]" />
                                      {match.driver.rating.toFixed(1)}
                                    </span>
                                  </p>
                                  <p className="text-[11px] text-[#777777] font-mono tabular-nums">
                                    {match.distanceKm} km · {displayedPrice}
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void dispatchDeliveryRequest(match.driver.uid)}
                                className="min-h-[42px] px-4 rounded-xl bg-[#E52B32] hover:bg-[#CC2229] text-white text-xs font-semibold transition-colors active:scale-[0.97] disabled:opacity-40 cursor-pointer shrink-0 whitespace-nowrap"
                              >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Choisir', 'Select')}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-4 text-center space-y-3">
                          <p className="text-xs text-[#777777]">
                            {t(
                              'Aucun livreur en ligne pour le moment. Vous pouvez envoyer la demande au réseau.',
                              'No drivers online right now. You can still broadcast your request.'
                            )}
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void dispatchDeliveryRequest()}
                            className="w-full min-h-[48px] rounded-2xl bg-[#E52B32] text-white text-sm font-semibold cursor-pointer"
                          >
                            {t('Envoyer la demande au réseau', 'Send request to network')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* STATE C — SEARCHING / REAL REQUEST STATUS PROGRESSION    */}
                  {/* ======================================================== */}
                  {panelState === 'searching' && (
                    <div className="space-y-4 py-1">
                      {liveDelivery && (liveDelivery.status === 'cancelled' || liveDelivery.status === 'failed') ? (
                        <div className="space-y-3.5">
                          <div className="space-y-1">
                            <h3 className="font-display text-base font-bold text-[#171717]">
                              {liveDelivery.status === 'failed'
                                ? t('Livreur indisponible', 'Driver unavailable')
                                : t('Demande annulée', 'Request cancelled')}
                            </h3>
                            <p className="text-xs text-[#777777]">
                              {t(
                                'Votre itinéraire est conservé. Vous pouvez relancer la recherche sans tout ressaisir.',
                                'Your route is ready. Continue searching without restarting.'
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleSearchAnotherDriver}
                            className="w-full min-h-[50px] rounded-2xl bg-[#E52B32] hover:bg-[#CC2229] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <RefreshCw className="w-4 h-4" />
                            <span>{t('Rechercher un autre livreur', 'Search for another driver')}</span>
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <p className="text-xs font-mono font-semibold text-[#777777]">
                                {liveDelivery
                                  ? `${liveDelivery.reference} · ${getStatusLabel(liveDelivery.status, lang)}`
                                  : t('Recherche de livreurs', 'Finding drivers')}
                              </p>
                              <h3 className="font-display text-base font-bold text-[#171717]">
                                {liveDelivery?.status === 'scheduled'
                                  ? t('Livraison planifiée enregistrée', 'Scheduled delivery saved')
                                  : liveDelivery
                                  ? t('Demande envoyée aux livreurs proches', 'Request sent to nearby drivers')
                                  : t('Recherche de livreurs disponibles...', 'Searching for nearby drivers...')}
                              </h3>
                              <p className="text-xs text-[#777777]">
                                {getVehicleLabel(liveDelivery?.vehicleCategory || draft.vehicleCategory, lang)} ·{' '}
                                <span className="font-mono tabular-nums">
                                  {liveDelivery
                                    ? formatLocalMoney(liveDelivery.quotedPrice, liveDelivery.currency)
                                    : displayedPrice}
                                </span>
                              </p>
                            </div>
                            <div className="w-11 h-11 rounded-2xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
                              <Loader2 className="w-5 h-5 animate-spin text-[#E52B32]" />
                            </div>
                          </div>

                          <div className="h-1 w-full rounded-full bg-[#EFEFEF] overflow-hidden">
                            <motion.div
                              initial={{ x: '-100%' }}
                              animate={{ x: '100%' }}
                              transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                              className="h-full w-1/2 rounded-full bg-[#E52B32]"
                            />
                          </div>

                          <div className="rounded-2xl bg-[#F6F6F6] p-3 space-y-1.5 text-xs">
                            <div className="flex items-center gap-2 text-[#171717]">
                              <span className="w-2 h-2 rounded-full bg-[#171717] shrink-0" />
                              <span className="truncate font-medium">
                                {liveDelivery?.pickupAddress || draft.pickup.address}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[#171717]">
                              <span className="w-2 h-2 rounded-[2px] bg-[#E52B32] shrink-0" />
                              <span className="truncate font-medium">
                                {liveDelivery?.primaryDestinationLabel || currentStop?.address}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleCancelActiveSearch()}
                              className="flex-1 min-h-[46px] rounded-2xl border border-[#E5E5E5] hover:border-[#171717] bg-white text-xs font-semibold text-[#171717] transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {t('Annuler la recherche', 'Cancel search')}
                            </button>
                            {liveDelivery && (
                              <button
                                type="button"
                                onClick={handleFinishAndTrack}
                                className="flex-1 min-h-[46px] rounded-2xl bg-[#171717] hover:bg-neutral-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                              >
                                {t('Ouvrir le suivi', 'Open tracking')}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* STATE E — DRIVER CONFIRMED (Live Tracking Panel)         */}
                  {/* ======================================================== */}
                  {panelState === 'confirmed' && liveDelivery && (
                    <div className="space-y-3.5 py-0.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-xs font-mono font-semibold text-[#777777]">
                            {liveDelivery.reference}
                          </p>
                          <h3 className="font-display text-base font-bold text-[#171717]">
                            <span className={STATUS_META[liveDelivery.status]?.text || 'text-[#171717]'}>
                              {getStatusLabel(liveDelivery.status, lang)}
                            </span>
                          </h3>
                        </div>
                        <span className="font-mono text-sm font-bold text-[#171717] tabular-nums shrink-0">
                          {formatLocalMoney(liveDelivery.quotedPrice, liveDelivery.currency)}
                        </span>
                      </div>

                      <div className="rounded-2xl bg-[#F6F6F6] p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-full bg-[#171717] text-white font-display text-sm font-bold flex items-center justify-center shrink-0">
                            {(liveDelivery.driverName || 'R').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-display text-sm font-bold text-[#171717] truncate">
                              {liveDelivery.driverName || t('Livreur Rovia assigné', 'Assigned Rovia courier')}
                            </p>
                            <p className="text-xs text-[#777777] truncate">
                              {getVehicleLabel(liveDelivery.vehicleCategory, lang)}
                              {liveDelivery.estimatedDurationMin > 0
                                ? ` · ~${liveDelivery.estimatedDurationMin} min`
                                : ''}
                            </p>
                          </div>
                        </div>
                        <div className="w-14 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden px-1 shrink-0">
                          <VehicleStudioImage
                            category={liveDelivery.vehicleCategory}
                            alt={getVehicleLabel(liveDelivery.vehicleCategory, lang)}
                            className="w-full h-full"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 px-1 text-xs">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1 w-2 h-2 rounded-full bg-[#171717] shrink-0" />
                          <p className="text-[#171717] font-medium leading-snug">{liveDelivery.pickupAddress}</p>
                        </div>
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1 w-2 h-2 rounded-[2px] bg-[#E52B32] shrink-0" />
                          <p className="text-[#171717] font-medium leading-snug">
                            {liveDelivery.primaryDestinationLabel || currentStop?.address}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={handleFinishAndTrack}
                          className="flex-1 min-h-[48px] px-4 rounded-2xl bg-[#E52B32] hover:bg-[#CC2229] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                          <Navigation className="w-4 h-4" />
                          <span>{t('Suivi complet & OTP', 'Full tracking & OTP')}</span>
                        </button>

                        {CANCELLABLE_STATUSES.includes(liveDelivery.status) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleCancelActiveSearch()}
                            className="min-h-[48px] px-4 rounded-2xl border border-[#E5E5E5] hover:border-[#171717] bg-white text-xs font-semibold text-[#171717] cursor-pointer disabled:opacity-50"
                          >
                            {t('Annuler', 'Cancel')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={closeComposer}
                            className="min-h-[48px] px-4 rounded-2xl border border-[#E5E5E5] hover:border-[#171717] bg-white text-xs font-semibold text-[#171717] cursor-pointer"
                          >
                            {t('Fermer', 'Close')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.aside>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contextual Payment Method Selector (Elevated z-[80]) */}
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
