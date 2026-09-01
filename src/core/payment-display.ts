// Resolves what the accepted-phase screen shows for a decrypted payment
// address: a scannable QR (when the rail has one), per-field breakdown
// rows (multi-field rails), or a single copyable value.
//
// Why this module exists: the widget used to `split("|")` the decrypted
// address itself. That broke the moment the protocol introduced *packed*
// payment IDs (`<qr payload>||field|field` — VEN Pago Móvil, BOB QR
// Simple, PEN Yape/Plin; see @p2pdotme/sdk country catalog): the QR blob
// rendered as a giant string under the first field label and every other
// field shifted by two. All parsing now goes through the SDK helpers so
// the widget stays byte-for-byte consistent with user-app, which uses
// the same calls.
import {
  PAYMENT_ID_FIELDS,
  assignStoredPaymentIdToFieldValues,
  deserializeCompoundPaymentId,
  getStoredQrPayload,
  unpackPackedPaymentId,
  type CurrencyCode,
} from "@p2pdotme/sdk/country";

export interface PaymentDisplayRow {
  /** Stable field key from the SDK catalog (`phone`, `bank`, …). */
  key: string;
  /** Field value from the stored payment ID. Empty string when the
   *  merchant record predates the field (e.g. legacy 2-part NGN ids
   *  without an account name) — the UI renders a placeholder. */
  value: string;
}

export interface PaymentDisplay {
  /** Scannable payload for rails that carry one (VEN/BOB/PEN stored QR,
   *  CUP Transfermóvil built here). `null` when the rail has none —
   *  INR/BRL build their own payable QRs elsewhere. */
  qrPayload: string | null;
  /** Per-field rows for multi-field rails, aligned with
   *  `CurrencyMeta.compoundFields` by key. Empty *optional* fields are
   *  dropped (PEN's phone/CCI pair); empty required fields are kept so
   *  the UI can show a placeholder. `null` for single-field rails. */
  rows: PaymentDisplayRow[] | null;
  /** The copyable value for single-field rails, unpacked — a packed BOB
   *  id yields the bare account number, never the raw `qr||account`
   *  blob. Empty string when the id is QR-only. `null` when `rows` is
   *  set. */
  single: string | null;
}

/**
 * Builds the Transfermóvil transfer payload for a CUP `phone|card` pair —
 * the payload format Transfermóvil itself emits
 * (`TRANSFERMOVIL_ETECSA,TRANSFERENCIA,<card>,<phone>,<amount>`). Ported
 * from user-app-client so both surfaces render the identical QR. Returns
 * null when the address isn't a usable phone/card pair, so callers fall
 * back to the plain text fields.
 */
export function buildTransfermovilQr(
  paymentAddress: string,
  amount: string,
): string | null {
  const [rawPhone, rawCard] = deserializeCompoundPaymentId(paymentAddress);

  const card = rawCard?.replace(/[\s-]/g, "") ?? "";
  const phoneDigits = rawPhone?.replace(/\D/g, "") ?? "";
  const phone = phoneDigits.length === 10 ? phoneDigits.slice(2) : phoneDigits;

  if (!/^\d{16}$/.test(card) || !/^\d{8}$/.test(phone)) return null;

  const parsed = Number(amount.replace(",", "."));
  const amountField =
    Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "";

  return `TRANSFERMOVIL_ETECSA,TRANSFERENCIA,${card},${phone},${amountField}`;
}

/**
 * Resolve the accepted-phase presentation of a decrypted payment address.
 *
 * @param currency - the order's currency code (bytes32-decoded symbol)
 * @param decryptedUpi - the decrypted merchant payment address, in
 *   whatever shape the protocol stored (plain, `a|b|c` compound, or
 *   packed `qr||a|b|c`)
 * @param fiatAmount - the fiat total as a decimal string; only used to
 *   stamp the amount into QRs that carry one (CUP)
 */
export function resolvePaymentDisplay(
  currency: string,
  decryptedUpi: string,
  fiatAmount?: string | null,
): PaymentDisplay {
  const code = currency as CurrencyCode;
  const fields = PAYMENT_ID_FIELDS[code] ?? [];

  const storedQr = getStoredQrPayload(code, decryptedUpi);
  const cupQr =
    currency === "CUP"
      ? buildTransfermovilQr(decryptedUpi, fiatAmount ?? "")
      : null;
  const qrPayload = storedQr ?? cupQr;

  // Currencies the SDK catalog doesn't know: nothing to unpack.
  if (fields.length === 0) {
    return { qrPayload, rows: null, single: decryptedUpi };
  }

  const values = assignStoredPaymentIdToFieldValues(code, decryptedUpi);

  if (fields.length === 1) {
    // Unpack even for single-field rails: a packed BOB id must show the
    // account number, not the raw blob. When the catalog assignment
    // comes back empty for a plain id (a shape its validators don't
    // recognize), fall back to the typed remainder so the merchant's
    // value is never hidden.
    const value = values[fields[0].key] ?? "";
    const single = value || (storedQr ? "" : unpackPackedPaymentId(decryptedUpi.trim()).rest);
    return { qrPayload, rows: null, single };
  }

  const rows = fields
    .map((f) => ({ key: f.key, value: values[f.key] ?? "", optional: f.optional === true }))
    .filter((r) => r.value !== "" || !r.optional)
    .map(({ key, value }) => ({ key, value }));

  return { qrPayload, rows, single: null };
}
