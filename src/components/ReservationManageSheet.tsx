import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { VehicleIllustration } from './VehicleIllustration';
import { useLanguage } from '../context/LanguageContext';
import { useRovaApp } from '../context/RovaAppContext';
import { getPaymentMethodLabelEn, getVehicleLabel } from '../lib/logistics';
import {
  CancellationPolicyPreview,
  fetchScheduledAvailability,
  ScheduledAvailabilityResponse,
} from '../lib/scheduledApi';
import { ReservationRecord } from '../types/rova';

interface ReservationManageSheetProps {
  reservation: ReservationRecord | null;
  onClose: () => void;
}

export function ReservationManageSheet({ reservation, onClose }: ReservationManageSheetProps) {
  const { lang, t, formatLocalMoney } = useLanguage();
  const { previewCancelReservation, cancelReservation, rescheduleReservation, busy } = useRovaApp();

  const [mode, setMode] = useState<'overview' | 'reschedule' | 'cancel'>('overview');
  const [cancelPreview, setCancelPreview] = useState<CancellationPolicyPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [newDate, setNewDate] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [avail, setAvail] = useState<ScheduledAvailabilityResponse | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  useEffect(() => {
    if (reservation) {
      setMode('overview');
      setCancelPreview(null);
      setNewDate(reservation.reservationDate);
      setNewStart(reservation.startTime);
      setNewEnd(reservation.endTime);
      setRescheduleError(null);
    }
  }, [reservation?.id]);

  useEffect(() => {
    if (!reservation || mode !== 'cancel') return;
    let cancelled = false;
    setLoadingPreview(true);
    void previewCancelReservation(reservation.id)
      .then((evalRes) => {
        if (!cancelled) setCancelPreview(evalRes);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reservation, mode, previewCancelReservation]);

  useEffect(() => {
    if (!reservation || mode !== 'reschedule') return;
    let cancelled = false;
    setLoadingSlots(true);
    setRescheduleError(null);
    void fetchScheduledAvailability({
      pickup: { lat: reservation.pickupLat, lng: reservation.pickupLng },
      destination:
        typeof reservation.destinationLat === 'number' && typeof reservation.destinationLng === 'number'
          ? { lat: reservation.destinationLat, lng: reservation.destinationLng }
          : null,
      reservationDate: newDate || reservation.reservationDate,
      durationType: reservation.durationType,
      vehicleCategory: reservation.vehicleCategory,
      estimatedWeightKg: reservation.estimatedWeightKg,
      fragile: reservation.fragile,
    })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setAvail(null);
          setRescheduleError(lang === 'fr' ? res.error : res.errorEn || res.error);
          return;
        }
        setAvail(res);
        const firstBookable = res.slots.find((s) => s.bookable);
        if (firstBookable && !res.slots.some((s) => s.startTime === newStart && s.endTime === newEnd && s.bookable)) {
          setNewStart(firstBookable.startTime);
          setNewEnd(firstBookable.endTime);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reservation, mode, newDate, lang]);

  if (!reservation) return null;

  const isActionable =
    reservation.status !== 'cancelled' &&
    reservation.status !== 'completed' &&
    reservation.reservationStatus !== 'cancelled' &&
    reservation.reservationStatus !== 'expired';

  const statusLabel = () => {
    if (reservation.reservationStatus === 'cancelled' || reservation.status === 'cancelled') {
      return t('Annulée', 'Cancelled');
    }
    if (reservation.reservationStatus === 'expired') return t('Expirée', 'Expired');
    if (reservation.executionStatus === 'completed' || reservation.status === 'completed') {
      return t('Terminée', 'Completed');
    }
    if (reservation.reservationStatus === 'pending_payment') {
      return t('En attente de paiement', 'Awaiting payment');
    }
    if (reservation.reservationStatus === 'confirmed' || reservation.status === 'confirmed') {
      return t('Confirmée', 'Confirmed');
    }
    return t('En attente de confirmation', 'Pending confirmation');
  };

  const assignmentLabel = () => {
    if (reservation.assignedDriverName) return reservation.assignedDriverName;
    if (reservation.assignmentStatus === 'searching') {
      return t('Recherche d’un chauffeur en cours', 'Searching for courier');
    }
    if (reservation.assignmentStatus === 'reassignment_required') {
      return t('Réaffectation en cours', 'Reassignment in progress');
    }
    if (reservation.assignmentStatus === 'failed') {
      return t('Intervention opérations en cours', 'Operations assistance');
    }
    return t('Planifiée 90 min avant prise en charge', 'Scheduled 90 min before pickup');
  };

  const handleConfirmCancel = async () => {
    const ok = await cancelReservation(reservation.id, 'customer_cancelled');
    if (ok) onClose();
  };

  const handleConfirmReschedule = async () => {
    if (!newDate || !newStart || !newEnd) return;
    setRescheduleError(null);
    const res = await rescheduleReservation(reservation.id, {
      reservationDate: newDate,
      startTime: newStart,
      endTime: newEnd,
      durationType: reservation.durationType,
      vehicleCategory: reservation.vehicleCategory,
    });
    if (!res.ok) {
      setRescheduleError(res.error || t('Impossible de replanifier.', 'Could not reschedule.'));
      return;
    }
    onClose();
  };

  return (
    <BottomSheet
      open={Boolean(reservation)}
      onClose={onClose}
      size="md"
      scrollable={true}
      title={
        mode === 'reschedule'
          ? t('Replanifier le créneau', 'Reschedule booking')
          : mode === 'cancel'
          ? t('Conditions d’annulation', 'Cancellation policy')
          : t('Détails de la réservation', 'Reservation details')
      }
      subtitle={`${reservation.reference || reservation.id.slice(0, 10)} · ${getVehicleLabel(
        reservation.vehicleCategory,
        lang
      )}`}
      footer={
        mode === 'overview' ? (
          isActionable ? (
            <div className="flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => setMode('cancel')}
                className="min-h-[44px] px-4 rounded-xl border border-[#E5E5E5] text-xs font-semibold text-[#777777] hover:text-[#E52B32] hover:border-red-200 transition-colors cursor-pointer"
              >
                {t('Annuler', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={() => setMode('reschedule')}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-[#171717] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('Replanifier', 'Reschedule')}</span>
              </button>
            </div>
          ) : undefined
        ) : mode === 'cancel' ? (
          <div className="flex items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setMode('overview')}
              className="min-h-[44px] px-4 rounded-xl border border-[#E5E5E5] text-xs font-semibold text-[#171717] cursor-pointer"
            >
              {t('Retour', 'Back')}
            </button>
            <button
              type="button"
              disabled={busy || loadingPreview || (cancelPreview !== null && !cancelPreview.allowed)}
              onClick={() => void handleConfirmCancel()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-[#E52B32] text-white text-xs font-semibold hover:bg-[#CC2229] disabled:opacity-40 cursor-pointer"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              <span>{t('Confirmer l’annulation', 'Confirm cancellation')}</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setMode('overview')}
              className="min-h-[44px] px-4 rounded-xl border border-[#E5E5E5] text-xs font-semibold text-[#171717] cursor-pointer"
            >
              {t('Retour', 'Back')}
            </button>
            <button
              type="button"
              disabled={busy || loadingSlots || !newDate || !newStart || !newEnd}
              onClick={() => void handleConfirmReschedule()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-[#E52B32] text-white text-xs font-semibold hover:bg-[#CC2229] disabled:opacity-40 cursor-pointer"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>{t('Valider le nouveau créneau', 'Confirm new slot')}</span>
            </button>
          </div>
        )
      }
    >
      {mode === 'overview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-11 rounded-xl bg-[#F3F3F3] flex items-center justify-center shrink-0">
              <VehicleIllustration category={reservation.vehicleCategory} className="w-10 h-7 text-[#171717]" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-sm font-bold text-[#171717]">
                {getVehicleLabel(reservation.vehicleCategory, lang)}
              </p>
              <p className="text-xs text-[#777777] font-mono">
                {reservation.reservationDate} · {reservation.startTime}–{reservation.endTime}
                {reservation.timezone ? ` (${reservation.timezone})` : ''}
              </p>
            </div>
          </div>

          <div className="border-y border-[#E5E5E5] divide-y divide-[#E5E5E5] text-xs">
            <div className="py-3 flex items-start justify-between gap-3">
              <span className="text-[#777777] inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {t('Prise en charge', 'Pickup')}
              </span>
              <span className="font-medium text-[#171717] text-right max-w-[65%]">
                {reservation.pickupAddress}
              </span>
            </div>
            {reservation.destinationAddress && (
              <div className="py-3 flex items-start justify-between gap-3">
                <span className="text-[#777777]">{t('Destination', 'Destination')}</span>
                <span className="font-medium text-[#171717] text-right max-w-[65%]">
                  {reservation.destinationAddress}
                </span>
              </div>
            )}
            <div className="py-3 flex items-center justify-between gap-3">
              <span className="text-[#777777]">{t('Statut réservation', 'Booking status')}</span>
              <span className="font-semibold text-[#171717]">{statusLabel()}</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <span className="text-[#777777]">{t('Paiement', 'Payment')}</span>
              <span className="font-medium text-[#171717]">
                {reservation.paymentMethod ? `${getPaymentMethodLabelEn(reservation.paymentMethod)} · ` : ''}
                {reservation.paymentStatus || 'pending'}
              </span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <span className="text-[#777777]">{t('Chauffeur', 'Courier')}</span>
              <span className="font-medium text-[#171717] text-right">{assignmentLabel()}</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-3">
              <span className="text-[#777777]">{t('Montant', 'Total')}</span>
              <span className="font-mono text-sm font-bold text-[#171717] tabular-nums">
                {formatLocalMoney(reservation.quotedPrice, reservation.currency)}
              </span>
            </div>
          </div>

          {reservation.pricingBreakdown && reservation.pricingBreakdown.length > 0 && (
            <div className="rounded-xl bg-[#F3F3F3]/60 border border-[#E5E5E5] p-3.5 space-y-1.5 text-xs">
              <p className="font-semibold text-[#171717]">{t('Détail du tarif', 'Price breakdown')}</p>
              {reservation.pricingBreakdown.map((item) => (
                <div key={item.code} className="flex items-center justify-between text-[#777777]">
                  <span>{lang === 'fr' ? item.labelFr : item.labelEn}</span>
                  <span className="font-mono text-[#171717] tabular-nums">
                    {formatLocalMoney(item.amount, reservation.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'cancel' && (
        <div className="space-y-4">
          {loadingPreview ? (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#777777]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('Calcul des conditions d’annulation...', 'Evaluating cancellation policy...')}</span>
            </div>
          ) : cancelPreview ? (
            <>
              <div className="rounded-2xl border border-[#E5E5E5] bg-[#F3F3F3]/50 p-4 space-y-2">
                <p className="text-xs font-semibold text-[#171717]">
                  {lang === 'fr' ? cancelPreview.policySummaryFr : cancelPreview.policySummaryEn}
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E5E5E5] text-xs">
                  <div>
                    <p className="text-[#777777]">{t('Frais d’annulation', 'Cancellation fee')}</p>
                    <p className="font-mono font-bold text-[#171717] tabular-nums mt-0.5">
                      {formatLocalMoney(cancelPreview.feeAmount, cancelPreview.currency)} ({cancelPreview.feePercent}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-[#777777]">{t('Remboursement estimé', 'Estimated refund')}</p>
                    <p className="font-mono font-bold text-emerald-700 tabular-nums mt-0.5">
                      {formatLocalMoney(cancelPreview.refundAmount, cancelPreview.currency)}
                    </p>
                  </div>
                </div>
              </div>
              {!cancelPreview.allowed && (
                <div className="rounded-xl border border-red-200 bg-red-50/70 p-3 flex items-start gap-2 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{lang === 'fr' ? cancelPreview.policySummaryFr : cancelPreview.policySummaryEn}</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-[#777777]">
              {t('Voulez-vous vraiment annuler cette réservation ?', 'Are you sure you want to cancel this reservation?')}
            </p>
          )}
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#171717] inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#777777]" />
              {t('Nouvelle date', 'New date')}
            </label>
            <input
              type="date"
              value={newDate}
              min={avail?.dates[0]?.date}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full rounded-xl bg-white border border-[#E5E5E5] px-3.5 py-2.5 text-sm font-mono text-[#171717] focus:outline-none focus:border-[#171717]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#171717] inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#777777]" />
                {t('Créneaux disponibles', 'Available slots')}
              </label>
              {loadingSlots && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#777777]" />}
            </div>

            {avail ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {avail.slots.map((slot) => {
                  const selected = slot.startTime === newStart && slot.endTime === newEnd && slot.bookable;
                  return (
                    <button
                      key={`${slot.startTime}-${slot.endTime}`}
                      type="button"
                      disabled={!slot.bookable}
                      onClick={() => {
                        setNewStart(slot.startTime);
                        setNewEnd(slot.endTime);
                      }}
                      className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                        !slot.bookable
                          ? 'border-[#E5E5E5] bg-[#F3F3F3]/60 text-[#777777]/60 cursor-not-allowed'
                          : selected
                          ? 'border-[#E52B32] bg-[#FEF2F2]/50 text-[#171717] cursor-pointer'
                          : 'border-[#E5E5E5] bg-white text-[#171717] hover:border-[#171717] cursor-pointer'
                      }`}
                    >
                      <p className="font-mono text-xs font-bold tabular-nums">
                        {slot.startTime}–{slot.endTime}
                      </p>
                      <p className="text-[10px] text-[#777777] mt-0.5">
                        {slot.bookable ? `${slot.remainingCapacity} ${t('dispo', 'open')}` : t('Indisponible', 'Unavailable')}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {rescheduleError && (
            <div className="rounded-xl border border-red-200 bg-red-50/70 p-3 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{rescheduleError}</span>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
