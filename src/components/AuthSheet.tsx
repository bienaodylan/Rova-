import React, { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface AuthSheetProps {
  open: boolean;
  onClose: () => void;
}

export function GoogleLogo({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function AppleLogo({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

export function AuthSheet({ open, onClose }: AuthSheetProps) {
  const { signInWithGoogle, signInWithApple, authError, clearAuthError } = useAuth();
  const { t } = useLanguage();
  const [pendingProvider, setPendingProvider] = useState<'google' | 'apple' | null>(null);

  const handleClose = () => {
    clearAuthError();
    onClose();
  };

  const handleGoogle = async () => {
    setPendingProvider('google');
    try {
      await signInWithGoogle();
      onClose();
    } catch {
      // Error surfaced cleanly via authError
    } finally {
      setPendingProvider(null);
    }
  };

  const handleApple = async () => {
    setPendingProvider('apple');
    try {
      await signInWithApple();
      onClose();
    } catch {
      // Error surfaced cleanly via authError
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      size="sm"
      title={t('Connexion à ROVA', 'Sign in to ROVA')}
      subtitle={t(
        'Synchronisez vos expéditions, adresses et suivis en temps réel.',
        'Sync your shipments, saved addresses, and live tracking.'
      )}
    >
      <div className="space-y-4">
        {/* Brand Identity Header */}
        <div className="rounded-2xl bg-neutral-50 border border-neutral-200/80 p-4 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="font-display text-lg font-extrabold tracking-[0.22em] text-neutral-950 inline-flex items-baseline">
              ROVA<span className="text-red-600 tracking-normal">.</span>
            </span>
            <p className="text-xs text-neutral-500">
              {t('Accès rapide et sécurisé en un geste', 'Fast, secure one-tap access')}
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-white border border-neutral-200 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-red-600" />
          </div>
        </div>

        {/* Provider Action Buttons */}
        <div className="space-y-2.5">
          <button
            type="button"
            disabled={pendingProvider !== null}
            onClick={() => void handleGoogle()}
            className="w-full min-h-[48px] px-5 py-3 rounded-full bg-white border border-neutral-300 hover:border-neutral-950 text-neutral-950 text-sm font-semibold inline-flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            {pendingProvider === 'google' ? (
              <Loader2 className="w-4 h-4 animate-spin text-neutral-700" />
            ) : (
              <GoogleLogo className="w-4 h-4 shrink-0" />
            )}
            <span>{t('Continuer avec Google', 'Continue with Google')}</span>
          </button>

          <button
            type="button"
            disabled={pendingProvider !== null}
            onClick={() => void handleApple()}
            className="w-full min-h-[48px] px-5 py-3 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            {pendingProvider === 'apple' ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <AppleLogo className="w-4 h-4 shrink-0" />
            )}
            <span>{t('Continuer avec Apple', 'Continue with Apple')}</span>
          </button>
        </div>

        {authError && (
          <div
            role="alert"
            className="rounded-2xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-800 leading-relaxed"
          >
            {authError}
          </div>
        )}

        <p className="text-[11px] text-neutral-400 text-center leading-relaxed pt-1">
          {t(
            'Vos données logistiques sont protégées par authentification chiffrée.',
            'Your logistics data is protected with encrypted authentication.'
          )}
        </p>
      </div>
    </BottomSheet>
  );
}
