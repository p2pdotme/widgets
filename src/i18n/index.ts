/**
 * Lightweight i18n for @p2pdotme/widgets.
 *
 * Locales: `en` (fallback), `es`, `pt-BR`.
 * Hosts may pass `locale` on each widget; otherwise `navigator.language` is used.
 */
export type { Locale, MessageParams } from "./types";
export { LOCALE_TAG } from "./types";
export { resolveLocale } from "./resolveLocale";
export { t, createTranslator, getCatalog, interpolate } from "./t";
export type { MessageKey, Translator } from "./t";
export { I18nProvider, useI18n, useT, useI18nContext } from "./context";
export type { I18nProviderProps, I18nValue } from "./context";
export { en } from "./locales/en";
export type { Messages } from "./locales/en";
export { translateError } from "./errors";
