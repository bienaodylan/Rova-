import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Loader2 } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { LocationSearchField } from './LocationSearchField';
import { VehicleStudioImage } from './VehicleIllustration';
import { useRovaApp } from '../context/RovaAppContext';
import { useLanguage } from '../context/LanguageContext';
import { getEffectivePricingRule, VEHICLE_CATALOG } from '../lib/logistics';
import { VehicleCategory } from '../types/rova';

export function ReservationSheet() {
  const { lang, t, formatLocalMoney, region } = useLanguage();
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

  const [reservationStep, setReservationStep] = useState<1 | 2 | 3>(1);
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('cargo_van');
  const [durationType, setDurationType] = useState<'window' | 'hours' | 'full_day'>('hours');
  const [reservationDate, setReservationDate] = useState(tomorrow);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [pickupAddress, setPickupAddress] = useState(business?.defaultPickupAddress || '');
  const [pickupCoords, setPickupCoords] = useState({
    lat: business?.defaultPickupLat ?? region.lat,
    lng: business?.defaultPickupLng ?? region.lng,
  });
  const [destinationsSummary, setDestinationsSummary] = useState('');
  const [cargoRequirements, setCargoRequirements] = useState('');

  useEffect(() => {
    if (!reservationSheetOpen) {
      setReservationStep(1);
      setVehicleCategory('cargo_van');
      setDurationType('hours');
      setReservationDate(tomorrow);
      setStartTime('09:00');
      setEndTime('13:00');
      setPickupAddress(business?.defaultPickupAddress || '');
      setPickupCoords({
        lat: business?.defaultPickupLat ?? region.lat,
        lng: business?.defaultPickupLng ?? region.lng,
      });
      setDestinationsSummary('');
      setCargoRequirements('');
    }
  }, [reservationSheetOpen, tomorrow, business?.defaultPickupAddress, business?.defaultPickupLat, business?.defaultPickupLng, region.lat, region.lng]);

  const rule = getEffectivePricingRule(pricingRules, vehicleCategory);
  const quotedPrice = useMemo(() => {
    if (durationType === 'full_day') return rule.fullDayRate;
    if (durationType === 'hours') return Math.round(rule.fullDayRate * 0.55);
    return Math.round(rule.baseFee + rule.scheduledFee + rule.perKmRate * 8);
  }, [durationType, rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickupAddress.trim() || !reservationDate || !startTime || !endTime || endTime <= startTime) return;
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

  const inputClass =
    'w-full rounded-2xl bg-white border border-[#E5E5E5] px-4 py-2.5 text-sm text-[#171717] placeholder:text-[#777777] focus:outline-none focus:border-[#171717] transition-colors';

  return (
    <BottomSheet
      open={reservationSheetOpen}
      onClose={closeReservationSheet}
      size="lg"
      title={t('Planifier une livraison', 'Schedule a delivery')}
      subtitle={t(
        'Réservez un créneau horaire ou une journée complète avec chauffeur.',
        'Reserve a time slot or full day with a dedicated driver.'
      )}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-[#777777]">{t('Tarif estimé', 'Estimated rate')}</p>
            <p className="font-mono text-base font-bold text-[#171717] tabular-nums">
              {formatLocalMoney(quotedPrice, rule.currency || 'GHS')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {reservationStep > 1 && (
              <button
                type="button"
                onClick={() => setReservationStep((step) => (step - 1) as 1 | 2 | 3)}
                className="min-h-[46px] rounded-full border border-[#E5E5E5] px-5 text-sm font-semibold text-[#171717] hover:border-[#171717] transition-colors active:scale-[0.98] cursor-pointer"
              >
                {t('Retour', 'Back')}
              </button>
            )}
            {reservationStep < 3 ? (
              <button
                type="button"
                onClick={() => setReservationStep((step) => (step + 1) as 1 | 2 | 3)}
                disabled={
                  reservationStep === 2 &&
                  (!reservationDate || !startTime || !endTime || endTime <= startTime)
                }
                className="min-h-[46px] inline-flex items-center gap-2 rounded-full bg-[#171717] px-6 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer"
              >
                {t('Continuer', 'Continue')}
              </button>
            ) : (
              <button
                type="submit"
                form="rova-reservation-form"
                disabled={
                  busy ||
                  !pickupAddress.trim() ||
                  !reservationDate ||
                  !startTime ||
                  !endTime ||
                  endTime <= startTime
                }
                className="min-h-[46px] inline-flex items-center gap-2 rounded-full bg-[#E52B32] px-6 text-sm font-semibold text-white hover:bg-[#CC2229] disabled:opacity-40 transition-all active:scale-[0.98] cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{t('Confirmer la planification', 'Confirm schedule')}</span>
              </button>
            )}
          </div>
        </div>
      }
    >
      <form id="rova-reservation-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#777777]">
            <span>{t(`Étape ${reservationStep} sur 3`, `Step ${reservationStep} of 3`)}</span>
            <span className="text-[#171717]">
              {[t('Véhicule', 'Vehicle'), t('Date & horaire', 'Date & time'), t('Point de départ', 'Pickup')][
                reservationStep - 1
              ]}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={`h-1 rounded-full transition-colors ${
                  step <= reservationStep ? 'bg-[#E52B32]' : 'bg-[#E5E5E5]'
                }`}
              />
            ))}
          </div>
        </div>

        {reservationStep === 1 && (
          <div className="space-y-2.5">
            <label className="block text-xs font-medium text-[#171717]">
              {t('Choisissez le format adapté à votre livraison', 'Choose the right vehicle for your delivery')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {VEHICLE_CATALOG.map((v) => {
                const active = vehicleCategory === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVehicleCategory(v.id)}
                    className={`p-3 rounded-2xl border text-left transition-all active:scale-[0.98] cursor-pointer flex flex-col justify-between ${
                      active
                        ? 'border-[#E52B32] bg-[#FEF2F2]/50 ring-1 ring-[#E52B32]/20'
                        : 'border-[#E5E5E5] bg-[#F7F7F7] hover:border-[#171717]/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div className="w-16 h-12 flex items-center justify-center overflow-hidden">
                        <VehicleStudioImage
                          category={v.id}
                          alt={lang === 'fr' ? v.labelFr : v.label}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          active ? 'border-[#E52B32] bg-[#E52B32] text-white' : 'border-[#D4D4D4] bg-white'
                        }`}
                      >
                        {active && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#171717] truncate">
                        {lang === 'fr' ? v.labelFr : v.label}
                      </p>
                      <p className="text-[11px] font-mono text-[#777777]">≤ {v.maxWeightKg} kg</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {reservationStep === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 p-1 rounded-full bg-[#F3F3F3] gap-1">
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
                  className={`min-h-[40px] rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    durationType === opt.id
                      ? 'bg-white text-[#171717] shadow-xs'
                      : 'text-[#777777] hover:text-[#171717]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#777777]" />
                    {t('Date', 'Date')}
                  </span>
                </label>
                <input
                  type="date"
                  required
                  value={reservationDate}
                  onChange={(e) => setReservationDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">
                  {t('Début', 'Start time')}
                </label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#171717] mb-1">
                  {t('Fin', 'End time')}
                </label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          </div>
        )}

        {reservationStep === 3 && (
          <>
            <div className="space-y-2.5">
              <label className="block text-xs font-medium text-[#171717]">
                {t('Point de départ de la livraison', 'Delivery pickup location')}
              </label>
              <LocationSearchField
                value={pickupAddress}
                center={[pickupCoords.lat, pickupCoords.lng]}
                placeholder={t('Rechercher une adresse ou un quartier…', 'Search an address or area…')}
                onChangeText={(text) => setPickupAddress(text)}
                onSelect={(place) => {
                  setPickupAddress(place.shortName || place.displayName);
                  setPickupCoords({ lat: place.lat, lng: place.lng });
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={destinationsSummary}
                onChange={(e) => setDestinationsSummary(e.target.value)}
                placeholder={t('Zones à desservir (optionnel)', 'Delivery zones (optional)')}
                className={inputClass}
              />
              <input
                type="text"
                value={cargoRequirements}
                onChange={(e) => setCargoRequirements(e.target.value)}
                placeholder={t('Notes de chargement (optionnel)', 'Cargo notes (optional)')}
                className={inputClass}
              />
            </div>
          </>
        )}
      </form>
    </BottomSheet>
  );
}
