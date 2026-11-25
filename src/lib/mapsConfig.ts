// Centralized Google Maps Platform public client configuration & error handling.
// SECURITY: Only the public browser key (VITE_GOOGLE_MAPS_API_KEY) may ever exist here.
// Server-only secrets (GOOGLE_MAPS_SERVER_API_KEY) remain strictly on the backend.

const PLACEHOLDER_PREFIXES = [
  'MY_',
  'YOUR_',
  'REPLACE_',
  'INSERT_',
  'CHANGE_ME',
  'PLACEHOLDER',
  'EXAMPLE',
  'TEST_',
];

const INVALID_LITERALS = new Set(['undefined', 'null', 'none', 'false', 'true']);

export type MapsFailureCode =
  | 'referer_not_allowed'
  | 'invalid_key'
  | 'api_not_activated'
  | 'billing_not_enabled'
  | 'missing_key'
  | 'script_load_failed'
  | 'auth_failure';

/**
 * Normalizes an API key coming from Vite build-time env vars or runtime JSON config.
 * Strips accidental wrapping single/double quotes and surrounding whitespace/newlines
 * (a common pitfall when pasting keys into Vercel Environment Variables).
 */
export function sanitizeApiKey(raw: string | undefined | null, minLength = 20): string {
  if (!raw || typeof raw !== 'string') return '';
  const unquoted = raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (unquoted.length < minLength) return '';
  if (INVALID_LITERALS.has(unquoted.toLowerCase())) return '';
  const upper = unquoted.toUpperCase();
  if (PLACEHOLDER_PREFIXES.some((prefix) => upper.startsWith(prefix))) return '';
  if (!/^[A-Za-z0-9_.-]+$/.test(unquoted)) return '';
  return unquoted;
}

export function isPlausibleApiKey(raw: string | undefined | null, minLength = 16): boolean {
  return Boolean(sanitizeApiKey(raw, minLength));
}

const BUILD_TIME_GOOGLE_KEY = sanitizeApiKey(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
  20
);

const BUILD_TIME_GEOAPIFY_KEY = sanitizeApiKey(
  import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined,
  20
);

export function getInitialGoogleMapsBrowserKey(): string {
  return BUILD_TIME_GOOGLE_KEY;
}

export function getValidGeoapifyKey(): string {
  return BUILD_TIME_GEOAPIFY_KEY;
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

  runtimeFetchPromise = fetch('/api/maps/client-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
    .then(async (res) => {
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`Maps config unavailable (${res.status})`);
      }
      const data = (await res.json()) as Partial<ClientMapsRuntimeConfig>;
      const runtimeKey =
        sanitizeApiKey(data.browserApiKey, 20) || getInitialGoogleMapsBrowserKey();
      const resolved: ClientMapsRuntimeConfig = {
        browserApiKey: runtimeKey,
        serverGeocodingEnabled: Boolean(data.serverGeocodingEnabled),
        serverRoutesEnabled: Boolean(data.serverRoutesEnabled),
      };
      cachedRuntimeConfig = resolved;
      return resolved;
    })
    .catch(() => {
      // Clear in-flight promise so a transient cold-start error isn't cached forever
      runtimeFetchPromise = null;
      return {
        browserApiKey: getInitialGoogleMapsBrowserKey(),
        serverGeocodingEnabled: false,
        serverRoutesEnabled: false,
      };
    });

  return runtimeFetchPromise;
}

export function classifyGoogleMapsError(reason?: string): MapsFailureCode {
  const msg = (reason || '').toLowerCase();
  if (msg.includes('referernotallowed') || msg.includes('referrer')) {
    return 'referer_not_allowed';
  }
  if (msg.includes('invalidkey')) {
    return 'invalid_key';
  }
  if (msg.includes('apinotactivated') || msg.includes('not activated')) {
    return 'api_not_activated';
  }
  if (msg.includes('billingnotenabled') || msg.includes('billing')) {
    return 'billing_not_enabled';
  }
  if (msg.includes('missingkey') || msg.includes('noapikeys')) {
    return 'missing_key';
  }
  if (msg.includes('script') || msg.includes('failed') || msg.includes('network')) {
    return 'script_load_failed';
  }
  return 'auth_failure';
}

// Tracks whether Google Maps JS SDK threw an auth/key/referrer error at runtime
// so all RovaMap instances can immediately fall back to CartoDB/Leaflet without showing "API key required".
let globalGoogleMapsAuthFailed = false;
let globalGoogleMapsFailureCode: MapsFailureCode | null = null;
let globalGoogleMapsFailureReason = '';

export function hasGoogleMapsAuthFailed(): boolean {
  return globalGoogleMapsAuthFailed;
}

export function getGoogleMapsFailureCode(): MapsFailureCode | null {
  return globalGoogleMapsFailureCode;
}

export function getGoogleMapsFailureReason(): string {
  return globalGoogleMapsFailureReason;
}

export function markGoogleMapsAuthFailed(reason?: string): void {
  const nextCode = classifyGoogleMapsError(reason);
  // Allow upgrading a generic 'auth_failure' (e.g. gm_authFailure) with a more specific
  // console error code (e.g. 'referer_not_allowed' or 'api_not_activated')
  if (
    globalGoogleMapsAuthFailed &&
    (globalGoogleMapsFailureCode !== 'auth_failure' || nextCode === 'auth_failure')
  ) {
    return;
  }
  globalGoogleMapsAuthFailed = true;
  globalGoogleMapsFailureCode = nextCode;
  globalGoogleMapsFailureReason = reason || nextCode;
  if (reason) {
    console.warn('[ROVA Maps] Switching to OpenStreetMap fallback:', nextCode);
  }
  window.dispatchEvent(
    new CustomEvent('gmp-auth-failure', {
      detail: { code: nextCode, reason: globalGoogleMapsFailureReason },
    })
  );
}
