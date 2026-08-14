import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { resolveLocale } from "./resolveLocale";
import { createTranslator, type Translator } from "./t";
import type { Locale } from "./types";
import { LOCALE_TAG } from "./types";

export interface I18nValue {
  locale: Locale;
  /** BCP-47 tag for Intl formatters. */
  localeTag: string;
  t: Translator;
}

const I18nContext = createContext<I18nValue | null>(null);

export interface I18nProviderProps {
  /** Raw preference (`"pt-BR"`, `"es-MX"`, …). Resolved via `resolveLocale`. */
  locale?: string | null;
  children: ReactNode;
}

export function I18nProvider({ locale: preferred, children }: I18nProviderProps) {
  const value = useMemo<I18nValue>(() => {
    const locale = resolveLocale(preferred);
    return {
      locale,
      localeTag: LOCALE_TAG[locale],
      t: createTranslator(locale),
    };
  }, [preferred]);

  return createElement(I18nContext.Provider, { value }, children);
}

/** Read the nearest I18nProvider. Falls back to English when absent. */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  return useMemo(() => {
    if (ctx) return ctx;
    const locale = resolveLocale(null);
    return {
      locale,
      localeTag: LOCALE_TAG[locale],
      t: createTranslator(locale),
    };
  }, [ctx]);
}

export function useT(): Translator {
  return useI18n().t;
}

/** Nearest provider value, or `null` when no `I18nProvider` is mounted. */
export function useI18nContext(): I18nValue | null {
  return useContext(I18nContext);
}
