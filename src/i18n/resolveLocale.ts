import type { Locale } from "./types";

const SUPPORTED: Locale[] = ["en", "es", "pt-BR"];

/**
 * Map a host preference or browser language tag onto a supported Locale.
 * English is the default fallback.
 *
 * An explicit `preferred` value pins the locale: if it isn't supported we
 * fall back to English rather than handing control back to the browser.
 * `navigator.language` is consulted only when no preference was passed.
 */
export function resolveLocale(preferred?: string | null): Locale {
  if (preferred) {
    return mapTag(preferred) ?? "en";
  }
  if (typeof navigator !== "undefined") {
    const candidates: string[] = [];
    if (navigator.language) candidates.push(navigator.language);
    if (Array.isArray(navigator.languages)) {
      candidates.push(...navigator.languages);
    }
    for (const raw of candidates) {
      const mapped = mapTag(raw);
      if (mapped) return mapped;
    }
  }
  return "en";
}

function mapTag(raw: string): Locale | null {
  const tag = raw.trim().replace(/_/g, "-");
  if (!tag) return null;
  const lower = tag.toLowerCase();
  // Exact / prefix matches against our Locale ids.
  for (const loc of SUPPORTED) {
    if (lower === loc.toLowerCase()) return loc;
  }
  const primary = lower.split("-")[0] ?? "";
  if (primary === "en") return "en";
  if (primary === "es") return "es";
  if (primary === "pt") return "pt-BR";
  return null;
}
