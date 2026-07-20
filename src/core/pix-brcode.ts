/**
 * Pix BR Code generation — the Central Bank of Brazil's implementation of
 * EMVCo's QRCPS-MPM (Merchant Presented Mode), used to render a scan-to-pay
 * QR for a merchant's Pix key. Every field is `ID(2) + LENGTH(2) + VALUE`,
 * flat TLV, sealed with a CRC16.
 *
 * All field lengths are computed from the actual value at build time
 * (`value.length` in `tlv()`) — never hardcoded — since Pix key length
 * varies by key type (phone numbers especially: 8-digit landline vs.
 * 9-digit mobile).
 */

export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

export interface StaticPixInput {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount?: number;
  txid?: string;
  description?: string;
  /** default true */
  includePointOfInitiation?: boolean;
}

export interface DynamicPixInput {
  locationUrl: string;
  merchantName: string;
  merchantCity: string;
}

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflect, no xorout.
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function sanitize(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .slice(0, max);
}

export function buildStaticPixPayload(input: StaticPixInput): string {
  const merchantAccountInfo =
    tlv("00", "BR.GOV.BCB.PIX") +
    tlv("01", input.pixKey) +
    (input.description ? tlv("02", input.description.slice(0, 72)) : "");
  // txid (EMV 62-05) is alphanumeric only, ≤25 chars; "***" is Bacen's
  // "no txid" sentinel. Strip anything outside [A-Za-z0-9] — an order id with
  // hyphens/slashes would otherwise be an out-of-spec txid that some wallets
  // reject — and fall back to "***" when nothing usable is left.
  const txid = (input.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  const additionalData = tlv("05", txid || "***");
  const body =
    tlv("00", "01") +
    (input.includePointOfInitiation !== false ? tlv("01", "11") : "") +
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (input.amount !== undefined ? tlv("54", input.amount.toFixed(2)) : "") +
    tlv("58", "BR") +
    tlv("59", sanitize(input.merchantName, 25) || "PIX") +
    tlv("60", sanitize(input.merchantCity, 15) || "BRASIL") +
    tlv("62", additionalData);
  return body + "6304" + crc16(body + "6304");
}

export function buildDynamicPixPayload(input: DynamicPixInput): string {
  const merchantAccountInfo = tlv("00", "BR.GOV.BCB.PIX") + tlv("25", input.locationUrl);
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("58", "BR") +
    tlv("59", sanitize(input.merchantName, 25) || "PIX") +
    tlv("60", sanitize(input.merchantCity, 15) || "BRASIL");
  return body + "6304" + crc16(body + "6304");
}

export function normalizePixKey(raw: string, keyType: PixKeyType): string {
  const trimmed = raw.trim();
  switch (keyType) {
    case "cpf": {
      const digits = trimmed.replace(/\D/g, "");
      if (digits.length !== 11) throw new Error(`CPF key must be 11 digits, got ${digits.length}: ${raw}`);
      return digits;
    }
    case "cnpj": {
      const digits = trimmed.replace(/\D/g, "");
      if (digits.length !== 14) throw new Error(`CNPJ key must be 14 digits, got ${digits.length}: ${raw}`);
      return digits;
    }
    case "phone": {
      const digits = trimmed.replace(/\D/g, "");
      const withCountry = digits.startsWith("55") && digits.length > 11 ? digits : `55${digits}`;
      if (withCountry.length < 12 || withCountry.length > 13) {
        throw new Error(`Phone key should resolve to +55 + area code + number, got: ${raw}`);
      }
      return `+${withCountry}`;
    }
    case "email": {
      const lower = trimmed.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) throw new Error(`Invalid email key: ${raw}`);
      return lower;
    }
    case "random": {
      const lower = trimmed.toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) {
        throw new Error(`Invalid random/EVP key, expected UUID format: ${raw}`);
      }
      return lower;
    }
  }
}

/** Best-effort key type detection for a Pix key of unknown provenance —
 *  used where the widget only has the raw key string (no separate type
 *  field collected from the merchant). Falls back to "random" for anything
 *  that doesn't match a stricter shape, since EVP keys are opaque UUIDs. */
export function detectPixKeyType(raw: string): PixKeyType {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  // Random/EVP key: a UUID (8-4-4-4-12 hex).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return "random";
  // Email key: contains an "@".
  if (trimmed.includes("@")) return "email";
  // Phone key: Pix stores phone keys in E.164, so a phone ALWAYS carries a
  // country code — an explicit "+", or a bare "55" + area code + 8/9-digit
  // number (12–13 digits total). This check MUST come before CPF and MUST
  // require the country code: a bare 11-digit number has no country code and
  // is a CPF, not a mobile (a mobile is +55 + DDD + 9 digits = 13). The old
  // loose `^(55)?\d{10,11}$` matched a bare 11-digit CPF and rewrote it into a
  // bogus +55 phone key — misrouting a very common key type.
  if (trimmed.startsWith("+") || (digits.startsWith("55") && (digits.length === 12 || digits.length === 13))) return "phone";
  // CNPJ: 14 digits. CPF: 11 digits (bare, no country code).
  if (digits.length === 14) return "cnpj";
  if (digits.length === 11) return "cpf";
  // Unrecognized shape → treat as an opaque EVP key; normalize will reject it
  // if it isn't a valid UUID, and the caller falls back to the copy-page.
  return "random";
}

export function pixKeyToQR(rawKey: string, keyType: PixKeyType): string {
  return buildStaticPixPayload({
    pixKey: normalizePixKey(rawKey, keyType),
    merchantName: "N",
    merchantCity: "C",
    includePointOfInitiation: false,
  });
}
