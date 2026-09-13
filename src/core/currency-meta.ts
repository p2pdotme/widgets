import {
  COUNTRY_OPTIONS,
  PAYMENT_ID_FIELDS,
  type CountryOption,
} from "@p2pdotme/sdk/country";
import type { CurrencyOption } from "../types";
import { t } from "../i18n/t";
import { resolveLocale } from "../i18n/resolveLocale";
import type { Locale } from "../i18n/types";

/**
 * Per-currency UI metadata resolved against the SDK as the source of truth.
 *
 * Why this module exists: the widget renders per-currency UI (selector
 * row, accepted-phase instructions, compound-field labels) and historically
 * duplicated that metadata in `src/core/config.ts`. That copy drifts every
 * time SDK adds a currency or renames a payment-method string — and it
 * already had diverged (e.g. SDK's `"PAGO_MOVIL"` vs widget's
 * `"Pago Movil"`). Reading directly from `@p2pdotme/sdk/country` keeps the
 * B2B checkout in lockstep with the consumer user-app, which is also where
 * the canonical strings live.
 *
 * Host overrides win. A `CurrencyOption.paymentMethod` set by the host
 * takes precedence over `sdk.paymentMethod`. Hosts that pass a `symbol`
 * the SDK doesn't recognize still get a usable shape via per-field
 * fallbacks (symbol-as-native, blank country, etc.).
 */

export interface CompoundField {
  /** Stable key for React lists (`phone`, `bank`, …). */
  key: string;
  /** Localized label for the field (e.g. "Bank name", "RIF"). */
  label: string;
}

export interface CurrencyMeta {
  symbol: string;
  /** Native script symbol — used in the circular badge in the selector. */
  symbolNative: string;
  /** Country name shown under the currency code. */
  country: string;
  /** Country flag emoji. */
  flag: string;
  /** Payment-method token as the protocol knows it (e.g. "PIX", "PAGO_MOVIL").
   *  Stable id — never render it directly; use `paymentMethodDisplay`. */
  paymentMethod: string;
  /** Human-readable payment-method name for copy (e.g. "Pago Móvil",
   *  "Yape / Plin / CCI"). Matches user-app's English i18n strings. */
  paymentMethodDisplay: string;
  /** SDK's i18n key for the address field (e.g. "PIX_ID"). Useful as a stable id. */
  paymentAddressName: string;
  /** Human-readable label used in copy ("PIX ID", "Alias", "CLABE"). */
  paymentAddressLabel: string;
  /** True for currencies in early-access state — render an "Alpha" pill. */
  isAlpha: boolean;
  /** For currencies whose address is multi-part (NGN, VEN), the per-field
   *  labels. `null` for single-field currencies. */
  compoundFields: CompoundField[] | null;
}

// Lookup index for SDK metadata, keyed by currency code.
const SDK_INDEX: Record<string, CountryOption> = Object.fromEntries(
  COUNTRY_OPTIONS.map((c) => [c.currency, c]),
);

/** SDK address-label keys that map to `currency.*` catalog entries. */
const ADDRESS_KEYS = new Set([
  "UPI_ID",
  "PIX_ID",
  "ALIAS_ID",
  "CLABE_ID",
  "PHONE_NUMBER",
  "ACCOUNT_NUMBER",
  "PAGO_MOVIL_DETAILS",
  "QR_SIMPLE_DETAILS",
  "ALIAS_TRANSFERENCIA",
  "TRANSFERMOVIL_DETAILS",
  "ECU_BANK_DETAILS",
  "YAPE_PLIN_CCI_DETAILS",
  "REVOLUT_ID",
]);

/** Map SDK address-label keys → `currency.*` catalog entries. */
function labelFor(key: string, locale: Locale): string {
  if (ADDRESS_KEYS.has(key)) return t(locale, `currency.${key}`);
  return key.replace(/_/g, " ").toLowerCase();
}

/**
 * Map SDK compound-field i18n keys → `currency.*` catalog entries.
 * PHONE_NUMBER / ACCOUNT_NUMBER use the `_FIELD` variants; others share
 * address keys or dedicated label keys. Unmapped keys fall back to the
 * SDK field's `displayLabel` so a new currency renders before the catalog
 * learns about it.
 */
function fieldLabelFor(
  field: { label: string; displayLabel?: string | null },
  locale: Locale,
): string {
  switch (field.label) {
    case "PHONE_NUMBER":
      return t(locale, "currency.PHONE_NUMBER_FIELD");
    case "ACCOUNT_NUMBER":
      return t(locale, "currency.ACCOUNT_NUMBER_FIELD");
    case "UPI_ID":
    case "PIX_ID":
    case "ALIAS_ID":
    case "CLABE_ID":
    case "ACCOUNT_NUMBER_LABEL":
    case "BANK_NAME_LABEL":
    case "BANK_NAME":
    case "ACCOUNT_NAME":
    case "BANK_LABEL":
    case "RIF_LABEL":
    case "CARD_NUMBER":
    case "ACCOUNT_TYPE":
    case "NAME":
    case "CEDULA":
    case "ALIAS_TRANSFERENCIA":
    case "PERU_PHONE_LABEL":
    case "PERU_CCI_LABEL":
    case "REVOLUT_ID":
      return t(locale, `currency.${field.label}`);
    default:
      return (
        field.displayLabel ??
        field.label.replace(/_/g, " ").toLowerCase()
      );
  }
}

// Payment-method tokens → display names, matching user-app's English
// i18n bundle. The protocol token (e.g. "PAGO_MOVIL") stays the stable
// id; only rendering goes through this map. BANK_TRANSFER is not an SDK
// token but a value existing hosts pass as a CurrencyOption override.
const PAYMENT_METHOD_DISPLAY: Record<string, string> = {
  UPI: "UPI",
  QRIS: "QRIS",
  PIX: "PIX",
  ALIAS: "Alias",
  SPEI: "SPEI",
  PAGO_MOVIL: "Pago Móvil",
  QR_SIMPLE: "QR Simple",
  NIP: "NIP",
  TRANSFERENCIA: "Bank Transfer",
  TRANSFERMOVIL: "Transfermóvil",
  YAPE_PLIN_CCI: "Yape / Plin / CCI",
  INSTAPAY: "InstaPay",
  REVOLUT: "Revolut",
  BANK_TRANSFER: "Bank Transfer",
};

/** Display name for a payment-method token ("PAGO_MOVIL" → "Pago Móvil").
 *  Unknown tokens with underscores are title-cased; plain values pass through
 *  (hosts may already send a display string like "Bank Transfer"). */
export function paymentMethodDisplayFor(token: string): string {
  const mapped = PAYMENT_METHOD_DISPLAY[token];
  if (mapped) return mapped;
  if (!token.includes("_")) return token;
  return token
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Build a fully-resolved metadata object for a currency. Host-supplied
 * fields on `opt` win; missing fields fall back to SDK metadata; missing
 * SDK entries fall back to neutral defaults so the widget still renders
 * for currencies the SDK doesn't ship metadata for.
 */
export function resolveCurrencyMeta(
  opt: { symbol: string } & Partial<CurrencyOption>,
  locale?: string,
): CurrencyMeta {
  const loc = resolveLocale(locale);
  const sdk = SDK_INDEX[opt.symbol];
  const paymentAddressName = sdk?.paymentAddressName ?? "PAYMENT_ID";
  const fields = PAYMENT_ID_FIELDS[opt.symbol as keyof typeof PAYMENT_ID_FIELDS] ?? [];
  const paymentMethod =
    opt.paymentMethod ?? sdk?.paymentMethod ?? t(loc, "currency.paymentFallback");
  return {
    symbol: opt.symbol,
    symbolNative: opt.symbolNative ?? sdk?.symbolNative ?? opt.symbol,
    country: opt.country ?? sdk?.country ?? "",
    flag: opt.flag ?? sdk?.flag ?? "",
    paymentMethod,
    paymentMethodDisplay: paymentMethodDisplayFor(paymentMethod),
    paymentAddressName,
    paymentAddressLabel: labelFor(paymentAddressName, loc),
    isAlpha: opt.isAlpha ?? sdk?.isAlpha ?? false,
    compoundFields:
      fields.length > 1
        ? fields.map((f) => ({ key: f.key, label: fieldLabelFor(f, loc) }))
        : null,
  };
}
