import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { GeoPlace } from '../types/rova';
import { useLanguage } from '../context/LanguageContext';

export interface MapMarkerItem {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'stop' | 'driver' | 'selected';
  sequence?: number;
  draggable?: boolean;
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
  heightClass?: string;
  className?: string;
}

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
    html: `<div style="width:20px;height:20px;background:#0a0a0a;border:3px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);border-radius:9999px;"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export function RovaMap({
  center = [5.6037, -0.187], // Accra default (African urban readiness, works globally)
  zoom = 13,
  markers = [],
  routeCoordinates = [],
  interactivePick = false,
  showSearchBar = false,
  searchPlaceholder,
  initialSearchText = '',
  onLocationSelected,
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

  useEffect(() => {
    setQuery(initialSearchText);
  }, [initialSearchText]);

  const reverseGeocodePoint = async (lat: number, lng: number) => {
    setReversing(true);
    try {
      const res = await fetch(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
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

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Real OpenStreetMap / CARTO Positron monochrome tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
      className: 'rova-map-tiles',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!interactivePick) return;
      reverseGeocodePoint(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  // Update interactive click listener if prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: L.LeafletMouseEvent) => {
      if (!interactivePick) return;
      reverseGeocodePoint(e.latlng.lat, e.latlng.lng);
    };
    map.off('click');
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [interactivePick]);

  const lastBoundsKeyRef = useRef<string>('');

  // Synchronize markers & route polyline smoothly without unnecessary resets
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
      if (m.draggable && interactivePick) {
        leafletMarker.on('dragend', () => {
          const pos = leafletMarker.getLatLng();
          reverseGeocodePoint(pos.lat, pos.lng);
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
      staticKeyParts.push(`route:${routeCoordinates.length}:${first[0].toFixed(3)},${last[0].toFixed(3)}`);
    }

    const nextKey = staticKeyParts.join('|');
    if (nextKey !== lastBoundsKeyRef.current) {
      lastBoundsKeyRef.current = nextKey;
      if (boundsPoints.length >= 2) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [44, 44], maxZoom: 15, animate: true });
      } else if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], Math.max(map.getZoom(), 14), { animate: true });
      }
    }
  }, [markers, routeCoordinates, interactivePick]);

  // Debounced geocoding search
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
        reverseGeocodePoint(latitude, longitude);
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
    <div className={`relative w-full rounded-2xl border border-neutral-200 bg-neutral-100 overflow-hidden ${className}`}>
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
