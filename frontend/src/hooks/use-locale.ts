import { createContext, useContext } from "react";

export type Locale = "en" | "id";

export const LOCALES = ["en", "id"] as const;

export type LocaleContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

export const LocaleContext = createContext<LocaleContextType | null>(null);

export function useLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used inside I18nProvider");
  }

  return context;
}
