import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  Briefcase,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  Crosshair,
  Home,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Plus,
  RefreshCw,
  Route,
  Search,
  Star,
  Trash2,
  Upload,
  User,
  X,
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

type BookingPanelState = 'initial' | 'route_ready' | 'searching' | 'driver_results' | 'confirmed';
type MapPickMode = 'none' | 'pickup' | 'stop';
type EditingField = 'none' | 'pickup' | 'stop';
type DisclosureDrawer = 'none' | 'recipient' | 'parcel' | 'stops';

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
  source: 'favorite' | 'history';
  frequency: number;
  icon: 'home' | 'work' | 'favorite' | 'recent';
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

export function DeliveryComposerSheet() {
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const {
    composerOpen,
    closeComposer,
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

  // Dynamic bottom-panel state machine (A -> B -> C -> D -> E)
  const [phaseOverride, setPhaseOverride] = useState<'auto' | 'searching' | 'driver_results'>('auto');
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [createdSnapshot, setCreatedSnapshot] = useState<DeliveryRecord | null>(null);

  // Interactive map & geolocation state
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatusNote, setGpsStatusNote] = useState<string | null>(null);
  const [mapPickMode, setMapPickMode] = useState<MapPickMode>('none');
  const [activeStopIdx, setActiveStopIdx] = useState(0);

  // Inline autocomplete search state (zero nested modals)
  const [editingField, setEditingField] = useState<EditingField>('none');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeoPlace[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);

  // Progressive disclosure compact drawers
  const [openDrawer, setOpenDrawer] = useState<DisclosureDrawer>('none');
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

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoLocatedRef = useRef(false);

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

  // Derived dynamic bottom panel state (A / B / C / D / E)
  const panelState: BookingPanelState = useMemo(() => {
    if (liveDelivery) {
      if (CONFIRMED_STATUSES.includes(liveDelivery.status)) {
        return 'confirmed';
      }
      return 'searching';
    }
    if (phaseOverride === 'driver_results') return 'driver_results';
    if (phaseOverride === 'searching') return 'searching';
    if (validStops.length > 0) return 'route_ready';
    return 'initial';
  }, [liveDelivery, phaseOverride, validStops.length]);

  // Lock background page scroll & handle Escape while full-screen map is open
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
        if (editingField !== 'none') {
          setEditingField('none');
          setSearchResults([]);
        } else if (mapPickMode !== 'none') {
          setMapPickMode('none');
        } else if (openDrawer !== 'none') {
          setOpenDrawer('none');
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
  }, [composerOpen, paymentModalOpen, editingField, mapPickMode, openDrawer, closeComposer]);

  // Reset transient UI state whenever the booking sheet opens or closes
  useEffect(() => {
    if (!composerOpen) {
      hasAutoLocatedRef.current = false;
      setPhaseOverride('auto');
      setActiveBookingId(null);
      setCreatedSnapshot(null);
      setEditingField('none');
      setSearchQuery('');
      setSearchResults([]);
      setMapPickMode('none');
      setOpenDrawer('none');
      setGpsStatusNote(null);
      return;
    }
    setActiveStopIdx(0);
    setPhaseOverride('auto');
    setActiveBookingId(null);
    setCreatedSnapshot(null);
  }, [composerOpen]);

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

  // Detect live GPS location and populate pickup automatically when granted
  const detectUserLocation = useCallback(
    (forceUpdatePickup = false) => {
      if (!navigator.geolocation) {
        setGpsStatusNote(
          t('Géolocalisation indisponible — indiquez votre point de départ.', 'Geolocation unavailable — enter pickup manually.')
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
            setDraft((prev) => ({
              ...prev,
              pickup: {
                ...prev.pickup,
                address: place.shortName || place.displayName,
                landmark: place.landmark || prev.pickup.landmark,
                lat,
                lng,
              },
            }));
          }
          setGpsLoading(false);
        },
        (err) => {
          setGpsLoading(false);
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatusNote(
              t(
                'Localisation refusée — touchez la carte ou recherchez votre adresse de départ.',
                'Location denied — tap the map or search your pickup address.'
              )
            );
          } else {
            setGpsStatusNote(
              t('Position GPS indisponible pour le moment.', 'GPS location currently unavailable.')
            );
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    },
    [draft.pickup.address, reverseGeocode, setDraft, t]
  );

  // Auto-detect user location once on opening the booking view
  useEffect(() => {
    if (!composerOpen || hasAutoLocatedRef.current) return;
    hasAutoLocatedRef.current = true;
    detectUserLocation(false);
  }, [composerOpen, detectUserLocation]);

  // Live location autocomplete via /api/geo/search
  useEffect(() => {
    if (editingField === 'none') {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.trim();
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
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editingField, searchQuery, userCoords, draft.pickup.lat, draft.pickup.lng, region.lat, region.lng]);

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

  // Per-vehicle real availability ETA map (null if no real online drivers exist for that vehicle)
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

  // Smart frequent & favorite suggestions strictly from real user history + saved recipients (zero fake data)
  const smartSuggestions = useMemo<SmartSuggestion[]>(() => {
    const freqMap = new Map<string, { address: string; count: number; latestIdx: number }>();
    deliveries.forEach((del, idx) => {
      const addr = (del.primaryDestinationLabel || '').trim();
      if (!addr) return;
      const key = addr.toLowerCase();
      const existing = freqMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        freqMap.set(key, { address: addr, count: 1, latestIdx: idx });
      }
    });

    const combined: SmartSuggestion[] = [];
    const seen = new Set<string>();

    // 1. Saved favorites boosted by real delivery frequency
    recipients.forEach((rec) => {
      const key = rec.address.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const hist = freqMap.get(key);
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
        source: 'favorite',
        frequency: (hist?.count || 0) + 2,
        icon: classifyPlaceIcon(rec.name),
      });
    });

    // 2. Frequent & recent destinations from actual past deliveries
    Array.from(freqMap.entries())
      .sort((a, b) => b[1].count - a[1].count || a[1].latestIdx - b[1].latestIdx)
      .forEach(([key, info]) => {
        if (seen.has(key)) return;
        seen.add(key);
        combined.push({
          id: `hist_${key}`,
          label: info.address.split(',')[0].trim() || info.address,
          address: info.address,
          source: 'history',
          frequency: info.count,
          icon: 'recent',
        });
      });

    return combined.sort((a, b) => b.frequency - a.frequency).slice(0, 4);
  }, [deliveries, recipients]);

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

  // Live map markers (user/pickup, destinations, real online drivers, or confirmed live driver)
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

    // Pickup / current user marker
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

    // Destination stop pins
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

    // Real nearby online drivers for the selected vehicle
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

  const openFieldEditor = (field: 'pickup' | 'stop') => {
    setEditingField(field);
    setMapPickMode('none');
    setOpenDrawer('none');
    setSearchQuery(field === 'pickup' ? draft.pickup.address : currentStop?.address || '');
    setSearchResults([]);
    window.setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  const applyGeoPlace = (target: 'pickup' | 'stop', place: GeoPlace) => {
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
    } else if (currentStop) {
      updateStop(safeStopIdx, {
        address: label,
        landmark: place.landmark || currentStop.landmark,
        lat: place.lat,
        lng: place.lng,
      });
    }
    setEditingField('none');
    setSearchQuery('');
    setSearchResults([]);
    setMapPickMode('none');
  };

  const applySuggestion = async (item: SmartSuggestion) => {
    if (typeof item.lat === 'number' && typeof item.lng === 'number') {
      updateStop(safeStopIdx, {
        address: item.address,
        recipientName: item.recipientName || currentStop?.recipientName || '',
        recipientPhone: item.recipientPhone || currentStop?.recipientPhone || '',
        landmark: item.landmark || '',
        instructions: item.instructions || '',
        lat: item.lat,
        lng: item.lng,
      });
      setEditingField('none');
      setSearchResults([]);
      return;
    }
    // Geocode history address cleanly so route & coordinates are accurate
    setSearchingPlaces(true);
    try {
      const biasLat = userCoords?.[0] ?? draft.pickup.lat ?? region.lat;
      const biasLng = userCoords?.[1] ?? draft.pickup.lng ?? region.lng;
      const res = await fetch(
        `/api/geo/search?q=${encodeURIComponent(item.address)}&lat=${encodeURIComponent(biasLat)}&lng=${encodeURIComponent(biasLng)}`
      );
      const data = await res.json();
      const first = Array.isArray(data.results) ? (data.results[0] as GeoPlace | undefined) : undefined;
      updateStop(safeStopIdx, {
        address: item.address,
        lat: first?.lat ?? biasLat + 0.012,
        lng: first?.lng ?? biasLng + 0.01,
      });
    } catch {
      updateStop(safeStopIdx, { address: item.address });
    } finally {
      setSearchingPlaces(false);
      setEditingField('none');
      setSearchResults([]);
    }
  };

  const handleMapLocationSelected = (place: GeoPlace) => {
    if (panelState === 'searching' || panelState === 'confirmed') return;
    if (mapPickMode === 'pickup') {
      applyGeoPlace('pickup', place);
    } else if (mapPickMode === 'stop') {
      applyGeoPlace('stop', place);
    } else if (panelState === 'initial') {
      // Direct tap on map in State A sets destination immediately!
      applyGeoPlace('stop', place);
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
    setOpenDrawer('none');
    openFieldEditor('stop');
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

  // =========================================================================
  // REAL DRIVER SEARCH & REQUEST DISPATCH (States B -> C -> D -> E)
  // =========================================================================
  const dispatchDeliveryRequest = async (overrideDriverUid?: string) => {
    const fallbackAmount = estimateVehiclePriceNumber(draft.vehicleCategory).amount;
    const totalAmount = quote?.total ?? fallbackAmount;
    setPhaseOverride('searching');
    setOpenDrawer('none');
    setEditingField('none');

    const created = await submitDelivery(routeDistanceKm, routeDurationMin, totalAmount, {
      stayInBookingPanel: true,
      overrideDriverUid,
    });

    if (created) {
      setCreatedSnapshot(created);
      setActiveBookingId(created.id);
      setPhaseOverride('auto');
    } else {
      // Auth cancelled or validation error -> stay smoothly on route_ready
      setPhaseOverride('auto');
    }
  };

  const handleFindDriversClick = async () => {
    if (!draft.pickup.address.trim()) {
      showToast(t('Indiquez un point de départ.', 'Please enter a pickup location.'), 'error');
      openFieldEditor('pickup');
      return;
    }
    if (validStops.length === 0) {
      openFieldEditor('stop');
      return;
    }
    if (quoteError) return;

    // If real approved online drivers exist right now, show real Driver Results (State D) so user can pick!
    if (matchedDrivers.length > 0 && draft.timingType === 'instant') {
      setOpenDrawer('none');
      setEditingField('none');
      setPhaseOverride('driver_results');
      return;
    }

    // Otherwise submit the real delivery request to backend (pending/scheduled) and watch live in State C!
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
    setPhaseOverride(matchedDrivers.length > 0 ? 'driver_results' : 'auto');
  };

  const handleFinishAndTrack = () => {
    if (!liveDelivery) return;
    const id = liveDelivery.id;
    resetDraft('single');
    setActiveBookingId(null);
    setCreatedSnapshot(null);
    closeComposer();
    openShipmentDetail(id);
  };

  const handleStartFreshBooking = () => {
    resetDraft('single');
    setActiveBookingId(null);
    setCreatedSnapshot(null);
    setPhaseOverride('auto');
    setOpenDrawer('none');
    setEditingField('none');
  };

  const canFindDrivers =
    draft.pickup.address.trim().length > 0 &&
    validStops.length > 0 &&
    !quoteError &&
    !busy;

  const inputClass =
    'w-full rounded-xl bg-[#F5F5F5] border border-transparent focus:border-[#171717] focus:bg-white px-3.5 py-2.5 text-base sm:text-sm text-[#171717] placeholder:text-[#777777] focus:outline-none transition-colors';

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
            {/* FLOATING TOP MAP CONTROLS (Non-obstructive, ≥44px touch hits)  */}
            {/* ============================================================== */}
            <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-4 pt-[max(0.875rem,env(safe-area-inset-top))] lg:left-[472px]">
              <button
                type="button"
                onClick={closeComposer}
                aria-label={t('Fermer', 'Close')}
                className="pointer-events-auto lg:hidden min-w-[44px] min-h-[44px] rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E5] shadow-[0_6px_20px_rgba(23,23,23,0.14)] flex items-center justify-center text-[#171717] active:scale-95 transition-transform cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Center floating map cue (only when pinning or when route active) */}
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

              {/* GPS Re-center Button */}
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

            {/* ============================================================== */}
            {/* DYNAMIC EVOLVING BOTTOM PANEL (Mobile Sheet / Desktop Rail)    */}
            {/* ============================================================== */}
            <motion.aside
              layout="position"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`absolute left-0 right-0 bottom-0 z-30 bg-white rounded-t-[28px] border-t border-[#E5E5E5] shadow-[0_-12px_40px_rgba(23,23,23,0.14)] flex flex-col overflow-hidden transition-[max-height] duration-200 ${
                editingField !== 'none'
                  ? 'max-h-[76dvh]'
                  : panelState === 'initial'
                  ? 'max-h-[58dvh]'
                  : 'max-h-[64dvh]'
              } lg:top-5 lg:left-5 lg:right-auto lg:bottom-5 lg:w-[440px] lg:max-h-[calc(100dvh-2.5rem)] lg:rounded-[28px] lg:border lg:shadow-[0_20px_56px_rgba(23,23,23,0.18)]`}
            >
              {/* Mobile drag handle + Desktop header close */}
              <div className="shrink-0 pt-2.5 pb-1 px-5 flex items-center justify-between lg:pt-4 lg:pb-2.5 lg:border-b lg:border-[#F0F0F0]">
                <div className="lg:hidden w-full flex justify-center">
                  <span className="w-10 h-1 rounded-full bg-[#DCDCDC]" aria-hidden="true" />
                </div>
                <div className="hidden lg:flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-base font-bold tracking-tight text-[#171717]">
                      Rovia<span className="text-[#E52B32]">.</span>
                    </span>
                    <span className="text-xs text-[#777777]">·</span>
                    <span className="text-xs font-medium text-[#777777]">
                      {panelState === 'initial' && t('Nouvelle livraison', 'New delivery')}
                      {panelState === 'route_ready' && t('Confirmer l’itinéraire', 'Confirm route')}
                      {panelState === 'searching' && t('Recherche en cours', 'Searching')}
                      {panelState === 'driver_results' && t('Livreurs disponibles', 'Available drivers')}
                      {panelState === 'confirmed' && t('Livraison confirmée', 'Delivery confirmed')}
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

              {/* Scrollable dynamic body */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3.5">
                {/* Optional subtle GPS permission hint */}
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

                {/* ========================================================== */}
                {/* INLINE LOCATION AUTOCOMPLETE OVERLAY (Zero Extra Screens)  */}
                {/* ========================================================== */}
                {editingField !== 'none' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingField('none');
                          setSearchResults([]);
                        }}
                        aria-label={t('Retour', 'Back')}
                        className="min-w-[40px] min-h-[40px] rounded-full hover:bg-[#F3F3F3] flex items-center justify-center text-[#171717] shrink-0 cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="flex-1 min-w-0 flex items-center gap-2 rounded-2xl bg-[#F3F3F3] border border-[#171717]/20 focus-within:border-[#171717] focus-within:bg-white px-3.5 min-h-[46px]">
                        <span
                          className={`w-2.5 h-2.5 shrink-0 ${
                            editingField === 'pickup'
                              ? 'rounded-full bg-[#171717]'
                              : 'rounded-[2px] bg-[#E52B32]'
                          }`}
                        />
                        <input
                          ref={searchInputRef}
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={
                            editingField === 'pickup'
                              ? t('Adresse de départ...', 'Pickup address...')
                              : t('Où envoyer votre colis ?', 'Where to send your package?')
                          }
                          className="flex-1 min-w-0 bg-transparent text-base sm:text-sm text-[#171717] placeholder:text-[#777777] outline-none"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        {searchingPlaces && <Loader2 className="w-4 h-4 animate-spin text-[#777777] shrink-0" />}
                        {searchQuery && !searchingPlaces && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setSearchResults([]);
                              searchInputRef.current?.focus();
                            }}
                            aria-label={t('Effacer', 'Clear')}
                            className="p-1 text-[#777777] hover:text-[#171717] cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quick GPS & Pin-on-Map Actions */}
                    <div className="flex items-center gap-2">
                      {editingField === 'pickup' && (
                        <button
                          type="button"
                          onClick={() => {
                            detectUserLocation(true);
                            setEditingField('none');
                          }}
                          className="min-h-[38px] px-3.5 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Crosshair className="w-3.5 h-3.5 text-[#E52B32]" />
                          <span>{t('Ma position actuelle', 'Current location')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMapPickMode(editingField === 'pickup' ? 'pickup' : 'stop');
                          setEditingField('none');
                        }}
                        className="min-h-[38px] px-3.5 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5 text-[#171717]" />
                        <span>{t('Choisir sur la carte', 'Pick on map')}</span>
                      </button>
                    </div>

                    {/* Autocomplete Results */}
                    {searchResults.length > 0 ? (
                      <div className="divide-y divide-[#F0F0F0]">
                        {searchResults.slice(0, 6).map((place, idx) => (
                          <button
                            key={`${place.lat}-${place.lng}-${idx}`}
                            type="button"
                            onClick={() =>
                              applyGeoPlace(editingField === 'pickup' ? 'pickup' : 'stop', place)
                            }
                            className="w-full min-h-[54px] py-2.5 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
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
                          </button>
                        ))}
                      </div>
                    ) : searchQuery.trim().length >= 2 && !searchingPlaces ? (
                      <div className="py-4 text-center space-y-2">
                        <p className="text-xs text-[#777777]">
                          {t('Aucun résultat exact trouvé.', 'No exact match found.')}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            applyGeoPlace(editingField === 'pickup' ? 'pickup' : 'stop', {
                              displayName: searchQuery.trim(),
                              shortName: searchQuery.trim(),
                              lat: (userCoords?.[0] ?? draft.pickup.lat) + (editingField === 'stop' ? 0.012 : 0),
                              lng: (userCoords?.[1] ?? draft.pickup.lng) + (editingField === 'stop' ? 0.01 : 0),
                            })
                          }
                          className="min-h-[38px] px-4 rounded-xl bg-[#171717] text-white text-xs font-semibold cursor-pointer"
                        >
                          {t(`Utiliser « ${searchQuery.trim()} »`, `Use "${searchQuery.trim()}"`)}
                        </button>
                      </div>
                    ) : (
                      smartSuggestions.length > 0 && (
                        <div className="divide-y divide-[#F0F0F0]">
                          {smartSuggestions.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                if (editingField === 'pickup' && typeof item.lat === 'number' && typeof item.lng === 'number') {
                                  applyGeoPlace('pickup', {
                                    displayName: item.address,
                                    shortName: item.address,
                                    lat: item.lat,
                                    lng: item.lng,
                                  });
                                } else {
                                  void applySuggestion(item);
                                }
                              }}
                              className="w-full min-h-[54px] py-2.5 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#F3F3F3] flex items-center justify-center shrink-0 text-[#171717]">
                                {item.icon === 'home' ? (
                                  <Home className="w-4 h-4" />
                                ) : item.icon === 'work' ? (
                                  <Briefcase className="w-4 h-4" />
                                ) : item.icon === 'recent' ? (
                                  <Clock className="w-4 h-4 text-[#777777]" />
                                ) : (
                                  <Bookmark className="w-4 h-4" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[#171717] truncate">
                                  {item.label}
                                </span>
                                <span className="block text-xs text-[#777777] truncate">
                                  {item.address}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                )}

                {/* ========================================================== */}
                {/* STATE A — INITIAL DELIVERY SCREEN (inDrive-style)          */}
                {/* ========================================================== */}
                {editingField === 'none' && panelState === 'initial' && (
                  <div className="space-y-3.5">
                    {/* Horizontal Swipable Vehicle Selector */}
                    <div
                      className="flex items-stretch gap-2.5 overflow-x-auto snap-x snap-mandatory no-scrollbar -mx-1 px-1 pb-0.5"
                      role="radiogroup"
                      aria-label={t('Choisir un véhicule de livraison', 'Choose delivery vehicle')}
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

                    {/* Prominent Destination Search Trigger ("Où envoyer votre colis ?") */}
                    <button
                      type="button"
                      onClick={() => openFieldEditor('stop')}
                      className="w-full min-h-[54px] px-4 rounded-2xl bg-[#F3F3F3] hover:bg-[#EAEAEA] flex items-center gap-3 text-left transition-colors active:scale-[0.99] cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-full bg-white text-[#E52B32] flex items-center justify-center shrink-0 shadow-2xs">
                        <Search className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-display text-[15px] font-bold text-[#171717] truncate">
                          {t('Où envoyer votre colis ?', 'Where to send your package?')}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-[#777777] shrink-0" />
                    </button>

                    {/* Smart Frequent & Favorite Locations (Real History & Saved Recipients Only) */}
                    {smartSuggestions.length > 0 ? (
                      <div className="divide-y divide-[#F2F2F2]">
                        {smartSuggestions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void applySuggestion(item)}
                            className="w-full min-h-[54px] py-2 flex items-center gap-3 text-left hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                          >
                            <span className="w-9 h-9 rounded-full bg-[#F3F3F3] flex items-center justify-center shrink-0 text-[#171717]">
                              {item.icon === 'home' ? (
                                <Home className="w-4 h-4" />
                              ) : item.icon === 'work' ? (
                                <Briefcase className="w-4 h-4" />
                              ) : item.icon === 'recent' ? (
                                <Clock className="w-4 h-4 text-[#777777]" />
                              ) : (
                                <Bookmark className="w-4 h-4" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-[#171717] truncate">
                                {item.label}
                              </span>
                              <span className="block text-xs text-[#777777] truncate">
                                {item.address}
                              </span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-[#BDBDBD] shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 py-1.5 px-1">
                        <p className="text-xs text-[#777777]">
                          {t(
                            'Touchez la carte ou recherchez une destination pour démarrer.',
                            'Tap the map or search a destination to get started.'
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={() => setMapPickMode('stop')}
                          className="min-h-[34px] px-3 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] shrink-0 cursor-pointer whitespace-nowrap"
                        >
                          {t('Sur la carte', 'On map')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ========================================================== */}
                {/* STATE B — DESTINATION SELECTED (Route Ready & Find Drivers)*/}
                {/* ========================================================== */}
                {editingField === 'none' && panelState === 'route_ready' && currentStop && (
                  <div className="space-y-3.5">
                    {/* Editable Pickup -> Destination Block */}
                    <div className="rounded-2xl bg-[#F6F6F6] p-2.5 space-y-1">
                      {/* Pickup Row */}
                      <button
                        type="button"
                        onClick={() => openFieldEditor('pickup')}
                        className="w-full min-h-[44px] px-2.5 py-2 rounded-xl hover:bg-white/80 flex items-center gap-3 text-left transition-colors cursor-pointer"
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-[#171717] shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium text-[#777777]">
                            {t('Point de départ', 'Pickup')}
                          </span>
                          <span className="block text-sm font-semibold text-[#171717] truncate">
                            {draft.pickup.address ||
                              t('Sélectionner le point de départ...', 'Set pickup location...')}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-[#777777] shrink-0">
                          {t('Modifier', 'Edit')}
                        </span>
                      </button>

                      <div className="mx-3 border-t border-[#E6E6E6]" />

                      {/* Destination Row */}
                      <button
                        type="button"
                        onClick={() => openFieldEditor('stop')}
                        className="w-full min-h-[44px] px-2.5 py-2 rounded-xl hover:bg-white/80 flex items-center gap-3 text-left transition-colors cursor-pointer"
                      >
                        <span className="w-2.5 h-2.5 rounded-[2px] bg-[#E52B32] shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium text-[#777777]">
                            {draft.stops.length > 1
                              ? t(`Destination #${safeStopIdx + 1} sur ${draft.stops.length}`, `Stop #${safeStopIdx + 1} of ${draft.stops.length}`)
                              : t('Destination', 'Destination')}
                          </span>
                          <span className="block text-sm font-semibold text-[#171717] truncate">
                            {currentStop.address}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-[#777777] shrink-0">
                          {t('Modifier', 'Edit')}
                        </span>
                      </button>
                    </div>

                    {/* Horizontal Vehicle Selector (Compact, Instant Live Price Switch) */}
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

                    {/* Clean Unboxed Route & Quote Summary Line */}
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

                    {/* Progressive Disclosure Compact Controls (Only Expanded When Needed) */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                      <button
                        type="button"
                        onClick={() => setPaymentModalOpen(true)}
                        className="min-h-[38px] px-3 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>{getPaymentMethodLabelEn(draft.paymentMethod)}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setOpenDrawer((d) => (d === 'recipient' ? 'none' : 'recipient'))}
                        className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          openDrawer === 'recipient'
                            ? 'bg-[#171717] text-white'
                            : 'bg-[#F3F3F3] hover:bg-[#EAEAEA] text-[#171717]'
                        }`}
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>
                          {currentStop.recipientName
                            ? currentStop.recipientName
                            : t('Destinataire', 'Recipient')}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setOpenDrawer((d) => (d === 'parcel' ? 'none' : 'parcel'))}
                        className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          openDrawer === 'parcel'
                            ? 'bg-[#171717] text-white'
                            : 'bg-[#F3F3F3] hover:bg-[#EAEAEA] text-[#171717]'
                        }`}
                      >
                        <Package className="w-3.5 h-3.5" />
                        <span>
                          {draft.weightKg} kg
                          {draft.timingType === 'scheduled' ? ` · ${t('Planifié', 'Sched.')}` : ''}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setOpenDrawer((d) => (d === 'stops' ? 'none' : 'stops'))}
                        className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          openDrawer === 'stops'
                            ? 'bg-[#171717] text-white'
                            : 'bg-[#F3F3F3] hover:bg-[#EAEAEA] text-[#171717]'
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          {draft.stops.length > 1
                            ? `${draft.stops.length} ${t('arrêts', 'stops')}`
                            : t('Arrêts', 'Stops')}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={savingFavorite}
                        onClick={() => void handleSaveDestinationAsFavorite()}
                        title={t('Enregistrer en favori', 'Save as favorite')}
                        className="min-h-[38px] px-3 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {savingFavorite ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Bookmark className="w-3.5 h-3.5" />
                        )}
                        <span>{t('Favori', 'Save')}</span>
                      </button>
                    </div>

                    {/* Drawer: Recipient Details */}
                    {openDrawer === 'recipient' && (
                      <div className="rounded-2xl border border-[#E5E5E5] bg-white p-3.5 space-y-2.5">
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
                            placeholder={t('Téléphone', 'Phone')}
                            className={inputClass}
                          />
                          <div className="sm:col-span-2">
                            <input
                              type="text"
                              value={currentStop.instructions}
                              onChange={(e) => updateStop(safeStopIdx, { instructions: e.target.value })}
                              placeholder={t('Instructions (code porte, étage...)', 'Delivery notes (gate, floor...)')}
                              className={inputClass}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Drawer: Parcel, Timing & Proof */}
                    {openDrawer === 'parcel' && (
                      <div className="rounded-2xl border border-[#E5E5E5] bg-white p-3.5 space-y-2.5">
                        <div className="grid grid-cols-2 p-1 rounded-xl bg-[#F3F3F3] gap-1">
                          <button
                            type="button"
                            onClick={() => setDraft((p) => ({ ...p, timingType: 'instant', scheduledFor: '' }))}
                            className={`min-h-[36px] rounded-lg text-xs font-semibold cursor-pointer ${
                              draft.timingType === 'instant'
                                ? 'bg-white text-[#171717] shadow-2xs'
                                : 'text-[#777777]'
                            }`}
                          >
                            {t('Maintenant', 'Now')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraft((p) => ({ ...p, timingType: 'scheduled' }))}
                            className={`min-h-[36px] rounded-lg text-xs font-semibold cursor-pointer ${
                              draft.timingType === 'scheduled'
                                ? 'bg-white text-[#171717] shadow-2xs'
                                : 'text-[#777777]'
                            }`}
                          >
                            {t('Planifier', 'Schedule')}
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

                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={draft.packageType}
                            onChange={(e) => setDraft((p) => ({ ...p, packageType: e.target.value }))}
                            placeholder={t('Type de colis', 'Parcel type')}
                            className={`${inputClass} col-span-2`}
                          />
                          <input
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={draft.weightKg}
                            onChange={(e) => setDraft((p) => ({ ...p, weightKg: Number(e.target.value) || 1 }))}
                            aria-label={t('Poids (kg)', 'Weight (kg)')}
                            className={`${inputClass} font-mono`}
                          />
                          <select
                            value={draft.proofRequired}
                            onChange={(e) =>
                              setDraft((p) => ({ ...p, proofRequired: e.target.value as ProofType }))
                            }
                            aria-label={t('Preuve de remise', 'Proof of delivery')}
                            className={inputClass}
                          >
                            <option value="otp">{t('Code OTP', 'OTP Code')}</option>
                            <option value="signature">{t('Signature', 'Signature')}</option>
                            <option value="photo">{t('Photo', 'Photo')}</option>
                            <option value="recipient_confirm">{t('Confirmation', 'Confirm')}</option>
                          </select>
                        </div>

                        <label className="flex items-center justify-between px-1 py-1 text-xs font-medium text-[#171717] cursor-pointer">
                          <span>{t('Colis fragile', 'Fragile parcel')}</span>
                          <input
                            type="checkbox"
                            checked={draft.fragile}
                            onChange={(e) => setDraft((p) => ({ ...p, fragile: e.target.checked }))}
                            className="w-4 h-4 accent-[#E52B32]"
                          />
                        </label>
                      </div>
                    )}

                    {/* Drawer: Multi-Stop Management + Optimize + CSV */}
                    {openDrawer === 'stops' && (
                      <div className="rounded-2xl border border-[#E5E5E5] bg-white p-3.5 space-y-2.5">
                        <div className="space-y-1.5">
                          {draft.stops.map((s, idx) => (
                            <div
                              key={s.id}
                              className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#F6F6F6]"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveStopIdx(idx);
                                  openFieldEditor('stop');
                                }}
                                className="flex-1 min-w-0 text-left flex items-center gap-2 cursor-pointer"
                              >
                                <span className="font-mono text-xs font-bold text-[#E52B32]">#{idx + 1}</span>
                                <span className="text-xs font-medium text-[#171717] truncate">
                                  {s.address || t('Choisir une adresse...', 'Pick address...')}
                                </span>
                              </button>
                              {draft.stops.length > 1 && (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => moveStop(idx, -1)}
                                    aria-label={t('Monter', 'Move up')}
                                    className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 cursor-pointer"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === draft.stops.length - 1}
                                    onClick={() => moveStop(idx, 1)}
                                    aria-label={t('Descendre', 'Move down')}
                                    className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 cursor-pointer"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeStop(idx)}
                                    aria-label={t('Supprimer', 'Remove')}
                                    className="p-1.5 rounded-lg text-[#E52B32] hover:bg-red-50 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={addStop}
                            className="flex-1 min-h-[38px] rounded-xl bg-[#171717] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{t('Ajouter un arrêt', 'Add stop')}</span>
                          </button>
                          {draft.stops.length > 1 && (
                            <button
                              type="button"
                              disabled={optimizing}
                              onClick={handleOptimizeRoute}
                              className="min-h-[38px] px-3 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {optimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Route className="w-3.5 h-3.5" />}
                              <span>{t('Optimiser', 'Optimize')}</span>
                            </button>
                          )}
                          <label className="min-h-[38px] px-3 rounded-xl bg-[#F3F3F3] hover:bg-[#EAEAEA] text-xs font-semibold text-[#171717] inline-flex items-center gap-1.5 cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>CSV</span>
                            <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Primary CTA: Find Delivery Drivers */}
                    <button
                      type="button"
                      disabled={!canFindDrivers}
                      onClick={() => void handleFindDriversClick()}
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
                          ? `${t('Planifier la livraison', 'Schedule delivery')} · ${displayedPrice}`
                          : `${t('Trouver un livreur', 'Find delivery drivers')} · ${displayedPrice}`}
                      </span>
                    </button>
                  </div>
                )}

                {/* ========================================================== */}
                {/* STATE D — DRIVER RESULTS (Real Online Drivers Matched)     */}
                {/* ========================================================== */}
                {editingField === 'none' && panelState === 'driver_results' && (
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
                        onClick={() => setPhaseOverride('auto')}
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

                {/* ========================================================== */}
                {/* STATE C — SEARCHING / REAL REQUEST STATUS PROGRESSION      */}
                {/* ========================================================== */}
                {editingField === 'none' && panelState === 'searching' && (
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
                              'Your route is still ready. Continue searching without restarting.'
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

                        {/* Smooth compositor-only indeterminate search rail */}
                        <div className="h-1 w-full rounded-full bg-[#EFEFEF] overflow-hidden">
                          <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: '100%' }}
                            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                            className="h-full w-1/2 rounded-full bg-[#E52B32]"
                          />
                        </div>

                        {/* Route summary */}
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

                        {/* Real Cancel Search + Background Actions */}
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

                {/* ========================================================== */}
                {/* STATE E — DRIVER CONFIRMED (Live Real-Time Tracking Panel) */}
                {/* ========================================================== */}
                {editingField === 'none' && panelState === 'confirmed' && liveDelivery && (
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

                    {/* Confirmed Driver & Vehicle Card */}
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

                    {/* Pickup & Destination */}
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

                    {/* Tracking, OTP & Action Buttons */}
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
                          onClick={handleStartFreshBooking}
                          className="min-h-[48px] px-4 rounded-2xl border border-[#E5E5E5] hover:border-[#171717] bg-white text-xs font-semibold text-[#171717] cursor-pointer"
                        >
                          {t('Nouvelle', 'New')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contextual Payment Method Selector (Elevated above Map Booking z-[80]) */}
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
