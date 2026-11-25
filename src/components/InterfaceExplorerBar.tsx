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
      label: t('Expéditions', 'Shipments'),
      icon: Package,
      badge: activeShipmentsBadge,
    },
    { id: 'activity', label: t('Activité', 'Activity'), icon: Clock },
    { id: 'account', label: t('Compte', 'Account'), icon: User },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-auto max-w-[calc(100vw-1rem)] pointer-events-none pb-[env(safe-area-inset-bottom,0px)]">
      <nav
        aria-label={t('Navigation principale', 'Primary navigation')}
        className="pointer-events-auto relative flex items-center gap-1.5 sm:gap-2 p-1.5 rounded-full bg-transparent backdrop-blur-md border border-white/60 ring-1 ring-black/[0.08] shadow-[0_12px_36px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.65)]"
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
              className="group relative flex flex-col items-center justify-center min-w-[74px] sm:min-w-[92px] h-[52px] px-3 sm:px-5 rounded-full cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 transition-transform duration-150 active:scale-95"
            >
              {/* Transparent glass rounded pill behind every icon */}
              <span
                aria-hidden="true"
                className={`absolute inset-0 rounded-full transition-all duration-200 ${
                  isActive
                    ? 'opacity-0'
                    : 'bg-transparent backdrop-blur-sm border border-white/40 group-hover:border-white/75'
                }`}
              />

              {/* Animated transparent rounded glassmorphism pill behind the active icon */}
              {isActive && (
                <motion.span
                  layoutId="rova-active-glass-pill"
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                    mass: 0.75,
                  }}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-transparent backdrop-blur-lg border border-white/85 ring-1 ring-black/[0.10] shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.8),0_4px_14px_rgba(0,0,0,0.08)]"
                />
              )}

              {/* Icon + Crisp Label + Red Active Indicator Dot */}
              <span className="relative z-10 flex flex-col items-center justify-center gap-0.5">
                <span className="relative">
                  <motion.span
                    animate={isActive ? { y: [0, -2, 0], scale: [1, 1.12, 1] } : { y: 0, scale: 1 }}
                    transition={isActive ? { duration: 0.34, ease: [0.2, 0.8, 0.2, 1] } : { duration: 0.18 }}
                    className="inline-flex"
                  >
                    <Icon
                      strokeWidth={isActive ? 2.3 : 1.85}
                      className={`w-[19px] h-[19px] transition-colors duration-200 ${
                        isActive ? 'text-neutral-950' : 'text-neutral-600 group-hover:text-neutral-900'
                      }`}
                    />
                  </motion.span>
                  {item.badge && item.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white font-mono text-[9px] font-bold flex items-center justify-center tabular-nums shadow-[0_2px_8px_rgba(220,38,38,0.45)]">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  ) : null}
                </span>
                <span className="inline-flex items-center gap-1">
                  {isActive && (
                    <motion.span
                      layoutId="rova-active-red-dot"
                      transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                      className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`text-[10px] leading-none tracking-tight whitespace-nowrap transition-colors duration-200 ${
                      isActive
                        ? 'font-semibold text-neutral-950'
                        : 'font-medium text-neutral-600 group-hover:text-neutral-900'
                    }`}
                  >
                    {item.label}
                  </span>
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
