import { test } from "node:test";
import assert from "node:assert";
import { resolvePaymentDisplay, buildTransfermovilQr } from "./payment-display.ts";
import { resolveCurrencyMeta, paymentMethodDisplayFor } from "./currency-meta.ts";

// A syntactically valid Pago Móvil S7B envelope: ≥40 base64 chars before
// "?" plus a 3–4 digit merchantId (see sdk's validateVenezuelanQr).
const VEN_QR = `${"QmFzZTY0UGF5bG9hZEZvclRlc3RpbmdPbmx5QUFBQUFB"}?merchantId=123`;

// ─── VEN: packed `qr||fields` ids (the "big string" regression) ─────

test("packed VEN id yields the QR payload plus aligned field rows", () => {
  const d = resolvePaymentDisplay("VEN", `${VEN_QR}||04121234567|V12345678|Banesco`);
  assert.strictEqual(d.qrPayload, VEN_QR);
  assert.deepStrictEqual(d.rows, [
    { key: "phone", value: "04121234567" },
    { key: "rif", value: "V12345678" },
    { key: "bank", value: "Banesco" },
  ]);
  assert.strictEqual(d.single, null);
});

test("legacy pipe-only VEN id still maps to fields, with no QR", () => {
  const d = resolvePaymentDisplay("VEN", "04121234567|V12345678|Banesco");
  assert.strictEqual(d.qrPayload, null);
  assert.deepStrictEqual(d.rows, [
    { key: "phone", value: "04121234567" },
    { key: "rif", value: "V12345678" },
    { key: "bank", value: "Banesco" },
  ]);
});

test("standalone VEN QR id (no typed fields) exposes the QR and empty required rows", () => {
  const d = resolvePaymentDisplay("VEN", VEN_QR);
  assert.strictEqual(d.qrPayload, VEN_QR);
  assert.deepStrictEqual(d.rows, [
    { key: "phone", value: "" },
    { key: "rif", value: "" },
    { key: "bank", value: "" },
  ]);
});

// ─── NGN: three fields, account name must survive ───────────────────

test("NGN id surfaces all three fields including the account name", () => {
  const d = resolvePaymentDisplay("NGN", "0123456789|GTBank|JOHN DOE");
  assert.strictEqual(d.qrPayload, null);
  assert.deepStrictEqual(d.rows, [
    { key: "account", value: "0123456789" },
    { key: "bank-name", value: "GTBank" },
    { key: "account-name", value: "JOHN DOE" },
  ]);
});

test("legacy 2-part NGN id keeps the required account-name row, empty", () => {
  const d = resolvePaymentDisplay("NGN", "0123456789|GTBank");
  assert.deepStrictEqual(d.rows?.map((r) => r.key), ["account", "bank-name", "account-name"]);
  assert.strictEqual(d.rows?.[2].value, "");
});

// ─── PEN: optional fields are dropped when empty ────────────────────

test("PEN phone-only id drops the empty optional CCI row", () => {
  const d = resolvePaymentDisplay("PEN", "987654321|");
  assert.deepStrictEqual(d.rows, [{ key: "phone", value: "987654321" }]);
});

// ─── Single-field rails ─────────────────────────────────────────────

test("INR stays a plain single value", () => {
  const d = resolvePaymentDisplay("INR", "name@upi");
  assert.strictEqual(d.rows, null);
  assert.strictEqual(d.single, "name@upi");
  assert.strictEqual(d.qrPayload, null);
});

test("packed BOB id shows the account number, never the raw blob", () => {
  // qr part here is intentionally not a valid BOB payload — the typed
  // remainder must still come through as the copyable value.
  const d = resolvePaymentDisplay("BOB", "NOTAVALIDQR||12345678");
  assert.strictEqual(d.rows, null);
  assert.strictEqual(d.single, "12345678");
});

test("unknown currencies pass the id through untouched", () => {
  const d = resolvePaymentDisplay("XXX", "whatever|value");
  assert.strictEqual(d.single, "whatever|value");
  assert.strictEqual(d.rows, null);
});

// ─── CUP: Transfermóvil payload parity with user-app ────────────────

test("CUP phone|card pair builds the Transfermóvil payload with the amount", () => {
  const d = resolvePaymentDisplay("CUP", "51234567|9224069995000000", "150.00");
  assert.strictEqual(
    d.qrPayload,
    "TRANSFERMOVIL_ETECSA,TRANSFERENCIA,9224069995000000,51234567,150.00",
  );
  assert.deepStrictEqual(d.rows, [
    { key: "phone", value: "51234567" },
    { key: "card", value: "9224069995000000" },
  ]);
});

test("buildTransfermovilQr strips the 53 country prefix and rejects bad pairs", () => {
  assert.strictEqual(
    buildTransfermovilQr("+53 5123-4567|9224 0699 9500 0000", ""),
    "TRANSFERMOVIL_ETECSA,TRANSFERENCIA,9224069995000000,51234567,",
  );
  assert.strictEqual(buildTransfermovilQr("12345|not-a-card", "10"), null);
});

// ─── Labels: catalog-aligned, no raw tokens ─────────────────────────

test("NGN compound labels match user-app's English strings", () => {
  const meta = resolveCurrencyMeta({ symbol: "NGN" });
  assert.deepStrictEqual(
    meta.compoundFields?.map((f) => f.label),
    ["Account Number", "Bank Name", "Account Name"],
  );
});

test("VEN compound labels match user-app's English strings", () => {
  const meta = resolveCurrencyMeta({ symbol: "VEN" });
  assert.deepStrictEqual(
    meta.compoundFields?.map((f) => f.label),
    ["Phone Number", "Cédula/RIF", "Bank"],
  );
});

test("every catalog compound field resolves to a label with no raw i18n token", () => {
  for (const symbol of ["VEN", "NGN", "CUP", "ECU", "PHP", "PEN"]) {
    const meta = resolveCurrencyMeta({ symbol });
    assert.ok(meta.compoundFields && meta.compoundFields.length > 1, `${symbol} should be compound`);
    for (const f of meta.compoundFields) {
      // Raw i18n keys are UNDERSCORE_TOKENS (PERU_PHONE_LABEL, RIF_LABEL);
      // legit labels never carry an underscore. All-caps initialisms like
      // "CCI" or "CLABE" are fine.
      assert.ok(!f.label.includes("_"), `${symbol}.${f.key} label "${f.label}" looks like a raw token`);
      assert.ok(f.label.length > 0, `${symbol}.${f.key} label is empty`);
    }
  }
});

test("payment methods render display names, not protocol tokens", () => {
  assert.strictEqual(resolveCurrencyMeta({ symbol: "VEN" }).paymentMethodDisplay, "Pago Móvil");
  assert.strictEqual(resolveCurrencyMeta({ symbol: "NGN" }).paymentMethodDisplay, "NIP");
  assert.strictEqual(resolveCurrencyMeta({ symbol: "CUP" }).paymentMethodDisplay, "Transfermóvil");
  assert.strictEqual(resolveCurrencyMeta({ symbol: "PEN" }).paymentMethodDisplay, "Yape / Plin / CCI");
  assert.strictEqual(resolveCurrencyMeta({ symbol: "BOB" }).paymentMethodDisplay, "QR Simple");
  // Host-passed override values humanize too, and unknown tokens degrade
  // gracefully instead of leaking underscores.
  assert.strictEqual(paymentMethodDisplayFor("BANK_TRANSFER"), "Bank Transfer");
  assert.strictEqual(paymentMethodDisplayFor("SOME_NEW_RAIL"), "Some New Rail");
  assert.strictEqual(paymentMethodDisplayFor("PIX"), "PIX");
});

test("VEN is no longer tagged alpha by the catalog", () => {
  assert.strictEqual(resolveCurrencyMeta({ symbol: "VEN" }).isAlpha, false);
});
