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

const SUPABASE_URL = sanitizePublicValue(
  import.meta.env.VITE_SUPABASE_URL as string | undefined
);
const SUPABASE_ANON_KEY = sanitizePublicValue(
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
);

const HAS_VALID_SUPABASE =
  isValidSupabaseUrl(SUPABASE_URL) && SUPABASE_ANON_KEY.length >= 20;

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return HAS_VALID_SUPABASE;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!HAS_VALID_SUPABASE) return null;
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
