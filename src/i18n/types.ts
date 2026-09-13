/** Supported widget locales. English is always the fallback. */
export type Locale = "en" | "es" | "pt-BR";

/** BCP-47 tags used with `Intl` for dates/numbers. */
export const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  es: "es",
  "pt-BR": "pt-BR",
};

export type MessageParams = Record<string, string | number | null | undefined>;
