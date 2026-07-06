import { test } from "node:test";
import assert from "node:assert";
import {
  chargedUsdc,
  creditFullyCovers,
  computeGateDecision,
  deriveGate,
  type PendingOrderSummary,
} from "./credit-math.ts";

// ─── chargedUsdc ────────────────────────────────────────────────────

test("chargedUsdc subtracts credit from the order amount", () => {
  assert.strictEqual(chargedUsdc(10_000_000n, 3_000_000n), 7_000_000n);
});

test("chargedUsdc clamps at 0 when credit exceeds the order", () => {
  assert.strictEqual(chargedUsdc(2_000_000n, 5_000_000n), 0n);
});

test("chargedUsdc returns the full amount when credit is zero", () => {
  assert.strictEqual(chargedUsdc(10_000_000n, 0n), 10_000_000n);
});

test("chargedUsdc returns 0 when credit exactly matches the order", () => {
  assert.strictEqual(chargedUsdc(5_000_000n, 5_000_000n), 0n);
});

// ─── creditFullyCovers ──────────────────────────────────────────────

test("creditFullyCovers is true when credit equals order amount", () => {
  assert.strictEqual(creditFullyCovers(5_000_000n, 5_000_000n), true);
});

test("creditFullyCovers is true when credit exceeds order amount", () => {
  assert.strictEqual(creditFullyCovers(5_000_000n, 10_000_000n), true);
});

test("creditFullyCovers is false when credit is short of order", () => {
  assert.strictEqual(creditFullyCovers(5_000_000n, 4_999_999n), false);
});

test("creditFullyCovers is false for a zero-amount order (no goods to redeem)", () => {
  // Edge case: a 0-USDC order with any credit isn't really "fully covered",
  // it's just empty. Guards against accidental no-op redemption.
  assert.strictEqual(creditFullyCovers(0n, 100n), false);
});

// ─── computeGateDecision ────────────────────────────────────────────
//
// Rule: one in-flight order at a time. Any pending order blocks a new
// placement, regardless of amount or credit.

const pendingA: PendingOrderSummary = { orderId: "100", usdcAmount: 5_000_000n };
const pendingB: PendingOrderSummary = { orderId: "101", usdcAmount: 10_000_000n };

test("computeGateDecision: no pending → allow", () => {
  assert.deepStrictEqual(computeGateDecision([], 5_000_000n), { kind: "allow" });
});

test("computeGateDecision: same-amount pending → reject (no more silent auto-resume)", () => {
  const gate = computeGateDecision([pendingA], 5_000_000n);
  assert.deepStrictEqual(gate, { kind: "reject", conflict: pendingA });
});

test("computeGateDecision: different-amount pending → reject", () => {
  const gate = computeGateDecision([pendingA], 7_000_000n);
  assert.deepStrictEqual(gate, { kind: "reject", conflict: pendingA });
});

test("computeGateDecision: undefined usdcAmount short-circuits to allow (tracking-only mode)", () => {
  assert.deepStrictEqual(computeGateDecision([pendingA], undefined), { kind: "allow" });
});

test("computeGateDecision: multiple pending → reject with the first as conflict (stable)", () => {
  // Surface the first pending order deterministically. Hosts can decide
  // ordering when populating `fetchPendingOrders` if they want a specific
  // one shown.
  const gate = computeGateDecision([pendingB, pendingA], 5_000_000n);
  assert.deepStrictEqual(gate, { kind: "reject", conflict: pendingB });
});

// ─── deriveGate (pure gate status; recomputes from the CURRENT amount) ─
//
// The gate is DERIVED, not stored: the credit/pending FETCH is keyed on the
// signer alone, and this pure function folds the resolved order amount into
// the decision on every render. That's what keeps fiatChargeAmount mode from
// briefly showing an enabled Pay button to a user who already has a pending
// order — in the old code the gate was computed once inside the fetch from the
// amount captured at fetch time (still `undefined` while the fiat rate loaded),
// so it stuck on "allow" until a second, amount-triggered refetch corrected it.

test("deriveGate: gate not wired → allow even with a pending order", () => {
  // No fetchers / no signer: the concurrency gate is inactive, so nothing to
  // gate regardless of what's in `pendingOrders`.
  assert.deepStrictEqual(deriveGate(false, [pendingA], 5_000_000n), { kind: "allow" });
});

test("deriveGate: wired but pending not yet fetched (null) → loading", () => {
  assert.strictEqual(deriveGate(true, null, 5_000_000n), "loading");
});

test("deriveGate: wired, no pending → allow", () => {
  assert.deepStrictEqual(deriveGate(true, [], 5_000_000n), { kind: "allow" });
});

test("deriveGate: wired, pending + resolved amount → reject (reflects the CURRENT amount)", () => {
  // The regression this fixes: once the fiat rate resolves the order amount,
  // the gate must reject in the SAME render — never pass through an enabled
  // "allow" on a stale/undefined amount.
  assert.deepStrictEqual(
    deriveGate(true, [pendingA], 10_937_500n),
    { kind: "reject", conflict: pendingA },
  );
});

test("deriveGate: wired, pending + amount still undefined → allow (masked by the quote-pending hold)", () => {
  // While the fiat amount is resolving, `resolvedUsdcAmount` is undefined and
  // computeGateDecision short-circuits to allow — but the widget is holding the
  // Pay button on `amountStatus === "pending"` in that window, so no enabled
  // allow is ever shown. The point of deriving is that the instant the amount
  // lands, this recomputes to reject (previous test) with no refetch.
  assert.deepStrictEqual(deriveGate(true, [pendingA], undefined), { kind: "allow" });
});
