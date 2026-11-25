import React, { createContext, useContext, useEffect, useState } from 'react';
import { Globe } from 'lucide-react';

export type AppLanguage = 'fr' | 'en';

interface LanguageContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  t: (fr: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<AppLanguage>('fr');

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (fr: string, en: string) => (lang === 'fr' ? fr : en);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      lang: 'fr' as AppLanguage,
      setLang: () => {},
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
      className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100 p-0.5 shrink-0"
    >
      {!compact && <Globe className="w-3.5 h-3.5 text-neutral-500 ml-2 mr-1 hidden sm:block" />}
      <button
        type="button"
        onClick={() => setLang('fr')}
        className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
          lang === 'fr'
            ? 'bg-neutral-950 text-white shadow-xs'
            : 'text-neutral-600 hover:text-neutral-950'
        }`}
      >
        Français
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
          lang === 'en'
            ? 'bg-neutral-950 text-white shadow-xs'
            : 'text-neutral-600 hover:text-neutral-950'
        }`}
      >
        English
      </button>
    </div>
  );
}
