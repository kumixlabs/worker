import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { IntlProvider } from "use-intl";

import { Toaster as Sonner, TooltipProvider } from "@kumix/ui";
import { DEFAULT_THEME_MODE, THEME_MODES } from "@kumix/utils";
import { LOCALES, type Locale, LocaleContext, type LocaleContextType } from "@/hooks/use-locale";
import en from "../../messages/en.json";
import id from "../../messages/id.json";
import { AuthGate } from "./AuthGate";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider messages={{ en, id }}>
      <ThemeProvider>
        <AuthGate isHome={window.location.pathname === "/"}>
          {/* Main Content */}
          <Suspense>{children}</Suspense>

          {/* Toasts */}
          <Sonner position="top-center" />
        </AuthGate>
      </ThemeProvider>
    </I18nProvider>
  );
}

function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME_MODE}
      enableSystem
      disableTransitionOnChange
      enableColorScheme
      storageKey="theme"
      themes={[THEME_MODES.LIGHT, THEME_MODES.DARK, THEME_MODES.SYSTEM]}
    >
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    </NextThemesProvider>
  );
}

const LOCALE_STORAGE_KEY = "locale";
const DEFAULT_LOCALE: Locale = "en";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function I18nProvider<TMessages extends Record<Locale, Record<string, unknown>>>({
  children,
  messages,
  defaultLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  messages: TMessages;
  defaultLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = readInitialLocale();
    return messages[stored] ? stored : defaultLocale;
  });

  // Persist locale changes; tolerate quota / privacy-mode failures.
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      document.documentElement.lang = locale;
    } catch {
      // ignore
    }
  }, [locale]);

  const value = useMemo<LocaleContextType>(
    () => ({
      locale,
      setLocale: (val: Locale) => {
        if (!messages[val]) return;
        setLocaleState(val);
      },
    }),
    [locale, messages],
  );

  // Fall back to default locale's messages if the active locale is missing.
  const activeMessages = messages[locale] ?? messages[defaultLocale];

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={locale} messages={activeMessages}>
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
