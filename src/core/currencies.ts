import type { PaymentAddressValidator } from "../types";
import { normalizePixKey, detectPixKeyType } from "./pix-brcode";

/**
 * Default validators per currency symbol. Mirrors the format expectations
 * documented in user-app-spa's payment-address validation. Integrators can
 * override per-currency by setting `validatePaymentAddress` on a
 * `CurrencyOption`.
 *
 * The validators are intentionally permissive — the merchant's bank/PSP is
 * the source of truth for whether an address is actually deliverable. We
 * only catch obvious typos client-side.
 */
export const DEFAULT_VALIDATORS: Record<string, PaymentAddressValidator> = {
  // UPI handle: name@bank
  INR: (s) =>
    /^[\w.\-]{3,}@[\w]{2,}$/.test(s.trim())
      ? null
      : "UPI handle must look like name@bank (e.g. example@upi)",

  // PIX key: CPF, CNPJ, email, phone, or random (EVP/UUID) key. Key type
  // isn't collected separately from the merchant, so we detect it from
  // shape, then run the same normalization used to build the BR Code QR —
  // a key that fails here would also fail (or corrupt) the QR payload.
  BRL: (s) => {
    const trimmed = s.trim();
    if (trimmed.length === 0) return "PIX key required (CPF, CNPJ, email, phone, or random key)";
    try {
      normalizePixKey(trimmed, detectPixKeyType(trimmed));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid PIX key";
    }
  },

  // IBAN: 2 letters + 2 digits + 11..30 alphanumerics, no spaces.
  EUR: (s) => {
    const v = s.replace(/\s+/g, "").toUpperCase();
    return /^[A-Z]{2}\d{2}[\dA-Z]{11,30}$/.test(v)
      ? null
      : "IBAN format: CC## + alphanumerics (no spaces)";
  },

  // US bank: account number ≥4 digits.
  USD: (s) =>
    /^\d{4,}$/.test(s.trim())
      ? null
      : "Account number required (digits only)",

  // SGD: PayNow ID (NRIC, mobile, UEN). Permissive non-empty for v1.
  SGD: (s) =>
    s.trim().length >= 4
      ? null
      : "PayNow ID required (NRIC, mobile, or UEN)",

  // Mexican CLABE: 18 digits.
  MXN: (s) =>
    /^\d{18}$/.test(s.replace(/\s+/g, ""))
      ? null
      : "CLABE must be 18 digits",
};

/** Per-currency placeholder shown in the input. */
export const DEFAULT_PLACEHOLDERS: Record<string, string> = {
  INR: "name@upi",
  BRL: "PIX key (CPF, email, phone, or random)",
  EUR: "IBAN (e.g. DE89370400440532013000)",
  USD: "Bank account number",
  SGD: "PayNow ID",
  MXN: "18-digit CLABE",
};

/** Per-currency input label for the form field. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  INR: "UPI handle",
  BRL: "PIX key",
  EUR: "IBAN",
  USD: "Bank account",
  SGD: "PayNow ID",
  MXN: "CLABE",
};

/** Generic fallback validator if a currency isn't in the map. */
export const FALLBACK_VALIDATOR: PaymentAddressValidator = (s) =>
  s.trim().length >= 3 ? null : "Payment address required";

export function getValidatorFor(
  symbol: string,
  override?: PaymentAddressValidator
): PaymentAddressValidator {
  if (override) return override;
  return DEFAULT_VALIDATORS[symbol] ?? FALLBACK_VALIDATOR;
}

export function getPlaceholderFor(
  symbol: string,
  override?: string
): string {
  return override ?? DEFAULT_PLACEHOLDERS[symbol] ?? "Payment address";
}

export function getPaymentLabelFor(symbol: string): string {
  return PAYMENT_METHOD_LABEL[symbol] ?? "Payment address";
}
