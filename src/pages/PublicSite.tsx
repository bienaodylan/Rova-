import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  Clock,
  Globe,
  Layers,
  MapPin,
  Menu,
  Package,
  Search,
  Shield,
  ShieldCheck,
  Smartphone,
  Truck,
  X,
} from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { PAYMENT_METHODS_EN, VEHICLE_CATALOG } from '../lib/logistics';
import { RovaMap } from '../components/RovaMap';
import { GeoPlace } from '../types/rova';
import { useLanguage } from '../context/LanguageContext';
import type { ActiveInterface } from '../components/InterfaceExplorerBar';

export type PublicPageId =
  | 'home'
  | 'about'
  | 'business'
  | 'drivers'
  | 'fleet'
  | 'partners'
  | 'contact'
  | 'privacy'
  | 'terms';

interface PublicSiteProps {
  onSignIn: () => void;
  onOpenTracking: (token: string) => void;
  onOpenInterface: (iface: ActiveInterface) => void;
  signingIn?: boolean;
  isSignedIn?: boolean;
}

export function PublicSite({
  onSignIn,
  onOpenTracking,
  onOpenInterface,
  signingIn,
  isSignedIn,
}: PublicSiteProps) {
  const { lang, t } = useLanguage();
  const [page, setPage] = useState<PublicPageId>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Tracking lookup modal
  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [trackCode, setTrackCode] = useState('');

  // Early access / waitlist modal
  const [waitlistPlatform, setWaitlistPlatform] = useState<'ios' | 'android' | 'partner' | 'driver' | null>(null);
  const [waitlistForm, setWaitlistForm] = useState({ name: '', email: '', company: '', city: '' });
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  // Public contact form
  const [contactForm, setContactForm] = useState({ name: '', email: '', company: '', city: '', message: '' });
  const [contactStatus, setContactStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  // Interactive Hero Map Location Explorer
  const [heroPlace, setHeroPlace] = useState<GeoPlace>({
    displayName: 'Plateau, Abidjan, Côte d’Ivoire',
    shortName: 'Plateau, Abidjan',
    lat: 5.3235,
    lng: -4.0267,
  });

  const navigate = (next: PublicPageId) => {
    setPage(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistPlatform || !waitlistForm.name.trim() || !waitlistForm.email.trim()) return;
    setWaitlistStatus('submitting');
    try {
      await addDoc(collection(db, 'waitlist'), {
        name: waitlistForm.name.trim().slice(0, 120),
        email: waitlistForm.email.trim().slice(0, 200),
        ...(waitlistForm.company.trim() ? { company: waitlistForm.company.trim().slice(0, 160) } : {}),
        ...(waitlistForm.city.trim() ? { city: waitlistForm.city.trim().slice(0, 100) } : {}),
        platform: waitlistPlatform,
        createdAt: serverTimestamp(),
      });
      setWaitlistStatus('done');
      setWaitlistForm({ name: '', email: '', company: '', city: '' });
    } catch (error) {
      setWaitlistStatus('error');
      handleFirestoreError(error, OperationType.CREATE, 'waitlist');
    }
  };

  const submitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.email.trim()) return;
    setContactStatus('submitting');
    try {
      await addDoc(collection(db, 'waitlist'), {
        name: contactForm.name.trim().slice(0, 120),
        email: contactForm.email.trim().slice(0, 200),
        ...(contactForm.company.trim() ? { company: contactForm.company.trim().slice(0, 160) } : {}),
        ...(contactForm.city.trim() ? { city: contactForm.city.trim().slice(0, 100) } : {}),
        ...(contactForm.message.trim() ? { message: contactForm.message.trim().slice(0, 1000) } : {}),
        platform: 'contact',
        createdAt: serverTimestamp(),
      });
      setContactStatus('done');
      setContactForm({ name: '', email: '', company: '', city: '', message: '' });
    } catch (error) {
      setContactStatus('error');
      handleFirestoreError(error, OperationType.CREATE, 'waitlist');
    }
  };

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackCode.trim()) return;
    setTrackModalOpen(false);
    onOpenTracking(trackCode.trim());
  };

  const navItems: Array<{ id: PublicPageId; label: string }> = [
    { id: 'business', label: t('Entreprises', 'Business') },
    { id: 'fleet', label: t('Flotte', 'Fleet') },
    { id: 'drivers', label: t('Livreurs', 'Drivers') },
    { id: 'partners', label: t('Partenaires', 'Partners') },
    { id: 'contact', label: t('Contact', 'Contact') },
  ];

  const interfacesShowcase: Array<{
    id: ActiveInterface;
    title: string;
    subtitle: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'merchant',
      title: t('Espace Marchand', 'Merchant Workspace'),
      subtitle: t('Expédition & Tournées B2B', 'B2B Dispatch & Multi-Stop'),
      description: t(
        'Création de livraison en 7 étapes, itinéraires multi-arrêts optimisés, import CSV, réservations de véhicules et carnet de destinataires.',
        '7-step delivery creation, optimized multi-stop routes, CSV import, vehicle reservations, and address book.'
      ),
      icon: Building2,
    },
    {
      id: 'driver',
      title: t('Application Livreur', 'Driver Mobile App'),
      subtitle: t('Expérience mobile terrain', 'Mobile-First Field App'),
      description: t(
        'Activation GPS en direct, radar de courses, progression étape par étape, preuve de livraison (code OTP, signature, photo) et suivi des revenus.',
        'Live GPS online toggle, dispatch radar, step-by-step delivery execution, proof of delivery (OTP, signature, photo), and earnings.'
      ),
      icon: Smartphone,
    },
    {
      id: 'operations',
      title: t('Centre d’Opérations', 'Operations Center'),
      subtitle: t('Dispatch, Flotte & Contrôle', 'Dispatch, Fleet & Control'),
      description: t(
        'Carte opérationnelle en direct, validation des livreurs, gestion de la flotte ROVA, équipements de marque, partenaires et moteur tarifaire.',
        'Live operations map, driver verification queue, ROVA Fleet management, branded equipment inventory, partners, and pricing engine.'
      ),
      icon: Shield,
    },
    {
      id: 'tracking',
      title: t('Suivi Destinataire', 'Recipient Tracking'),
      subtitle: t('Lien isolé sans connexion', 'Isolated No-Login Link'),
      description: t(
        'Page mobile dédiée au client final : suivi GPS de son colis uniquement, étapes claires et code de remise sécurisé.',
        'Dedicated mobile view for end recipients: live GPS tracking of their stop only, clear milestones, and secure handover OTP.'
      ),
      icon: MapPin,
    },
  ];

  return (
    <div className="min-h-screen bg-white text-neutral-950 flex flex-col">
      {/* Top Bar — 3-zone contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => navigate('home')}
            className="font-display text-lg font-extrabold tracking-[0.2em] text-neutral-950 whitespace-nowrap shrink-0"
          >
            ROVA
          </button>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-600">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-neutral-950 ${
                  page === item.id ? 'text-neutral-950 underline underline-offset-8 decoration-2' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={signingIn}
              onClick={onSignIn}
              className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs sm:text-sm font-medium hover:bg-neutral-800 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {signingIn
                ? t('Connexion...', 'Signing in...')
                : isSignedIn
                ? t('Mon espace', 'My workspace')
                : t('Se connecter', 'Sign in')}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={t('Ouvrir le menu', 'Open menu')}
              className="md:hidden p-2 rounded-full border border-neutral-200 text-neutral-950"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-neutral-200 bg-white px-5 py-4 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className="block w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-800 hover:bg-neutral-100"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setTrackModalOpen(true);
              }}
              className="block w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-800 hover:bg-neutral-100"
            >
              {t('Suivre un colis', 'Track a delivery')}
            </button>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* ================================================================ */}
        {/* HOME PAGE                                                        */}
        {/* ================================================================ */}
        {page === 'home' && (
          <div>
            {/* 1. HERO SECTION */}
            <section className="max-w-7xl mx-auto px-5 sm:px-8 pt-12 pb-16 lg:pt-20 lg:pb-24">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
                <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
                  <div className="space-y-6">
                    <p className="text-xs font-medium text-neutral-500 tracking-wide">
                      {t('Infrastructure logistique commerciale · Départ à zéro', 'Commercial logistics infrastructure · Fresh start')}
                    </p>
                    <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight leading-[1.06] text-balance text-neutral-950">
                      {t(
                        'La livraison pensée pour les entreprises.',
                        'Delivery designed for business.'
                      )}
                    </h1>
                    <p className="text-base sm:text-lg text-neutral-600 leading-relaxed max-w-xl">
                      {t(
                        'Expédiez instantanément, planifiez vos tournées multi-arrêts, réservez la flotte ROVA et offrez un suivi GPS précis à chaque destinataire depuis une plateforme unifiée.',
                        'Dispatch instantly, schedule multi-stop routes, reserve ROVA fleet vehicles, and deliver live GPS tracking to every recipient from one unified platform.'
                      )}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => onOpenInterface('merchant')}
                        className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-colors"
                      >
                        {t('Ouvrir l’Espace Marchand', 'Open Merchant Workspace')}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrackModalOpen(true)}
                        className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full border border-neutral-300 bg-white text-neutral-950 text-sm font-medium hover:border-neutral-950 transition-colors"
                      >
                        <Search className="w-4 h-4" />
                        {t('Suivre un colis', 'Track a parcel')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-6 border-t border-neutral-200">
                    <div>
                      <p className="font-mono text-2xl font-bold tabular-nums">6</p>
                      <p className="text-xs text-neutral-500 mt-1">
                        {t('Catégories de véhicules', 'Vehicle tiers')}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-2xl font-bold tabular-nums">5</p>
                      <p className="text-xs text-neutral-500 mt-1">
                        {t('Interfaces dédiées', 'Dedicated interfaces')}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-2xl font-bold tabular-nums">100%</p>
                      <p className="text-xs text-neutral-500 mt-1">
                        {t('Suivi GPS réel', 'Real GPS tracking')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Live Interactive Map Card */}
                <div className="lg:col-span-6 flex flex-col">
                  <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5 flex-1 flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-950 truncate">
                          {t('Carte interactive en direct', 'Live interactive map')}
                        </p>
                        <p className="text-xs text-neutral-500 truncate">{heroPlace.displayName}</p>
                      </div>
                      <span className="font-mono text-[11px] text-neutral-500 shrink-0 tabular-nums">
                        {heroPlace.lat.toFixed(4)}, {heroPlace.lng.toFixed(4)}
                      </span>
                    </div>

                    <RovaMap
                      center={[heroPlace.lat, heroPlace.lng]}
                      zoom={13}
                      markers={[
                        {
                          id: 'hero-pin',
                          lat: heroPlace.lat,
                          lng: heroPlace.lng,
                          kind: 'pickup',
                          label: heroPlace.shortName,
                          draggable: true,
                        },
                      ]}
                      interactivePick
                      showSearchBar
                      onLocationSelected={(place) => setHeroPlace(place)}
                      heightClass="h-[340px] lg:h-[380px]"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* 2. ALL INTERFACES EXPLORER SECTION */}
            <section className="bg-neutral-50 border-y border-neutral-200 py-16 lg:py-24">
              <div className="max-w-7xl mx-auto px-5 sm:px-8 space-y-10">
                <div className="max-w-2xl space-y-3">
                  <p className="text-xs font-medium text-neutral-500">
                    {t('Écosystème complet', 'Complete ecosystem')}
                  </p>
                  <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
                    {t(
                      'Explorez toutes les interfaces de l’application.',
                      'Explore every interface of the platform.'
                    )}
                  </h2>
                  <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
                    {t(
                      'Accédez en un clic à chaque espace métier — marchand, livreur mobile, centre d’opérations et suivi destinataire — en partant proprement de zéro.',
                      'Open each workspace in one click — merchant, mobile driver app, operations center, and recipient tracking — starting cleanly from zero.'
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                  {interfacesShowcase.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpenInterface(item.id)}
                        className="group text-left bg-white rounded-3xl border border-neutral-200 p-6 hover:border-neutral-950 transition-all flex flex-col justify-between gap-6"
                      >
                        <div className="space-y-4">
                          <div className="w-11 h-11 rounded-2xl bg-neutral-100 group-hover:bg-neutral-950 group-hover:text-white flex items-center justify-center transition-colors">
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-xs text-neutral-500">{item.subtitle}</p>
                            <h3 className="font-display text-lg font-bold text-neutral-950 mt-0.5">
                              {item.title}
                            </h3>
                          </div>
                          <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-950">
                          {t('Ouvrir l’interface', 'Open interface')}
                          <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* 3. HOW ROVA WORKS */}
            <section className="max-w-7xl mx-auto px-5 sm:px-8 py-16 lg:py-24 space-y-12">
              <div className="max-w-2xl space-y-3">
                <p className="text-xs font-medium text-neutral-500">
                  {t('Fonctionnement', 'How it works')}
                </p>
                <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
                  {t('De la commande à la preuve de livraison.', 'From dispatch to verified proof of delivery.')}
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                {[
                  {
                    num: '01',
                    title: t('Adresse & Points d’arrêt', 'Address & Stops'),
                    desc: t(
                      'Saisissez la collecte et un ou plusieurs destinataires par recherche d’adresse, repère local ou pointage sur la carte.',
                      'Set pickup and one or many drop-offs via street search, local landmarks, or direct map pin.'
                    ),
                  },
                  {
                    num: '02',
                    title: t('Véhicule & Devis réel', 'Vehicle & Live Quote'),
                    desc: t(
                      'Choisissez parmi 6 gabarits de la moto rapide au camion 5T avec tarif transparent basé sur la distance routière réelle.',
                      'Pick from 6 vehicle classes from motorcycle to 5T truck with transparent real road distance pricing.'
                    ),
                  },
                  {
                    num: '03',
                    title: t('Affectation & Suivi GPS', 'Dispatch & Live GPS'),
                    desc: t(
                      'Les livreurs vérifiés et en ligne reçoivent la course. Chaque destinataire reçoit son propre lien de suivi isolé.',
                      'Verified online drivers receive the job. Each recipient receives an isolated live tracking link.'
                    ),
                  },
                  {
                    num: '04',
                    title: t('Preuve & Facturation', 'Proof & Billing'),
                    desc: t(
                      'Remise sécurisée par code OTP, signature tactile ou photo, avec règlement flexible en anglais (Mobile Money, Bank Card, Corporate Invoice).',
                      'Verified handover via OTP, touch signature, or photo with flexible settlement (Mobile Money, Bank Card, Corporate Invoice).'
                    ),
                  },
                ].map((step) => (
                  <div
                    key={step.num}
                    className="rounded-3xl border border-neutral-200 p-6 space-y-4 bg-white"
                  >
                    <span className="font-mono text-xs font-semibold text-neutral-400">{step.num}</span>
                    <h3 className="font-display text-base font-bold text-neutral-950">{step.title}</h3>
                    <p className="text-sm text-neutral-600 leading-relaxed">{step.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 4. SERVICES GRID: INSTANT, SCHEDULED, MULTI-STOP, FLEET */}
            <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-20 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="rounded-3xl border border-neutral-200 p-7 space-y-4">
                  <div className="w-10 h-10 rounded-2xl bg-neutral-950 text-white flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h3 className="font-display text-xl font-bold">
                    {t('Livraison instantanée', 'Instant delivery')}
                  </h3>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    {t(
                      'Déclenchez une collecte immédiate pour vos boutiques, pharmacies, restaurants ou bureaux avec calcul automatique du livreur le plus proche.',
                      'Trigger immediate pickup for retail stores, pharmacies, or offices with automated nearest-driver matching.'
                    )}
                  </p>
                </div>

                <div className="rounded-3xl border border-neutral-200 p-7 space-y-4">
                  <div className="w-10 h-10 rounded-2xl bg-neutral-950 text-white flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                  <h3 className="font-display text-xl font-bold">
                    {t('Tournées multi-arrêts', 'Multi-stop routes')}
                  </h3>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    {t(
                      'Importez vos commandes en CSV ou ajoutez vos arrêts manuellement. ROVA optimise l’ordre du trajet et isole le suivi pour chaque client.',
                      'Import orders via CSV or add stops manually. ROVA optimizes stop sequence and isolates tracking per recipient.'
                    )}
                  </p>
                </div>

                <div className="rounded-3xl border border-neutral-200 p-7 space-y-4">
                  <div className="w-10 h-10 rounded-2xl bg-neutral-950 text-white flex items-center justify-center">
                    <Truck className="w-4 h-4" />
                  </div>
                  <h3 className="font-display text-xl font-bold">
                    {t('Réservation & Flotte ROVA', 'Scheduled & ROVA Fleet')}
                  </h3>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    {t(
                      'Réservez un fourgon ou un camion pour un créneau horaire ou une journée complète, avec contrôle automatique des disponibilités.',
                      'Reserve a van or truck for a time window or full-day charter with automatic conflict checking.'
                    )}
                  </p>
                </div>
              </div>
            </section>

            {/* 5. FLEET CATALOG */}
            <section className="bg-neutral-50 border-y border-neutral-200 py-16 lg:py-24">
              <div className="max-w-7xl mx-auto px-5 sm:px-8 space-y-10">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="space-y-2 max-w-xl">
                    <p className="text-xs font-medium text-neutral-500">
                      {t('Flotte commerciale', 'Commercial fleet')}
                    </p>
                    <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                      {t('Six gabarits adaptés à chaque charge.', 'Six vehicle classes sized for every cargo.')}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('fleet')}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-950 hover:underline"
                  >
                    {t('Voir toute la flotte', 'View full fleet')}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {VEHICLE_CATALOG.map((v) => (
                    <div
                      key={v.id}
                      className="bg-white rounded-3xl border border-neutral-200 p-6 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="font-display text-lg font-bold text-neutral-950">
                            {lang === 'fr' ? v.labelFr : v.label}
                          </h3>
                          <span className="font-mono text-xs text-neutral-500 tabular-nums">
                            ≤ {v.maxWeightKg} kg
                          </span>
                        </div>
                        <p className="text-sm text-neutral-600 leading-relaxed">
                          {lang === 'fr' ? v.summaryFr : v.summary}
                        </p>
                      </div>
                      <div className="pt-4 border-t border-neutral-100 flex items-center justify-between text-xs font-mono text-neutral-500">
                        <span>{t('Base', 'Base')}: GHS {v.baseFallback}</span>
                        <span>{t('Journée', 'Full day')}: GHS {v.fullDayFallback}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 6. PAYMENT METHODS (STRICTLY IN ENGLISH PER USER SPEC) */}
            <section className="max-w-7xl mx-auto px-5 sm:px-8 py-16 lg:py-20 space-y-8">
              <div className="max-w-2xl space-y-2">
                <p className="text-xs font-medium text-neutral-500">
                  {t('Règlement flexible', 'Flexible settlement')}
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
                  {t('Moyens de paiement acceptés', 'Accepted Payment Methods')}
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {PAYMENT_METHODS_EN.map((pm) => (
                  <div key={pm.id} className="rounded-2xl border border-neutral-200 p-5 space-y-1.5">
                    <p className="font-semibold text-sm text-neutral-950">{pm.label}</p>
                    <p className="text-xs text-neutral-500">{pm.subtitle}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 7. DRIVER NETWORK + PARTNER + APP WAITLIST */}
            <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-20">
              <div className="rounded-3xl bg-neutral-950 text-white p-8 sm:p-12 lg:p-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                <div className="lg:col-span-7 space-y-5">
                  <p className="text-xs text-neutral-400">
                    {t('Réseau de chauffeurs & Applications mobiles', 'Driver network & Mobile apps')}
                  </p>
                  <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
                    {t(
                      'Rejoignez le réseau ROVA en tant que livreur ou partenaire de flotte.',
                      'Join the ROVA network as a driver or fleet partner.'
                    )}
                  </h2>
                  <p className="text-sm sm:text-base text-neutral-300 leading-relaxed max-w-xl">
                    {t(
                      'Recevez des courses professionnelles régulières, suivez vos revenus en temps réel et inscrivez-vous à l’accès anticipé iOS et Android.',
                      'Receive steady business dispatches, track earnings in real time, and join early access for iOS and Android.'
                    )}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => onOpenInterface('driver')}
                      className="px-5 py-3 rounded-full bg-white text-neutral-950 text-xs sm:text-sm font-semibold hover:bg-neutral-200 transition-colors"
                    >
                      {t('Voir l’Application Livreur', 'Open Driver App')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWaitlistPlatform('ios');
                        setWaitlistStatus('idle');
                      }}
                      className="px-5 py-3 rounded-full border border-neutral-700 text-white text-xs sm:text-sm font-medium hover:border-white transition-colors"
                    >
                      {t('Accès anticipé iOS', 'iOS Early Access')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWaitlistPlatform('android');
                        setWaitlistStatus('idle');
                      }}
                      className="px-5 py-3 rounded-full border border-neutral-700 text-white text-xs sm:text-sm font-medium hover:border-white transition-colors"
                    >
                      {t('Accès anticipé Android', 'Android Early Access')}
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setWaitlistPlatform('driver');
                      setWaitlistStatus('idle');
                    }}
                    className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 text-left hover:border-neutral-500 transition-colors space-y-2"
                  >
                    <Truck className="w-5 h-5 text-white" />
                    <p className="font-semibold text-sm">{t('Devenir livreur', 'Become a driver')}</p>
                    <p className="text-xs text-neutral-400">
                      {t('Moto, tricycle, fourgon ou camion.', 'Bike, tricycle, van, or truck.')}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWaitlistPlatform('partner');
                      setWaitlistStatus('idle');
                    }}
                    className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 text-left hover:border-neutral-500 transition-colors space-y-2"
                  >
                    <Globe className="w-5 h-5 text-white" />
                    <p className="font-semibold text-sm">{t('Devenir partenaire', 'Become a partner')}</p>
                    <p className="text-xs text-neutral-400">
                      {t('Propriétaires de flotte et entreprises.', 'Fleet owners & enterprise logistics.')}
                    </p>
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ================================================================ */}
        {/* DEDICATED SUB-PAGES                                              */}
        {/* ================================================================ */}
        {page !== 'home' && page !== 'contact' && (
          <section className="max-w-5xl mx-auto px-5 sm:px-8 py-14 lg:py-20 space-y-10">
            <button
              type="button"
              onClick={() => navigate('home')}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-950"
            >
              ← {t('Retour à l’accueil', 'Back to home')}
            </button>

            {page === 'business' && (
              <div className="space-y-8">
                <div className="space-y-3">
                  <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                    {t('ROVA pour les entreprises', 'ROVA for Business')}
                  </h1>
                  <p className="text-base text-neutral-600 max-w-2xl leading-relaxed">
                    {t(
                      'Centralisez toutes vos livraisons quotidiennes, vos tournées multi-arrêts et vos réservations de véhicules dans un espace marchand dédié.',
                      'Centralize daily dispatches, multi-stop tours, and scheduled vehicle reservations inside a dedicated merchant workspace.'
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {[
                    {
                      title: t('Expédition en 7 étapes', '7-Step Dispatch'),
                      text: t('Adresse, destinataires, véhicule, devis en direct et choix du règlement.', 'Address, recipients, vehicle, live quote, and payment method.'),
                    },
                    {
                      title: t('Import CSV & Optimisation', 'CSV Import & Optimization'),
                      text: t('Importez des dizaines d’arrêts et calculez l’ordre le plus rapide.', 'Import dozens of stops and compute the fastest stop order.'),
                    },
                    {
                      title: t('Facturation & Équipe', 'Billing & Team'),
                      text: t('Invitez vos collaborateurs et gérez vos factures commerciales.', 'Invite team members and manage commercial invoices.'),
                    },
                  ].map((c) => (
                    <div key={c.title} className="rounded-3xl border border-neutral-200 p-6 space-y-2">
                      <h3 className="font-display text-base font-bold">{c.title}</h3>
                      <p className="text-sm text-neutral-600">{c.text}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenInterface('merchant')}
                  className="px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800"
                >
                  {t('Accéder à l’Espace Marchand', 'Open Merchant Workspace')}
                </button>
              </div>
            )}

            {page === 'fleet' && (
              <div className="space-y-8">
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                  {t('Flotte ROVA', 'ROVA Fleet')}
                </h1>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {VEHICLE_CATALOG.map((v) => (
                    <div key={v.id} className="rounded-3xl border border-neutral-200 p-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-display text-lg font-bold">
                          {lang === 'fr' ? v.labelFr : v.label}
                        </h3>
                        <span className="font-mono text-xs text-neutral-500">≤ {v.maxWeightKg} kg</span>
                      </div>
                      <p className="text-sm text-neutral-600">
                        {lang === 'fr' ? v.summaryFr : v.summary}
                      </p>
                      <p className="font-mono text-xs text-neutral-500 pt-2 border-t border-neutral-100">
                        GHS {v.baseFallback} + GHS {v.perKmFallback}/km
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {page === 'drivers' && (
              <div className="space-y-6">
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                  {t('Réseau de livreurs ROVA', 'ROVA Driver Network')}
                </h1>
                <p className="text-base text-neutral-600 max-w-2xl leading-relaxed">
                  {t(
                    'Inscrivez votre véhicule, faites valider votre dossier par le Centre d’Opérations ROVA et passez en ligne pour accepter des livraisons commerciales.',
                    'Register your vehicle, get verified by ROVA Operations, and go online to accept commercial deliveries.'
                  )}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenInterface('driver')}
                    className="px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-medium"
                  >
                    {t('Ouvrir l’Application Livreur', 'Open Driver App')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWaitlistPlatform('driver');
                      setWaitlistStatus('idle');
                    }}
                    className="px-6 py-3 rounded-full border border-neutral-300 text-sm font-medium hover:border-neutral-950"
                  >
                    {t('Déposer une candidature', 'Submit application')}
                  </button>
                </div>
              </div>
            )}

            {page === 'partners' && (
              <div className="space-y-6">
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                  {t('Partenaires commerciaux & flottes', 'Commercial & Fleet Partners')}
                </h1>
                <p className="text-base text-neutral-600 max-w-2xl leading-relaxed">
                  {t(
                    'Déployez vos véhicules, entrepôts ou capacités de transport sur la plateforme ROVA avec des conditions contractuelles transparentes.',
                    'Deploy your vehicles, warehouses, or transport capacity on ROVA with transparent contract terms.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setWaitlistPlatform('partner');
                    setWaitlistStatus('idle');
                  }}
                  className="px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-medium"
                >
                  {t('Devenir partenaire ROVA', 'Become a ROVA Partner')}
                </button>
              </div>
            )}

            {(page === 'about' || page === 'privacy' || page === 'terms') && (
              <div className="space-y-4 max-w-2xl">
                <h1 className="font-display text-3xl font-bold tracking-tight">
                  {page === 'about'
                    ? t('À propos de ROVA', 'About ROVA')
                    : page === 'privacy'
                    ? t('Politique de confidentialité', 'Privacy Policy')
                    : t('Conditions d’utilisation', 'Terms of Service')}
                </h1>
                <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
                  {page === 'about'
                    ? t(
                        'ROVA construit l’infrastructure logistique moderne dédiée aux commerçants, grossistes et entreprises. Notre plateforme unifie la création de courses, le dispatch temps réel, la gestion de flotte et le suivi destinataire isolé.',
                        'ROVA builds modern commercial logistics infrastructure for merchants, wholesalers, and enterprises, unifying dispatch, fleet management, and isolated recipient tracking.'
                      )
                    : page === 'privacy'
                    ? t(
                        'Les données personnelles des marchands, livreurs et destinataires sont strictement cloisonnées. Les liens de suivi publics exposent uniquement la position et le statut du colis concerné, sans jamais divulguer d’autres arrêts.',
                        'Merchant, driver, and recipient data is strictly isolated. Public tracking links expose only the relevant stop status and location without disclosing other recipients.'
                      )
                    : t(
                        'L’utilisation des services ROVA est réservée aux livraisons commerciales conformes aux réglementations locales de transport. Les chauffeurs doivent être vérifiés par le Centre d’Opérations avant de passer en ligne.',
                        'ROVA services are designed for compliant commercial logistics. Drivers must be verified by Operations before going online.'
                      )}
                </p>
              </div>
            )}
          </section>
        )}

        {/* ================================================================ */}
        {/* CONTACT PAGE                                                     */}
        {/* ================================================================ */}
        {page === 'contact' && (
          <section className="max-w-3xl mx-auto px-5 sm:px-8 py-14 lg:py-20 space-y-8">
            <div className="space-y-2">
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                {t('Contactez l’équipe ROVA', 'Contact the ROVA Team')}
              </h1>
              <p className="text-sm sm:text-base text-neutral-600">
                {t(
                  'Logistique d’entreprise, intégration de flotte ou partenariat commercial : écrivez-nous directement.',
                  'Enterprise logistics, fleet onboarding, or commercial partnerships: reach out directly.'
                )}
              </p>
            </div>

            {contactStatus === 'done' ? (
              <div className="rounded-3xl border border-neutral-200 p-8 space-y-3 bg-neutral-50">
                <Check className="w-6 h-6 text-neutral-950" />
                <p className="font-semibold text-base">
                  {t('Message enregistré', 'Message received')}
                </p>
                <p className="text-sm text-neutral-600">
                  {t(
                    'Votre demande a été transmise à notre Centre d’Opérations ROVA.',
                    'Your inquiry has been logged in ROVA Operations.'
                  )}
                </p>
              </div>
            ) : (
              <form
                onSubmit={submitContact}
                className="rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-4 bg-white"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                      {t('Nom complet', 'Full name')}
                    </label>
                    <input
                      type="text"
                      required
                      value={contactForm.name}
                      onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                      {t('Adresse e-mail', 'Email address')}
                    </label>
                    <input
                      type="email"
                      required
                      value={contactForm.email}
                      onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))}
                      className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                      {t('Entreprise', 'Company')}
                    </label>
                    <input
                      type="text"
                      value={contactForm.company}
                      onChange={(e) => setContactForm((p) => ({ ...p, company: e.target.value }))}
                      className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                      {t('Ville', 'City')}
                    </label>
                    <input
                      type="text"
                      value={contactForm.city}
                      onChange={(e) => setContactForm((p) => ({ ...p, city: e.target.value }))}
                      className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                    {t('Votre besoin', 'Message')}
                  </label>
                  <textarea
                    rows={4}
                    value={contactForm.message}
                    onChange={(e) => setContactForm((p) => ({ ...p, message: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                  />
                </div>
                <button
                  type="submit"
                  disabled={contactStatus === 'submitting'}
                  className="px-6 py-3 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
                >
                  {contactStatus === 'submitting'
                    ? t('Envoi en cours...', 'Sending...')
                    : t('Envoyer la demande', 'Send message')}
                </button>
              </form>
            )}
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <span className="font-display text-base font-extrabold tracking-[0.2em]">ROVA</span>
            <p className="text-xs text-neutral-500 mt-1">
              {t('La logistique commerciale nouvelle génération.', 'Commercial logistics infrastructure.')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-neutral-600">
            <button type="button" onClick={() => navigate('about')} className="hover:text-neutral-950">
              {t('À propos', 'About')}
            </button>
            <button type="button" onClick={() => navigate('privacy')} className="hover:text-neutral-950">
              {t('Confidentialité', 'Privacy')}
            </button>
            <button type="button" onClick={() => navigate('terms')} className="hover:text-neutral-950">
              {t('Conditions', 'Terms')}
            </button>
            <button type="button" onClick={() => navigate('contact')} className="hover:text-neutral-950">
              {t('Contact', 'Contact')}
            </button>
          </div>
        </div>
      </footer>

      {/* Tracking Lookup Modal */}
      {trackModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-neutral-200 max-w-md w-full p-6 sm:p-7 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {t('Suivre une livraison', 'Track a delivery')}
              </h3>
              <button
                type="button"
                onClick={() => setTrackModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleTrackSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  {t('Code de suivi destinataire', 'Recipient tracking token')}
                </label>
                <input
                  type="text"
                  required
                  value={trackCode}
                  onChange={(e) => setTrackCode(e.target.value)}
                  placeholder="rvt_..."
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-neutral-950"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800"
              >
                {t('Afficher le suivi', 'View live tracking')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Early Access / Partner / Driver Waitlist Modal */}
      {waitlistPlatform && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-neutral-200 max-w-md w-full p-6 sm:p-7 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {waitlistPlatform === 'ios'
                  ? t('Accès anticipé iOS', 'iOS Early Access')
                  : waitlistPlatform === 'android'
                  ? t('Accès anticipé Android', 'Android Early Access')
                  : waitlistPlatform === 'driver'
                  ? t('Candidature livreur ROVA', 'ROVA Driver Application')
                  : t('Demande de partenariat', 'Partnership Inquiry')}
              </h3>
              <button
                type="button"
                onClick={() => setWaitlistPlatform(null)}
                className="p-1.5 rounded-full hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {waitlistStatus === 'done' ? (
              <div className="space-y-4 py-2">
                <p className="text-sm text-neutral-700">
                  {t(
                    'Votre inscription a bien été enregistrée dans notre base ROVA.',
                    'Your registration has been saved in ROVA.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setWaitlistPlatform(null)}
                  className="w-full py-2.5 rounded-full bg-neutral-950 text-white text-sm font-medium"
                >
                  {t('Fermer', 'Close')}
                </button>
              </div>
            ) : (
              <form onSubmit={submitWaitlist} className="space-y-3.5">
                <input
                  type="text"
                  required
                  placeholder={t('Nom complet', 'Full name')}
                  value={waitlistForm.name}
                  onChange={(e) => setWaitlistForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
                <input
                  type="email"
                  required
                  placeholder={t('Adresse e-mail', 'Email address')}
                  value={waitlistForm.email}
                  onChange={(e) => setWaitlistForm((p) => ({ ...p, email: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
                <input
                  type="text"
                  placeholder={t('Entreprise (optionnel)', 'Company (optional)')}
                  value={waitlistForm.company}
                  onChange={(e) => setWaitlistForm((p) => ({ ...p, company: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
                <input
                  type="text"
                  placeholder={t('Ville', 'City')}
                  value={waitlistForm.city}
                  onChange={(e) => setWaitlistForm((p) => ({ ...p, city: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
                />
                <button
                  type="submit"
                  disabled={waitlistStatus === 'submitting'}
                  className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
                >
                  {waitlistStatus === 'submitting'
                    ? t('Enregistrement...', 'Submitting...')
                    : t('Confirmer l’inscription', 'Confirm registration')}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
