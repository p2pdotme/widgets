import { test } from "node:test";
import assert from "node:assert";
import {
  usdcToFiat,
  fiatToUsdc,
  grossFiatForOrder,
  resolveSellAmount,
  resolveUsdcFromAllInFiat,
  computeAmountResolution,
  type AmountResolutionInputs,
  type SellAmountInputs,
} from "./price-math.ts";

// Concrete config used across the cases: INR at 83 fiat/USDC, 10 USDC
// small-order threshold, 0.0625 USDC BUY fee (the prod-ish V22 numbers).
const BUY_PRICE = 83_000_000n; // 83.000000 fiat per USDC
const THRESHOLD = 10_000_000n; // 10 USDC
const FIXED_FEE = 62_500n; // 0.0625 USDC

// ─── usdcToFiat ─────────────────────────────────────────────────────

test("usdcToFiat multiplies USDC by the buy price", () => {
  assert.strictEqual(usdcToFiat(5_000_000n, BUY_PRICE), 415_000_000n); // 5 × 83 = 415
});

test("usdcToFiat is zero for a zero amount", () => {
  assert.strictEqual(usdcToFiat(0n, BUY_PRICE), 0n);
});

// ─── fiatToUsdc ─────────────────────────────────────────────────────

test("fiatToUsdc inverts usdcToFiat on exact values", () => {
  assert.strictEqual(fiatToUsdc(415_000_000n, BUY_PRICE), 5_000_000n);
});

test("fiatToUsdc rounds to the nearest micro-USDC", () => {
  // 100 fiat / 83 = 1.204819277… USDC → 1204819 micro-USDC
  assert.strictEqual(fiatToUsdc(100_000_000n, BUY_PRICE), 1_204_819n);
});

test("fiatToUsdc returns 0 for a non-positive price rather than dividing by zero", () => {
  assert.strictEqual(fiatToUsdc(100_000_000n, 0n), 0n);
  assert.strictEqual(fiatToUsdc(100_000_000n, -5n), 0n);
});

// ─── resolveUsdcFromAllInFiat: large order (no fee) ──────────────────

test("large all-in total resolves to the full amount with no fee", () => {
  // 100000 fiat / 83 ≈ 1204.8 USDC, far above the 10 USDC threshold.
  const res = resolveUsdcFromAllInFiat(100_000_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 1_204_819_277n, feeUsdc: 0n });
});

// ─── resolveUsdcFromAllInFiat: small order (fee backed out) ──────────

test("small all-in total backs the fixed fee out of the total", () => {
  // gross = fiatToUsdc(100, 83) = 1204819; usdcAmount = 1204819 − 62500 = 1142319
  const res = resolveUsdcFromAllInFiat(100_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 1_142_319n, feeUsdc: FIXED_FEE });
});

test("small-order round-trip: (usdcAmount + fee) × price ≈ entered total", () => {
  const total = 100_000_000n;
  const res = resolveUsdcFromAllInFiat(total, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.ok(res.ok);
  const recomputed = usdcToFiat(res.usdcAmount + res.feeUsdc, BUY_PRICE);
  // Within one micro-USDC of buy price (rounding residual), never more.
  const diff = total > recomputed ? total - recomputed : recomputed - total;
  assert.ok(diff <= BUY_PRICE, `residual ${diff} exceeds one micro-USDC of price`);
});

// ─── resolveUsdcFromAllInFiat: fee-exceeds-amount edge case ──────────

test("rejects when the fee is larger than the entered total", () => {
  // 5 fiat / 83 ≈ 0.0602 USDC gross; fee is 0.0625 USDC → nothing left.
  const res = resolveUsdcFromAllInFiat(5_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.deepStrictEqual(res, { ok: false, reason: "fee-exceeds-amount", feeUsdc: FIXED_FEE });
});

test("rejects a total that converts to exactly the fee (nothing left over)", () => {
  // Pick a fiat total whose gross USDC equals the fee exactly: 0.0625 × 83 = 5.1875 fiat
  const total = usdcToFiat(FIXED_FEE, BUY_PRICE); // 5_187_500
  const res = resolveUsdcFromAllInFiat(total, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.strictEqual(res.ok, false);
});

test("rejects a zero total", () => {
  const res = resolveUsdcFromAllInFiat(0n, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.strictEqual(res.ok, false);
});

// ─── resolveUsdcFromAllInFiat: threshold boundary + overlap band ─────

test("a total that grosses to exactly the threshold keeps the fee (small order)", () => {
  // gross == threshold (10 USDC) → still a small order, fee applies.
  const total = usdcToFiat(THRESHOLD, BUY_PRICE); // 10 × 83 = 830 fiat
  const res = resolveUsdcFromAllInFiat(total, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.deepStrictEqual(res, {
    ok: true,
    usdcAmount: THRESHOLD - FIXED_FEE,
    feeUsdc: FIXED_FEE,
  });
});

test("overlap band (threshold, threshold+fee] resolves to the fee-free branch", () => {
  // Choose a total that grosses to just above the threshold but within one
  // fee of it. gross = threshold + 1 micro-USDC → no fee, full amount.
  const grossTarget = THRESHOLD + 1n;
  const total = usdcToFiat(grossTarget, BUY_PRICE);
  const res = resolveUsdcFromAllInFiat(total, BUY_PRICE, THRESHOLD, FIXED_FEE);
  assert.ok(res.ok);
  assert.strictEqual(res.feeUsdc, 0n);
  assert.ok(res.usdcAmount > THRESHOLD, "amount stays above the threshold (no fee)");
});

// ─── resolveUsdcFromAllInFiat: zero-fee currency ────────────────────

test("a currency with no small-order fee resolves the whole amount", () => {
  const res = resolveUsdcFromAllInFiat(100_000_000n, BUY_PRICE, THRESHOLD, 0n);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 1_204_819n, feeUsdc: 0n });
});

// ─── resolveUsdcFromAllInFiat: credit-aware fee bracket (issue #51) ──
//
// The protocol levies the small-order fee on the POST-CREDIT delta (the amount
// that reaches the Diamond), so the inversion must decide the fee branch on
// `gross − credit`. `userPaysFiat` mirrors the pre-order breakdown: the fiat
// the user actually pays given the resolved order amount + their credit.
function userPaysFiat(orderUsdc: bigint, credit: bigint): bigint {
  const charged = credit >= orderUsdc ? 0n : orderUsdc - credit;
  const fee = charged > 0n && charged <= THRESHOLD ? FIXED_FEE : 0n;
  return usdcToFiat(charged, BUY_PRICE) + usdcToFiat(fee, BUY_PRICE);
}

test("no credit is identical to the plain 4-arg inversion (regression)", () => {
  for (const total of [100_000_000n, 830_000_000n, 100_000_000_000n, 5_000_000n]) {
    assert.deepStrictEqual(
      resolveUsdcFromAllInFiat(total, BUY_PRICE, THRESHOLD, FIXED_FEE, 0n),
      resolveUsdcFromAllInFiat(total, BUY_PRICE, THRESHOLD, FIXED_FEE),
    );
  }
});

test("credit that keeps the order above threshold charges no fee", () => {
  // ₹1660 → gross 20 USDC; 5 USDC credit → delta 15 USDC (> threshold).
  const res = resolveUsdcFromAllInFiat(1_660_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE, 5_000_000n);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 20_000_000n, feeUsdc: 0n });
  const target = 1_660_000_000n - usdcToFiat(5_000_000n, BUY_PRICE); // all-in − credit value
  assert.strictEqual(userPaysFiat(res.ok ? res.usdcAmount : 0n, 5_000_000n), target);
  assert.strictEqual(target, 1_245_000_000n); // ₹1245.00
});

test("credit crossing below threshold is absorbed into the all-in — #51 repro lands on ₹747.00", () => {
  // ₹913 → gross 11 USDC (a genuine 'large, no fee' quote); 2 USDC credit →
  // delta 9 USDC ≤ threshold, so the chain WILL charge the fee. Option B backs
  // it out of the all-in: usdcAmount = 11 − 0.0625 = 10.9375 USDC.
  const res = resolveUsdcFromAllInFiat(913_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE, 2_000_000n);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 10_937_500n, feeUsdc: FIXED_FEE });
  // User pays exactly the all-in minus the credit value — NOT one fee more.
  assert.strictEqual(userPaysFiat(10_937_500n, 2_000_000n), 747_000_000n); // ₹747.00, not ₹752.19
});

test("credit fully covering resolves to the gross with no fee (credit-only path)", () => {
  // ₹913 → gross 11 USDC; 12 USDC credit fully covers → delta ≤ 0.
  const res = resolveUsdcFromAllInFiat(913_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE, 12_000_000n);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 11_000_000n, feeUsdc: 0n });
  // credit ≥ order → nothing charged, no fee (the credit-only redemption).
  assert.strictEqual(userPaysFiat(11_000_000n, 12_000_000n), 0n);
  assert.ok(12_000_000n >= (res.ok ? res.usdcAmount : 0n));
});

test("E1 residual: credit within one fee of covering rides the fee on top (documented)", () => {
  // ₹913 → gross 11 USDC; 10.97 USDC credit → delta 0.03 USDC ≤ fee. The chain
  // still levies the fee on the tiny remainder; it can't be absorbed, so it
  // rides on top (parity with usdcAmount + credit). Order stays the full gross.
  const credit = 10_970_000n;
  const res = resolveUsdcFromAllInFiat(913_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE, credit);
  assert.deepStrictEqual(res, { ok: true, usdcAmount: 11_000_000n, feeUsdc: FIXED_FEE });
  const target = 913_000_000n - usdcToFiat(credit, BUY_PRICE);
  const overcharge = userPaysFiat(11_000_000n, credit) - target;
  assert.strictEqual(overcharge, usdcToFiat(FIXED_FEE, BUY_PRICE)); // exactly one fee, only in this band
});

test("a sub-fee order still blocks even with credit (order gross ≤ fee)", () => {
  const res = resolveUsdcFromAllInFiat(5_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE, 100_000_000n);
  assert.strictEqual(res.ok, false);
});

// ─── grossFiatForOrder ──────────────────────────────────────────────

test("grossFiatForOrder adds the small-order fee for a small order", () => {
  // 5 USDC ≤ threshold → subtotal + fee.
  const expected = usdcToFiat(5_000_000n, BUY_PRICE) + usdcToFiat(FIXED_FEE, BUY_PRICE);
  assert.strictEqual(grossFiatForOrder(5_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE), expected);
});

test("grossFiatForOrder omits the fee above the threshold and when config is null", () => {
  assert.strictEqual(grossFiatForOrder(20_000_000n, BUY_PRICE, THRESHOLD, FIXED_FEE), usdcToFiat(20_000_000n, BUY_PRICE));
  assert.strictEqual(grossFiatForOrder(5_000_000n, BUY_PRICE, null, null), usdcToFiat(5_000_000n, BUY_PRICE));
});

// ─── resolveSellAmount (cashout / withdrawal fiatPayoutAmount) ──────

// `BUY_PRICE` doubles as the sellPrice here (both are fiat-per-USDC, 6-dec).
const SELL_BASE: SellAmountInputs = {
  fiatPayoutAmount: undefined,
  sellPrice: BUY_PRICE,
  priceReadyForCurrency: true,
  priceConfigFailed: false,
  threshold: THRESHOLD,
  fixedFee: FIXED_FEE,
};

test("resolveSellAmount: no fiatPayoutAmount → none (plain USDC-input mode)", () => {
  assert.deepStrictEqual(resolveSellAmount(SELL_BASE), { status: "none" });
});

test("resolveSellAmount: holds pending until the rate is ready for the currency", () => {
  const p = { ...SELL_BASE, fiatPayoutAmount: 5_000_000_000n };
  assert.strictEqual(resolveSellAmount({ ...p, priceReadyForCurrency: false }).status, "pending");
  assert.strictEqual(resolveSellAmount({ ...p, sellPrice: null }).status, "pending");
});

test("resolveSellAmount: rate read failed → unavailable", () => {
  const r = resolveSellAmount({ ...SELL_BASE, fiatPayoutAmount: 5_000_000_000n, priceConfigFailed: true });
  assert.strictEqual(r.status, "unavailable");
});

test("resolveSellAmount: large payout → full principal, no fee", () => {
  // ₹5,000 at 83 → 60.240964 USDC, above the 10 USDC threshold.
  assert.deepStrictEqual(
    resolveSellAmount({ ...SELL_BASE, fiatPayoutAmount: 5_000_000_000n }),
    { status: "ready", principal: 60_240_964n, feeUsdc: 0n },
  );
});

test("resolveSellAmount: small payout → principal + separate USDC fee (not deducted from payout)", () => {
  // ₹100 → 1.204819 USDC (≤ threshold) → fee applies, charged on top in USDC.
  assert.deepStrictEqual(
    resolveSellAmount({ ...SELL_BASE, fiatPayoutAmount: 100_000_000n }),
    { status: "ready", principal: 1_204_819n, feeUsdc: FIXED_FEE },
  );
});

test("resolveSellAmount: dust payout (principal rounds to 0) → too-small", () => {
  assert.strictEqual(resolveSellAmount({ ...SELL_BASE, fiatPayoutAmount: 1n }).status, "too-small");
});

test("resolveSellAmount: fee-dominated payout (fee ≥ principal) → too-small (#58)", () => {
  // ₹2.49 → ~0.03 USDC principal; the 0.0625 USDC fee exceeds it, so the user
  // would pay more fee than they sell — block it.
  assert.strictEqual(resolveSellAmount({ ...SELL_BASE, fiatPayoutAmount: 2_490_000n }).status, "too-small");
});

// ─── computeAmountResolution (amount-mode state machine, issue #53.4) ─

const READY_INPUTS: AmountResolutionInputs = {
  usdcAmount: undefined,
  fiatChargeAmount: undefined,
  demo: false,
  hasSelectedCurrency: true,
  selectedSymbol: "INR",
  priceLoadedCurrency: "INR",
  buyPrice: BUY_PRICE,
  threshold: THRESHOLD,
  fixedFee: FIXED_FEE,
  priceConfigFailed: false,
  credit: 0n,
};

test("usdcAmount mode is ready immediately, ungated by rate/credit", () => {
  const r = computeAmountResolution({
    ...READY_INPUTS, usdcAmount: 5_000_000n, buyPrice: null, credit: null,
  });
  assert.deepStrictEqual(r, { status: "ready", usdcAmount: 5_000_000n });
});

test("neither amount input → none (tracking-only / product-priced)", () => {
  assert.deepStrictEqual(computeAmountResolution(READY_INPUTS), { status: "none" });
});

test("fiat mode holds pending until the rate loads", () => {
  const r = computeAmountResolution({ ...READY_INPUTS, fiatChargeAmount: 913_000_000n, buyPrice: null });
  assert.strictEqual(r.status, "pending");
});

test("fiat mode holds pending when the loaded price is for a different currency", () => {
  const r = computeAmountResolution({
    ...READY_INPUTS, fiatChargeAmount: 913_000_000n, selectedSymbol: "BRL", priceLoadedCurrency: "INR",
  });
  assert.strictEqual(r.status, "pending");
});

test("fiat mode holds pending while the async credit read is in flight", () => {
  const r = computeAmountResolution({ ...READY_INPUTS, fiatChargeAmount: 913_000_000n, credit: null });
  assert.strictEqual(r.status, "pending");
});

test("fiat mode is unavailable when the rate read failed", () => {
  const r = computeAmountResolution({ ...READY_INPUTS, fiatChargeAmount: 913_000_000n, priceConfigFailed: true });
  assert.strictEqual(r.status, "unavailable");
});

test("fiat mode is unavailable with no selectable currency (#53.2)", () => {
  const r = computeAmountResolution({
    ...READY_INPUTS, fiatChargeAmount: 913_000_000n, hasSelectedCurrency: false, selectedSymbol: undefined,
  });
  assert.strictEqual(r.status, "unavailable");
});

test("fiat mode resolves credit-aware once rate + credit are ready", () => {
  const r = computeAmountResolution({ ...READY_INPUTS, fiatChargeAmount: 913_000_000n, credit: 2_000_000n });
  assert.deepStrictEqual(r, { status: "ready", usdcAmount: 10_937_500n });
});

test("fiat mode blocks a too-small total", () => {
  const r = computeAmountResolution({ ...READY_INPUTS, fiatChargeAmount: 5_000_000n });
  assert.strictEqual(r.status, "too-small");
});

test("demo fiat converts via the demo rate without on-chain reads", () => {
  const r = computeAmountResolution({
    ...READY_INPUTS, fiatChargeAmount: 830_000_000n, demo: true, demoRate: 83, buyPrice: null, credit: null,
  });
  assert.deepStrictEqual(r, { status: "ready", usdcAmount: 10_000_000n }); // ₹830 / 83 = 10 USDC
});

test("demo fiat too small for the demo rate is blocked", () => {
  const r = computeAmountResolution({
    ...READY_INPUTS, fiatChargeAmount: 0n, demo: true, demoRate: 83, buyPrice: null,
  });
  assert.strictEqual(r.status, "too-small");
});
