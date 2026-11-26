import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Check, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { db } from '../../lib/firebase';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useRovaApp } from '../../context/RovaAppContext';
import { LocationSearchField } from '../LocationSearchField';
import { DriverRecord, VehicleCategory } from '../../types/rova';
import { VEHICLE_CATALOG } from '../../lib/logistics';
import {
  combineFullName,
  getRoleDisplayLabel,
  resolveAccountRoleKind,
  splitFullName,
} from './accountTypes';

interface ProfileSectionProps {
  onOpenWorkspace: (workspace: 'driver' | 'operations' | 'tracking') => void;
}

export function ProfileSection({ onOpenWorkspace }: ProfileSectionProps) {
  const { firebaseUser, profile } = useAuth();
  const { lang, t, region } = useLanguage();
  const { business, saveBusinessProfile, showToast, requestSignIn, busy } = useRovaApp();

  const roleKind = resolveAccountRoleKind(profile?.role);
  const fullName = profile?.displayName || firebaseUser?.displayName || '';
  const initialNames = splitFullName(fullName);

  const [firstName, setFirstName] = useState(initialNames.firstName);
  const [lastName, setLastName] = useState(initialNames.lastName);
  const [phone, setPhone] = useState(profile?.phone || '');
  const [businessName, setBusinessName] = useState(business?.name || '');
  const [city, setCity] = useState(business?.city || region.city || '');
  const [country, setCountry] = useState(business?.country || region.countryName || '');
  const [primaryAddress, setPrimaryAddress] = useState(business?.defaultPickupAddress || '');
  const [primaryLat, setPrimaryLat] = useState(business?.defaultPickupLat ?? region.lat);
  const [primaryLng, setPrimaryLng] = useState(business?.defaultPickupLng ?? region.lng);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Driver-specific Firestore record (loaded only when user is a driver)
  const [driverDoc, setDriverDoc] = useState<DriverRecord | null>(null);
  const [driverPlate, setDriverPlate] = useState('');
  const [driverLicense, setDriverLicense] = useState('');
  const [driverInsurance, setDriverInsurance] = useState('');
  const [driverArea, setDriverArea] = useState('');
  const [driverVehicle, setDriverVehicle] = useState<VehicleCategory>('motorcycle');
  const [savingDriver, setSavingDriver] = useState(false);

  useEffect(() => {
    const parts = splitFullName(profile?.displayName || firebaseUser?.displayName || '');
    setFirstName(parts.firstName);
    setLastName(parts.lastName);
    setPhone(profile?.phone || '');
  }, [profile?.displayName, profile?.phone, firebaseUser?.displayName]);

  useEffect(() => {
    setBusinessName(business?.name || '');
    setCity(business?.city || region.city || '');
    setCountry(business?.country || region.countryName || '');
    setPrimaryAddress(business?.defaultPickupAddress || '');
    if (typeof business?.defaultPickupLat === 'number') setPrimaryLat(business.defaultPickupLat);
    if (typeof business?.defaultPickupLng === 'number') setPrimaryLng(business.defaultPickupLng);
  }, [
    business?.name,
    business?.city,
    business?.country,
    business?.defaultPickupAddress,
    business?.defaultPickupLat,
    business?.defaultPickupLng,
    region.city,
    region.countryName,
  ]);

  useEffect(() => {
    if (!firebaseUser || roleKind !== 'driver' || isSupabaseConfigured()) {
      setDriverDoc(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'drivers', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...(snap.data() as Omit<DriverRecord, 'id'>) };
          setDriverDoc(data);
          setDriverPlate(data.vehiclePlate || '');
          setDriverLicense(data.licenseNumber || '');
          setDriverInsurance(data.insuranceRef || '');
          setDriverArea(data.serviceArea || '');
          setDriverVehicle(data.vehicleCategory || 'motorcycle');
        } else {
          setDriverDoc(null);
        }
      },
      () => {
        setDriverDoc(null);
      }
    );
    return () => unsub();
  }, [firebaseUser?.uid, roleKind]);

  const handleSavePersonal = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const combined = combineFullName(firstName, lastName);
    if (combined.length < 2) {
      setValidationError(
        t('Veuillez renseigner au moins votre prénom ou nom complet.', 'Please enter your first or full name.')
      );
      return;
    }
    if (phone.trim() && phone.trim().length < 6) {
      setValidationError(
        t('Le numéro de téléphone semble trop court.', 'The phone number appears too short.')
      );
      return;
    }

    await saveBusinessProfile({
      displayName: combined,
      phone: phone.trim(),
      name: roleKind === 'merchant' ? businessName.trim() || combined : business?.name || combined,
      city: city.trim() || region.city,
      country: country.trim() || region.countryName,
      defaultPickupAddress: primaryAddress.trim(),
      defaultPickupLat: primaryLat,
      defaultPickupLng: primaryLng,
    });
  };

  const canEditDriverDetails =
    driverDoc && (driverDoc.approvalStatus === 'pending' || driverDoc.approvalStatus === 'under_review');

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !driverDoc || !canEditDriverDetails) return;
    setSavingDriver(true);
    try {
      await updateDoc(doc(db, 'drivers', firebaseUser.uid), {
        fullName: combineFullName(firstName, lastName) || driverDoc.fullName,
        phone: phone.trim() || driverDoc.phone,
        vehicleCategory: driverVehicle,
        vehiclePlate: driverPlate.trim().slice(0, 40),
        licenseNumber: driverLicense.trim().slice(0, 80),
        insuranceRef: driverInsurance.trim().slice(0, 80),
        serviceArea: driverArea.trim().slice(0, 120),
        updatedAt: serverTimestamp(),
      });
      showToast(t('Dossier livreur mis à jour.', 'Driver profile updated.'), 'success');
    } catch {
      showToast(
        t('Impossible de modifier le dossier livreur pour ce statut.', 'Could not update driver profile.'),
        'error'
      );
    } finally {
      setSavingDriver(false);
    }
  };

  if (!firebaseUser) {
    return (
      <div className="py-10 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold text-neutral-950">
            {t('Profil personnel', 'Personal profile')}
          </h2>
          <p className="text-sm text-neutral-500 max-w-md">
            {t(
              'Connectez-vous pour consulter et modifier vos informations personnelles, votre téléphone et votre adresse principale.',
              'Sign in to view and edit your personal details, phone number, and primary address.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void requestSignIn()}
          className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          {t('Se connecter', 'Sign in')}
        </button>
      </div>
    );
  }

  const initials = (fullName || firebaseUser.email || 'R').trim().charAt(0).toUpperCase();

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="pb-5 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
            {t('Profil personnel', 'Personal profile')}
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            {t(
              'Identité, coordonnées de contact et adresse principale utilisées pour vos expéditions.',
              'Identity, contact details, and primary address used across your deliveries.'
            )}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
          {getRoleDisplayLabel(profile?.role, lang)}
        </span>
      </div>

      {/* Identity Row (Avatar from Auth photoURL or Monogram) */}
      <div className="flex items-center gap-4 pb-6 border-b border-neutral-200/70">
        {firebaseUser.photoURL ? (
          <img
            src={firebaseUser.photoURL}
            alt={fullName || 'Avatar'}
            referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full object-cover border border-neutral-200 shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-neutral-950 text-white font-display text-lg font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="font-display text-base font-bold text-neutral-950 truncate">
            {fullName || t('Utilisateur Rovia', 'Rovia User')}
          </p>
          <p className="text-xs text-neutral-500 truncate">{firebaseUser.email}</p>
          <p className="text-[11px] text-neutral-500 inline-flex items-center gap-1.5 pt-0.5">
            <ShieldCheck className="w-3.5 h-3.5 text-neutral-950" />
            <span>
              {firebaseUser.emailVerified
                ? t('Adresse e-mail vérifiée', 'Verified email address')
                : t('Vérification e-mail en attente', 'Email verification pending')}
            </span>
          </p>
        </div>
      </div>

      {/* Main Editable Profile Form */}
      <form onSubmit={handleSavePersonal} className="space-y-6">
        {validationError && (
          <div className="px-4 py-3 rounded-2xl border border-red-200 bg-red-50 text-xs text-red-700">
            {validationError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              {t('Prénom', 'First name')}
            </label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t('Votre prénom', 'Your first name')}
              className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 focus:outline-none focus:border-neutral-950 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              {t('Nom', 'Last name')}
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t('Votre nom', 'Your last name')}
              className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 focus:outline-none focus:border-neutral-950 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              {t('Adresse e-mail', 'Email address')}
            </label>
            <input
              type="email"
              value={firebaseUser.email || ''}
              disabled
              className="w-full rounded-2xl bg-neutral-100/80 border border-neutral-200 px-3.5 py-2.5 text-sm text-neutral-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              {t('Numéro de téléphone', 'Phone number')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+225 07 00 00 00 00"
              className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 focus:outline-none focus:border-neutral-950 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              {t('Ville', 'City')}
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={region.city}
              className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 focus:outline-none focus:border-neutral-950 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              {t('Pays', 'Country')}
            </label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder={region.countryName}
              className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 focus:outline-none focus:border-neutral-950 transition-colors"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-mono uppercase tracking-wider text-[#777777] mb-1.5">
              {t('Adresse principale / collecte par défaut', 'Primary / default pickup address')}
            </label>
            <LocationSearchField
              value={primaryAddress}
              center={[primaryLat, primaryLng]}
              placeholder={t(
                'Rue, quartier ou cliquez sur l’icône carte...',
                'Street, district or tap the map icon...'
              )}
              onChangeText={(text) => setPrimaryAddress(text)}
              onSelect={(place) => {
                setPrimaryAddress(place.shortName || place.displayName);
                setPrimaryLat(place.lat);
                setPrimaryLng(place.lng);
              }}
            />
          </div>

          {/* Role Adaptation: Merchant Business Name */}
          {roleKind === 'merchant' && (
            <div className="sm:col-span-2 pt-4 border-t border-neutral-200/70 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-950">
                    {t('Espace commerçant', 'Merchant profile')}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    {t('Affiché sur vos bordereaux d’expédition et liens clients.', 'Shown on dispatch records and recipient tracking links.')}
                  </p>
                </div>
                {business?.verificationStatus && (
                  <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-600">
                    {business.verificationStatus === 'verified'
                      ? t('Vérifié', 'Verified')
                      : business.verificationStatus === 'pending'
                      ? t('En vérification', 'Pending review')
                      : business.verificationStatus}
                  </span>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
                  {t('Nom commercial / Entreprise', 'Business name')}
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder={t('Nom de votre boutique ou société', 'Store or company name')}
                  className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 focus:outline-none focus:border-neutral-950 transition-colors"
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>{t('Enregistrer les modifications', 'Save changes')}</span>
          </button>
        </div>
      </form>

      {/* Role Adaptation: Driver Account Summary */}
      {roleKind === 'driver' && (
        <div className="pt-6 border-t border-neutral-200/80 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-neutral-950">
                {t('Profil livreur', 'Driver profile')}
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t(
                  'Informations de véhicule et statut de validation sur le réseau Rovia.',
                  'Vehicle details and approval status on the Rovia network.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenWorkspace('driver')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-300 hover:border-neutral-950 text-xs font-medium text-neutral-900 transition-colors cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{t('Ouvrir l’Application Livreur', 'Open Driver App')}</span>
            </button>
          </div>

          {driverDoc ? (
            <form onSubmit={handleSaveDriver} className="space-y-4">
              <div className="flex items-center justify-between px-4 py-3.5 rounded-2xl border border-neutral-200/80 bg-white text-xs">
                <span className="text-neutral-500">{t('Statut d’agrément', 'Approval status')}</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-neutral-950">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      driverDoc.approvalStatus === 'approved' ? 'bg-neutral-950' : 'bg-red-600'
                    }`}
                    aria-hidden="true"
                  />
                  {driverDoc.approvalStatus === 'approved'
                    ? t('Approuvé', 'Approved')
                    : driverDoc.approvalStatus === 'under_review'
                    ? t('En cours d’examen', 'Under review')
                    : driverDoc.approvalStatus === 'pending'
                    ? t('En attente', 'Pending')
                    : driverDoc.approvalStatus}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
                    {t('Véhicule', 'Vehicle')}
                  </label>
                  <select
                    disabled={!canEditDriverDetails}
                    value={driverVehicle}
                    onChange={(e) => setDriverVehicle(e.target.value as VehicleCategory)}
                    className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 disabled:bg-neutral-100 disabled:text-neutral-500 focus:outline-none focus:border-neutral-950"
                  >
                    {VEHICLE_CATALOG.map((v) => (
                      <option key={v.id} value={v.id}>
                        {lang === 'fr' ? v.labelFr : v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
                    {t('Immatriculation', 'Plate number')}
                  </label>
                  <input
                    type="text"
                    disabled={!canEditDriverDetails}
                    value={driverPlate}
                    onChange={(e) => setDriverPlate(e.target.value)}
                    className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm font-mono text-neutral-950 disabled:bg-neutral-100 disabled:text-neutral-500 focus:outline-none focus:border-neutral-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
                    {t('Permis de conduire', 'License number')}
                  </label>
                  <input
                    type="text"
                    disabled={!canEditDriverDetails}
                    value={driverLicense}
                    onChange={(e) => setDriverLicense(e.target.value)}
                    className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm font-mono text-neutral-950 disabled:bg-neutral-100 disabled:text-neutral-500 focus:outline-none focus:border-neutral-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
                    {t('Zone de service', 'Service area')}
                  </label>
                  <input
                    type="text"
                    disabled={!canEditDriverDetails}
                    value={driverArea}
                    onChange={(e) => setDriverArea(e.target.value)}
                    className="w-full rounded-2xl bg-white border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 disabled:bg-neutral-100 disabled:text-neutral-500 focus:outline-none focus:border-neutral-950"
                  />
                </div>
              </div>

              {canEditDriverDetails ? (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingDriver}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    {savingDriver && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{t('Mettre à jour le dossier livreur', 'Update driver dossier')}</span>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">
                  {t(
                    'Votre profil véhicule est verrouillé après validation. Contactez les opérations Rovia pour modifier votre immatriculation.',
                    'Your vehicle details are locked after verification. Contact Rovia Operations to update your plate.'
                  )}
                </p>
              )}
            </form>
          ) : (
            <div className="px-4 py-4 rounded-2xl border border-neutral-200/80 bg-white flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-neutral-600">
                {t(
                  'Complétez votre inscription véhicule dans l’Application Livreur pour recevoir des courses.',
                  'Complete your vehicle onboarding in the Driver App to start receiving deliveries.'
                )}
              </p>
              <button
                type="button"
                onClick={() => onOpenWorkspace('driver')}
                className="text-xs font-semibold text-neutral-950 underline underline-offset-4 hover:text-red-600 cursor-pointer"
              >
                {t('Compléter mon dossier', 'Complete dossier')}
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
