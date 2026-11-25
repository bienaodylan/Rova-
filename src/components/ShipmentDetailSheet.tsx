import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { DeliveryRecord, DeliveryStatus, DeliveryStopRecord } from '../types/rova';
import {
  DELIVERY_STATUS_ORDER,
  getPaymentMethodLabelEn,
  getStatusLabel,
  getVehicleLabel,
  STATUS_META,
} from '../lib/logistics';
import { MapMarkerItem, RovaMap } from './RovaMap';
import { VehicleIllustration } from './VehicleIllustration';
import { BottomSheet } from './BottomSheet';
import { useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';

interface ShipmentDetailContentProps {
  delivery: DeliveryRecord;
  onOpenPublicTracking: (token: string) => void;
}

export function ShipmentDetailContent({
  delivery,
  onOpenPublicTracking,
}: ShipmentDetailContentProps) {
  const { lang, t, formatLocalMoney } = useLanguage();
  const { busy, cancelDelivery, repeatDelivery, openSupportSheet, showToast } = useRovaApp();

  const [stops, setStops] = useState<DeliveryStopRecord[]>([]);
  const [loadingStops, setLoadingStops] = useState(true);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  useEffect(() => {
    setLoadingStops(true);
    const unsub = onSnapshot(
      query(
        collection(db, 'deliveries', delivery.id, 'stops'),
        where('merchantUid', '==', delivery.merchantUid),
        orderBy('sequence', 'asc')
      ),
      (snap) => {
        setStops(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryStopRecord, 'id'>) })));
        setLoadingStops(false);
      },
      () => {
        setLoadingStops(false);
      }
    );
    return () => unsub();
  }, [delivery.id, delivery.merchantUid]);

  // Fetch road polyline once stops load
  useEffect(() => {
    if (stops.length === 0) {
      setRouteCoords([]);
      return;
    }
    let cancelled = false;
    const points = [
      { lat: delivery.pickupLat, lng: delivery.pickupLng },
      ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];
    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.geometry)) {
          setRouteCoords(data.geometry);
        }
      })
      .catch(() => {
        if (!cancelled) setRouteCoords(points.map((p) => [p.lat, p.lng]));
      });
    return () => {
      cancelled = true;
    };
  }, [delivery.pickupLat, delivery.pickupLng, stops]);

  const markers: MapMarkerItem[] = useMemo(() => {
    const list: MapMarkerItem[] = [
      {
        id: 'pickup',
        lat: delivery.pickupLat,
        lng: delivery.pickupLng,
        kind: 'pickup',
        label: delivery.pickupAddress,
      },
    ];
    stops.forEach((s) => {
      list.push({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        kind: 'stop',
        sequence: s.sequence,
        label: `#${s.sequence} ${s.recipientName}`,
      });
    });
    if (typeof delivery.driverLat === 'number' && typeof delivery.driverLng === 'number') {
      list.push({
        id: 'driver',
        lat: delivery.driverLat,
        lng: delivery.driverLng,
        kind: 'driver',
        label: delivery.driverName || t('Livreur ROVA', 'ROVA Driver'),
      });
    }
    return list;
  }, [delivery, stops, t]);

  const timelineSteps: Array<{ key: DeliveryStatus; label: string }> = [
    { key: 'pending', label: t('Livraison confirmée', 'Delivery confirmed') },
    { key: 'driver_assigned', label: t('Livreur assigné', 'Driver assigned') },
    { key: 'driver_approaching_pickup', label: t('En route vers la collecte', 'Heading to pickup') },
    { key: 'package_collected', label: t('Colis récupéré', 'Cargo collected') },
    { key: 'in_transit', label: t('Livraison en cours', 'In transit') },
    { key: 'arrived', label: t('Arrivé à destination', 'Arrived at destination') },
    { key: 'delivered', label: t('Livrée', 'Delivered') },
  ];

  const currentRank = DELIVERY_STATUS_ORDER.indexOf(delivery.status);
  const canCancel = delivery.status === 'pending' || delivery.status === 'scheduled';

  const copyTrackingUrl = (token: string) => {
    const url = `${window.location.origin}${window.location.pathname}?track=${encodeURIComponent(token)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    showToast(t('Lien de suivi destinataire copié.', 'Recipient tracking link copied.'), 'success');
  };

  return (
    <div className="space-y-6">
      {/* Status Headline + Key Metrics */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-neutral-100">
        <div>
          <p className="font-mono text-xs text-neutral-500">{delivery.reference}</p>
          <p className={`text-base font-semibold mt-0.5 ${STATUS_META[delivery.status]?.text || 'text-neutral-950'}`}>
            {getStatusLabel(delivery.status, lang)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {getVehicleLabel(delivery.vehicleCategory, lang)}
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">{delivery.totalDistanceKm.toFixed(1)} km</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">~{delivery.estimatedDurationMin} min</span>
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold text-neutral-950 tabular-nums">
            {formatLocalMoney(delivery.quotedPrice, delivery.currency)}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {getPaymentMethodLabelEn(delivery.paymentMethod)}
          </p>
        </div>
      </div>

      {/* Live Map */}
      <RovaMap
        center={[delivery.pickupLat, delivery.pickupLng]}
        markers={markers}
        routeCoordinates={routeCoords}
        heightClass="h-[230px] sm:h-[260px]"
      />

      {/* Driver & Vehicle Strip */}
      <div className="rounded-2xl bg-neutral-50 border border-neutral-200/70 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-white border border-neutral-200 flex items-center justify-center shrink-0">
            <VehicleIllustration category={delivery.vehicleCategory} className="w-9 h-6 text-neutral-900" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-950 truncate">
              {delivery.driverName || t('En attente d’un livreur ROVA', 'Awaiting ROVA driver')}
            </p>
            <p className="text-xs text-neutral-500 truncate">
              {getVehicleLabel(delivery.vehicleCategory, lang)} · {delivery.quantity}x {delivery.packageType} ({delivery.weightKg} kg)
            </p>
          </div>
        </div>
        {delivery.driverName && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-950 shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-600" aria-hidden="true" />
            {t('GPS actif', 'Live GPS')}
          </span>
        )}
      </div>

      {/* Clear Status Timeline */}
      {delivery.status !== 'cancelled' && delivery.status !== 'failed' && (
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold text-neutral-500">
            {t('Progression', 'Status timeline')}
          </h3>
          <div className="space-y-2">
            {timelineSteps.map((step) => {
              const stepRank = DELIVERY_STATUS_ORDER.indexOf(step.key);
              const done = currentRank >= stepRank && currentRank >= 0;
              const isCurrent = delivery.status === step.key;
              return (
                <div key={step.key} className="flex items-center gap-3 text-sm">
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${
                      isCurrent ? 'text-red-600' : done ? 'text-neutral-950' : 'text-neutral-300'
                    }`}
                  />
                  <span
                    className={
                      isCurrent
                        ? 'font-semibold text-neutral-950'
                        : done
                        ? 'text-neutral-700'
                        : 'text-neutral-400'
                    }
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Route & Stops with Isolated Recipient Tracking Links */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-neutral-500">
          {t('Itinéraire & destinataires', 'Route & recipients')}
        </h3>

        <div className="rounded-2xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
          <div className="p-3.5 flex items-start gap-3 bg-neutral-50/70">
            <div className="w-6 h-6 rounded-full bg-neutral-950 text-white font-mono text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              P
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-neutral-500">{t('Collecte', 'Pickup')}</p>
              <p className="text-sm font-medium text-neutral-950">{delivery.pickupAddress}</p>
              {delivery.pickupInstructions && (
                <p className="text-xs text-neutral-500 mt-0.5">{delivery.pickupInstructions}</p>
              )}
            </div>
          </div>

          {loadingStops ? (
            <div className="p-5 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('Chargement des arrêts...', 'Loading stops...')}
            </div>
          ) : (
            stops.map((stop) => (
              <div key={stop.id} className="p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-6 h-6 rounded-full border-2 border-neutral-950 text-neutral-950 font-mono text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {stop.sequence}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-950 truncate">
                        {stop.recipientName}
                      </p>
                      <p className="text-xs text-neutral-600">{stop.address}</p>
                      <p className="text-[11px] text-neutral-500 mt-0.5">
                        {stop.recipientPhone} · {getStatusLabel(stop.status, lang)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-xs font-semibold text-neutral-950">
                      OTP {stop.otpCode}
                    </span>
                  </div>
                </div>

                {stop.proofType && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 pl-9">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {t('Preuve validée :', 'Proof verified:')} {stop.proofType}
                      {stop.proofNotes ? ` · ${stop.proofNotes}` : ''}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pl-9">
                  <button
                    type="button"
                    onClick={() => copyTrackingUrl(stop.trackingToken)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-800 transition-colors cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    {t('Copier le lien client', 'Copy recipient link')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPublicTracking(stop.trackingToken)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-xs font-medium text-neutral-900 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t('Vue destinataire', 'Recipient view')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Contextual Actions */}
      <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-neutral-100">
        <button
          type="button"
          onClick={() => repeatDelivery(delivery)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('Répéter cette livraison', 'Repeat delivery')}
        </button>
        <button
          type="button"
          onClick={() => openSupportSheet(delivery.id)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-neutral-200 hover:border-neutral-950 text-xs font-medium text-neutral-800 transition-colors cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          {t('Contacter le support', 'Contact support')}
        </button>
        {canCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => cancelDelivery(delivery.id)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-red-200 text-red-700 hover:bg-red-50 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            {t('Annuler', 'Cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

export function ShipmentDetailSheet({
  onOpenPublicTracking,
}: {
  onOpenPublicTracking: (token: string) => void;
}) {
  const { t } = useLanguage();
  const { selectedDelivery, closeShipmentDetail } = useRovaApp();

  return (
    <BottomSheet
      open={Boolean(selectedDelivery)}
      onClose={closeShipmentDetail}
      size="lg"
      title={selectedDelivery?.reference || t('Détails de l’expédition', 'Shipment details')}
      subtitle={
        selectedDelivery
          ? `${selectedDelivery.pickupAddress} → ${selectedDelivery.primaryDestinationLabel || ''}`
          : undefined
      }
    >
      {selectedDelivery ? (
        <ShipmentDetailContent
          delivery={selectedDelivery}
          onOpenPublicTracking={(token) => {
            closeShipmentDetail();
            onOpenPublicTracking(token);
          }}
        />
      ) : (
        <div className="py-12 text-center text-sm text-neutral-500">
          <MapPin className="w-5 h-5 mx-auto mb-2 text-neutral-400" />
          {t('Sélectionnez une expédition.', 'Select a shipment.')}
        </div>
      )}
    </BottomSheet>
  );
}
