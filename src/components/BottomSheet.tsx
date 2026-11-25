import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<BottomSheetProps['size']>, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  full: 'sm:max-w-4xl',
};

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  headerExtra,
  footer,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title || 'ROVA'}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="fixed inset-0 bg-neutral-950/45 backdrop-blur-[2px]"
          />

          {/* Sheet Container */}
          <motion.div
            initial={{ opacity: 0, y: 36, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.99 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className={`relative z-10 w-full ${SIZE_CLASSES[size]} max-h-[92dvh] sm:max-h-[88dvh] bg-white rounded-t-[28px] sm:rounded-3xl shadow-2xl border border-neutral-200/80 flex flex-col overflow-hidden`}
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1 rounded-full bg-neutral-300" aria-hidden="true" />
            </div>

            {/* Header */}
            {(title || headerExtra) && (
              <div className="px-5 sm:px-6 pt-3 pb-3.5 border-b border-neutral-100 flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  {title && (
                    <h2 className="font-display text-lg font-bold tracking-tight text-neutral-950 truncate">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-xs text-neutral-500 mt-0.5 truncate">{subtitle}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {headerExtra}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fermer"
                    className="min-w-[40px] min-h-[40px] rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-700 hover:text-neutral-950 flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5">
              {children}
            </div>

            {/* Optional Sticky Footer */}
            {footer && (
              <div className="px-5 sm:px-6 py-4 border-t border-neutral-100 bg-white/95 backdrop-blur-sm shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
