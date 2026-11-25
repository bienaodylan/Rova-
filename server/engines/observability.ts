import crypto from 'crypto';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  deliveryId?: string;
  eventId?: string;
  offerId?: string;
  courierId?: string;
  cityId?: string;
  quoteId?: string;
  actorUid?: string;
  actorRole?: string;
  component?: string;
  [key: string]: unknown;
}

const REDACTED_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'secret',
  'otp',
  'otpCode',
  'otp_code',
  'pin',
  'signature',
  'apiKey',
  'service_role_key',
]);

function sanitizePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (REDACTED_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizePayload(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createCorrelationId(prefix = 'cor'): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function logOperationalEvent(
  level: LogLevel,
  event: string,
  context: LogContext = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizePayload(context),
  };

  if (process.env.NODE_ENV === 'test' && process.env.ROVA_TEST_LOGS !== '1') {
    return;
  }

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
