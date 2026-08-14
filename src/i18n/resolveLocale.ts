import type { Locale } from "./types";

const SUPPORTED: Locale[] = ["en", "es", "pt-BR"];

/**
 * Map a host preference or browser language tag onto a supported Locale.
 * English is the default fallback.
 */
export function resolveLocale(preferred?: string | null): Locale {
  const candidates: string[] = [];
  if (preferred) candidates.push(preferred);
  if (typeof navigator !== "undefined") {
    if (navigator.language) candidates.push(navigator.language);
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  }
  for (const raw of candidates) {
    const mapped = mapTag(raw);
    if (mapped) return mapped;
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
