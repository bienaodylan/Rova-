import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import type express from 'express';

// Strictly server-side Supabase Admin client for Vercel Serverless Functions & Express.
// SECURITY: SUPABASE_SERVICE_ROLE_KEY is NEVER prefixed with VITE_ and NEVER sent to browsers.

const INVALID_LITERALS = new Set(['undefined', 'null', 'none', 'false', 'true']);

function sanitizeServerEnv(raw: string | undefined): string {
  if (!raw) return '';
  const cleaned = raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!cleaned || INVALID_LITERALS.has(cleaned.toLowerCase())) return '';
  return cleaned;
}

export function getSupabasePublicUrl(): string {
  const url = sanitizeServerEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

export function getSupabasePublicAnonKey(): string {
  const key = sanitizeServerEnv(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  return key.length >= 20 ? key : '';
}

function getSupabaseServiceRoleKey(): string {
  const key = sanitizeServerEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return key.length >= 20 ? key : '';
}

export function isSupabaseServerConfigured(): boolean {
  return Boolean(getSupabasePublicUrl() && getSupabaseServiceRoleKey());
}

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseServerConfigured()) return null;
  if (!cachedAdminClient) {
    cachedAdminClient = createClient(getSupabasePublicUrl(), getSupabaseServiceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return cachedAdminClient;
}

export interface SupabaseAuthRequest extends express.Request {
  supabaseUser?: User;
  isRovaAdmin?: boolean;
}

const BOOTSTRAP_ADMIN_EMAIL = 'bienaodylan428@gmail.com';

export async function checkIsSupabaseAdmin(
  admin: SupabaseClient,
  user: User
): Promise<boolean> {
  if (
    user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL &&
    Boolean(user.email_confirmed_at)
  ) {
    return true;
  }
  const { data } = await admin
    .from('admins')
    .select('uid')
    .eq('uid', user.id)
    .maybeSingle();
  return Boolean(data);
}

export async function requireSupabaseAuth(
  req: SupabaseAuthRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: 'Supabase backend is not configured on this server yet.',
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing Bearer token.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length > 4096) {
    return res.status(401).json({ error: 'Unauthorized: invalid token format.' });
  }

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Unauthorized: invalid or expired session.' });
    }
    req.supabaseUser = data.user;
    req.isRovaAdmin = await checkIsSupabaseAdmin(admin, data.user);
    return next();
  } catch (err) {
    console.error('Supabase JWT verification failed:', err);
    return res.status(401).json({ error: 'Unauthorized: verification failed.' });
  }
}
