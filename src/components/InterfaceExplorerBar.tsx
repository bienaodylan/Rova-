import React from 'react';
import { motion } from 'motion/react';
import { Clock, Home, Package, User } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type PrimaryTab = 'home' | 'shipments' | 'activity' | 'account';
export type ActiveInterface = 'public' | 'merchant' | 'driver' | 'operations' | 'tracking';

interface FloatingBottomNavProps {
  active: PrimaryTab;
  onSelect: (next: PrimaryTab) => void;
  activeShipmentsBadge?: number;
}

export function FloatingBottomNav({
  active,
  onSelect,
  activeShipmentsBadge = 0,
}: FloatingBottomNavProps) {
  const { t } = useLanguage();

  const items: Array<{
    id: PrimaryTab;
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    badge?: number;
  }> = [
    { id: 'home', label: t('Accueil', 'Home'), icon: Home },
    {
      id: 'shipments',
      label: t('Envois', 'Shipments'),
      icon: Package,
      badge: activeShipmentsBadge,
    },
    { id: 'activity', label: t('Activité', 'Activity'), icon: Clock },
    { id: 'account', label: t('Compte', 'Account'), icon: User },
  ];

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[min(368px,calc(100vw-1.5rem))] sm:w-auto pointer-events-none pb-[env(safe-area-inset-bottom,0px)]">
      <nav
        aria-label={t('Navigation principale', 'Primary navigation')}
        className="pointer-events-auto relative grid grid-cols-4 sm:flex items-center gap-1 p-1.5 rounded-full bg-white/95 backdrop-blur-xl border border-[#E5E5E5] shadow-[0_12px_32px_rgba(23,23,23,0.10)]"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className="group relative flex flex-col items-center justify-center sm:min-w-[84px] h-[50px] px-2 sm:px-4 rounded-full cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] transition-transform duration-150 active:scale-[0.95]"
            >
              {isActive && (
                <motion.span
                  layoutId="rova-active-nav-pill"
                  transition={{
                    type: 'spring',
                    stiffness: 480,
                    damping: 34,
                    mass: 0.7,
                  }}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-[#F3F3F3]"
                />
              )}

              <span className="relative z-10 flex flex-col items-center justify-center gap-1">
                <span className="relative">
                  <Icon
                    strokeWidth={isActive ? 2.25 : 1.75}
                    className={`w-[20px] h-[20px] transition-colors duration-150 ${
                      isActive ? 'text-[#E52B32]' : 'text-[#777777] group-hover:text-[#171717]'
                    }`}
                  />
                  {item.badge && item.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#E52B32] text-white font-mono text-[9px] font-bold flex items-center justify-center tabular-nums ring-2 ring-white">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`text-[10.5px] leading-none tracking-tight whitespace-nowrap transition-colors duration-150 ${
                    isActive
                      ? 'font-semibold text-[#171717]'
                      : 'font-medium text-[#777777] group-hover:text-[#171717]'
                  }`}
                >
                  {item.label}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export const InterfaceExplorerBar = FloatingBottomNav;
