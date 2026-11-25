import React from 'react';
import { Building2, Globe, MapPin, Shield, Smartphone } from 'lucide-react';
import { LanguageSelector, useLanguage } from '../context/LanguageContext';

export type ActiveInterface = 'public' | 'merchant' | 'driver' | 'operations' | 'tracking';

interface InterfaceExplorerBarProps {
  active: ActiveInterface;
  onSelect: (next: ActiveInterface) => void;
  isSignedIn: boolean;
  userName?: string;
  onSignIn: () => void;
  signingIn?: boolean;
}

export function InterfaceExplorerBar({
  active,
  onSelect,
  isSignedIn,
  userName,
  onSignIn,
  signingIn,
}: InterfaceExplorerBarProps) {
  const { t } = useLanguage();

  const items: Array<{
    id: ActiveInterface;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'public', label: t('Site Public', 'Public Website'), icon: Globe },
    { id: 'merchant', label: t('Espace Marchand', 'Merchant Workspace'), icon: Building2 },
    { id: 'driver', label: t('App Livreur', 'Driver App'), icon: Smartphone },
    { id: 'operations', label: t('Opérations', 'Operations Center'), icon: Shield },
    { id: 'tracking', label: t('Suivi Destinataire', 'Recipient Tracking'), icon: MapPin },
  ];

  return (
    <div className="bg-neutral-50 border-b border-neutral-200 px-3 sm:px-6 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-neutral-950 text-white'
                    : 'bg-white text-neutral-700 border border-neutral-200 hover:border-neutral-400 hover:text-neutral-950'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <LanguageSelector compact />
          {!isSignedIn ? (
            <button
              type="button"
              disabled={signingIn}
              onClick={onSignIn}
              className="hidden md:inline-flex items-center px-3.5 py-1.5 rounded-full bg-neutral-950 text-white text-xs font-medium hover:bg-neutral-800 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {signingIn ? t('Connexion...', 'Signing in...') : t('Connexion Google', 'Sign in')}
            </button>
          ) : (
            <span className="hidden xl:inline text-xs text-neutral-500 max-w-[140px] truncate">
              {userName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
