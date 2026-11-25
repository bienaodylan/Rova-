import React, { useState } from 'react';
import { Building2, Shield, Truck, Users } from 'lucide-react';
import { UserRole } from '../types/rova';
import { LanguageSelector, useLanguage } from '../context/LanguageContext';

interface RoleOnboardingProps {
  email: string;
  initialName: string;
  canSelectAdmin: boolean;
  onComplete: (role: UserRole, displayName: string, phone: string) => Promise<void>;
  onSignOut: () => void;
}

export function RoleOnboarding({
  email,
  initialName,
  canSelectAdmin,
  onComplete,
  onSignOut,
}: RoleOnboardingProps) {
  const { t } = useLanguage();
  const [role, setRole] = useState<UserRole>(canSelectAdmin ? 'super_admin' : 'business_owner');
  const [displayName, setDisplayName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const roles: Array<{
    id: UserRole;
    title: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'business_owner',
      title: t('Marchand / Entreprise', 'Merchant / Business'),
      desc: t(
        'Créez des livraisons instantanées, des tournées multi-arrêts, réservez des véhicules et gérez votre équipe.',
        'Create instant deliveries, multi-stop routes, scheduled vehicle reservations, and manage teams.'
      ),
      icon: Building2,
    },
    {
      id: 'independent_driver',
      title: t('Livreur indépendant', 'Delivery Driver'),
      desc: t(
        'Complétez votre dossier chauffeur, passez en ligne avec GPS en direct, acceptez des courses et soumettez la preuve de livraison.',
        'Complete driver onboarding, go online with live GPS, accept dispatches, and submit proof of delivery.'
      ),
      icon: Truck,
    },
    {
      id: 'fleet_partner',
      title: t('Partenaire de flotte', 'Fleet Partner'),
      desc: t(
        'Exploitez vos véhicules partenaires, gérez vos contrats commerciaux et coordonnez vos tournées.',
        'Operate partner vehicles, manage commercial contracts, and coordinate fleet dispatches.'
      ),
      icon: Users,
    },
    ...(canSelectAdmin
      ? [
          {
            id: 'super_admin' as UserRole,
            title: t('Centre d’Opérations ROVA (Admin)', 'ROVA Operations Center (Admin)'),
            desc: t(
              'Carte opérationnelle en direct, validation des livreurs, flotte & équipements, règles tarifaires et analyses.',
              'Centralized live operations map, driver approvals, fleet & brand inventory, pricing rules, and analytics.'
            ),
            icon: Shield,
          },
        ]
      : []),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await onComplete(role, displayName, phone);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-950 flex flex-col justify-center py-12 px-5">
      <div className="max-w-2xl w-full mx-auto bg-white rounded-3xl border border-neutral-200 p-6 sm:p-10 space-y-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-5">
          <div>
            <span className="font-display text-lg font-extrabold tracking-[0.18em]">ROVA</span>
            <p className="text-xs text-neutral-500 mt-1">
              {t('Connecté en tant que', 'Signed in as')} {email}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSelector compact />
            <button
              type="button"
              onClick={onSignOut}
              className="text-xs text-neutral-500 hover:text-neutral-950 underline"
            >
              {t('Déconnexion', 'Sign out')}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            {t('Configurez votre espace ROVA', 'Configure your ROVA workspace')}
          </h1>
          <p className="text-sm text-neutral-600">
            {t(
              'Sélectionnez votre rôle principal dans le réseau logistique ROVA pour démarrer de zéro.',
              'Select your primary role in the ROVA logistics network to enter the right workspace.'
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {roles.map((r) => {
              const Icon = r.icon;
              const active = role === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id)}
                  className={`p-4 text-left rounded-2xl border transition-colors space-y-2 ${
                    active
                      ? 'border-neutral-950 bg-neutral-50 shadow-xs'
                      : 'border-neutral-200 hover:border-neutral-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className="w-4 h-4 text-neutral-950" />
                    <span className="font-mono text-[11px] text-neutral-500">
                      {active ? t('Sélectionné', 'Selected') : ''}
                    </span>
                  </div>
                  <p className="font-semibold text-sm text-neutral-950">{r.title}</p>
                  <p className="text-xs text-neutral-600 leading-relaxed">{r.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                {t('Nom complet', 'Full name')}
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                {t('Numéro de téléphone', 'Phone number')}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+225 07 00 00 00 00"
                className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-neutral-950"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-full bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            {saving
              ? t('Création de votre espace...', 'Creating workspace...')
              : t('Continuer sur ROVA', 'Continue to ROVA')}
          </button>
        </form>
      </div>
    </div>
  );
}
