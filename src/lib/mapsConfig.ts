// Centralized Google Maps Platform public client configuration & error handling.
// SECURITY: Only the public browser key (VITE_GOOGLE_MAPS_API_KEY) may ever exist here.
// Server-only secrets (GOOGLE_MAPS_SERVER_API_KEY) remain strictly in server.ts.

const PLACEHOLDER_PREFIXES = ['MY_', 'YOUR_', 'REPLACE_', 'INSERT_', 'CHANGE_ME', 'PLACEHOLDER'];

export function isPlausibleApiKey(raw: string | undefined | null, minLength = 16): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (trimmed.length < minLength) return false;
  const upper = trimmed.toUpperCase();
  if (PLACEHOLDER_PREFIXES.some((prefix) => upper.startsWith(prefix))) return false;
  if (/\s/.test(trimmed)) return false;
  return true;
}

const BUILD_TIME_GOOGLE_KEY = (
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
).trim();

const BUILD_TIME_GEOAPIFY_KEY = (
  (import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined) || ''
).trim();

export function getInitialGoogleMapsBrowserKey(): string {
  return isPlausibleApiKey(BUILD_TIME_GOOGLE_KEY, 20) ? BUILD_TIME_GOOGLE_KEY : '';
}

export function getValidGeoapifyKey(): string {
  return isPlausibleApiKey(BUILD_TIME_GEOAPIFY_KEY, 20) ? BUILD_TIME_GEOAPIFY_KEY : '';
}

export interface ClientMapsRuntimeConfig {
  browserApiKey: string;
  serverGeocodingEnabled: boolean;
  serverRoutesEnabled: boolean;
}

let cachedRuntimeConfig: ClientMapsRuntimeConfig | null = null;
let runtimeFetchPromise: Promise<ClientMapsRuntimeConfig> | null = null;

export async function fetchClientMapsConfig(): Promise<ClientMapsRuntimeConfig> {
  if (cachedRuntimeConfig) return cachedRuntimeConfig;
  if (runtimeFetchPromise) return runtimeFetchPromise;

  runtimeFetchPromise = fetch('/api/maps/client-config')
    .then(async (res) => {
      if (!res.ok) throw new Error('Maps config unavailable');
      const data = (await res.json()) as Partial<ClientMapsRuntimeConfig>;
      const runtimeKey = isPlausibleApiKey(data.browserApiKey, 20)
        ? data.browserApiKey!.trim()
        : getInitialGoogleMapsBrowserKey();
      const resolved: ClientMapsRuntimeConfig = {
        browserApiKey: runtimeKey,
        serverGeocodingEnabled: Boolean(data.serverGeocodingEnabled),
        serverRoutesEnabled: Boolean(data.serverRoutesEnabled),
      };
      cachedRuntimeConfig = resolved;
      return resolved;
    })
    .catch(() => {
      const fallback: ClientMapsRuntimeConfig = {
        browserApiKey: getInitialGoogleMapsBrowserKey(),
        serverGeocodingEnabled: false,
        serverRoutesEnabled: false,
      };
      cachedRuntimeConfig = fallback;
      return fallback;
    });

  return runtimeFetchPromise;
}

// Tracks whether Google Maps JS SDK threw an auth/key/referrer error at runtime
// so all RovaMap instances can immediately fall back to CartoDB/Leaflet without showing "API key required".
let globalGoogleMapsAuthFailed = false;

export function hasGoogleMapsAuthFailed(): boolean {
  return globalGoogleMapsAuthFailed;
}

export function markGoogleMapsAuthFailed(reason?: string): void {
  if (globalGoogleMapsAuthFailed) return;
  globalGoogleMapsAuthFailed = true;
  if (reason) {
    console.warn('[ROVA Maps] Switching to OpenStreetMap fallback:', reason);
  }
  window.dispatchEvent(new CustomEvent('gmp-auth-failure', { detail: { reason } }));
}
