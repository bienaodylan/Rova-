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
  /** Disable vertical scrolling for fixed, app-like multi-step flows. */
  scrollable?: boolean;
  /** Elevate above standard sheets when opened contextually (e.g., payment selector inside checkout). */
  elevated?: boolean;
  children: React.ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<BottomSheetProps['size']>, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-2xl',
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
  scrollable = true,
  elevated = false,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const scrollY = window.scrollY;
    const previous = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
    };
    if (!elevated) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (!elevated) {
        document.documentElement.style.overflow = previous.htmlOverflow;
        document.body.style.overflow = previous.bodyOverflow;
        document.body.style.position = previous.bodyPosition;
        document.body.style.top = previous.bodyTop;
        document.body.style.width = previous.bodyWidth;
        window.scrollTo(0, scrollY);
      }
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, elevated]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 ${elevated ? 'z-[80]' : 'z-[60]'} flex items-end sm:items-center justify-center sm:p-5`}
          role="dialog"
          aria-modal="true"
          aria-label={title || 'Rovia'}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#171717]/40 backdrop-blur-[2px]"
          />

          {/* Sheet / Modal Container */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`relative z-10 w-full ${SIZE_CLASSES[size]} ${
              scrollable
                ? 'max-h-[92dvh] sm:max-h-[86dvh]'
                : 'h-[100dvh] max-h-[100dvh] sm:h-[min(860px,90dvh)] sm:max-h-[90dvh]'
            } bg-white rounded-t-[32px] sm:rounded-[32px] shadow-[0_24px_64px_rgba(23,23,23,0.16)] border border-[#E5E5E5] flex flex-col overflow-hidden`}
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
              <span className="w-9 h-1 rounded-full bg-[#E5E5E5]" aria-hidden="true" />
            </div>

            {/* Header */}
            {(title || headerExtra) && (
              <div className="px-5 sm:px-6 pt-3 sm:pt-5 pb-4 border-b border-[#E5E5E5] flex items-center justify-between gap-4 shrink-0 bg-white">
                <div className="min-w-0">
                  {title && (
                    <h2 className="font-display text-base sm:text-lg font-bold tracking-tight text-[#171717] truncate">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-xs text-[#777777] mt-0.5 truncate">{subtitle}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {headerExtra}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fermer"
                    className="min-w-[44px] min-h-[44px] -mr-1.5 rounded-full hover:bg-[#F3F3F3] text-[#777777] hover:text-[#171717] flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Body */}
            <div
              className={`min-h-0 flex-1 px-5 sm:px-6 py-5 bg-white ${
                scrollable
                  ? 'overflow-y-auto overscroll-contain'
                  : 'overflow-hidden overscroll-none touch-pan-x'
              }`}
            >
              {children}
            </div>

            {/* Optional Sticky Footer */}
            {footer && (
              <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5E5E5] bg-white shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
