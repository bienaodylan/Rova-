import { UserRole } from '../../types/rova';

export type AccountSectionId =
  | 'profile'
  | 'addresses'
  | 'payments'
  | 'preferences'
  | 'notifications'
  | 'security'
  | 'support'
  | 'legal';

export type AccountRoleKind = 'client' | 'merchant' | 'driver';

export type AddressCategory = 'home' | 'office' | 'other';

export interface AccountLocalPrefs {
  notifDeliveries: boolean;
  notifOrders: boolean;
  notifPayments: boolean;
  notifMarketing: boolean;
  commOperationalSummary: boolean;
  commProductUpdates: boolean;
}

export const DEFAULT_ACCOUNT_PREFS: AccountLocalPrefs = {
  notifDeliveries: true,
  notifOrders: true,
  notifPayments: true,
  notifMarketing: false,
  commOperationalSummary: true,
  commProductUpdates: false,
};

export function resolveAccountRoleKind(role?: UserRole): AccountRoleKind {
  if (!role || role === 'recipient') return 'client';
  if (
    role === 'independent_driver' ||
    role === 'rova_driver' ||
    role === 'fleet_partner' ||
    role === 'fleet_manager'
  ) {
    return 'driver';
  }
  return 'merchant';
}

export function getRoleDisplayLabel(role: UserRole | undefined, lang: 'fr' | 'en'): string {
  const kind = resolveAccountRoleKind(role);
  if (kind === 'driver') return lang === 'fr' ? 'Livreur' : 'Driver';
  if (kind === 'merchant') return lang === 'fr' ? 'Commerçant' : 'Merchant';
  return lang === 'fr' ? 'Client' : 'Customer';
}

export function splitFullName(displayName: string): { firstName: string; lastName: string } {
  const clean = displayName.trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: '', lastName: '' };
  const parts = clean.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function combineFullName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').slice(0, 120);
}

const TAG_REGEX = /^\[(Domicile|Bureau|Autre|Home|Office|Other)\]\s*/i;

export function parseAddressTag(landmark?: string): { category: AddressCategory; cleanLandmark: string } {
  const raw = (landmark || '').trim();
  const match = raw.match(TAG_REGEX);
  if (!match) return { category: 'other', cleanLandmark: raw };
  const tag = match[1].toLowerCase();
  const cleanLandmark = raw.slice(match[0].length).trim();
  if (tag === 'domicile' || tag === 'home') return { category: 'home', cleanLandmark };
  if (tag === 'bureau' || tag === 'office') return { category: 'office', cleanLandmark };
  return { category: 'other', cleanLandmark };
}

export function formatLandmarkWithTag(category: AddressCategory, landmark: string): string {
  const clean = landmark.trim().replace(TAG_REGEX, '').trim();
  const tagLabel = category === 'home' ? 'Domicile' : category === 'office' ? 'Bureau' : 'Autre';
  return clean ? `[${tagLabel}] ${clean}` : `[${tagLabel}]`;
}

export function formatExactCurrency(amount: number, currencyCode: string, lang: 'fr' | 'en'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const code = (currencyCode || 'XOF').toUpperCase();
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: code === 'XOF' || code === 'XAF' || code === 'JPY' ? 0 : 2,
    }).format(safe);
  } catch {
    return `${code} ${safe.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  }
}

export function loadAccountPrefs(uid: string): AccountLocalPrefs {
  if (!uid) return DEFAULT_ACCOUNT_PREFS;
  try {
    const raw = localStorage.getItem(`rova-account-prefs:${uid}`);
    if (!raw) return DEFAULT_ACCOUNT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AccountLocalPrefs>;
    return { ...DEFAULT_ACCOUNT_PREFS, ...parsed };
  } catch {
    return DEFAULT_ACCOUNT_PREFS;
  }
}

export function saveAccountPrefs(uid: string, prefs: AccountLocalPrefs): void {
  if (!uid) return;
  try {
    localStorage.setItem(`rova-account-prefs:${uid}`, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}
