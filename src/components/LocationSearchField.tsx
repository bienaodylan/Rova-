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
  onChangeText?: (text: string) => void;
}

export function LocationSearchField({
  value,
  center,
  placeholder,
  onSelect,
  onChangeText,
}: LocationSearchFieldProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCenter, setPickerCenter] = useState<[number, number]>(center);
  const [resolved, setResolved] = useState<GeoPlace | null>(null);
  const [resolving, setResolving] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [searchCenter, setSearchCenter] = useState<[number, number]>(center);
  const [locationMessage, setLocationMessage] = useState('');
  const debounceRef = useRef<number | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => setQuery(value), [value]);
  useEffect(() => setSearchCenter(center), [center[0], center[1]]);

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
        const params = new URLSearchParams({ q });
        if (Number.isFinite(searchCenter[0]) && Number.isFinite(searchCenter[1])) {
          params.set('lat', String(searchCenter[0]));
          params.set('lng', String(searchCenter[1]));
        }
        const response = await fetch(`/api/geo/search?${params.toString()}`);
        const data = await response.json();
        if (!cancelled) {
          const places = Array.isArray(data.results) ? data.results as GeoPlace[] : [];
          const distanceKm = (place: GeoPlace) => {
            const toRad = (value: number) => (value * Math.PI) / 180;
            const dLat = toRad(place.lat - searchCenter[0]);
            const dLng = toRad(place.lng - searchCenter[1]);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(searchCenter[0])) * Math.cos(toRad(place.lat)) * Math.sin(dLng / 2) ** 2;
            return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          };
          setResults(places.sort((a, b) => distanceKm(a) - distanceKm(b)));
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 320);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, searchCenter[0], searchCenter[1]]);

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
    if (!navigator.geolocation) {
      setLocationMessage(t('La géolocalisation n’est pas disponible sur cet appareil.', 'Location is not available on this device.'));
      return;
    }
    setGpsLoading(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: [number, number] = [position.coords.latitude, position.coords.longitude];
        setPickerCenter(next);
        setSearchCenter(next);
        setLocationMessage(t('Position actuelle utilisée pour les lieux à proximité.', 'Your current location is being used for nearby places.'));
        void resolvePoint(next[0], next[1]);
        setGpsLoading(false);
      },
      (error) => {
        setGpsLoading(false);
        setLocationMessage(error.code === error.PERMISSION_DENIED
          ? t('Autorisez la localisation dans les paramètres du navigateur pour trouver les lieux proches.', 'Allow location in your browser settings to find nearby places.')
          : t('Position indisponible. Vérifiez le GPS et réessayez.', 'Location unavailable. Check GPS and try again.'));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
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
        <div className="flex min-h-[46px] items-center rounded-2xl border border-[#E5E5E5] bg-white transition focus-within:border-[#171717] focus-within:ring-1 focus-within:ring-[#171717]/10">
          <Search className="ml-3.5 h-4 w-4 shrink-0 text-[#777777]" />
          <input
            value={query}
            onChange={(event) => {
              const nextVal = event.target.value;
              setQuery(nextVal);
              onChangeText?.(nextVal);
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-[#171717] outline-none placeholder:text-[#777777]"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
          />
          {searching && <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#777777]" />}
          <button
            type="button"
            onClick={useGps}
            disabled={gpsLoading}
            aria-label={t('Rechercher près de moi', 'Search near me')}
            title={t('Rechercher près de moi', 'Search near me')}
            className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#777777] transition hover:bg-[#F3F3F3] hover:text-[#171717] disabled:opacity-50 cursor-pointer"
          >
            {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={openPicker}
            aria-label={t('Choisir sur la carte', 'Choose location on map')}
            title={t('Choisir sur la carte', 'Choose on map')}
            className="mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#171717] text-white transition hover:bg-[#E52B32] focus:outline-none focus:ring-2 focus:ring-[#E52B32] focus:ring-offset-2 cursor-pointer"
          >
            <MapIcon className="h-4 w-4" />
          </button>
        </div>
        {locationMessage && <p className="mt-1.5 px-1 text-xs text-[#777777]" role="status">{locationMessage}</p>}
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-[80] mt-1.5 max-h-60 overflow-y-auto rounded-2xl border border-[#E5E5E5] bg-white shadow-xl">
            {results.map((place, index) => (
              <button key={`${place.lat}-${place.lng}-${index}`} type="button" onClick={() => chooseSearchResult(place)} className="flex w-full items-start gap-3 border-b border-[#E5E5E5] px-3.5 py-3 text-left last:border-0 hover:bg-[#F3F3F3]/60 cursor-pointer">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#E52B32]" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#171717]">{place.shortName}</span>
                  <span className="block truncate text-xs text-[#777777]">{place.displayName}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-[1000] flex h-[100dvh] min-h-0 w-screen max-w-[100vw] flex-col overflow-hidden overscroll-none bg-white" role="dialog" aria-modal="true" aria-label={t('Choisir un emplacement', 'Choose a location')}>
          <header className="relative z-[20] flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-[#E5E5E5] bg-white px-4 pt-[env(safe-area-inset-top)]">
            <button type="button" onClick={() => setPickerOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F3F3F3] cursor-pointer" aria-label={t('Retour', 'Back')}>
              <ArrowLeft className="h-5 w-5 text-[#171717]" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-[#171717]">{t('Positionner le point', 'Pin your location')}</p>
              <p className="text-[11px] text-[#777777]">{t('Déplacez la carte sous le repère', 'Move the map under the marker')}</p>
            </div>
            <button type="button" onClick={() => setPickerOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F3F3F3] cursor-pointer" aria-label={t('Fermer', 'Close')}>
              <X className="h-5 w-5 text-[#171717]" />
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
            <button type="button" onClick={useGps} disabled={gpsLoading} className="absolute right-4 top-4 z-[500] flex h-11 w-11 items-center justify-center rounded-full border border-[#E5E5E5] bg-white text-[#171717] shadow-lg disabled:opacity-60 cursor-pointer" aria-label={t('Ma position GPS', 'My GPS location')}>
              {gpsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
            </button>
            <div className="pointer-events-none absolute left-4 right-16 top-4 z-[400] rounded-2xl border border-[#E5E5E5] bg-white/95 px-4 py-2.5 shadow-md">
              <div className="flex items-center gap-2">
                {resolving ? <Loader2 className="h-4 w-4 animate-spin text-[#E52B32]" /> : <MapPin className="h-4 w-4 shrink-0 text-[#E52B32]" />}
                <p className="line-clamp-2 text-xs font-medium text-[#171717]">{resolved?.shortName || t('Recherche de l’adresse...', 'Resolving address...')}</p>
              </div>
            </div>
          </div>
          <footer className="shrink-0 border-t border-[#E5E5E5] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
            <p className="mb-2 line-clamp-2 text-xs text-[#777777]">{resolved?.displayName || t('Aucune adresse résolue pour le moment', 'No address resolved yet')}</p>
            <button type="button" onClick={confirmMapLocation} disabled={!resolved || resolving} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#E52B32] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#CC2229] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer">
              <Check className="h-4 w-4" />
              {t('Confirmer cet emplacement', 'Confirm this location')}
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
