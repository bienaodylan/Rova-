import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';

export type AppLanguage = 'fr' | 'en';
export type AppCurrency =
  | 'GHS'
  | 'GBP'
  | 'XOF'
  | 'XAF'
  | 'EUR'
  | 'USD'
  | 'NGN'
  | 'CAD'
  | 'ZAR'
  | 'KES'
  | 'CHF'
  | 'AUD'
  | 'JPY'
  | 'CNY'
  | 'AED'
  | 'INR'
  | 'MAD'
  | 'TZS'
  | 'UGX';

export interface RegionProfile {
  countryCode: string;
  countryName: string;
  currency: AppCurrency;
  city: string;
  lat: number;
  lng: number;
  source: 'edge_header' | 'ip_geo' | 'timezone' | 'accept_language' | 'default';
  detected: boolean;
}

const VALID_CURRENCIES: AppCurrency[] = [
  'GHS',
  'GBP',
  'XOF',
  'XAF',
  'EUR',
  'USD',
  'NGN',
  'CAD',
  'ZAR',
  'KES',
  'CHF',
  'AUD',
  'JPY',
  'CNY',
  'AED',
  'INR',
  'MAD',
  'TZS',
  'UGX',
];

const DEFAULT_REGION: RegionProfile = {
  countryCode: 'CI',
  countryName: 'Côte d’Ivoire',
  currency: 'XOF',
  city: 'Abidjan',
  lat: 5.3235,
  lng: -4.0267,
  source: 'default',
  detected: false,
};

interface LanguageContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  currency: AppCurrency;
  setCurrency: (next: AppCurrency) => void;
  region: RegionProfile;
  refreshAutoRegion: () => Promise<void>;
  formatLocalMoney: (amount: number, sourceCurrency?: string) => string;
  t: (fr: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Pure French default unless the user explicitly chose English in settings
  const [lang, setLangState] = useState<AppLanguage>(() => {
    try {
      return localStorage.getItem('rova-language') === 'en' ? 'en' : 'fr';
    } catch {
      return 'fr';
    }
  });

  const [currency, setCurrencyState] = useState<AppCurrency>(() => {
    try {
      const saved = localStorage.getItem('rova-currency') as AppCurrency | null;
      return saved && VALID_CURRENCIES.includes(saved) ? saved : 'XOF';
    } catch {
      return 'XOF';
    }
  });

  const [region, setRegion] = useState<RegionProfile>(() => {
    try {
      const cached = localStorage.getItem('rova-region-cache');
      if (cached) {
        const parsed = JSON.parse(cached) as RegionProfile;
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number' && parsed.countryCode) {
          return parsed;
        }
      }
    } catch {
      // Ignore cache parse issues
    }
    return DEFAULT_REGION;
  });

  const [rates, setRates] = useState<Record<string, number>>({ XOF: 1, GHS: 1 });

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
    try {
      localStorage.setItem('rova-language', next);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const setCurrency = useCallback((next: AppCurrency) => {
    setCurrencyState(next);
    try {
      localStorage.setItem('rova-currency', next);
      localStorage.setItem('rova-currency-manual', '1');
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Automatic, silent backend regional detection (edge headers + IP geo + timezone + Accept-Language)
  const detectFromBackend = useCallback(async (forceCurrencySync = false) => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const query = tz ? `?tz=${encodeURIComponent(tz)}` : '';
      const response = await fetch(`/api/region/detect${query}`);
      if (!response.ok) return;

      const data = (await response.json()) as Partial<RegionProfile>;
      const resolvedCurrency: AppCurrency =
        data.currency && VALID_CURRENCIES.includes(data.currency as AppCurrency)
          ? (data.currency as AppCurrency)
          : DEFAULT_REGION.currency;

      const resolvedRegion: RegionProfile = {
        countryCode: typeof data.countryCode === 'string' && data.countryCode ? data.countryCode : DEFAULT_REGION.countryCode,
        countryName: typeof data.countryName === 'string' && data.countryName ? data.countryName : DEFAULT_REGION.countryName,
        currency: resolvedCurrency,
        city: typeof data.city === 'string' && data.city ? data.city : DEFAULT_REGION.city,
        lat: typeof data.lat === 'number' && Number.isFinite(data.lat) ? data.lat : DEFAULT_REGION.lat,
        lng: typeof data.lng === 'number' && Number.isFinite(data.lng) ? data.lng : DEFAULT_REGION.lng,
        source: data.source || 'default',
        detected: true,
      };

      setRegion(resolvedRegion);
      try {
        localStorage.setItem('rova-region-cache', JSON.stringify(resolvedRegion));
      } catch {
        // Ignore storage errors
      }

      let hasManualCurrency = false;
      try {
        hasManualCurrency = localStorage.getItem('rova-currency-manual') === '1';
      } catch {
        // Ignore
      }

      if (forceCurrencySync || !hasManualCurrency) {
        setCurrencyState(resolvedCurrency);
        try {
          localStorage.setItem('rova-currency', resolvedCurrency);
          if (forceCurrencySync) {
            localStorage.removeItem('rova-currency-manual');
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Keep cached or default region seamlessly
    }
  }, []);

  useEffect(() => {
    void detectFromBackend(false);
  }, [detectFromBackend]);

  const refreshAutoRegion = useCallback(async () => {
    await detectFromBackend(true);
  }, [detectFromBackend]);

  // Live exchange rates relative to active regional currency
  useEffect(() => {
    let cancelled = false;
    setRates({ [currency]: 1 });
    fetch(`https://open.er-api.com/v6/latest/${currency}`)
      .then((response) => {
        if (!response.ok) throw new Error('Exchange-rate service unavailable');
        return response.json();
      })
      .then((data: { result?: string; rates?: Record<string, number> }) => {
        if (!cancelled && data.result === 'success' && data.rates) {
          setRates({ [currency]: 1, ...data.rates });
        }
      })
      .catch(() => {
        // Keep source-currency display if live rates are unavailable
      });
    return () => {
      cancelled = true;
    };
  }, [currency]);

  const formatLocalMoney = useCallback(
    (amount: number, sourceCurrency = 'GHS') => {
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const sourceRate = rates[sourceCurrency];
      const converted =
        sourceCurrency === currency
          ? safeAmount
          : typeof sourceRate === 'number' && sourceRate > 0
          ? safeAmount / sourceRate
          : safeAmount;
      const displayCurrency =
        sourceCurrency !== currency && typeof sourceRate !== 'number' ? sourceCurrency : currency;
      const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: displayCurrency,
          maximumFractionDigits: displayCurrency === 'XOF' || displayCurrency === 'XAF' || displayCurrency === 'JPY' ? 0 : 2,
        }).format(converted);
      } catch {
        return `${displayCurrency} ${converted.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
      }
    },
    [currency, lang, rates]
  );

  const t = useCallback((fr: string, en: string) => (lang === 'fr' ? fr : en), [lang]);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      currency,
      setCurrency,
      region,
      refreshAutoRegion,
      formatLocalMoney,
      t,
    }),
    [lang, setLang, currency, setCurrency, region, refreshAutoRegion, formatLocalMoney, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      lang: 'fr' as AppLanguage,
      setLang: (_next: AppLanguage) => {},
      currency: 'XOF' as AppCurrency,
      setCurrency: (_next: AppCurrency) => {},
      region: DEFAULT_REGION,
      refreshAutoRegion: async () => {},
      formatLocalMoney: (amount: number, sourceCurrency = 'XOF') =>
        `${sourceCurrency} ${amount.toLocaleString()}`,
      t: (fr: string) => fr,
    };
  }
  return ctx;
}

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLanguage();

  return (
    <div
      role="group"
      aria-label="Sélection de la langue"
      className="inline-flex shrink-0 items-center rounded-full border border-neutral-200 bg-neutral-100 p-0.5"
    >
      {!compact && <Globe className="ml-2 mr-1 hidden h-3.5 w-3.5 text-neutral-500 sm:block" />}
      <button
        type="button"
        onClick={() => setLang('fr')}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
          lang === 'fr' ? 'bg-neutral-950 text-white shadow-xs' : 'text-neutral-600 hover:text-neutral-950'
        }`}
      >
        Français
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
          lang === 'en' ? 'bg-neutral-950 text-white shadow-xs' : 'text-neutral-600 hover:text-neutral-950'
        }`}
      >
        English
      </button>
    </div>
  );
}
