import React, { createContext, useContext, useMemo, useState } from "react";
import en from "./en.json";

export type LocaleCode = "en";
export type Messages = typeof en;

const LOCALES: Record<LocaleCode, Messages> = {
  en,
};

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  messages: Messages;
  availableLocales: readonly LocaleCode[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocale] = useState<LocaleCode>("en");

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      messages: LOCALES[locale],
      availableLocales: Object.keys(LOCALES) as LocaleCode[],
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
