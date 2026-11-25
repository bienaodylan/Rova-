import React, { useMemo, useState } from 'react';
import { Calendar, Check, Loader2 } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { RovaMap } from './RovaMap';
import { VehicleIllustration } from './VehicleIllustration';
import { useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';
import { getEffectivePricingRule, VEHICLE_CATALOG } from '../lib/logistics';
import { VehicleCategory } from '../types/rova';

export function ReservationSheet() {
  const { lang, t, formatLocalMoney } = useLanguage();
  const {
    reservationSheetOpen,
    closeReservationSheet,
    business,
    pricingRules,
    busy,
    submitReservation,
  } = useRovaApp();

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('cargo_van');
  const [durationType, setDurationType] = useState<'window' | 'hours' | 'full_day'>('hours');
  const [reservationDate, setReservationDate] = useState(tomorrow);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [pickupAddress, setPickupAddress] = useState(business?.defaultPickupAddress || '');
  const [pickupCoords, setPickupCoords] = useState({
    lat: business?.defaultPickupLat ?? 5.3235,
    lng: business?.defaultPickupLng ?? -4.0267,
  });
  const [destinationsSummary, setDestinationsSummary] = useState('');
  const [cargoRequirements, setCargoRequirements] = useState('');

  const rule = getEffectivePricingRule(pricingRules, vehicleCategory);
  const quotedPrice = useMemo(() => {
    if (durationType === 'full_day') return rule.fullDayRate;
    if (durationType === 'hours') return Math.round(rule.fullDayRate * 0.55);
    return Math.round(rule.baseFee + rule.scheduledFee + rule.perKmRate * 8);
  }, [durationType, rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickupAddress.trim() || !reservationDate) return;
    await submitReservation({
      vehicleCategory,
      reservationDate,
      startTime,
      endTime,
      durationType,
      pickupAddress,
      pickupLat: pickupCoords.lat,
      pickupLng: pickupCoords.lng,
      destinationsSummary,
      cargoRequirements,
      quotedPrice,
    });
  };

  return (
    <BottomSheet
      open={reservationSheetOpen}
      onClose={closeReservationSheet}
      size="lg"
      title={t('Planifier un véhicule', 'Schedule a vehicle')}
      subtitle={t(
        'Réservez un véhicule dédié pour un créneau ou une journée complète.',
        'Reserve a dedicated vehicle for a time window or full day.'
      )}
      footer={
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] text-neutral-500">{t('Tarif estimé', 'Estimated rate')}</p>
            <p className="font-mono text-base font-bold text-neutral-950 tabular-nums">
              {formatLocalMoney(quotedPrice, rule.currency || 'GHS')}
            </p>
          </div>
          <button
            type="submit"
            form="rova-reservation-form"
            disabled={busy || !pickupAddress.trim()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{t('Confirmer la réservation', 'Confirm reservation')}</span>
          </button>
        </div>
      }
    >
      <form id="rova-reservation-form" onSubmit={handleSubmit} className="space-y-5">
        {/* Vehicle Picker */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-neutral-700">
            {t('Catégorie de véhicule', 'Vehicle category')}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {VEHICLE_CATALOG.map((v) => {
              const active = vehicleCategory === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicleCategory(v.id)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    active
                      ? 'border-neutral-950 bg-neutral-950 text-white'
                      : 'border-neutral-200 bg-white hover:border-neutral-400 text-neutral-900'
                  }`}
                >
                  <VehicleIllustration category={v.id} className="w-10 h-7 mb-2" />
                  <p className="text-xs font-semibold truncate">{lang === 'fr' ? v.labelFr : v.label}</p>
                  <p className={`text-[11px] font-mono ${active ? 'text-neutral-300' : 'text-neutral-500'}`}>
                    ≤ {v.maxWeightKg} kg
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Duration & Date / Time */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'window', label: t('Créneau', 'Window') },
                { id: 'hours', label: t('Demi-journée', 'Half day') },
                { id: 'full_day', label: t('Journée', 'Full day') },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDurationType(opt.id)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                  durationType === opt.id
                    ? 'border-neutral-950 bg-neutral-950 text-white'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {t('Date', 'Date')}
                </span>
              </label>
              <input
                type="date"
                required
                value={reservationDate}
                onChange={(e) => setReservationDate(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Début', 'Start time')}
              </label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                {t('Fin', 'End time')}
              </label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-neutral-950"
              />
            </div>
          </div>
        </div>

        {/* Pickup Location with Synchronized Map */}
        <div className="space-y-2.5">
          <label className="block text-xs font-medium text-neutral-700">
            {t('Point de départ du véhicule', 'Vehicle pickup location')}
          </label>
          <RovaMap
            center={[pickupCoords.lat, pickupCoords.lng]}
            markers={[
              {
                id: 'res_pickup',
                lat: pickupCoords.lat,
                lng: pickupCoords.lng,
                kind: 'pickup',
                label: pickupAddress || t('Départ', 'Start'),
                draggable: true,
              },
            ]}
            interactivePick
            showSearchBar
            initialSearchText={pickupAddress}
            heightClass="h-[190px]"
            onLocationSelected={(place) => {
              setPickupAddress(place.shortName || place.displayName);
              setPickupCoords({ lat: place.lat, lng: place.lng });
            }}
          />
          <input
            type="text"
            required
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            placeholder={t('Adresse de prise en charge *', 'Pickup address *')}
            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
          />
        </div>

        {/* Optional Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={destinationsSummary}
            onChange={(e) => setDestinationsSummary(e.target.value)}
            placeholder={t('Zones à desservir (optionnel)', 'Delivery zones (optional)')}
            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
          />
          <input
            type="text"
            value={cargoRequirements}
            onChange={(e) => setCargoRequirements(e.target.value)}
            placeholder={t('Besoins chargement (optionnel)', 'Cargo requirements (optional)')}
            className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
          />
        </div>
      </form>
    </BottomSheet>
  );
}
