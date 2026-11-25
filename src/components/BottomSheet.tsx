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
  scrollable = true,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Lock the page behind the sheet on mobile Safari as well as desktop.
    // overflow:hidden alone can still allow the document to rubber-band on iOS.
    const scrollY = window.scrollY;
    const previous = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.style.overflow = previous.htmlOverflow;
      document.body.style.overflow = previous.bodyOverflow;
      document.body.style.position = previous.bodyPosition;
      document.body.style.top = previous.bodyTop;
      document.body.style.width = previous.bodyWidth;
      window.scrollTo(0, scrollY);
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
            className={`relative z-10 w-full ${SIZE_CLASSES[size]} ${scrollable ? 'max-h-[92dvh] sm:max-h-[88dvh]' : 'h-[100dvh] max-h-[100dvh] sm:h-[min(900px,92dvh)] sm:max-h-[92dvh]'} bg-white rounded-t-[28px] sm:rounded-3xl shadow-2xl border border-neutral-200/80 flex flex-col overflow-hidden`}
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

            {/* Body: scrolling can be disabled for native-like, fixed-step experiences. */}
            <div className={`min-h-0 flex-1 px-5 sm:px-6 py-5 ${scrollable ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden overscroll-none touch-pan-x'}`}>
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
