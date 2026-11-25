import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Centralized Supabase browser client configuration.
// SECURITY: Only the public project URL (VITE_SUPABASE_URL) and public anon key
// (VITE_SUPABASE_ANON_KEY) may ever exist in client code.
// SUPABASE_SERVICE_ROLE_KEY remains strictly server-side in /server/supabaseAdmin.ts.

const INVALID_LITERALS = new Set(['undefined', 'null', 'none', 'false', 'true']);

function sanitizePublicValue(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!cleaned || INVALID_LITERALS.has(cleaned.toLowerCase())) return '';
  return cleaned;
}

function isValidSupabaseUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.length > 3;
  } catch {
    return false;
  }
}

let runtimeSupabaseUrl = sanitizePublicValue(
  import.meta.env.VITE_SUPABASE_URL as string | undefined
);
let runtimeSupabaseAnonKey = sanitizePublicValue(
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
);

let browserClient: SupabaseClient | null = null;
let hydrationPromise: Promise<boolean> | null = null;

export function isSupabaseConfigured(): boolean {
  return isValidSupabaseUrl(runtimeSupabaseUrl) && runtimeSupabaseAnonKey.length >= 20;
}

/**
 * Hydrates public Supabase URL & anon key from Vercel's runtime endpoint (/api/config/runtime)
 * when build-time VITE_SUPABASE_* variables were not baked into the static bundle.
 * Never exposes or fetches any private server secrets.
 */
export async function hydrateSupabaseConfig(): Promise<boolean> {
  if (isSupabaseConfigured()) return true;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch('/api/config/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        supabaseUrl?: string;
        supabaseAnonKey?: string;
      };
      const url = sanitizePublicValue(data?.supabaseUrl);
      const anon = sanitizePublicValue(data?.supabaseAnonKey);
      if (isValidSupabaseUrl(url) && anon.length >= 20) {
        runtimeSupabaseUrl = url;
        runtimeSupabaseAnonKey = anon;
        browserClient = null;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  })();

  return hydrationPromise;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(runtimeSupabaseUrl, runtimeSupabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
}

/**
 * Authenticated fetch wrapper for ROVA's Vercel Serverless Supabase API routes (/api/v1/*).
 */
export async function supabaseApiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getSupabaseAccessToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && String(payload.error)) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }

  return payload as T;
}
