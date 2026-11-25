import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, Map as MapIcon, MapPin, Search, X, Check, ArrowLeft } from 'lucide-react';
import { RovaMap } from './RovaMap';
import { GeoPlace } from '../types/rova';
import { useLanguage } from '../context/LanguageContext';

interface LocationSearchFieldProps {
  value: string;
  center: [number, number];
  placeholder: string;
  onSelect: (place: GeoPlace) => void;
}

export function LocationSearchField({ value, center, placeholder, onSelect }: LocationSearchFieldProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCenter, setPickerCenter] = useState<[number, number]>(center);
  const [resolved, setResolved] = useState<GeoPlace | null>(null);
  const [resolving, setResolving] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => setQuery(value), [value]);

  // Freeze the page underneath the full-screen map picker.
  useEffect(() => {
    if (!pickerOpen) return;
    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
    };
    const previousRootOverflow = root.style.overflow;
    const previousOverscroll = root.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.classList.add('rova-map-picker-open');
    return () => {
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousOverscroll;
      body.classList.remove('rova-map-picker-open');
      window.scrollTo(0, scrollY);
    };
  }, [pickerOpen]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
        const data = await response.json();
        if (!cancelled) setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 320);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const resolvePoint = async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const response = await fetch(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      const data = await response.json();
      setResolved({
        displayName: data.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: data.shortName || data.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        landmark: data.landmark,
        lat, lng,
      });
    } catch {
      setResolved({ displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng });
    } finally {
      setResolving(false);
    }
  };

  const openPicker = () => {
    setPickerCenter(center);
    setResolved(null);
    setPickerOpen(true);
    void resolvePoint(center[0], center[1]);
  };

  const handleMapCenter = (lat: number, lng: number) => {
    setPickerCenter([lat, lng]);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void resolvePoint(lat, lng), 450);
  };

  const useGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: [number, number] = [position.coords.latitude, position.coords.longitude];
        setPickerCenter(next);
        void resolvePoint(next[0], next[1]);
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const chooseSearchResult = (place: GeoPlace) => {
    setQuery(place.shortName || place.displayName);
    setResults([]);
    onSelect(place);
  };

  const confirmMapLocation = () => {
    if (!resolved) return;
    onSelect(resolved);
    setQuery(resolved.shortName || resolved.displayName);
    setPickerOpen(false);
  };

  return (
    <>
      <div className="relative">
        <div className="flex items-center rounded-xl border border-neutral-300 bg-white shadow-sm transition focus-within:border-neutral-950 focus-within:ring-2 focus-within:ring-neutral-950/5">
          <Search className="ml-3.5 h-4 w-4 shrink-0 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-neutral-950 outline-none placeholder:text-neutral-400"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
          />
          {searching && <Loader2 className="mr-2 h-4 w-4 animate-spin text-neutral-400" />}
          <button
            type="button"
            onClick={openPicker}
            aria-label={t('Choisir sur la carte', 'Choose location on map')}
            title={t('Choisir sur la carte', 'Choose on map')}
            className="mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            <MapIcon className="h-4 w-4" />
          </button>
        </div>
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-[80] mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
            {results.map((place, index) => (
              <button key={`${place.lat}-${place.lng}-${index}`} type="button" onClick={() => chooseSearchResult(place)} className="flex w-full items-start gap-3 border-b border-neutral-100 px-3.5 py-3 text-left last:border-0 hover:bg-neutral-50">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-950">{place.shortName}</span>
                  <span className="block truncate text-xs text-neutral-500">{place.displayName}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-[1000] flex h-[100dvh] min-h-0 w-screen max-w-[100vw] flex-col overflow-hidden overscroll-none bg-white" role="dialog" aria-modal="true" aria-label={t('Choisir un emplacement', 'Choose a location')}>
          <header className="relative z-[20] flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4 pt-[env(safe-area-inset-top)]">
            <button type="button" onClick={() => setPickerOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-neutral-100" aria-label={t('Retour', 'Back')}>
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-neutral-950">{t('Positionner le point', 'Pin your location')}</p>
              <p className="text-[11px] text-neutral-500">{t('Déplacez la carte sous le repère', 'Move the map under the marker')}</p>
            </div>
            <button type="button" onClick={() => setPickerOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-neutral-100" aria-label={t('Fermer', 'Close')}>
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="relative min-h-0 flex-1 overflow-hidden rova-map-gesture-surface">
            <RovaMap
              center={pickerCenter}
              zoom={16}
              markers={[]}
              heightClass="h-full"
              className="h-full rounded-none border-0 rova-map-gesture-surface"
              centerMarker
              onMapCenterChanged={handleMapCenter}
            />
            <button type="button" onClick={useGps} disabled={gpsLoading} className="absolute right-4 top-4 z-[500] flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-lg disabled:opacity-60" aria-label={t('Ma position GPS', 'My GPS location')}>
              {gpsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
            </button>
            <div className="pointer-events-none absolute left-4 right-4 top-4 z-[400] rounded-xl border border-neutral-200 bg-white/95 px-3.5 py-2.5 shadow-md">
              <div className="flex items-center gap-2">
                {resolving ? <Loader2 className="h-4 w-4 animate-spin text-red-600" /> : <MapPin className="h-4 w-4 shrink-0 text-red-600" />}
                <p className="line-clamp-2 text-xs font-medium text-neutral-800">{resolved?.shortName || t('Recherche de l’adresse...', 'Resolving address...')}</p>
              </div>
            </div>
          </div>
          <footer className="shrink-0 border-t border-neutral-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
            <p className="mb-2 line-clamp-2 text-xs text-neutral-500">{resolved?.displayName || t('Aucune adresse résolue pour le moment', 'No address resolved yet')}</p>
            <button type="button" onClick={confirmMapLocation} disabled={!resolved || resolving} className="flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40">
              <Check className="h-4 w-4" />
              {t('Confirmer cet emplacement', 'Confirm this location')}
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
