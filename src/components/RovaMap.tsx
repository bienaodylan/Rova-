/// <reference types="google.maps" />
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  MapMouseEvent,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { GeoPlace } from '../types/rova';
import { useLanguage } from '../context/LanguageContext';
import { GOOGLE_MAPS_LIBRARIES, useMapsRuntime } from '../context/MapsContext';
import { getValidGeoapifyKey, markGoogleMapsAuthFailed } from '../lib/mapsConfig';

export interface MapMarkerItem {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'stop' | 'driver' | 'selected';
  sequence?: number;
  draggable?: boolean;
  meta?: string;
}

interface RovaMapProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarkerItem[];
  routeCoordinates?: [number, number][];
  interactivePick?: boolean;
  showSearchBar?: boolean;
  searchPlaceholder?: string;
  initialSearchText?: string;
  onLocationSelected?: (place: GeoPlace) => void;
  onMarkerClick?: (marker: MapMarkerItem) => void;
  followDriver?: boolean;
  heightClass?: string;
  className?: string;
}

const COORD_OR_DIGITAL_RE = /^(-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?|[A-Z]{2}-\d{3,4}-\d{4})$/i;

function isQuotaError(err: unknown): boolean {
  const msg = String(err ?? '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('OverQuotaMapError') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('429')
  );
}

// ============================================================================
// GOOGLE MAPS IMPLEMENTATION (@vis.gl/react-google-maps + Places API New)
// ============================================================================

function RovaPinVisual({ marker }: { marker: MapMarkerItem }) {
  if (marker.kind === 'driver') {
    return (
      <div className="relative w-7 h-7 bg-neutral-950 text-white border-2 border-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] flex items-center justify-center font-mono text-[10px] font-bold rounded-full">
        R
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-600 border-2 border-white" />
      </div>
    );
  }
  if (marker.kind === 'pickup') {
    return (
      <div className="w-7 h-7 bg-neutral-950 text-white border-2 border-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] flex items-center justify-center font-mono text-[10px] font-bold rounded-[10px]">
        P
      </div>
    );
  }
  if (marker.kind === 'stop') {
    return (
      <div className="relative w-7 h-7 bg-white text-neutral-950 border-[2.5px] border-neutral-950 shadow-[0_2px_8px_rgba(0,0,0,0.25)] flex items-center justify-center font-mono text-[11px] font-bold rounded-[10px]">
        {marker.sequence ?? '•'}
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-600" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 bg-red-600 border-[3px] border-white shadow-[0_2px_10px_rgba(220,38,38,0.45)] rounded-full" />
  );
}

function RovaAdvancedMarker({
  marker,
  draggable,
  onDragEnd,
  onMarkerClick,
}: {
  marker: MapMarkerItem;
  draggable: boolean;
  onDragEnd?: (lat: number, lng: number) => void;
  onMarkerClick?: (marker: MapMarkerItem) => void;
}) {
  const [markerRef, markerInstance] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: marker.lat, lng: marker.lng }}
        title={marker.label}
        draggable={draggable}
        onClick={() => {
          onMarkerClick?.(marker);
          setInfoOpen((prev) => !prev);
        }}
        onDragEnd={(e) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (typeof lat === 'number' && typeof lng === 'number') {
            onDragEnd?.(lat, lng);
          }
        }}
      >
        <RovaPinVisual marker={marker} />
      </AdvancedMarker>

      {infoOpen && markerInstance && (
        <InfoWindow anchor={markerInstance} onCloseClick={() => setInfoOpen(false)}>
          <div className="text-xs font-medium text-neutral-950 px-0.5 max-w-[200px]">
            {marker.label}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function GoogleMapCameraAndRoute({
  center,
  markers,
  routeCoordinates,
  panTarget,
  followDriver = false,
}: {
  center: [number, number];
  markers: MapMarkerItem[];
  routeCoordinates: [number, number][];
  panTarget: { lat: number; lng: number; zoom: number; nonce: number } | null;
  followDriver?: boolean;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const lastBoundsKeyRef = useRef<string>('');
  const lastCenterKeyRef = useRef<string>('');
  const lastDriverKeyRef = useRef<string>('');

  // Render route polyline cleanly via Maps JS SDK
  useEffect(() => {
    if (!map || !mapsLib) return;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (routeCoordinates.length >= 2) {
      const path: google.maps.LatLngLiteral[] = routeCoordinates
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
        .map(([lat, lng]) => ({ lat, lng }));

      if (path.length >= 2) {
        const line = new mapsLib.Polyline({
          path,
          geodesic: true,
          strokeColor: '#0a0a0a',
          strokeOpacity: 0.9,
          strokeWeight: 4,
          map,
        });
        polylineRef.current = line;
      }
    }

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, mapsLib, routeCoordinates]);

  // Fit bounds when static markers or route change without interrupting live driver movement
  useEffect(() => {
    if (!map || !coreLib) return;

    const boundsPoints: google.maps.LatLngLiteral[] = [];
    const staticKeyParts: string[] = [];

    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      boundsPoints.push({ lat: m.lat, lng: m.lng });
      if (m.kind !== 'driver') {
        staticKeyParts.push(`${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`);
      } else {
        staticKeyParts.push(`${m.id}:driver`);
      }
    }

    if (routeCoordinates.length >= 2) {
      for (const [lat, lng] of routeCoordinates) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          boundsPoints.push({ lat, lng });
        }
      }
      const first = routeCoordinates[0];
      const last = routeCoordinates[routeCoordinates.length - 1];
      staticKeyParts.push(
        `route:${routeCoordinates.length}:${first[0].toFixed(3)},${last[0].toFixed(3)}`
      );
    }

    const nextKey = staticKeyParts.join('|');
    if (nextKey === lastBoundsKeyRef.current) return;
    lastBoundsKeyRef.current = nextKey;

    if (boundsPoints.length >= 2) {
      const bounds = new coreLib.LatLngBounds();
      for (const pt of boundsPoints) {
        bounds.extend(pt);
      }
      map.fitBounds(bounds, 48);
    } else if (boundsPoints.length === 1) {
      map.panTo(boundsPoints[0]);
      const currentZoom = map.getZoom() ?? 13;
      if (currentZoom < 14) {
        map.setZoom(14);
      }
    }
  }, [map, coreLib, markers, routeCoordinates]);

  // Real-time driver GPS tracking hook: smoothly pans to live driver updates when enabled
  useEffect(() => {
    if (!map || !followDriver) return;
    const driver = markers.find((m) => m.kind === 'driver' && Number.isFinite(m.lat) && Number.isFinite(m.lng));
    if (!driver) return;
    const key = `${driver.id}:${driver.lat.toFixed(5)},${driver.lng.toFixed(5)}`;
    if (key === lastDriverKeyRef.current) return;
    lastDriverKeyRef.current = key;
    map.panTo({ lat: driver.lat, lng: driver.lng });
  }, [map, followDriver, markers]);

  // Pan smoothly when default region center updates and no markers/route pin the camera
  useEffect(() => {
    if (!map || markers.length > 0 || routeCoordinates.length >= 2) return;
    const [lat, lng] = center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (key === lastCenterKeyRef.current) return;
    lastCenterKeyRef.current = key;
    map.panTo({ lat, lng });
  }, [map, center, markers.length, routeCoordinates.length]);

  // Explicit pan/zoom when user selects an autocomplete place or clicks GPS
  useEffect(() => {
    if (!map || !panTarget) return;
    map.panTo({ lat: panTarget.lat, lng: panTarget.lng });
    map.setZoom(panTarget.zoom);
  }, [map, panTarget]);

  return null;
}

interface SearchOption {
  id: string;
  primaryText: string;
  secondaryText: string;
  prediction?: google.maps.places.PlacePrediction;
  geoPlace?: GeoPlace;
}

function GoogleRovaMap({
  center = [5.6037, -0.187],
  zoom = 13,
  markers = [],
  routeCoordinates = [],
  interactivePick = false,
  showSearchBar = false,
  searchPlaceholder,
  initialSearchText = '',
  onLocationSelected,
  onMarkerClick,
  followDriver = false,
  heightClass = 'h-[360px]',
  className = '',
}: RovaMapProps) {
  const { t, region } = useLanguage();
  const loadingStatus = useApiLoadingStatus();
  const placesLib = useMapsLibrary('places');

  const [query, setQuery] = useState(initialSearchText);
  const [options, setOptions] = useState<SearchOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [panTarget, setPanTarget] = useState<{
    lat: number;
    lng: number;
    zoom: number;
    nonce: number;
  } | null>(null);

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const onLocationSelectedRef = useRef(onLocationSelected);
  onLocationSelectedRef.current = onLocationSelected;

  useEffect(() => {
    setQuery(initialSearchText);
  }, [initialSearchText]);

  const defaultCenter = useMemo(() => ({ lat: center[0], lng: center[1] }), [center[0], center[1]]);

  const validMarkers = useMemo(
    () => markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)),
    [markers]
  );

  const reverseGeocodePoint = useCallback(async (lat: number, lng: number) => {
    setReversing(true);
    try {
      const res = await fetch(
        `/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
      );
      const data = await res.json();
      const place: GeoPlace = {
        displayName: data.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: data.shortName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        landmark: data.landmark,
        lat,
        lng,
      };
      setQuery(place.shortName);
      setDropdownOpen(false);
      onLocationSelectedRef.current?.(place);
    } catch {
      const fallback: GeoPlace = {
        displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
      };
      setQuery(fallback.shortName);
      onLocationSelectedRef.current?.(fallback);
    } finally {
      setReversing(false);
    }
  }, []);

  // Modern Places API (New) autocomplete using AutocompleteSuggestion + sessionToken
  useEffect(() => {
    if (!showSearchBar || !dropdownOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setOptions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        // Direct GPS coordinates or GhanaPostGPS codes use the dedicated backend parser
        if (COORD_OR_DIGITAL_RE.test(trimmed) || !placesLib) {
          const res = await fetch(
            `/api/geo/search?q=${encodeURIComponent(trimmed)}&region=${encodeURIComponent(region.countryCode)}`
          );
          const data = await res.json();
          if (!cancelled) {
            const list: GeoPlace[] = Array.isArray(data.results) ? data.results : [];
            setOptions(
              list.map((r, i) => ({
                id: `geo-${r.lat}-${r.lng}-${i}`,
                primaryText: r.shortName,
                secondaryText: r.displayName,
                geoPlace: r,
              }))
            );
          }
          return;
        }

        if (trimmed.length < 3) {
          setOptions([]);
          return;
        }

        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }

        const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });

        if (!cancelled) {
          const suggestions = response?.suggestions ?? [];
          setOptions(
            suggestions
              .filter((s) => Boolean(s.placePrediction))
              .map((s, i) => {
                const pred = s.placePrediction!;
                return {
                  id: pred.placeId || `pred-${i}`,
                  primaryText: pred.mainText?.text || pred.text?.text || '',
                  secondaryText: pred.secondaryText?.text || pred.text?.text || '',
                  prediction: pred,
                };
              })
          );
        }
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        // Fallback silently to backend geocoder so search keeps working
        try {
          const res = await fetch(
            `/api/geo/search?q=${encodeURIComponent(trimmed)}&region=${encodeURIComponent(region.countryCode)}`
          );
          const data = await res.json();
          if (!cancelled) {
            const list: GeoPlace[] = Array.isArray(data.results) ? data.results : [];
            setOptions(
              list.map((r, i) => ({
                id: `fallback-${r.lat}-${r.lng}-${i}`,
                primaryText: r.shortName,
                secondaryText: r.displayName,
                geoPlace: r,
              }))
            );
          }
        } catch {
          if (!cancelled) setOptions([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, showSearchBar, dropdownOpen, placesLib, region.countryCode]);

  const handleSelectOption = async (opt: SearchOption) => {
    setDropdownOpen(false);
    setOptions([]);

    if (opt.geoPlace) {
      setQuery(opt.geoPlace.shortName);
      setPanTarget({
        lat: opt.geoPlace.lat,
        lng: opt.geoPlace.lng,
        zoom: 15,
        nonce: Date.now(),
      });
      onLocationSelectedRef.current?.(opt.geoPlace);
      return;
    }

    if (!opt.prediction) return;

    setSearching(true);
    try {
      const place = opt.prediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      // Reset session token after Place details fetch to properly close billing session
      sessionTokenRef.current = null;

      const loc = place.location;
      if (loc) {
        const lat = loc.lat();
        const lng = loc.lng();
        const shortName =
          place.displayName || opt.primaryText || place.formattedAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        const displayName = place.formattedAddress || shortName;
        const resolved: GeoPlace = {
          displayName,
          shortName,
          landmark: place.displayName || undefined,
          lat,
          lng,
        };
        setQuery(resolved.shortName);
        setPanTarget({ lat, lng, zoom: 15, nonce: Date.now() });
        onLocationSelectedRef.current?.(resolved);
      }
    } catch (err) {
      if (isQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      sessionTokenRef.current = null;
    } finally {
      setSearching(false);
    }
  };

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const { latitude, longitude } = pos.coords;
        setPanTarget({ lat: latitude, lng: longitude, zoom: 16, nonce: Date.now() });
        void reverseGeocodePoint(latitude, longitude);
      },
      () => {
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleMapClick = useCallback(
    (event: MapMouseEvent) => {
      if (!interactivePick) return;
      const coords = event.detail.latLng;
      if (!coords) return;
      void reverseGeocodePoint(coords.lat, coords.lng);
    },
    [interactivePick, reverseGeocodePoint]
  );

  // Propagate Google Maps loading / auth failures to global runtime state so Preferences & other maps stay in sync
  useEffect(() => {
    if (loadingStatus === APILoadingStatus.AUTH_FAILURE) {
      markGoogleMapsAuthFailed('gm_authFailure');
    } else if (loadingStatus === APILoadingStatus.FAILED) {
      markGoogleMapsAuthFailed('script_load_failed');
    }
  }, [loadingStatus]);

  // If Google Maps fails authentication or script loading, gracefully fall back to Leaflet
  if (
    loadingStatus === APILoadingStatus.FAILED ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE
  ) {
    return (
      <LeafletRovaMap
        center={center}
        zoom={zoom}
        markers={markers}
        routeCoordinates={routeCoordinates}
        interactivePick={interactivePick}
        showSearchBar={showSearchBar}
        searchPlaceholder={searchPlaceholder}
        initialSearchText={initialSearchText}
        onLocationSelected={onLocationSelected}
        onMarkerClick={onMarkerClick}
        followDriver={followDriver}
        heightClass={heightClass}
        className={className}
      />
    );
  }

  const effectivePlaceholder =
    searchPlaceholder ||
    t(
      'Rechercher une rue, un repère, un quartier ou des coordonnées GPS...',
      'Search street, landmark, digital address or GPS...'
    );

  return (
    <div
      className={`relative w-full rounded-2xl border border-neutral-200 bg-neutral-100 overflow-hidden ${className}`}
    >
      {showSearchBar && (
        <div className="absolute top-3 left-3 right-3 z-[20] flex flex-col gap-1.5">
          <div className="flex items-center rounded-xl bg-white border border-neutral-200 shadow-sm overflow-hidden">
            <div className="pl-3.5 text-neutral-500">
              {searching || reversing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </div>
            <input
              type="text"
              value={query}
              onFocus={() => setDropdownOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setDropdownOpen(true);
              }}
              placeholder={effectivePlaceholder}
              className="w-full px-3 py-2.5 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none bg-transparent"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setOptions([]);
                }}
                aria-label={t('Effacer la recherche', 'Clear search')}
                className="p-2 text-neutral-400 hover:text-neutral-950 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleUseCurrentGps}
              disabled={gpsLoading}
              title={t('Utiliser ma position GPS', 'Use current GPS position')}
              className="px-3.5 py-2.5 border-l border-neutral-200 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 transition-colors flex items-center gap-1.5 text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              {gpsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crosshair className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">GPS</span>
            </button>
          </div>

          {dropdownOpen && options.length > 0 && (
            <div className="rounded-xl bg-white border border-neutral-200 shadow-lg max-h-56 overflow-y-auto divide-y divide-neutral-100">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void handleSelectOption(opt)}
                  className="w-full px-3.5 py-2.5 text-left hover:bg-neutral-50 flex items-start gap-2.5 transition-colors cursor-pointer"
                >
                  <MapPin className="w-4 h-4 text-neutral-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-950 truncate">
                      {opt.primaryText}
                    </p>
                    {opt.secondaryText && opt.secondaryText !== opt.primaryText && (
                      <p className="text-xs text-neutral-500 truncate">{opt.secondaryText}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`relative w-full min-h-[220px] touch-none ${heightClass}`}>
        {loadingStatus === APILoadingStatus.LOADING && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-neutral-100/90 text-xs text-neutral-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-neutral-700" />
            <span>{t('Chargement de Google Maps...', 'Loading Google Maps...')}</span>
          </div>
        )}
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={defaultCenter}
          defaultZoom={zoom}
          gestureHandling="greedy"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          zoomControl={true}
          clickableIcons={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%', minHeight: 220 }}
        >
          <GoogleMapCameraAndRoute
            center={center}
            markers={validMarkers}
            routeCoordinates={routeCoordinates}
            panTarget={panTarget}
            followDriver={followDriver}
          />
          {validMarkers.map((m) => (
            <RovaAdvancedMarker
              key={m.id}
              marker={m}
              draggable={Boolean(m.draggable && interactivePick)}
              onMarkerClick={onMarkerClick}
              onDragEnd={(lat, lng) => void reverseGeocodePoint(lat, lng)}
            />
          ))}
        </GoogleMap>
      </div>

      {interactivePick && (
        <div className="absolute bottom-7 left-3 z-[15] rounded-full bg-white/95 border border-neutral-200 px-3 py-1 text-[11px] text-neutral-600 pointer-events-none shadow-xs">
          {t(
            'Touchez la carte ou déplacez le marqueur pour affiner la position',
            'Tap map or drag pin to refine exact coordinates'
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LEAFLET FALLBACK (used only if VITE_GOOGLE_MAPS_API_KEY is absent or fails)
// ============================================================================

function buildMarkerIcon(marker: MapMarkerItem): L.DivIcon {
  if (marker.kind === 'driver') {
    return L.divIcon({
      className: 'rova-driver-pin',
      html: `<div style="width:28px;height:28px;background:#0a0a0a;color:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:700;border-radius:9999px;">R</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }
  if (marker.kind === 'pickup') {
    return L.divIcon({
      className: 'rova-pickup-pin',
      html: `<div style="width:28px;height:28px;background:#0a0a0a;color:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:700;border-radius:10px;">P</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }
  if (marker.kind === 'stop') {
    const num = marker.sequence ?? '•';
    return L.divIcon({
      className: 'rova-stop-pin',
      html: `<div style="width:28px;height:28px;background:#ffffff;color:#0a0a0a;border:2.5px solid #0a0a0a;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;font-size:11px;font-weight:700;border-radius:10px;">${num}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }
  return L.divIcon({
    className: 'rova-selected-pin',
    html: `<div style="width:20px;height:20px;background:#dc2626;border:3px solid #ffffff;box-shadow:0 2px 10px rgba(220,38,38,0.45);border-radius:9999px;"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function LeafletRovaMap({
  center = [5.6037, -0.187],
  zoom = 13,
  markers = [],
  routeCoordinates = [],
  interactivePick = false,
  showSearchBar = false,
  searchPlaceholder,
  initialSearchText = '',
  onLocationSelected,
  onMarkerClick,
  followDriver = false,
  heightClass = 'h-[360px]',
  className = '',
}: RovaMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);

  const [query, setQuery] = useState(initialSearchText);
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const onLocationSelectedRef = useRef(onLocationSelected);
  onLocationSelectedRef.current = onLocationSelected;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  useEffect(() => {
    setQuery(initialSearchText);
  }, [initialSearchText]);

  const reverseGeocodePoint = async (lat: number, lng: number) => {
    setReversing(true);
    try {
      const res = await fetch(
        `/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
      );
      const data = await res.json();
      const place: GeoPlace = {
        displayName: data.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: data.shortName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        landmark: data.landmark,
        lat,
        lng,
      };
      setQuery(place.shortName);
      setDropdownOpen(false);
      onLocationSelectedRef.current?.(place);
    } catch {
      const fallback: GeoPlace = {
        displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        shortName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
      };
      setQuery(fallback.shortName);
      onLocationSelectedRef.current?.(fallback);
    } finally {
      setReversing(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const geoapifyKey = getValidGeoapifyKey();
    L.tileLayer(
      geoapifyKey
        ? `https://maps.geoapify.com/v1/tile/osm-bright-grey/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(geoapifyKey)}`
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution: geoapifyKey
          ? 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          : '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: geoapifyKey ? undefined : 'abcd',
        maxZoom: 19,
        className: 'rova-map-tiles',
      }
    ).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Mobile browsers and installed home-screen apps often mount maps while a
    // sheet/tab is still animating or hidden. Recalculate Leaflet's viewport
    // whenever its container becomes visible or changes dimensions.
    const invalidateMapSize = () => {
      window.requestAnimationFrame(() => {
        if (mapRef.current === map) map.invalidateSize({ pan: false, animate: false });
      });
    };
    map.whenReady(invalidateMapSize);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(invalidateMapSize)
        : null;
    if (containerRef.current && resizeObserver) {
      resizeObserver.observe(containerRef.current);
      if (containerRef.current.parentElement) {
        resizeObserver.observe(containerRef.current.parentElement);
      }
    }
    window.addEventListener('resize', invalidateMapSize, { passive: true });
    window.addEventListener('orientationchange', invalidateMapSize, { passive: true });
    document.addEventListener('visibilitychange', invalidateMapSize);
    const resizeTimers = [120, 360, 800].map((delay) =>
      window.setTimeout(invalidateMapSize, delay)
    );

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!interactivePick) return;
      void reverseGeocodePoint(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', invalidateMapSize);
      window.removeEventListener('orientationchange', invalidateMapSize);
      document.removeEventListener('visibilitychange', invalidateMapSize);
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: L.LeafletMouseEvent) => {
      if (!interactivePick) return;
      void reverseGeocodePoint(e.latlng.lat, e.latlng.lng);
    };
    map.off('click');
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [interactivePick]);

  const lastBoundsKeyRef = useRef<string>('');

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const boundsPoints: [number, number][] = [];
    const staticKeyParts: string[] = [];

    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      const leafletMarker = L.marker([m.lat, m.lng], {
        icon: buildMarkerIcon(m),
        draggable: Boolean(m.draggable && interactivePick),
      });
      leafletMarker.bindTooltip(m.label, {
        direction: 'top',
        offset: [0, -12],
      });
      leafletMarker.on('click', () => {
        onMarkerClickRef.current?.(m);
      });
      if (m.draggable && interactivePick) {
        leafletMarker.on('dragend', () => {
          const pos = leafletMarker.getLatLng();
          void reverseGeocodePoint(pos.lat, pos.lng);
        });
      }
      leafletMarker.addTo(layer);
      boundsPoints.push([m.lat, m.lng]);
      if (m.kind !== 'driver') {
        staticKeyParts.push(`${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`);
      } else {
        staticKeyParts.push(`${m.id}:driver`);
      }
    }

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (routeCoordinates.length >= 2) {
      routeLayerRef.current = L.polyline(routeCoordinates, {
        color: '#0a0a0a',
        weight: 3.5,
        opacity: 0.9,
      }).addTo(map);
      for (const pt of routeCoordinates) {
        boundsPoints.push(pt);
      }
      const first = routeCoordinates[0];
      const last = routeCoordinates[routeCoordinates.length - 1];
      staticKeyParts.push(
        `route:${routeCoordinates.length}:${first[0].toFixed(3)},${last[0].toFixed(3)}`
      );
    }

    const nextKey = staticKeyParts.join('|');
    if (nextKey !== lastBoundsKeyRef.current) {
      lastBoundsKeyRef.current = nextKey;
      if (boundsPoints.length >= 2) {
        map.fitBounds(L.latLngBounds(boundsPoints), {
          padding: [44, 44],
          maxZoom: 15,
          animate: true,
        });
      } else if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], Math.max(map.getZoom(), 14), { animate: true });
      }
    }

    if (followDriver) {
      const driver = markers.find((m) => m.kind === 'driver' && Number.isFinite(m.lat) && Number.isFinite(m.lng));
      if (driver) {
        map.panTo([driver.lat, driver.lng], { animate: true });
      }
    }
  }, [markers, routeCoordinates, interactivePick, followDriver]);

  useEffect(() => {
    if (!showSearchBar || !dropdownOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, showSearchBar, dropdownOpen]);

  const handleSelectResult = (place: GeoPlace) => {
    setQuery(place.shortName);
    setDropdownOpen(false);
    setResults([]);
    if (mapRef.current) {
      mapRef.current.setView([place.lat, place.lng], 15, { animate: true });
    }
    onLocationSelected?.(place);
  };

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const { latitude, longitude } = pos.coords;
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 16, { animate: true });
        }
        void reverseGeocodePoint(latitude, longitude);
      },
      () => {
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const { t } = useLanguage();
  const effectivePlaceholder =
    searchPlaceholder ||
    t(
      'Rechercher une rue, un repère, un quartier ou des coordonnées GPS...',
      'Search street, landmark, digital address or GPS...'
    );

  return (
    <div
      className={`relative w-full rounded-2xl border border-neutral-200 bg-neutral-100 overflow-hidden ${className}`}
    >
      {showSearchBar && (
        <div className="absolute top-3 left-3 right-3 z-[400] flex flex-col gap-1.5">
          <div className="flex items-center rounded-xl bg-white border border-neutral-200 shadow-sm overflow-hidden">
            <div className="pl-3.5 text-neutral-500">
              {searching || reversing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </div>
            <input
              type="text"
              value={query}
              onFocus={() => setDropdownOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setDropdownOpen(true);
              }}
              placeholder={effectivePlaceholder}
              className="w-full px-3 py-2.5 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none bg-transparent"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
                aria-label={t('Effacer la recherche', 'Clear search')}
                className="p-2 text-neutral-400 hover:text-neutral-950"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleUseCurrentGps}
              disabled={gpsLoading}
              title={t('Utiliser ma position GPS', 'Use current GPS position')}
              className="px-3.5 py-2.5 border-l border-neutral-200 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 transition-colors flex items-center gap-1.5 text-xs font-medium whitespace-nowrap"
            >
              {gpsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crosshair className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">GPS</span>
            </button>
          </div>

          {dropdownOpen && results.length > 0 && (
            <div className="rounded-xl bg-white border border-neutral-200 shadow-lg max-h-56 overflow-y-auto divide-y divide-neutral-100">
              {results.map((r, i) => (
                <button
                  key={`${r.lat}-${r.lng}-${i}`}
                  type="button"
                  onClick={() => handleSelectResult(r)}
                  className="w-full px-3.5 py-2.5 text-left hover:bg-neutral-50 flex items-start gap-2.5 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-neutral-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-950 truncate">{r.shortName}</p>
                    <p className="text-xs text-neutral-500 truncate">{r.displayName}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={containerRef} className={`w-full ${heightClass}`} />

      {interactivePick && (
        <div className="absolute bottom-3 left-3 z-[400] rounded-full bg-white/95 border border-neutral-200 px-3 py-1 text-[11px] text-neutral-600 pointer-events-none shadow-xs">
          {t(
            'Touchez la carte ou déplacez le marqueur pour affiner la position',
            'Tap map or drag pin to refine exact coordinates'
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PUBLIC EXPORT: Uses Google Maps Platform when API key is configured
// ============================================================================

export function RovaMap(props: RovaMapProps) {
  const { googleMapsAvailable, browserApiKey } = useMapsRuntime();
  const { lang, region } = useLanguage();
  const initialLocaleRef = useRef({ lang, regionCode: region.countryCode });

  const handleApiError = useCallback((err: unknown) => {
    markGoogleMapsAuthFailed(String(err || 'script_load_failed'));
  }, []);

  if (googleMapsAvailable && browserApiKey) {
    return (
      <APIProvider
        apiKey={browserApiKey}
        language={initialLocaleRef.current.lang}
        region={initialLocaleRef.current.regionCode}
        libraries={GOOGLE_MAPS_LIBRARIES}
        authReferrerPolicy="origin"
        onError={handleApiError}
      >
        <GoogleRovaMap {...props} />
      </APIProvider>
    );
  }
  return <LeafletRovaMap {...props} />;
}
