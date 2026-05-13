import { test } from "node:test";
import assert from "node:assert";
import {
  chargedUsdc,
  creditFullyCovers,
  findMatchingPending,
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

// ─── findMatchingPending ────────────────────────────────────────────

const pendingA: PendingOrderSummary = { orderId: "100", usdcAmount: 5_000_000n };
const pendingB: PendingOrderSummary = { orderId: "101", usdcAmount: 10_000_000n };

test("findMatchingPending returns the order with exact amount match", () => {
  const match = findMatchingPending([pendingA, pendingB], 5_000_000n);
  assert.deepStrictEqual(match, pendingA);
});

test("findMatchingPending returns null when no amount matches", () => {
  assert.strictEqual(findMatchingPending([pendingA, pendingB], 7_500_000n), null);
});

test("findMatchingPending returns null for an empty pending list", () => {
  assert.strictEqual(findMatchingPending([], 5_000_000n), null);
});

// ─── computeGateDecision ────────────────────────────────────────────

test("computeGateDecision: no pending → allow (regardless of credit)", () => {
  assert.deepStrictEqual(computeGateDecision(0n, [], 5_000_000n), { kind: "allow" });
  assert.deepStrictEqual(computeGateDecision(2_000_000n, [], 5_000_000n), { kind: "allow" });
});

test("computeGateDecision: zero credit + same-amount pending → auto-resume (prevents duplicate placement)", () => {
  const gate = computeGateDecision(0n, [pendingA], 5_000_000n);
  assert.deepStrictEqual(gate, { kind: "auto-resume", orderId: "100" });
});

test("computeGateDecision: zero credit + different-amount pending → allow (concurrent orders ok without credit)", () => {
  const gate = computeGateDecision(0n, [pendingA], 7_000_000n);
  assert.deepStrictEqual(gate, { kind: "allow" });
});

test("computeGateDecision: credit > 0 + amount match → auto-resume", () => {
  const gate = computeGateDecision(2_000_000n, [pendingA, pendingB], 5_000_000n);
  assert.deepStrictEqual(gate, { kind: "auto-resume", orderId: "100" });
});

test("computeGateDecision: credit > 0 + amount mismatch → reject with conflict", () => {
  const gate = computeGateDecision(2_000_000n, [pendingA], 7_000_000n);
  assert.deepStrictEqual(gate, { kind: "reject", conflict: pendingA });
});

test("computeGateDecision: undefined usdcAmount short-circuits to allow (tracking-only mode)", () => {
  const gate = computeGateDecision(2_000_000n, [pendingA], undefined);
  assert.deepStrictEqual(gate, { kind: "allow" });
});

test("computeGateDecision: when multiple pending exist and one matches, that one wins over others", () => {
  // Two pending orders for the same user; only the matching-amount one
  // auto-resumes. The non-matching one would be a separate conflict that
  // the user would resolve via the history widget — but the credit gate
  // here doesn't surface it because the match is sufficient.
  const gate = computeGateDecision(1_000_000n, [pendingB, pendingA], 5_000_000n);
  assert.deepStrictEqual(gate, { kind: "auto-resume", orderId: "100" });
});

test("computeGateDecision: when no match, conflict is the first pending order (stable)", () => {
  // Multiple non-matching pending — surface the first so the rejection UI
  // is deterministic. Hosts can decide ordering when populating
  // `fetchPendingOrders` if they want a specific one shown.
  const gate = computeGateDecision(1_000_000n, [pendingB, pendingA], 7_000_000n);
  assert.deepStrictEqual(gate, { kind: "reject", conflict: pendingB });
});
