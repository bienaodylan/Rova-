import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';

interface RovaWordmarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP: Record<NonNullable<RovaWordmarkProps['size']>, string> = {
  sm: 'text-base tracking-[0.02em]',
  md: 'text-lg tracking-[0.02em]',
  lg: 'text-2xl tracking-[0.02em]',
  xl: 'text-4xl sm:text-5xl tracking-[0.01em]',
};

/**
 * Shared Rovia brand wordmark used consistently across the splash screen,
 * main client application header, live tracking window, and driver workspace.
 */
export function RovaWordmark({ size = 'md', className = '' }: RovaWordmarkProps) {
  return (
    <span
      className={`font-display font-extrabold text-[#171717] select-none inline-flex items-baseline leading-none ${SIZE_MAP[size]} ${className}`}
    >
      Rovia<span className="text-[#E52B32] tracking-normal">.</span>
    </span>
  );
}

interface RovaSplashScreenProps {
  /** True once initial auth/bootstrap hydration has finished */
  ready: boolean;
}

const SPLASH_SESSION_KEY = 'rovia_splash_seen_v1';

export function RovaSplashScreen({ ready }: RovaSplashScreenProps) {
  const { t } = useLanguage();
  const prefersReducedMotion = useReducedMotion();

  const [minDelayDone, setMinDelayDone] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SPLASH_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (minDelayDone) return;
    const durationMs = prefersReducedMotion ? 350 : 1150;
    const timer = window.setTimeout(() => {
      setMinDelayDone(true);
      try {
        sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
      } catch {
        // Ignore storage errors in private browsing
      }
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [minDelayDone, prefersReducedMotion]);

  const visible = !ready || !minDelayDone;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="rovia-splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0.15 : 0.36, ease: [0.16, 1, 0.3, 1] }}
          aria-label={t('Chargement de Rovia', 'Loading Rovia')}
          role="status"
          className="fixed inset-0 z-[200] bg-white text-[#171717] flex flex-col items-center justify-center px-6 select-none overflow-hidden"
        >
          <motion.div
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex flex-col items-center text-center"
          >
            {/* Current Rovia. Logo Mark */}
            <RovaWordmark size="xl" />

            {/* Crisp red-black route line progress indicator */}
            <div className="mt-6 w-36 h-[2px] rounded-full bg-[#E5E5E5] overflow-hidden">
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{
                  repeat: Infinity,
                  duration: 1.15,
                  ease: [0.4, 0, 0.2, 1],
                }}
                className="w-1/2 h-full bg-gradient-to-r from-[#171717] via-[#E52B32] to-[#E52B32] rounded-full"
              />
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
