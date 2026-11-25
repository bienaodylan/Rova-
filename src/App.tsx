import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RoleOnboarding } from './components/RoleOnboardingModal';
import { ActiveInterface, InterfaceExplorerBar } from './components/InterfaceExplorerBar';
import { PublicSite } from './pages/PublicSite';
import { MerchantWorkspace } from './pages/MerchantWorkspace';
import { DriverWorkspace } from './pages/DriverWorkspace';
import { OperationsCenter } from './pages/OperationsCenter';
import { RecipientTrackingPage } from './pages/RecipientTrackingPage';

function getInitialTrackingToken(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('track')?.trim() || '';
  } catch {
    return '';
  }
}

function RovaRouter() {
  const {
    firebaseUser,
    profile,
    loading,
    authError,
    isAdmin,
    signInWithGoogle,
    completeOnboarding,
    logout,
  } = useAuth();
  const { t } = useLanguage();

  const initialToken = getInitialTrackingToken();
  const [trackingToken, setTrackingToken] = useState<string>(initialToken);
  const [activeInterface, setActiveInterface] = useState<ActiveInterface>(
    initialToken ? 'tracking' : 'public'
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      const tk = getInitialTrackingToken();
      setTrackingToken(tk);
      if (tk) setActiveInterface('tracking');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openTracking = (token: string) => {
    const clean = token.trim();
    setTrackingToken(clean);
    setActiveInterface('tracking');
    try {
      const url = new URL(window.location.href);
      if (clean) url.searchParams.set('track', clean);
      else url.searchParams.delete('track');
      window.history.pushState({}, '', url.toString());
    } catch {
      // Ignore in restricted frames
    }
  };

  const selectInterface = (next: ActiveInterface) => {
    setActiveInterface(next);
    if (next !== 'tracking') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('track');
        window.history.replaceState({}, '', url.toString());
      } catch {
        // Ignore
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch {
      // Handled via authError
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-neutral-950 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-3">
          <span className="font-display text-xl font-extrabold tracking-[0.22em]">ROVA</span>
          <p className="font-mono text-xs text-neutral-500">
            {t('Initialisation de la plateforme...', 'Connecting to logistics network...')}
          </p>
        </div>
      </div>
    );
  }

  // First-time signed-in user without Firestore profile yet
  if (firebaseUser && !profile && activeInterface !== 'tracking') {
    return (
      <RoleOnboarding
        email={firebaseUser.email || ''}
        initialName={firebaseUser.displayName || ''}
        canSelectAdmin={isAdmin}
        onComplete={completeOnboarding}
        onSignOut={logout}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Persistent Interface Explorer + Language Selector Bar */}
      <InterfaceExplorerBar
        active={activeInterface}
        onSelect={selectInterface}
        isSignedIn={Boolean(firebaseUser)}
        userName={profile?.displayName || firebaseUser?.displayName || undefined}
        onSignIn={handleSignIn}
        signingIn={signingIn}
      />

      {authError && (
        <div className="bg-neutral-950 text-white text-xs px-4 py-2.5 text-center">
          {t('Connexion interrompue :', 'Sign-in could not be completed:')} {authError}
        </div>
      )}

      <div className="flex-1">
        {activeInterface === 'public' && (
          <PublicSite
            onSignIn={firebaseUser ? () => selectInterface('merchant') : handleSignIn}
            onOpenTracking={openTracking}
            onOpenInterface={selectInterface}
            signingIn={signingIn}
            isSignedIn={Boolean(firebaseUser)}
          />
        )}

        {activeInterface === 'merchant' && (
          <MerchantWorkspace
            onOpenTracking={openTracking}
            onRequestSignIn={handleSignIn}
          />
        )}

        {activeInterface === 'driver' && (
          <DriverWorkspace onRequestSignIn={handleSignIn} />
        )}

        {activeInterface === 'operations' && (
          <OperationsCenter
            onOpenTracking={openTracking}
            onRequestSignIn={handleSignIn}
          />
        )}

        {activeInterface === 'tracking' && (
          <RecipientTrackingPage
            trackingToken={trackingToken}
            onBack={() => selectInterface('public')}
            onLookupToken={openTracking}
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <RovaRouter />
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
