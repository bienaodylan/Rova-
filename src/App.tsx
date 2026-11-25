import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { RovaAppProvider, useRovaApp } from './context/RovaAppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RoleOnboarding } from './components/RoleOnboardingModal';
import { FloatingBottomNav, PrimaryTab } from './components/InterfaceExplorerBar';
import { DeliveryComposerSheet } from './components/DeliveryComposerSheet';
import { ReservationSheet } from './components/ReservationSheet';
import { ShipmentDetailSheet } from './components/ShipmentDetailSheet';
import { SupportSheet, TrackLookupSheet } from './components/UtilitySheets';
import { ToastBanner } from './components/ToastBanner';
import { RovaHomeView } from './pages/RovaHomeView';
import { RovaShipmentsView } from './pages/RovaShipmentsView';
import { RovaActivityView } from './pages/RovaActivityView';
import { RovaAccountView } from './pages/RovaAccountView';
import { RecipientTrackingPage } from './pages/RecipientTrackingPage';

const DriverWorkspace = lazy(() =>
  import('./pages/DriverWorkspace').then((m) => ({ default: m.DriverWorkspace }))
);
const OperationsCenter = lazy(() =>
  import('./pages/OperationsCenter').then((m) => ({ default: m.OperationsCenter }))
);

type SecondaryWorkspace = 'none' | 'driver' | 'operations' | 'tracking';

function readUrlState(): {
  tab: PrimaryTab;
  workspace: SecondaryWorkspace;
  trackToken: string;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const track = params.get('track')?.trim() || '';
    if (track) {
      return { tab: 'home', workspace: 'tracking', trackToken: track };
    }
    const ws = params.get('workspace');
    if (ws === 'driver' || ws === 'operations' || ws === 'tracking') {
      return { tab: 'account', workspace: ws, trackToken: '' };
    }
    const tabParam = params.get('tab');
    const tab: PrimaryTab =
      tabParam === 'shipments' || tabParam === 'activity' || tabParam === 'account'
        ? tabParam
        : 'home';
    return { tab, workspace: 'none', trackToken: '' };
  } catch {
    return { tab: 'home', workspace: 'none', trackToken: '' };
  }
}

function pushUrlState(tab: PrimaryTab, workspace: SecondaryWorkspace, trackToken: string) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('tab');
    url.searchParams.delete('workspace');
    url.searchParams.delete('track');
    if (workspace === 'tracking') {
      if (trackToken) url.searchParams.set('track', trackToken);
      else url.searchParams.set('workspace', 'tracking');
    } else if (workspace !== 'none') {
      url.searchParams.set('workspace', workspace);
    } else if (tab !== 'home') {
      url.searchParams.set('tab', tab);
    }
    window.history.pushState({}, '', url.toString());
  } catch {
    // Ignore in restricted iframe contexts
  }
}

function RovaApplicationShell() {
  const { firebaseUser, profile, loading, authError, isAdmin, signInWithGoogle, completeOnboarding, logout } =
    useAuth();
  const { t } = useLanguage();
  const { activeDeliveries, toast, dismissToast } = useRovaApp();

  const initial = readUrlState();
  const [activeTab, setActiveTab] = useState<PrimaryTab>(initial.tab);
  const [workspace, setWorkspace] = useState<SecondaryWorkspace>(initial.workspace);
  const [trackingToken, setTrackingToken] = useState<string>(initial.trackToken);

  // Sync browser Back / Forward cleanly without page reload
  useEffect(() => {
    const onPopState = () => {
      const state = readUrlState();
      setActiveTab(state.tab);
      setWorkspace(state.workspace);
      setTrackingToken(state.trackToken);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTab = (next: PrimaryTab) => {
    setWorkspace('none');
    setActiveTab(next);
    pushUrlState(next, 'none', '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openWorkspace = (ws: 'driver' | 'operations' | 'tracking') => {
    setWorkspace(ws);
    if (ws !== 'tracking') setTrackingToken('');
    pushUrlState(activeTab, ws, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openPublicTracking = (token: string) => {
    const clean = token.trim();
    setTrackingToken(clean);
    setWorkspace('tracking');
    pushUrlState(activeTab, 'tracking', clean);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const returnToMainApp = () => {
    setWorkspace('none');
    setTrackingToken('');
    pushUrlState(activeTab, 'none', '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f8f9] text-neutral-950 flex items-center justify-center p-6">
        <div className="text-center space-y-2.5">
          <span className="font-display text-xl font-extrabold tracking-[0.22em]">ROVA</span>
          <p className="text-xs text-neutral-500">
            {t('Chargement de votre espace...', 'Opening your workspace...')}
          </p>
        </div>
      </div>
    );
  }

  // First-time signed-in user onboarding (skip if viewing an isolated recipient tracking link)
  if (firebaseUser && !profile && workspace !== 'tracking') {
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

  // Dedicated secondary workspaces (Driver App, Operations Center, Recipient Isolated Tracking)
  if (workspace !== 'none') {
    return (
      <div className="min-h-screen bg-[#f8f8f9] flex flex-col">
        {workspace !== 'tracking' && (
          <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-neutral-200 px-4 py-2.5 flex items-center justify-between">
            <button
              type="button"
              onClick={returnToMainApp}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-950 hover:text-white text-xs font-semibold text-neutral-900 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('Retour à ROVA', 'Back to ROVA')}
            </button>
            <span className="text-xs font-medium text-neutral-500">
              {workspace === 'driver'
                ? t('Application Livreur', 'Driver App')
                : t('Centre d’Opérations', 'Operations Center')}
            </span>
          </div>
        )}

        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center py-20 text-xs text-neutral-500">
              {t('Chargement de l’interface...', 'Loading interface...')}
            </div>
          }
        >
          {workspace === 'driver' && <DriverWorkspace onRequestSignIn={signInWithGoogle} />}
          {workspace === 'operations' && (
            <OperationsCenter
              onOpenTracking={openPublicTracking}
              onRequestSignIn={signInWithGoogle}
            />
          )}
          {workspace === 'tracking' && (
            <RecipientTrackingPage
              trackingToken={trackingToken}
              onBack={returnToMainApp}
              onLookupToken={openPublicTracking}
            />
          )}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f8f9] text-neutral-950 flex flex-col">
      {authError && (
        <div className="bg-neutral-950 text-white text-xs px-4 py-2.5 text-center">
          {t('Connexion interrompue :', 'Sign-in could not be completed:')} {authError}
        </div>
      )}

      {/* Continuous Animated Main Content Area */}
      <main className="flex-1 pb-28">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === 'home' && <RovaHomeView onNavigateTab={navigateTab} />}
            {activeTab === 'shipments' && (
              <RovaShipmentsView onOpenPublicTracking={openPublicTracking} />
            )}
            {activeTab === 'activity' && <RovaActivityView />}
            {activeTab === 'account' && <RovaAccountView onOpenWorkspace={openWorkspace} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Glassmorphism 4-Tab Bottom Navigation Bar */}
      <FloatingBottomNav
        active={activeTab}
        onSelect={navigateTab}
        activeShipmentsBadge={activeDeliveries.length}
      />

      {/* Contextual Bottom Sheets */}
      <DeliveryComposerSheet />
      <ReservationSheet />
      <ShipmentDetailSheet onOpenPublicTracking={openPublicTracking} />
      <TrackLookupSheet onOpenTracking={openPublicTracking} />
      <SupportSheet />

      {/* Subtle Floating Toast Feedback */}
      <ToastBanner toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

function AppWithStore() {
  const { signInWithGoogle } = useAuth();
  return (
    <RovaAppProvider onSignIn={signInWithGoogle}>
      <RovaApplicationShell />
    </RovaAppProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <LanguageProvider>
          <AuthProvider>
            <AppWithStore />
          </AuthProvider>
        </LanguageProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
