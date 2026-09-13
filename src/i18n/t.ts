import type { MessageParams } from "./types";
import type { Messages } from "./locales/en";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { ptBR } from "./locales/pt-BR";
import type { Locale } from "./types";

const CATALOGS: Record<Locale, Messages> = {
  en,
  es,
  "pt-BR": ptBR,
};

/** Dot-path into the nested messages object, e.g. `"checkout.payNow"`. */
export type MessageKey = string;

export function getCatalog(locale: Locale): Messages {
  return CATALOGS[locale] ?? en;
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    return v === null || v === undefined ? `{${key}}` : String(v);
  });
}

function lookup(messages: Messages, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = messages;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * Translate `path` for `locale`, falling back to English, then to the path itself.
 */
export function t(
  locale: Locale,
  path: MessageKey,
  params?: MessageParams,
): string {
  const msg =
    lookup(getCatalog(locale), path) ??
    lookup(en, path) ??
    path;
  return interpolate(msg, params);
}

export function createTranslator(locale: Locale) {
  return (path: MessageKey, params?: MessageParams) => t(locale, path, params);
}

export type Translator = ReturnType<typeof createTranslator>;
