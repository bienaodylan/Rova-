import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  MapsFailureCode,
  fetchClientMapsConfig,
  getGoogleMapsFailureCode,
  getGoogleMapsFailureReason,
  getInitialGoogleMapsBrowserKey,
  hasGoogleMapsAuthFailed,
} from '../lib/mapsConfig';

export const GOOGLE_MAPS_LIBRARIES = ['marker', 'places'];

interface MapsContextValue {
  browserApiKey: string;
  googleMapsAvailable: boolean;
  authFailed: boolean;
  failureCode: MapsFailureCode | null;
  failureReason: string;
  configResolved: boolean;
  serverGeocodingEnabled: boolean;
  serverRoutesEnabled: boolean;
}

const MapsContext = createContext<MapsContextValue>({
  browserApiKey: '',
  googleMapsAvailable: false,
  authFailed: false,
  failureCode: null,
  failureReason: '',
  configResolved: false,
  serverGeocodingEnabled: false,
  serverRoutesEnabled: false,
});

export function useMapsRuntime() {
  return useContext(MapsContext);
}

/**
 * Provides Google Maps runtime availability without conditionally wrapping/unwrapping
 * the application tree in <APIProvider>, preventing full-app remounts when runtime config
 * loads asynchronously or when a domain/key error triggers the OpenStreetMap fallback.
 */
export function RovaMapsProvider({ children }: { children: React.ReactNode }) {
  const [browserApiKey, setBrowserApiKey] = useState<string>(() =>
    getInitialGoogleMapsBrowserKey()
  );
  const [configResolved, setConfigResolved] = useState<boolean>(() =>
    Boolean(getInitialGoogleMapsBrowserKey())
  );
  const [serverGeocodingEnabled, setServerGeocodingEnabled] = useState(false);
  const [serverRoutesEnabled, setServerRoutesEnabled] = useState(false);
  const [authFailed, setAuthFailed] = useState<boolean>(() => hasGoogleMapsAuthFailed());
  const [failureCode, setFailureCode] = useState<MapsFailureCode | null>(() =>
    getGoogleMapsFailureCode()
  );
  const [failureReason, setFailureReason] = useState<string>(() =>
    getGoogleMapsFailureReason()
  );

  useEffect(() => {
    let active = true;
    void fetchClientMapsConfig().then((cfg) => {
      if (!active) return;
      if (cfg.browserApiKey) {
        setBrowserApiKey(cfg.browserApiKey);
      }
      setServerGeocodingEnabled(cfg.serverGeocodingEnabled);
      setServerRoutesEnabled(cfg.serverRoutesEnabled);
      setConfigResolved(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onAuthFail = () => {
      setAuthFailed(true);
      setFailureCode(getGoogleMapsFailureCode());
      setFailureReason(getGoogleMapsFailureReason());
    };
    window.addEventListener('gmp-auth-failure', onAuthFail);
    return () => window.removeEventListener('gmp-auth-failure', onAuthFail);
  }, []);

  const googleMapsAvailable = Boolean(browserApiKey) && !authFailed;

  const value = useMemo<MapsContextValue>(
    () => ({
      browserApiKey,
      googleMapsAvailable,
      authFailed,
      failureCode: authFailed
        ? failureCode
        : configResolved && !browserApiKey
        ? 'missing_key'
        : null,
      failureReason,
      configResolved,
      serverGeocodingEnabled,
      serverRoutesEnabled,
    }),
    [
      browserApiKey,
      googleMapsAvailable,
      authFailed,
      failureCode,
      failureReason,
      configResolved,
      serverGeocodingEnabled,
      serverRoutesEnabled,
    ]
  );

  return <MapsContext.Provider value={value}>{children}</MapsContext.Provider>;
}
