import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Globe, MapPin, X } from 'lucide-react';

export type AppLanguage = 'fr' | 'en';
export type AppCurrency = 'GHS' | 'GBP' | 'XOF' | 'EUR' | 'USD' | 'NGN' | 'CAD' | 'ZAR' | 'KES' | 'CHF' | 'AUD' | 'JPY' | 'CNY' | 'AED' | 'INR' | 'MAD' | 'TZS' | 'UGX';

interface LanguageContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  currency: AppCurrency;
  setCurrency: (next: AppCurrency) => void;
  formatLocalMoney: (amount: number, sourceCurrency?: string) => string;
  t: (fr: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const COUNTRY_SETTINGS: Record<string, { lang: AppLanguage; currency: AppCurrency; name: string }> = {
  GH: { lang: 'en', currency: 'GHS', name: 'Ghana' },
  GB: { lang: 'en', currency: 'GBP', name: 'United Kingdom' },
  CI: { lang: 'fr', currency: 'XOF', name: 'Côte d’Ivoire' },
  SN: { lang: 'fr', currency: 'XOF', name: 'Sénégal' },
  ML: { lang: 'fr', currency: 'XOF', name: 'Mali' },
  BF: { lang: 'fr', currency: 'XOF', name: 'Burkina Faso' },
  BJ: { lang: 'fr', currency: 'XOF', name: 'Bénin' },
  TG: { lang: 'fr', currency: 'XOF', name: 'Togo' },
  NE: { lang: 'fr', currency: 'XOF', name: 'Niger' },
  FR: { lang: 'fr', currency: 'EUR', name: 'France' },
  BE: { lang: 'fr', currency: 'EUR', name: 'Belgium' },
  CH: { lang: 'fr', currency: 'CHF', name: 'Switzerland' },
  US: { lang: 'en', currency: 'USD', name: 'United States' },
  CA: { lang: 'en', currency: 'CAD', name: 'Canada' },
  NG: { lang: 'en', currency: 'NGN', name: 'Nigeria' },
  ZA: { lang: 'en', currency: 'ZAR', name: 'South Africa' },
  KE: { lang: 'en', currency: 'KES', name: 'Kenya' },
  AU: { lang: 'en', currency: 'AUD', name: 'Australia' },
  JP: { lang: 'en', currency: 'JPY', name: 'Japan' },
  CN: { lang: 'en', currency: 'CNY', name: 'China' },
  AE: { lang: 'en', currency: 'AED', name: 'United Arab Emirates' },
  IN: { lang: 'en', currency: 'INR', name: 'India' },
  MA: { lang: 'fr', currency: 'MAD', name: 'Maroc' },
  TZ: { lang: 'en', currency: 'TZS', name: 'Tanzania' },
  UG: { lang: 'en', currency: 'UGX', name: 'Uganda' },
};

interface LocaleSuggestion {
  countryCode: string;
  countryName: string;
  lang: AppLanguage;
  currency: AppCurrency;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<AppLanguage>(() => {
    try { return localStorage.getItem('rova-language') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; }
  });
  const [currency, setCurrency] = useState<AppCurrency>(() => {
    try {
      const saved = localStorage.getItem('rova-currency');
      return saved && ['GHS', 'GBP', 'XOF', 'EUR', 'USD', 'NGN', 'CAD', 'ZAR', 'KES', 'CHF', 'AUD', 'JPY', 'CNY', 'AED', 'INR', 'MAD', 'TZS', 'UGX'].includes(saved)
        ? saved as AppCurrency : 'GHS';
    } catch { return 'GHS'; }
  });
  const [suggestion, setSuggestion] = useState<LocaleSuggestion | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({ GHS: 1 });

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem('rova-language', lang); } catch { /* storage may be unavailable */ }
  }, [lang]);

  useEffect(() => {
    try { localStorage.setItem('rova-currency', currency); } catch { /* storage may be unavailable */ }
  }, [currency]);

  // Rates are fetched with the visitor's selected currency as the base. This lets us convert
  // any stored quote currency to the visitor's currency without changing the amount in Firestore.
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
      .catch(() => { /* Keep source-currency display if live rates are unavailable. */ });
    return () => { cancelled = true; };
  }, [currency]);

  const formatLocalMoney = (amount: number, sourceCurrency = 'GHS') => {
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const sourceRate = rates[sourceCurrency];
    const converted = sourceCurrency === currency
      ? safeAmount
      : typeof sourceRate === 'number' && sourceRate > 0
        ? safeAmount / sourceRate
        : safeAmount;
    const displayCurrency = sourceCurrency !== currency && typeof sourceRate !== 'number'
      ? sourceCurrency
      : currency;
    const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: displayCurrency,
        maximumFractionDigits: displayCurrency === 'XOF' ? 0 : 2,
      }).format(converted);
    } catch {
      return `${displayCurrency} ${converted.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    }
  };

  const detectRegion = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const response = await fetch(`/api/geo/reverse?lat=${encodeURIComponent(coords.latitude)}&lng=${encodeURIComponent(coords.longitude)}`);
        if (!response.ok) throw new Error('Could not detect country');
        const place = await response.json() as { countryCode?: string; country?: string };
        const code = (place.countryCode || '').toUpperCase();
        const settings = COUNTRY_SETTINGS[code];
        try { localStorage.setItem('rova-locale-prompted', '1'); } catch { /* ignore */ }
        if (settings && (settings.lang !== lang || settings.currency !== currency)) {
          setSuggestion({ countryCode: code, countryName: settings.name || place.country || code, ...settings });
        }
      } catch {
        // Keep the action available so the visitor can retry after a temporary lookup failure.
      } finally {
        setDetecting(false);
      }
    }, () => {
      setDetecting(false);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    setLang(suggestion.lang);
    setCurrency(suggestion.currency);
    setSuggestion(null);
  };

  const t = (fr: string, en: string) => (lang === 'fr' ? fr : en);
  const value = useMemo(() => ({ lang, setLang, currency, setCurrency, formatLocalMoney, t }), [lang, currency, rates]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
      <div className="fixed bottom-24 right-4 z-[100] max-w-[calc(100vw-2rem)]">
        {!suggestion && (() => {
          let alreadyPrompted = false;
          try { alreadyPrompted = localStorage.getItem('rova-locale-prompted') === '1'; } catch { /* ignore */ }
          if (alreadyPrompted) return null;
          return (
            <button
              type="button"
              onClick={detectRegion}
              disabled={detecting}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3.5 py-2.5 text-xs font-semibold text-neutral-800 shadow-lg backdrop-blur transition hover:bg-neutral-50 disabled:opacity-60"
            >
              <MapPin className="h-3.5 w-3.5" />
              {detecting ? t('Détection de votre région…', 'Detecting your region…') : t('Adapter à ma région', 'Set my region')}
            </button>
          );
        })()}
        {suggestion && (
          <div role="dialog" aria-modal="false" aria-label={t('Préférences régionales', 'Regional preferences')} className="w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100"><Globe className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-semibold text-neutral-950">{t('Région détectée', 'Location detected')}</p>
                  <p className="text-xs text-neutral-500">{suggestion.countryName}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSuggestion(null)} aria-label={t('Fermer', 'Close')} className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-3 text-sm text-neutral-700">
              {t('Souhaitez-vous utiliser', 'Would you like to use')} {suggestion.lang === 'fr' ? 'le français' : 'English'} · {suggestion.currency} ?
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={acceptSuggestion} className="flex-1 rounded-full bg-neutral-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800">
                {t('Appliquer', 'Apply')}
              </button>
              <button type="button" onClick={() => setSuggestion(null)} className="rounded-full bg-neutral-100 px-4 py-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200">
                {t('Garder mes réglages', 'Keep my settings')}
              </button>
            </div>
          </div>
        )}
      </div>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      lang: 'fr' as AppLanguage,
      setLang: (_next: AppLanguage) => {},
      currency: 'GHS' as AppCurrency,
      setCurrency: (_next: AppCurrency) => {},
      formatLocalMoney: (amount: number, sourceCurrency = 'GHS') => `${sourceCurrency} ${amount.toLocaleString()}`,
      t: (fr: string) => fr,
    };
  }
  return ctx;
}

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLanguage();

  return (
    <div role="group" aria-label="Sélection de la langue" className="inline-flex shrink-0 items-center rounded-full border border-neutral-200 bg-neutral-100 p-0.5">
      {!compact && <Globe className="ml-2 mr-1 hidden h-3.5 w-3.5 text-neutral-500 sm:block" />}
      <button type="button" onClick={() => setLang('fr')} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${lang === 'fr' ? 'bg-neutral-950 text-white shadow-xs' : 'text-neutral-600 hover:text-neutral-950'}`}>Français</button>
      <button type="button" onClick={() => setLang('en')} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${lang === 'en' ? 'bg-neutral-950 text-white shadow-xs' : 'text-neutral-600 hover:text-neutral-950'}`}>English</button>
    </div>
  );
}
