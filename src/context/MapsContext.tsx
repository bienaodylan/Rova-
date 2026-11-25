import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useLanguage } from './LanguageContext';
import {
  fetchClientMapsConfig,
  getInitialGoogleMapsBrowserKey,
  hasGoogleMapsAuthFailed,
} from '../lib/mapsConfig';

interface MapsContextValue {
  browserApiKey: string;
  googleMapsAvailable: boolean;
  authFailed: boolean;
  serverGeocodingEnabled: boolean;
  serverRoutesEnabled: boolean;
}

const MapsContext = createContext<MapsContextValue>({
  browserApiKey: '',
  googleMapsAvailable: false,
  authFailed: false,
  serverGeocodingEnabled: false,
  serverRoutesEnabled: false,
});

export function useMapsRuntime() {
  return useContext(MapsContext);
}

export function RovaMapsProvider({ children }: { children: React.ReactNode }) {
  const { lang, region } = useLanguage();
  const [browserApiKey, setBrowserApiKey] = useState<string>(() =>
    getInitialGoogleMapsBrowserKey()
  );
  const [serverGeocodingEnabled, setServerGeocodingEnabled] = useState(false);
  const [serverRoutesEnabled, setServerRoutesEnabled] = useState(false);
  const [authFailed, setAuthFailed] = useState<boolean>(() => hasGoogleMapsAuthFailed());

  useEffect(() => {
    let active = true;
    void fetchClientMapsConfig().then((cfg) => {
      if (!active) return;
      if (cfg.browserApiKey) {
        setBrowserApiKey(cfg.browserApiKey);
      }
      setServerGeocodingEnabled(cfg.serverGeocodingEnabled);
      setServerRoutesEnabled(cfg.serverRoutesEnabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onAuthFail = () => setAuthFailed(true);
    window.addEventListener('gmp-auth-failure', onAuthFail);
    return () => window.removeEventListener('gmp-auth-failure', onAuthFail);
  }, []);

  const googleMapsAvailable = Boolean(browserApiKey) && !authFailed;

  const value = useMemo<MapsContextValue>(
    () => ({
      browserApiKey,
      googleMapsAvailable,
      authFailed,
      serverGeocodingEnabled,
      serverRoutesEnabled,
    }),
    [browserApiKey, googleMapsAvailable, authFailed, serverGeocodingEnabled, serverRoutesEnabled]
  );

  if (!googleMapsAvailable) {
    return <MapsContext.Provider value={value}>{children}</MapsContext.Provider>;
  }

  return (
    <MapsContext.Provider value={value}>
      <APIProvider
        apiKey={browserApiKey}
        language={lang}
        region={region.countryCode}
        libraries={['marker', 'places']}
      >
        {children}
      </APIProvider>
    </MapsContext.Provider>
  );
}
