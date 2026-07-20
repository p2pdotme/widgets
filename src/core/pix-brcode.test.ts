import { test } from "node:test";
import assert from "node:assert";
import {
  crc16,
  buildStaticPixPayload,
  normalizePixKey,
  pixKeyToQR,
  detectPixKeyType,
} from "./pix-brcode.ts";

// ─── crc16 ───────────────────────────────────────────────────────────

test("crc16 matches the official CRC-16/CCITT-FALSE test vector", () => {
  assert.strictEqual(crc16("123456789"), "29B1");
});

// ─── acceptance criteria: real production payloads ──────────────────

test("pixKeyToQR reproduces the random/EVP-key production payload exactly", () => {
  assert.strictEqual(
    pixKeyToQR("9fc9b472-3930-4a8f-85d3-b9491fedeef9", "random"),
    "00020126580014BR.GOV.BCB.PIX01369fc9b472-3930-4a8f-85d3-b9491fedeef95204000053039865802BR5901N6001C62070503***630405C6",
  );
});

test("pixKeyToQR reproduces the 9-digit-mobile phone-key production payload exactly", () => {
  assert.strictEqual(
    pixKeyToQR("+5521982390011", "phone"),
    "00020126360014BR.GOV.BCB.PIX0114+55219823900115204000053039865802BR5901N6001C62070503***6304E6F7",
  );
});

// ─── regression: field-26 declared length must always match content ──
//
// Phone keys are the highest-risk key type because their length varies:
// landline (8-digit local number) vs. mobile (9-digit, leading '9'). If the
// length prefix were ever hardcoded instead of derived from value.length,
// any key whose length differs from the assumed one would desync field-26's
// declared length from its actual content.

function field26DeclaredLength(payload: string): number {
  const idx = payload.indexOf("26");
  assert.ok(idx !== -1, "payload must contain a field-26 tag");
  const len = Number(payload.slice(idx + 2, idx + 4));
  assert.ok(!Number.isNaN(len), "field-26 length must be numeric");
  return len;
}

function field26ActualContentLength(payload: string): number {
  const idx = payload.indexOf("26");
  const len = Number(payload.slice(idx + 2, idx + 4));
  return payload.slice(idx + 4, idx + 4 + len).length;
}

const PHONE_CASES: Array<[string, string]> = [
  ["landline, no 9th digit", "+551133334444"], // +55 + DDD 11 + 8-digit landline
  ["mobile, with 9th digit", "+5521982390011"], // +55 + DDD 21 + 9-digit mobile
  ["mobile, DDD 11", "+5511987654321"],
  ["landline, DDD 85", "+558533334444"],
];

for (const [label, key] of PHONE_CASES) {
  test(`field-26 length declaration matches content for phone key (${label})`, () => {
    const payload = buildStaticPixPayload({
      pixKey: key,
      merchantName: "N",
      merchantCity: "C",
      includePointOfInitiation: false,
    });
    assert.strictEqual(field26DeclaredLength(payload), field26ActualContentLength(payload));
    // Sanity: the raw key text is fully present and untruncated, and the
    // next field's tag ('52', Merchant Category Code) is not swallowed
    // into it.
    const idx = payload.indexOf("26");
    const len = field26DeclaredLength(payload);
    const content = payload.slice(idx + 4, idx + 4 + len);
    assert.ok(content.endsWith(key), `field-26 content should end with the exact key, got: ${content}`);
    assert.ok(!content.includes("52" + "0000"), "field-26 content must not absorb the next field's tag+value");
  });
}

// ─── normalizePixKey ─────────────────────────────────────────────────

test("normalizePixKey strips CPF punctuation to 11 digits", () => {
  assert.strictEqual(normalizePixKey("123.456.789-01", "cpf"), "12345678901");
});

test("normalizePixKey rejects a malformed CPF", () => {
  assert.throws(() => normalizePixKey("123.456.789", "cpf"));
});

test("normalizePixKey strips CNPJ punctuation to 14 digits", () => {
  assert.strictEqual(normalizePixKey("12.345.678/0001-95", "cnpj"), "12345678000195");
});

test("normalizePixKey rejects a malformed CNPJ", () => {
  assert.throws(() => normalizePixKey("12.345.678/0001", "cnpj"));
});

test("normalizePixKey normalizes phone with parens/spaces and adds +55", () => {
  assert.strictEqual(normalizePixKey("(11) 99999-9999", "phone"), "+5511999999999");
});

test("normalizePixKey accepts an already-prefixed +55 phone", () => {
  assert.strictEqual(normalizePixKey("+55 11 99999-9999", "phone"), "+5511999999999");
});

test("normalizePixKey accepts an 8-digit landline", () => {
  assert.strictEqual(normalizePixKey("(11) 3333-4444", "phone"), "+551133334444");
});

test("normalizePixKey rejects a phone key with an implausible digit count", () => {
  assert.throws(() => normalizePixKey("123", "phone"));
});

test("normalizePixKey lowercases email and validates shape", () => {
  assert.strictEqual(normalizePixKey("Example@Bank.com", "email"), "example@bank.com");
  assert.throws(() => normalizePixKey("not-an-email", "email"));
});

test("normalizePixKey lowercases a random/EVP UUID and validates shape", () => {
  assert.strictEqual(
    normalizePixKey("9FC9B472-3930-4A8F-85D3-B9491FEDEEF9", "random"),
    "9fc9b472-3930-4a8f-85d3-b9491fedeef9",
  );
  assert.throws(() => normalizePixKey("not-a-uuid", "random"));
});

// ─── merchant name / city sanitization ────────────────────────────────

test("buildStaticPixPayload strips accents, uppercases, and truncates merchant name/city", () => {
  const payload = buildStaticPixPayload({
    pixKey: "example@bank.com",
    merchantName: "José da Silva Comércio Internacional Ltda",
    merchantCity: "São Paulo Metropolitana",
  });
  assert.ok(payload.includes("5925JOSE DA SILVA COMERCIO"), payload);
  assert.ok(payload.includes("6015SAO PAULO METR"), payload);
});

// ─── detectPixKeyType (the integration path the widget actually uses) ──
//
// The widget only has the raw key string, so it detects the type by shape.
// The load-bearing case: an 11-digit CPF must NOT be read as a phone.

test("detectPixKeyType reads a bare CPF as cpf, never phone", () => {
  assert.strictEqual(detectPixKeyType("12345678901"), "cpf");
  assert.strictEqual(detectPixKeyType("111.444.777-35"), "cpf");
});

test("detectPixKeyType reads E.164 phone keys as phone", () => {
  assert.strictEqual(detectPixKeyType("+5521982390011"), "phone"); // mobile, "+"
  assert.strictEqual(detectPixKeyType("5521982390011"), "phone");  // mobile, 13-digit 55-prefixed
  assert.strictEqual(detectPixKeyType("+551133334444"), "phone");  // landline
});

test("detectPixKeyType reads cnpj / email / random keys", () => {
  assert.strictEqual(detectPixKeyType("12345678000195"), "cnpj");
  assert.strictEqual(detectPixKeyType("shop@example.com"), "email");
  assert.strictEqual(detectPixKeyType("9fc9b472-3930-4a8f-85d3-b9491fedeef9"), "random");
});

test("a CPF key round-trips as a CPF payload, not a +55 phone rewrite", () => {
  const key = "11144477735";
  const type = detectPixKeyType(key);
  assert.strictEqual(type, "cpf");
  const qr = pixKeyToQR(key, type);
  assert.ok(qr.includes("011111144477735"), qr); // MAI tag 01, len 11, the raw CPF
  assert.ok(!qr.includes("+55"), "a CPF must not be rewritten into a phone key");
});

// ─── txid charset (EMV 62-05: alphanumeric only, ≤25) ─────────────────

test("buildStaticPixPayload strips non-alphanumeric txid characters", () => {
  const p = buildStaticPixPayload({ pixKey: "a@b.com", merchantName: "N", merchantCity: "C", txid: "order-abc/123" });
  assert.ok(p.includes("0511orderabc123"), p); // tag 05, len 11, sanitized value
  assert.ok(!p.includes("order-abc"), "punctuation must be stripped from txid");
});

test("buildStaticPixPayload falls back to *** for an all-punctuation txid", () => {
  const p = buildStaticPixPayload({ pixKey: "a@b.com", merchantName: "N", merchantCity: "C", txid: "!!!" });
  assert.ok(p.includes("62070503***"), p);
});

// ─── mandatory tags 59/60 are never emitted empty ─────────────────────

test("buildStaticPixPayload guards a merchant name/city that sanitizes to empty", () => {
  const p = buildStaticPixPayload({ pixKey: "a@b.com", merchantName: "🎁", merchantCity: "🏙" });
  assert.ok(p.includes("5903PIX"), p);    // name -> "PIX"
  assert.ok(p.includes("6006BRASIL"), p); // city -> "BRASIL"
});
