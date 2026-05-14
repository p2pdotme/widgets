import {
  COUNTRY_OPTIONS,
  PAYMENT_ID_FIELDS,
  type CountryOption,
} from "@p2pdotme/sdk/country";
import type { CurrencyOption } from "../types";

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
  /** English label for the field (e.g. "Bank name", "RIF"). */
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
  /** Payment-method short name (e.g. "PIX", "UPI", "Alias"). */
  paymentMethod: string;
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

// SDK ships translation keys (e.g. "PIX_ID", "PAGO_MOVIL_DETAILS"); the
// widget has no i18n layer, so we map them to English here. Keep aligned
// with user-app-spa's i18n bundle when adding currencies. Falls back to a
// kebab-cased version of the key for unmapped values.
const ADDRESS_LABEL: Record<string, string> = {
  UPI_ID: "UPI ID",
  PIX_ID: "PIX ID",
  ALIAS_ID: "Alias",
  CLABE_ID: "CLABE",
  PHONE_NUMBER: "phone number",
  ACCOUNT_NUMBER: "account number",
  PAGO_MOVIL_DETAILS: "Pago Movil details",
};

// Compound-field i18n keys → English. Used for NGN account/bank + VEN
// phone/RIF/bank breakdown rows in the accepted-phase screen.
const FIELD_LABEL: Record<string, string> = {
  UPI_ID: "UPI ID",
  PIX_ID: "PIX ID",
  ALIAS_ID: "Alias",
  CLABE_ID: "CLABE",
  PHONE_NUMBER: "Phone number",
  ACCOUNT_NUMBER: "Account number",
  ACCOUNT_NUMBER_LABEL: "Account number",
  BANK_NAME_LABEL: "Bank name",
  BANK_LABEL: "Bank",
  RIF_LABEL: "RIF",
};

function labelFor(key: string): string {
  return ADDRESS_LABEL[key] ?? key.replace(/_/g, " ").toLowerCase();
}

function fieldLabelFor(key: string): string {
  return FIELD_LABEL[key] ?? key.replace(/_/g, " ").toLowerCase();
}

/**
 * Build a fully-resolved metadata object for a currency. Host-supplied
 * fields on `opt` win; missing fields fall back to SDK metadata; missing
 * SDK entries fall back to neutral defaults so the widget still renders
 * for currencies the SDK doesn't ship metadata for.
 */
export function resolveCurrencyMeta(
  opt: { symbol: string } & Partial<CurrencyOption>,
): CurrencyMeta {
  const sdk = SDK_INDEX[opt.symbol];
  const paymentAddressName = sdk?.paymentAddressName ?? "PAYMENT_ID";
  const fields = PAYMENT_ID_FIELDS[opt.symbol as keyof typeof PAYMENT_ID_FIELDS] ?? [];
  return {
    symbol: opt.symbol,
    symbolNative: opt.symbolNative ?? sdk?.symbolNative ?? opt.symbol,
    country: opt.country ?? sdk?.country ?? "",
    flag: opt.flag ?? sdk?.flag ?? "",
    paymentMethod: opt.paymentMethod ?? sdk?.paymentMethod ?? "Payment",
    paymentAddressName,
    paymentAddressLabel: labelFor(paymentAddressName),
    isAlpha: opt.isAlpha ?? sdk?.isAlpha ?? false,
    compoundFields:
      fields.length > 1
        ? fields.map((f) => ({ key: f.key, label: fieldLabelFor(f.label) }))
        : null,
  };
}
