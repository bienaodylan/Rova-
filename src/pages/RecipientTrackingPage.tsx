import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, Clock, MapPin, Search, ShieldCheck, Truck } from 'lucide-react';
import { db } from '../lib/firebase';
import { PublicTrackingRecord } from '../types/rova';
import { getStatusLabel, getVehicleLabel, STATUS_META } from '../lib/logistics';
import { MapMarkerItem, RovaMap } from '../components/RovaMap';
import { LanguageSelector, useLanguage } from '../context/LanguageContext';

interface RecipientTrackingPageProps {
  trackingToken: string;
  onBack: () => void;
  onLookupToken?: (token: string) => void;
}

export function RecipientTrackingPage({
  trackingToken,
  onBack,
  onLookupToken,
}: RecipientTrackingPageProps) {
  const { lang, t } = useLanguage();
  const [inputCode, setInputCode] = useState(trackingToken);
  const [record, setRecord] = useState<PublicTrackingRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(trackingToken.trim()));
  const [notFound, setNotFound] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  const milestones = [
    { key: 'driver_assigned', label: t('Livreur assigné', 'Driver assigned') },
    { key: 'package_collected', label: t('Colis récupéré', 'Package collected') },
    { key: 'in_transit', label: t('En transit', 'In transit') },
    { key: 'arrived', label: t('Arrivé', 'Arrived') },
    { key: 'delivered', label: t('Livré', 'Delivered') },
  ];

  useEffect(() => {
    setInputCode(trackingToken);
    const cleanToken = trackingToken.trim();
    if (!cleanToken) {
      setRecord(null);
      setNotFound(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotFound(false);

    const unsub = onSnapshot(
      doc(db, 'publicTracking', cleanToken),
      (snap) => {
        if (snap.exists()) {
          setRecord(snap.data() as PublicTrackingRecord);
          setNotFound(false);
        } else {
          setRecord(null);
          setNotFound(true);
        }
        setLoading(false);
      },
      () => {
        setRecord(null);
        setNotFound(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [trackingToken]);

  useEffect(() => {
    if (!record || !record.showLiveDriver || !record.driverLat || !record.driverLng) {
      setRouteCoords([]);
      return;
    }
    let cancelled = false;
    fetch('/api/geo/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          { lat: record.driverLat, lng: record.driverLng },
          { lat: record.destinationLat, lng: record.destinationLng },
        ],
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.geometry)) {
          setRouteCoords(data.geometry);
        }
      })
      .catch(() => {
        if (!cancelled) setRouteCoords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [record?.driverLat, record?.driverLng, record?.destinationLat, record?.destinationLng, record?.showLiveDriver]);

  const markers: MapMarkerItem[] = useMemo(() => {
    if (!record) return [];
    const list: MapMarkerItem[] = [
      {
        id: 'dest',
        lat: record.destinationLat,
        lng: record.destinationLng,
        kind: 'stop',
        sequence: 1,
        label: record.destinationLabel,
      },
    ];
    if (record.showLiveDriver && typeof record.driverLat === 'number' && typeof record.driverLng === 'number') {
      list.push({
        id: 'driver',
        lat: record.driverLat,
        lng: record.driverLng,
        kind: 'driver',
        label: record.driverFirstName || t('Livreur ROVA', 'ROVA Driver'),
      });
    }
    return list;
  }, [record, t]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;
    onLookupToken?.(inputCode.trim());
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-950 py-8 px-4 sm:px-6">
      <div className="max-w-lg mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-950"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t('Retour', 'Back')}
          </button>
          <span className="font-display text-sm font-extrabold tracking-[0.2em]">ROVA</span>
          <LanguageSelector compact />
        </div>

        {/* Search / Token Bar */}
        <form
          onSubmit={handleSearch}
          className="bg-white rounded-3xl border border-neutral-200 p-4 flex items-center gap-2 shadow-xs"
        >
          <Search className="w-4 h-4 text-neutral-400 ml-1 shrink-0" />
          <input
            type="text"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            placeholder={t('Entrez un code de suivi (ex. rvt_...)', 'Enter tracking code (e.g. rvt_...)')}
            className="flex-1 text-sm font-mono bg-transparent focus:outline-none min-w-0"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800 shrink-0"
          >
            {t('Suivre', 'Track')}
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center space-y-2">
            <Clock className="w-5 h-5 mx-auto text-neutral-400 animate-spin" />
            <p className="text-sm text-neutral-600">
              {t('Recherche du colis en direct...', 'Loading live parcel status...')}
            </p>
          </div>
        )}

        {/* Empty / Start from zero state */}
        {!loading && !record && (
          <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="p-6 space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-neutral-950" />
              </div>
              <h1 className="font-display text-xl font-bold tracking-tight">
                {notFound
                  ? t('Aucun colis trouvé pour ce code', 'No parcel found for this code')
                  : t('Interface de suivi destinataire', 'Recipient tracking interface')}
              </h1>
              <p className="text-sm text-neutral-600 leading-relaxed">
                {notFound
                  ? t(
                      'Vérifiez le code reçu par SMS ou lien sécurisé auprès de votre marchand.',
                      'Check the tracking link or token shared by your merchant.'
                    )
                  : t(
                      'Aucune livraison active pour le moment (départ à zéro). Dès qu’un marchand crée une course, son lien de suivi affiche ici la position GPS du livreur en direct, uniquement pour ce destinataire.',
                      'No active delivery yet (starting from zero). Once a merchant creates a delivery, its tracking link shows live driver GPS here for that recipient only.'
                    )}
              </p>
            </div>
            <div className="px-6 pb-6">
              <RovaMap
                center={[5.3235, -4.0267]}
                zoom={12}
                heightClass="h-[260px]"
              />
            </div>
          </div>
        )}

        {/* Active Live Tracking Record */}
        {!loading && record && (
          <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="p-6 border-b border-neutral-100 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-bold">{record.reference}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-800">
                  <span className={`w-2 h-2 rounded-full ${STATUS_META[record.status].dot}`} />
                  {getStatusLabel(record.status, lang)}
                </span>
              </div>
              <div>
                <h1 className="font-display text-xl font-bold">
                  {t('Bonjour', 'Hello')} {record.recipientFirstName}
                </h1>
                <p className="text-xs text-neutral-500 mt-1">{record.destinationLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600 pt-1">
                <span className="inline-flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5" />
                  {getVehicleLabel(record.vehicleCategory, lang)}
                </span>
                {record.driverFirstName && (
                  <span>
                    {t('Livreur', 'Driver')}: <strong>{record.driverFirstName}</strong>
                  </span>
                )}
                {typeof record.etaMinutes === 'number' && record.showLiveDriver && (
                  <span className="font-mono">ETA ~{record.etaMinutes} min</span>
                )}
              </div>
            </div>

            <div className="p-4">
              <RovaMap
                center={[record.destinationLat, record.destinationLng]}
                zoom={14}
                markers={markers}
                routeCoordinates={routeCoords}
                heightClass="h-[280px]"
              />
            </div>

            <div className="p-6 space-y-5 border-t border-neutral-100">
              {!record.showLiveDriver && record.status !== 'delivered' && (
                <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-xs text-neutral-600">
                  {t(
                    'La position GPS en direct du livreur s’activera automatiquement dès que votre arrêt sera le prochain sur la tournée.',
                    'Live driver GPS activates automatically once your stop is next on the route.'
                  )}
                </div>
              )}

              <div className="space-y-3">
                <p className="text-xs font-semibold text-neutral-950">
                  {t('Étapes de la livraison', 'Delivery progress')}
                </p>
                <div className="space-y-2.5">
                  {milestones.map((m) => {
                    const reached =
                      record.status === m.key ||
                      record.status === 'delivered' ||
                      (m.key === 'driver_assigned' && record.driverUid !== '');
                    return (
                      <div key={m.key} className="flex items-center gap-3 text-xs">
                        <CheckCircle2
                          className={`w-4 h-4 shrink-0 ${
                            reached ? 'text-neutral-950' : 'text-neutral-300'
                          }`}
                        />
                        <span className={reached ? 'font-medium text-neutral-950' : 'text-neutral-400'}>
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {record.otpHint && record.status !== 'delivered' && (
                <div className="rounded-2xl bg-neutral-950 text-white p-4 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-xs text-neutral-300">
                      {t('Code de remise sécurisé (OTP)', 'Secure handover code (OTP)')}
                    </p>
                    <p className="text-[11px] text-neutral-400">
                      {t('À communiquer au livreur à réception', 'Share with driver upon arrival')}
                    </p>
                  </div>
                  <span className="font-mono text-lg font-bold tracking-widest">{record.otpHint}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-neutral-500 pt-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {t(
                    'Lien protégé ROVA · Aucune donnée d’autres clients n’est accessible ici.',
                    'Protected ROVA link · No other recipient data is accessible here.'
                  )}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
