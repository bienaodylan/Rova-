import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  Calendar,
  ChevronRight,
  List,
  Map as MapIcon,
  MapPin,
  Navigation,
  Plus,
  Search,
  XCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { useLanguage } from '../context/LanguageContext';
import { ShipmentFilter, useRovaApp } from '../context/RovaAppContext';
import { VehicleIllustration } from '../components/VehicleIllustration';
import { TrackingParcelIllustration } from '../components/RovaIllustrations';
import { ShipmentDetailContent } from '../components/ShipmentDetailSheet';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import {
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';
import { DeliveryStopRecord, GeoPlace } from '../types/rova';

interface RovaShipmentsViewProps {
  onOpenPublicTracking: (token: string) => void;
}

type ShipmentsViewMode = 'list' | 'map';

export function RovaShipmentsView({ onOpenPublicTracking }: RovaShipmentsViewProps) {
  const { lang, t, formatLocalMoney, region } = useLanguage();
  const {
    loadingData,
    business,
    deliveries,
    reservations,
    onlineDrivers,
    shipmentFilter,
    setShipmentFilter,
    openComposer,
    openReservationSheet,
    openShipmentDetail,
    cancelReservation,
    busy,
  } = useRovaApp();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ShipmentsViewMode>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStops, setSelectedStops] = useState<DeliveryStopRecord[]>([]);
  const [selectedRouteCoords, setSelectedRouteCoords] = useState<[number, number][]>([]);
  const [pickedOrigin, setPickedOrigin] = useState<GeoPlace | null>(null);
  const { hidden: headerHidden, scrolled: headerScrolled } = useHideOnScroll();

  const counts = useMemo(() => {
    const active = deliveries.filter(
      (d) => !['delivered', 'failed', 'cancelled', 'scheduled'].includes(d.status)
    ).length;
    const upcomingDeliveries = deliveries.filter((d) => d.status === 'scheduled').length;
    const upcomingRes = reservations.filter((r) =>
      ['pending_approval', 'confirmed', 'in_progress'].includes(r.status)
    ).length;
    const completed = deliveries.filter((d) => d.status === 'delivered').length;
    const cancelled = deliveries.filter((d) => d.status === 'cancelled' || d.status === 'failed').length;
    return {
      all: deliveries.length + reservations.length,
      active,
      upcoming: upcomingDeliveries + upcomingRes,
      completed,
      cancelled,
    };
  }, [deliveries, reservations]);

  const filteredDeliveries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (shipmentFilter === 'active' && ['delivered', 'failed', 'cancelled', 'scheduled'].includes(d.status)) {
        return false;
      }
      if (shipmentFilter === 'upcoming' && d.status !== 'scheduled') return false;
      if (shipmentFilter === 'completed' && d.status !== 'delivered') return false;
      if (shipmentFilter === 'cancelled' && d.status !== 'cancelled' && d.status !== 'failed') return false;
      if (!q) return true;
      return (
        d.reference.toLowerCase().includes(q) ||
        d.pickupAddress.toLowerCase().includes(q) ||
        (d.primaryDestinationLabel || '').toLowerCase().includes(q) ||
        (d.driverName || '').toLowerCase().includes(q)
      );
    });
  }, [deliveries, shipmentFilter, search]);

  const filteredReservations = useMemo(() => {
    if (shipmentFilter !== 'all' && shipmentFilter !== 'upcoming') return [];
    const q = search.trim().toLowerCase();
    return reservations.filter((r) => {
      if (shipmentFilter === 'upcoming' && !['pending_approval', 'confirmed', 'in_progress'].includes(r.status)) {
        return false;
      }
      if (!q) return true;
      return (
        r.pickupAddress.toLowerCase().includes(q) ||
        r.reservationDate.toLowerCase().includes(q) ||
        getVehicleLabel(r.vehicleCategory, lang).toLowerCase().includes(q)
      );
    });
  }, [reservations, shipmentFilter, search, lang]);

  const activeSelection = useMemo(() => {
    if (filteredDeliveries.length === 0) return null;
    return filteredDeliveries.find((d) => d.id === selectedId) || filteredDeliveries[0];
  }, [filteredDeliveries, selectedId]);

  // Subscribe to stops of the selected delivery when Map view is active
  useEffect(() => {
    if (viewMode !== 'map' || !activeSelection) {
      setSelectedStops([]);
      setSelectedRouteCoords([]);
      return;
    }

    const unsub = onSnapshot(
      query(
        collection(db, 'deliveries', activeSelection.id, 'stops'),
        where('merchantUid', '==', activeSelection.merchantUid),
        orderBy('sequence', 'asc')
      ),
      (snap) => {
        setSelectedStops(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryStopRecord, 'id'>) }))
        );
      },
      () => {
        setSelectedStops([]);
      }
    );
    return () => unsub();
  }, [viewMode, activeSelection?.id, activeSelection?.merchantUid]);

  // Compute road route polyline for the selected delivery in Map view
  useEffect(() => {
    if (viewMode !== 'map' || !activeSelection || selectedStops.length === 0) {
      setSelectedRouteCoords([]);
      return;
    }

    let cancelled = false;
    const points = [
      { lat: activeSelection.pickupLat, lng: activeSelection.pickupLng },
      ...selectedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];

    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.geometry)) {
          setSelectedRouteCoords(data.geometry);
        }
      })
      .catch(() => {
        if (!cancelled) setSelectedRouteCoords(points.map((p) => [p.lat, p.lng]));
      });

    return () => {
      cancelled = true;
    };
  }, [viewMode, activeSelection?.id, activeSelection?.pickupLat, activeSelection?.pickupLng, selectedStops]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (pickedOrigin) return [pickedOrigin.lat, pickedOrigin.lng];
    if (activeSelection && Number.isFinite(activeSelection.pickupLat) && Number.isFinite(activeSelection.pickupLng)) {
      return [activeSelection.pickupLat, activeSelection.pickupLng];
    }
    if (business?.defaultPickupLat && business?.defaultPickupLng) {
      return [business.defaultPickupLat, business.defaultPickupLng];
    }
    return [region.lat, region.lng];
  }, [pickedOrigin, activeSelection, business?.defaultPickupLat, business?.defaultPickupLng, region.lat, region.lng]);

  const mapMarkers = useMemo<MapMarkerItem[]>(() => {
    const list: MapMarkerItem[] = [];

    if (pickedOrigin) {
      list.push({
        id: 'picked_origin',
        lat: pickedOrigin.lat,
        lng: pickedOrigin.lng,
        kind: 'selected',
        label: pickedOrigin.shortName || pickedOrigin.displayName,
        draggable: true,
      });
    }

    if (activeSelection) {
      list.push({
        id: `del_${activeSelection.id}`,
        lat: activeSelection.pickupLat,
        lng: activeSelection.pickupLng,
        kind: 'pickup',
        label: `${activeSelection.reference} · ${activeSelection.pickupAddress}`,
        meta: activeSelection.id,
      });
      selectedStops.forEach((s) => {
        list.push({
          id: `stop_${s.id}`,
          lat: s.lat,
          lng: s.lng,
          kind: 'stop',
          sequence: s.sequence,
          label: `#${s.sequence} ${s.recipientName} · ${s.address}`,
          meta: activeSelection.id,
        });
      });
      if (typeof activeSelection.driverLat === 'number' && typeof activeSelection.driverLng === 'number') {
        list.push({
          id: `drv_${activeSelection.id}`,
          lat: activeSelection.driverLat,
          lng: activeSelection.driverLng,
          kind: 'driver',
          label: activeSelection.driverName || t('Livreur ROVA', 'ROVA Driver'),
          meta: activeSelection.id,
        });
      }
    }

    // Also pin other filtered deliveries for instant visual fleet overview
    filteredDeliveries.slice(0, 12).forEach((del) => {
      if (del.id === activeSelection?.id) return;
      if (Number.isFinite(del.pickupLat) && Number.isFinite(del.pickupLng)) {
        list.push({
          id: `del_${del.id}`,
          lat: del.pickupLat,
          lng: del.pickupLng,
          kind: 'pickup',
          label: `${del.reference} · ${del.pickupAddress}`,
          meta: del.id,
        });
      }
    });

    // Pin online available drivers nearby
    onlineDrivers.slice(0, 8).forEach((d) => {
      if (typeof d.currentLat === 'number' && typeof d.currentLng === 'number') {
        list.push({
          id: `online_drv_${d.uid}`,
          lat: d.currentLat,
          lng: d.currentLng,
          kind: 'driver',
          label: `${d.firstName || t('Livreur', 'Driver')} · ${getVehicleLabel(d.vehicleCategory, lang)}`,
        });
      }
    });

    return list;
  }, [pickedOrigin, activeSelection, selectedStops, filteredDeliveries, onlineDrivers, lang, t]);

  const filters: Array<{ id: ShipmentFilter; label: string; count: number }> = [
    { id: 'all', label: t('Toutes', 'All'), count: counts.all },
    { id: 'active', label: t('Actives', 'Active'), count: counts.active },
    { id: 'upcoming', label: t('À venir', 'Upcoming'), count: counts.upcoming },
    { id: 'completed', label: t('Terminées', 'Completed'), count: counts.completed },
    { id: 'cancelled', label: t('Annulées', 'Cancelled'), count: counts.cancelled },
  ];

  const handleSelectRow = (id: string) => {
    setSelectedId(id);
    if (window.innerWidth < 1280) {
      openShipmentDetail(id);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-0 sm:pt-7 pb-8 space-y-5">
      {/* Header — Mobile Auto-Hide on Scroll Down, Reveal on Scroll Up */}
      <header
        className={`sticky top-0 z-30 -mx-4 px-4 py-3 flex flex-wrap items-center justify-between gap-3 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none sm:static sm:mx-0 sm:px-0 sm:py-0 sm:translate-y-0 sm:pointer-events-auto sm:bg-transparent sm:backdrop-blur-none sm:border-none ${
          headerHidden ? '-translate-y-full pointer-events-none' : 'translate-y-0'
        } ${
          headerScrolled
            ? 'bg-[#f8f8f9]/92 backdrop-blur-md border-b border-neutral-200/70'
            : 'bg-transparent border-b border-transparent'
        }`}
      >
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-neutral-950">
            {t('Expéditions', 'Shipments')}
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t(
              'Gérez vos livraisons et visualisez vos trajets sur la carte en direct.',
              'Manage deliveries and view your live routes on the map.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Dedicated Liste / Carte View Switcher (works cleanly on mobile & desktop) */}
          <div
            role="group"
            aria-label={t('Mode d’affichage', 'View mode')}
            className="inline-flex items-center rounded-full bg-white border border-neutral-200 p-0.5"
          >
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-neutral-950 text-white'
                  : 'text-neutral-600 hover:text-neutral-950'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>{t('Liste', 'List')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                viewMode === 'map'
                  ? 'bg-neutral-950 text-white'
                  : 'text-neutral-600 hover:text-neutral-950'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>{t('Carte', 'Map')}</span>
              {counts.active > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => openComposer('single')}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('Nouvelle livraison', 'New delivery')}</span>
            <span className="sm:hidden">{t('Expédier', 'Ship')}</span>
          </button>
        </div>
      </header>

      {/* Lightweight Segmented Filters + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {filters.map((f) => {
            const active = shipmentFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setShipmentFilter(f.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-neutral-950 text-white'
                    : 'bg-white border border-neutral-200 text-neutral-700 hover:border-neutral-400'
                }`}
              >
                {active && <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />}
                <span>{f.label}</span>
                {f.count > 0 && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      active ? 'text-neutral-300' : 'text-neutral-400'
                    }`}
                  >
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-64 shrink-0">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Référence, adresse, livreur...', 'Reference, address, driver...')}
            className="w-full pl-9 pr-3.5 py-2 rounded-full bg-white border border-neutral-200 text-xs focus:outline-none focus:border-neutral-950"
          />
        </div>
      </div>

      {/* ================================================================== */}
      {/* DEDICATED MAP & DELIVERIES MANAGEMENT VIEW (Mobile + Desktop)      */}
      {/* ================================================================== */}
      {viewMode === 'map' ? (
        <section className="space-y-4">
          <div className="rounded-3xl bg-white border border-neutral-200/80 p-2.5 sm:p-3 space-y-3">
            <RovaMap
              center={mapCenter}
              zoom={13}
              markers={mapMarkers}
              routeCoordinates={selectedRouteCoords}
              interactivePick
              showSearchBar
              followDriver={Boolean(activeSelection?.driverLat)}
              initialSearchText={pickedOrigin?.shortName || ''}
              searchPlaceholder={t(
                `Rechercher une adresse à ${region.city} pour expédier...`,
                `Search an address in ${region.city} to dispatch...`
              )}
              heightClass="h-[340px] sm:h-[440px]"
              onLocationSelected={(place) => setPickedOrigin(place)}
              onMarkerClick={(marker) => {
                if (marker.meta) {
                  setSelectedId(marker.meta);
                  setPickedOrigin(null);
                }
              }}
            />

            {/* Quick action bar when user picked a custom location on the map */}
            {pickedOrigin && (
              <div className="px-3.5 py-2.5 rounded-2xl bg-neutral-50 border border-neutral-200/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin className="w-4 h-4 text-red-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-neutral-500">
                      {t('Emplacement sélectionné', 'Selected location')}
                    </p>
                    <p className="text-xs font-semibold text-neutral-950 truncate">
                      {pickedOrigin.shortName || pickedOrigin.displayName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPickedOrigin(null)}
                    className="text-xs text-neutral-500 hover:text-neutral-950 px-2 py-1 cursor-pointer"
                  >
                    {t('Fermer', 'Clear')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openComposer('single', undefined, {
                        address: pickedOrigin.shortName || pickedOrigin.displayName,
                        landmark: pickedOrigin.landmark,
                        lat: pickedOrigin.lat,
                        lng: pickedOrigin.lng,
                      })
                    }
                    className="px-3.5 py-2 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {t('Créer une livraison ici', 'Ship from here')}
                  </button>
                </div>
              </div>
            )}

            {/* Quick Shipment Strip to switch active route on map */}
            {filteredDeliveries.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-0.5 pb-1">
                {filteredDeliveries.map((del) => {
                  const isSelected = activeSelection?.id === del.id;
                  return (
                    <button
                      key={del.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(del.id);
                        setPickedOrigin(null);
                      }}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-neutral-950 text-white'
                          : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                      }`}
                    >
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" aria-hidden="true" />
                      )}
                      <span className="font-mono font-semibold">{del.reference}</span>
                      <span className={isSelected ? 'text-neutral-300' : 'text-neutral-500'}>
                        {getStatusLabel(del.status, lang)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Focused Shipment Management Strip for the Selected Pin */}
          {activeSelection ? (
            <div className="rounded-3xl bg-white border border-neutral-200/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0">
                  <VehicleIllustration
                    category={activeSelection.vehicleCategory}
                    className="w-9 h-6 text-neutral-900"
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-neutral-500 flex-wrap">
                    <span className="font-mono font-semibold text-neutral-950">
                      {activeSelection.reference}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className={`font-medium ${STATUS_META[activeSelection.status]?.text || 'text-neutral-700'}`}>
                      {getStatusLabel(activeSelection.status, lang)}
                    </span>
                    {activeSelection.driverName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-neutral-800">
                          <Navigation className="w-3 h-3 text-red-600" />
                          {activeSelection.driverName}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-neutral-950 truncate">
                    {activeSelection.pickupAddress} → {activeSelection.primaryDestinationLabel || t('Destination', 'Destination')}
                  </p>
                  <p className="text-xs text-neutral-500 font-mono tabular-nums">
                    {activeSelection.totalDistanceKm.toFixed(1)} km · ~{activeSelection.estimatedDurationMin} min ·{' '}
                    {formatLocalMoney(activeSelection.quotedPrice, activeSelection.currency)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openShipmentDetail(activeSelection.id)}
                  className="px-4 py-2.5 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  {t('Gérer l’expédition', 'Manage shipment')}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl bg-white border border-neutral-200/80 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-neutral-950">
                  {t('Aucune expédition active sur la carte', 'No active shipments on the map')}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {t(
                    'Touchez un point sur la carte ou recherchez une adresse pour démarrer une livraison.',
                    'Tap any point on the map or search an address to start a delivery.'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openComposer('single')}
                className="px-4 py-2.5 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
              >
                {t('Nouvelle livraison', 'New delivery')}
              </button>
            </div>
          )}
        </section>
      ) : (
        /* ================================================================== */
        /* MASTER-DETAIL LIST VIEW (Desktop Split + Mobile Stream)            */
        /* ================================================================== */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-5 space-y-4">
            {loadingData ? (
              <div className="rounded-2xl bg-white border border-neutral-200/80 p-5 space-y-4 animate-pulse">
                <div className="h-4 w-36 bg-neutral-200 rounded" />
                <div className="h-3 w-full bg-neutral-100 rounded" />
                <div className="h-4 w-32 bg-neutral-200 rounded pt-2" />
                <div className="h-3 w-4/5 bg-neutral-100 rounded" />
              </div>
            ) : filteredDeliveries.length === 0 && filteredReservations.length === 0 ? (
              <div className="rounded-3xl bg-white border border-neutral-200/80 p-8 text-center space-y-3">
                <div className="flex justify-center">
                  <TrackingParcelIllustration className="w-32 h-24" />
                </div>
                <p className="font-display text-base font-bold text-neutral-950">
                  {shipmentFilter === 'upcoming'
                    ? t('Aucune réservation à venir', 'No upcoming reservations')
                    : t('Aucune expédition trouvée', 'No shipments yet')}
                </p>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                  {shipmentFilter === 'upcoming'
                    ? t(
                        'Planifiez un véhicule dédié à l’avance pour vos tournées commerciales.',
                        'Reserve a dedicated vehicle ahead of time for your commercial runs.'
                      )
                    : t(
                        'Créez votre première livraison pour suivre vos colis et partager le lien client.',
                        'Create your first delivery to track parcels live and share recipient links.'
                      )}
                </p>
                <div className="pt-1 flex justify-center gap-2">
                  {shipmentFilter === 'upcoming' ? (
                    <button
                      type="button"
                      onClick={openReservationSheet}
                      className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
                    >
                      {t('Planifier un véhicule', 'Schedule a vehicle')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openComposer('single')}
                      className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
                    >
                      {t('Créer votre première livraison', 'Create your first delivery')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Deliveries List */}
                {filteredDeliveries.length > 0 && (
                  <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                    {filteredDeliveries.map((del) => {
                      const selected = activeSelection?.id === del.id;
                      const createdLabel = del.createdAt?.toDate
                        ? del.createdAt.toDate().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '';
                      return (
                        <button
                          key={del.id}
                          type="button"
                          onClick={() => handleSelectRow(del.id)}
                          className={`w-full text-left p-4 sm:p-5 transition-colors cursor-pointer flex items-start justify-between gap-3 ${
                            selected ? 'xl:bg-neutral-100/80 hover:bg-neutral-50' : 'hover:bg-neutral-50'
                          }`}
                        >
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0 mt-0.5">
                              <VehicleIllustration
                                category={del.vehicleCategory}
                                className="w-8 h-6 text-neutral-900"
                              />
                            </div>
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 text-xs text-neutral-500 flex-wrap">
                                <span className="font-mono font-semibold text-neutral-950">
                                  {del.reference}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className={`font-medium ${STATUS_META[del.status]?.text || 'text-neutral-700'}`}>
                                  {getStatusLabel(del.status, lang)}
                                </span>
                                {createdLabel && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{createdLabel}</span>
                                  </>
                                )}
                              </div>
                              <p className="text-sm font-medium text-neutral-950 truncate">
                                {del.pickupAddress} → {del.primaryDestinationLabel || t('Destination', 'Destination')}
                              </p>
                              <p className="text-xs text-neutral-500">
                                {getVehicleLabel(del.vehicleCategory, lang)}
                                {del.driverName ? ` · ${del.driverName}` : ''}
                                {del.isMultiStop ? ` · ${del.stopCount} ${t('arrêts', 'stops')}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <span className="font-mono text-xs font-semibold text-neutral-950 tabular-nums">
                              {formatLocalMoney(del.quotedPrice, del.currency)}
                            </span>
                            <ChevronRight className="w-4 h-4 text-neutral-400 xl:hidden" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Upcoming / Scheduled Vehicle Reservations */}
                {filteredReservations.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-neutral-500 px-1">
                      {t('Réservations de véhicules', 'Vehicle reservations')}
                    </p>
                    <div className="rounded-3xl bg-white border border-neutral-200/80 divide-y divide-neutral-100 overflow-hidden">
                      {filteredReservations.map((res) => (
                        <div key={res.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0">
                              <Calendar className="w-4 h-4 text-neutral-800" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-neutral-950 truncate">
                                {getVehicleLabel(res.vehicleCategory, lang)} · {res.reservationDate}
                              </p>
                              <p className="text-xs text-neutral-500 truncate">
                                {res.startTime}–{res.endTime} · {res.pickupAddress}
                              </p>
                              <p className="text-[11px] text-neutral-500 mt-0.5">
                                {res.status === 'pending_approval'
                                  ? t('En attente de confirmation', 'Pending confirmation')
                                  : res.status === 'confirmed'
                                  ? t('Confirmée', 'Confirmed')
                                  : res.status === 'cancelled'
                                  ? t('Annulée', 'Cancelled')
                                  : res.status}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-xs font-semibold tabular-nums">
                              {formatLocalMoney(res.quotedPrice, res.currency)}
                            </span>
                            {(res.status === 'pending_approval' || res.status === 'confirmed') && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => cancelReservation(res.id)}
                                aria-label={t('Annuler la réservation', 'Cancel reservation')}
                                className="p-1.5 rounded-full text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Desktop Inline Detail & Live Tracking Panel */}
          <div className="hidden xl:block xl:col-span-7 sticky top-6">
            <div className="rounded-3xl bg-white border border-neutral-200/80 p-6">
              {activeSelection ? (
                <ShipmentDetailContent
                  delivery={activeSelection}
                  onOpenPublicTracking={onOpenPublicTracking}
                />
              ) : (
                <div className="py-16 text-center space-y-3">
                  <div className="flex justify-center">
                    <TrackingParcelIllustration className="w-36 h-28" />
                  </div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {t('Aperçu de l’expédition', 'Shipment inspector')}
                  </p>
                  <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                    {t(
                      'Sélectionnez une livraison à gauche ou basculez en mode Carte pour suivre vos trajets en direct.',
                      'Select a delivery on the left or switch to Map view to track your routes live.'
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
