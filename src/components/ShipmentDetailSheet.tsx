import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  Check,
  Eye,
  HelpCircle,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { isSupabaseConfigured, supabaseApiFetch } from '../lib/supabase';
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
  const { busy, cancelDelivery, openSupportSheet } = useRovaApp();

  const [stops, setStops] = useState<DeliveryStopRecord[]>([]);
  const [loadingStops, setLoadingStops] = useState(true);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  useEffect(() => {
    setLoadingStops(true);
    if (isSupabaseConfigured()) {
      let cancelled = false;
      void supabaseApiFetch<{ stops: DeliveryStopRecord[] }>(
        `/api/v1/deliveries/${encodeURIComponent(delivery.id)}/stops`
      )
        .then((res) => {
          if (!cancelled) setStops(res.stops || []);
        })
        .catch(() => {
          if (!cancelled) setStops([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingStops(false);
        });
      return () => {
        cancelled = true;
      };
    }

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
  const canCancel =
    delivery.status === 'pending' ||
    delivery.status === 'scheduled' ||
    delivery.status === 'driver_assigned' ||
    delivery.status === 'driver_approaching_pickup';
  const isPostPickup =
    delivery.status === 'package_collected' ||
    delivery.status === 'in_transit' ||
    delivery.status === 'approaching_recipient' ||
    delivery.status === 'arrived';
  const hasReliableEta =
    typeof delivery.estimatedDurationMin === 'number' &&
    delivery.estimatedDurationMin > 0 &&
    !['delivered', 'cancelled', 'failed'].includes(delivery.status);
  const hasLiveGps =
    typeof delivery.driverLat === 'number' && typeof delivery.driverLng === 'number';

  return (
    <div className="space-y-6">
      {/* Map-First Operational View */}
      <div className="overflow-hidden rounded-2xl border border-[#E5E5E5]">
        <RovaMap
          center={[delivery.pickupLat, delivery.pickupLng]}
          markers={markers}
          routeCoordinates={routeCoords}
          heightClass="h-[230px] sm:h-[260px]"
        />
      </div>

      {/* Status & Financial Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#E5E5E5]">
        <div className="space-y-0.5">
          <p className="font-mono text-xs text-[#777777]">{delivery.reference}</p>
          <p className={`font-display text-base font-bold ${STATUS_META[delivery.status]?.text || 'text-[#171717]'}`}>
            {getStatusLabel(delivery.status, lang)}
          </p>
          <p className="text-xs text-[#777777]">
            {getVehicleLabel(delivery.vehicleCategory, lang)}
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">{delivery.totalDistanceKm.toFixed(1)} km</span>
            {hasReliableEta && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-mono tabular-nums">~{delivery.estimatedDurationMin} min</span>
              </>
            )}
          </p>
        </div>

        <div className="text-right">
          <p className="font-mono text-lg font-bold text-[#171717] tabular-nums">
            {formatLocalMoney(delivery.quotedPrice, delivery.currency)}
          </p>
          <p className="text-xs text-[#777777] mt-0.5">
            {getPaymentMethodLabelEn(delivery.paymentMethod)}
          </p>
        </div>
      </div>

      {/* Courier & Vehicle Row */}
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-10 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
            <VehicleIllustration category={delivery.vehicleCategory} className="w-9 h-6 text-[#171717]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#171717] truncate">
              {delivery.driverName || t('Affectation livreur en cours', 'Awaiting courier assignment')}
            </p>
            <p className="text-xs text-[#777777] truncate">
              {delivery.quantity}× {delivery.packageType} ({delivery.weightKg} kg)
            </p>
          </div>
        </div>
        {hasLiveGps && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-600" aria-hidden="true" />
            <span>{t('GPS actif', 'Live GPS')}</span>
          </span>
        )}
      </div>

      {/* Linear Vertical Progress Spine */}
      {delivery.status !== 'cancelled' && delivery.status !== 'failed' && (
        <div className="space-y-3 pt-2 border-t border-[#E5E5E5]">
          <h3 className="text-xs font-medium text-[#777777]">
            {t('Progression', 'Status timeline')}
          </h3>
          <div className="relative pl-6 space-y-3">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#E5E5E5]" aria-hidden="true" />
            {timelineSteps.map((step) => {
              const stepRank = DELIVERY_STATUS_ORDER.indexOf(step.key);
              const done = currentRank >= stepRank && currentRank >= 0;
              const isCurrent = delivery.status === step.key;
              return (
                <div key={step.key} className="relative flex items-center gap-3 text-sm">
                  <span
                    className={`absolute -left-6 w-4 h-4 rounded-full flex items-center justify-center border ${
                      isCurrent
                        ? 'border-[#E52B32] bg-[#E52B32] text-white'
                        : done
                        ? 'border-[#171717] bg-[#171717] text-white'
                        : 'border-[#E5E5E5] bg-white'
                    }`}
                  >
                    {(done || isCurrent) && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span
                    className={
                      isCurrent
                        ? 'font-semibold text-[#171717]'
                        : done
                        ? 'text-[#171717]'
                        : 'text-[#777777]'
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

      {/* Route & Recipients Ledger */}
      <div className="space-y-2.5 pt-2 border-t border-[#E5E5E5]">
        <h3 className="text-xs font-medium text-[#777777]">
          {t('Itinéraire & destinataires', 'Route & recipients')}
        </h3>

        <div className="border-y border-[#E5E5E5] divide-y divide-[#E5E5E5]">
          <div className="py-3.5 flex items-start gap-3">
            <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-[#171717] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[11px] text-[#777777]">{t('Collecte', 'Pickup')}</p>
              <p className="text-sm font-medium text-[#171717]">{delivery.pickupAddress}</p>
              {delivery.pickupInstructions && (
                <p className="text-xs text-[#777777] mt-0.5">{delivery.pickupInstructions}</p>
              )}
            </div>
          </div>

          {loadingStops ? (
            <div className="py-5 flex items-center justify-center gap-2 text-xs text-[#777777]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('Chargement des arrêts...', 'Loading stops...')}</span>
            </div>
          ) : (
            stops.map((stop) => (
              <div key={stop.id} className="py-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-1.5 w-2.5 h-2.5 rounded-[2px] bg-[#E52B32] shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#171717] truncate">
                        {stops.length > 1 ? `#${stop.sequence} · ` : ''}
                        {stop.recipientName}
                      </p>
                      <p className="text-xs text-[#777777]">{stop.address}</p>
                      <p className="text-[11px] text-[#777777] mt-0.5">
                        {stop.recipientPhone} · {getStatusLabel(stop.status, lang)}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-[#171717] bg-[#F3F3F3] px-2.5 py-1 rounded-lg shrink-0 tabular-nums">
                    OTP {stop.otpCode}
                  </span>
                </div>

                {stop.proofType && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 pl-5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {t('Preuve validée :', 'Proof verified:')} {stop.proofType}
                      {stop.proofNotes ? ` · ${stop.proofNotes}` : ''}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pl-5">
                  {stop.recipientPhone && (
                    <a
                      href={`tel:${stop.recipientPhone}`}
                      className="min-h-[34px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[#E5E5E5] hover:border-[#171717] text-xs font-medium text-[#171717] transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{t('Appeler', 'Call')}</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenPublicTracking(stop.trackingToken)}
                    className="min-h-[34px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-[#F3F3F3] hover:bg-[#E5E5E5] text-xs font-medium text-[#171717] transition-colors cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    <span>{t('Vue destinataire', 'Recipient view')}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Post-pickup Policy Notice */}
      {isPostPickup && (
        <div className="rounded-xl border border-[#E5E5E5] bg-[#F3F3F3]/70 px-4 py-3 text-xs text-[#777777] leading-relaxed">
          {t(
            'Le colis est déjà pris en charge par le livreur. Contactez le support pour initier un retour expéditeur sécurisé.',
            'Parcel is in courier custody. Contact support to initiate a secure return to sender.'
          )}
        </div>
      )}

      {/* Contextual State-Aware Actions */}
      <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-[#E5E5E5]">
        <button
          type="button"
          onClick={() => openSupportSheet(delivery.id)}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-[#E5E5E5] hover:border-[#171717] text-xs font-semibold text-[#171717] transition-colors cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>
            {isPostPickup
              ? t('Signaler un incident / Retour', 'Report incident / Return')
              : t('Contacter le support', 'Contact support')}
          </span>
        </button>
        {canCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => cancelDelivery(delivery.id)}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-red-200 text-[#E52B32] hover:bg-red-50 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>{t('Annuler la livraison', 'Cancel delivery')}</span>
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
        <div className="py-12 text-center text-sm text-[#777777]">
          <MapPin className="w-5 h-5 mx-auto mb-2 text-[#777777]" />
          {t('Sélectionnez une expédition.', 'Select a shipment.')}
        </div>
      )}
    </BottomSheet>
  );
}
