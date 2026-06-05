import { test } from "node:test";
import assert from "node:assert";
import {
  chargedUsdc,
  creditFullyCovers,
  computeGateDecision,
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
