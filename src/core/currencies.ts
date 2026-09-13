import type { PaymentAddressValidator } from "../types";
import { normalizePixKey, detectPixKeyType } from "./pix-brcode";
import { t } from "../i18n/t";
import { resolveLocale } from "../i18n/resolveLocale";
import type { Locale } from "../i18n/types";

/**
 * Default validators per currency symbol. Mirrors the format expectations
 * documented in user-app-spa's payment-address validation. Integrators can
 * override per-currency by setting `validatePaymentAddress` on a
 * `CurrencyOption`.
 *
 * The validators are intentionally permissive — the merchant's bank/PSP is
 * the source of truth for whether an address is actually deliverable. We
 * only catch obvious typos client-side.
 *
 * English-only map kept for backward-compatible public exports. Prefer
 * `getValidatorFor(symbol, override, locale)` for localized messages.
 */
function localizePixError(err: unknown, locale: Locale): string {
  if (!(err instanceof Error)) return t(locale, "paymentAddress.errPixInvalid");
  const msg = err.message;

  const cpf = /^CPF key must be 11 digits, got (\d+): (.+)$/.exec(msg);
  if (cpf) return t(locale, "paymentAddress.errCpf", { n: cpf[1], raw: cpf[2] });

  const cnpj = /^CNPJ key must be 14 digits, got (\d+): (.+)$/.exec(msg);
  if (cnpj) return t(locale, "paymentAddress.errCnpj", { n: cnpj[1], raw: cnpj[2] });

  const phone = /^Phone key should resolve to \+55 \+ area code \+ number, got: (.+)$/.exec(msg);
  if (phone) return t(locale, "paymentAddress.errPhone", { raw: phone[1] });

  const email = /^Invalid email key: (.+)$/.exec(msg);
  if (email) return t(locale, "paymentAddress.errEmail", { raw: email[1] });

  const evp = /^Invalid random\/EVP key, expected UUID format: (.+)$/.exec(msg);
  if (evp) return t(locale, "paymentAddress.errEvp", { raw: evp[1] });

  return t(locale, "paymentAddress.errPixInvalid");
}

function makeValidators(locale: Locale): Record<string, PaymentAddressValidator> {
  return {
    // UPI handle: name@bank
    INR: (s) =>
      /^[\w.\-]{3,}@[\w]{2,}$/.test(s.trim())
        ? null
        : t(locale, "paymentAddress.errUpi"),

    // PIX key: CPF, CNPJ, email, phone, or random (EVP/UUID) key. Key type
    // isn't collected separately from the merchant, so we detect it from
    // shape, then run the same normalization used to build the BR Code QR —
    // a key that fails here would also fail (or corrupt) the QR payload.
    BRL: (s) => {
      const trimmed = s.trim();
      if (trimmed.length === 0) return t(locale, "paymentAddress.errPixRequired");
      try {
        normalizePixKey(trimmed, detectPixKeyType(trimmed));
        return null;
      } catch (err) {
        return localizePixError(err, locale);
      }
    },

    // IBAN: 2 letters + 2 digits + 11..30 alphanumerics, no spaces.
    EUR: (s) => {
      const v = s.replace(/\s+/g, "").toUpperCase();
      return /^[A-Z]{2}\d{2}[\dA-Z]{11,30}$/.test(v)
        ? null
        : t(locale, "paymentAddress.errIban");
    },

    // US bank: account number ≥4 digits.
    USD: (s) =>
      /^\d{4,}$/.test(s.trim())
        ? null
        : t(locale, "paymentAddress.errUsd"),

    // SGD: PayNow ID (NRIC, mobile, UEN). Permissive non-empty for v1.
    SGD: (s) =>
      s.trim().length >= 4
        ? null
        : t(locale, "paymentAddress.errSgd"),

    // Mexican CLABE: 18 digits.
    MXN: (s) =>
      /^\d{18}$/.test(s.replace(/\s+/g, ""))
        ? null
        : t(locale, "paymentAddress.errMxn"),
  };
}

export const DEFAULT_VALIDATORS: Record<string, PaymentAddressValidator> =
  makeValidators("en");

/** Per-currency placeholder shown in the input. */
const PLACEHOLDER_KEYS: Record<string, string> = {
  INR: "paymentAddress.placeholderInr",
  BRL: "paymentAddress.placeholderBrl",
  EUR: "paymentAddress.placeholderEur",
  USD: "paymentAddress.placeholderUsd",
  SGD: "paymentAddress.placeholderSgd",
  MXN: "paymentAddress.placeholderMxn",
};

/** Per-currency input label for the form field. */
const LABEL_KEYS: Record<string, string> = {
  INR: "paymentAddress.labelUpi",
  BRL: "paymentAddress.labelPix",
  EUR: "paymentAddress.labelIban",
  USD: "paymentAddress.labelBankAccount",
  SGD: "paymentAddress.labelPayNow",
  MXN: "paymentAddress.labelClabe",
};

/** English placeholders — public export for backward compatibility. */
export const DEFAULT_PLACEHOLDERS: Record<string, string> = {
  INR: "name@upi",
  BRL: "PIX key (CPF, email, phone, or random)",
  EUR: "IBAN (e.g. DE89370400440532013000)",
  USD: "Bank account number",
  SGD: "PayNow ID",
  MXN: "18-digit CLABE",
};

/** English labels — public export for backward compatibility. */
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
  override?: PaymentAddressValidator,
  locale?: string,
): PaymentAddressValidator {
  if (override) return override;
  const loc = resolveLocale(locale);
  const validators = makeValidators(loc);
  return (
    validators[symbol] ??
    ((s) =>
      s.trim().length >= 3 ? null : t(loc, "paymentAddress.errFallback"))
  );
}

export function getPlaceholderFor(
  symbol: string,
  override?: string,
  locale?: string,
): string {
  if (override) return override;
  const loc = resolveLocale(locale);
  const key = PLACEHOLDER_KEYS[symbol];
  return key ? t(loc, key) : t(loc, "paymentAddress.placeholderFallback");
}

export function getPaymentLabelFor(symbol: string, locale?: string): string {
  const loc = resolveLocale(locale);
  const key = LABEL_KEYS[symbol];
  return key ? t(loc, key) : t(loc, "paymentAddress.labelFallback");
}
