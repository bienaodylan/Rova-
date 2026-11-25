import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface ToastBannerProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function ToastBanner({ toast, onDismiss }: ToastBannerProps) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] w-full max-w-md px-4 pointer-events-none">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg border text-xs sm:text-sm font-medium ${
              toast.kind === 'error'
                ? 'bg-red-950 text-white border-red-800'
                : 'bg-neutral-950 text-white border-neutral-800'
            }`}
          >
            {toast.kind === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.kind === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
            {toast.kind === 'info' && <Info className="w-4 h-4 text-neutral-300 shrink-0" />}
            <span className="flex-1 leading-snug">{toast.text}</span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Fermer la notification"
              className="p-1 rounded-full text-neutral-400 hover:text-white transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
