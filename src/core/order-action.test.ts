import { test } from "node:test";
import assert from "node:assert";
import type { Order } from "@p2pdotme/sdk/orders";
import {
  computeOrderAction,
  formatRemaining,
  BUY_DISPUTE_OPEN_MS,
  BUY_DISPUTE_CLOSE_MS,
  SELL_PAY_DISPUTE_OPEN_MS,
  SELL_PAY_DISPUTE_CLOSE_MS,
} from "./order-action.ts";

// All test cases pin `placedAt` to a fixed epoch second and pass `now`
// as the placedAt+elapsed time. This keeps the elapsed math explicit at
// the call site so a reader can match each case directly against the
// dispute window constants without doing wallclock arithmetic in their
// head.
const PLACED_AT_SEC = 1_700_000_000n;
const PLACED_AT_MS = Number(PLACED_AT_SEC) * 1000;

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: 169n,
    type: "buy",
    status: "placed",
    usdcAmount: 0n,
    fiatAmount: 0n,
    actualUsdcAmount: 0n,
    actualFiatAmount: 0n,
    currency: "INR",
    user: "0x0000000000000000000000000000000000000001",
    recipient: "0x0000000000000000000000000000000000000001",
    acceptedMerchant: "0x0000000000000000000000000000000000000002",
    placedAt: PLACED_AT_SEC,
    acceptedAt: 0n,
    paidAt: 0n,
    completedAt: 0n,
    circleId: 1n,
    fixedFeePaid: 0n,
    tipsPaid: 0n,
    disputeStatus: "none",
    encUpi: "",
    encMerchantUpi: "",
    pubkey: "",
    ...overrides,
  } as Order;
}

// ─── Dispute lifecycle short-circuits over status flow ─────────────────

test("disputeStatus=open short-circuits regardless of order.status", () => {
  const out = computeOrderAction(
    baseOrder({ status: "paid", disputeStatus: "open" }),
    PLACED_AT_MS,
  );
  assert.strictEqual(out.statusText, "Under review");
  assert.deepStrictEqual(out.action, { kind: "none" });
  assert.strictEqual(out.disputeState, "open");
});

test("disputeStatus=resolved short-circuits regardless of order.status", () => {
  const out = computeOrderAction(
    baseOrder({ status: "completed", disputeStatus: "resolved" }),
    PLACED_AT_MS,
  );
  assert.strictEqual(out.statusText, "Resolved");
  assert.deepStrictEqual(out.action, { kind: "none" });
  assert.strictEqual(out.disputeState, "resolved");
});

// ─── placed ────────────────────────────────────────────────────────────

test("placed: status only, no action", () => {
  const out = computeOrderAction(baseOrder({ status: "placed" }), PLACED_AT_MS);
  assert.strictEqual(out.statusText, "Placed · matching");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── accepted ──────────────────────────────────────────────────────────

test("accepted BUY: resume action surfaces", () => {
  const out = computeOrderAction(
    baseOrder({ status: "accepted", type: "buy" }),
    PLACED_AT_MS,
  );
  assert.strictEqual(out.statusText, "Accepted · awaiting your payment");
  assert.deepStrictEqual(out.action, { kind: "resume" });
});

test("accepted SELL: status only (merchant pays user)", () => {
  const out = computeOrderAction(
    baseOrder({ status: "accepted", type: "sell" }),
    PLACED_AT_MS,
  );
  assert.strictEqual(out.statusText, "Accepted · processing payment");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("accepted PAY: status only", () => {
  const out = computeOrderAction(
    baseOrder({ status: "accepted", type: "pay" }),
    PLACED_AT_MS,
  );
  assert.strictEqual(out.statusText, "Accepted · processing payment");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── paid BUY ──────────────────────────────────────────────────────────
//
// On-chain `raiseDispute` rejects BUY orders with status=PAID — the
// dispute path opens only after the order moves to CANCELLED with
// paidAt > 0 (covered below under cancelled BUY). PAID BUY is a
// no-action terminal-ish state where the user waits for the merchant
// to complete OR for the order to auto-cancel.

test("paid BUY: no action regardless of elapsed (chain requires CANCELLED)", () => {
  for (const elapsed of [
    5 * 60 * 1000,
    BUY_DISPUTE_OPEN_MS,
    10 * 60 * 60 * 1000,
    BUY_DISPUTE_CLOSE_MS + 1,
  ]) {
    const out = computeOrderAction(
      baseOrder({ status: "paid", type: "buy", paidAt: 1n }),
      PLACED_AT_MS + elapsed,
    );
    assert.strictEqual(out.statusText, "Paid · processing payment");
    assert.deepStrictEqual(out.action, { kind: "none" });
  }
});

// ─── cancelled BUY (the real dispute path) ─────────────────────────────

test("cancelled BUY before window opens (paidAt > 0): countdown in status, no action", () => {
  const elapsed = 5 * 60 * 1000;
  const out = computeOrderAction(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
    PLACED_AT_MS + elapsed,
  );
  assert.strictEqual(
    out.statusText,
    `Cancelled · review opens in ${formatHelper(BUY_DISPUTE_OPEN_MS - elapsed)}`,
  );
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("cancelled BUY at open boundary: report-problem, ring full, paidAt>0 required", () => {
  const elapsed = BUY_DISPUTE_OPEN_MS;
  const out = computeOrderAction(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
    PLACED_AT_MS + elapsed,
  );
  assert.strictEqual(
    out.statusText,
    "Cancelled · contact support to recover funds",
  );
  if (out.action.kind !== "report-problem") {
    throw new Error("expected report-problem action");
  }
  assert.strictEqual(out.action.remainingMs, BUY_DISPUTE_CLOSE_MS - elapsed);
  assert.strictEqual(out.action.filled, 1);
});

test("cancelled BUY mid-window: ring fill proportional", () => {
  const elapsed = 10 * 60 * 60 * 1000;
  const out = computeOrderAction(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
    PLACED_AT_MS + elapsed,
  );
  if (out.action.kind !== "report-problem") {
    throw new Error("expected report-problem action");
  }
  const windowMs = BUY_DISPUTE_CLOSE_MS - BUY_DISPUTE_OPEN_MS;
  assert.strictEqual(
    out.action.filled,
    (BUY_DISPUTE_CLOSE_MS - elapsed) / windowMs,
  );
});

test("cancelled BUY past window: no action, review window closed", () => {
  const elapsed = BUY_DISPUTE_CLOSE_MS + 1;
  const out = computeOrderAction(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
    PLACED_AT_MS + elapsed,
  );
  assert.strictEqual(out.statusText, "Cancelled · review window closed");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("cancelled BUY with paidAt == 0: no action — order expired before user paid", () => {
  const out = computeOrderAction(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 0n }),
    PLACED_AT_MS + BUY_DISPUTE_OPEN_MS + 60 * 60 * 1000,
  );
  assert.strictEqual(out.statusText, "Cancelled");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── paid SELL/PAY ─────────────────────────────────────────────────────

test("paid SELL: merchant-paid status, no dispute affordance (user must confirm)", () => {
  const out = computeOrderAction(
    baseOrder({ status: "paid", type: "sell" }),
    PLACED_AT_MS + 60 * 60 * 1000,
  );
  assert.strictEqual(out.statusText, "Payment received · confirm to complete");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── completed BUY ─────────────────────────────────────────────────────

test("completed BUY: terminal, no action regardless of elapsed", () => {
  const out = computeOrderAction(
    baseOrder({ status: "completed", type: "buy" }),
    PLACED_AT_MS + 30 * 60 * 1000,
  );
  assert.strictEqual(out.statusText, "Completed");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── completed SELL/PAY ────────────────────────────────────────────────

test("completed SELL before window opens: status carries countdown", () => {
  const elapsed = 10 * 60 * 1000;
  const out = computeOrderAction(
    baseOrder({ status: "completed", type: "sell" }),
    PLACED_AT_MS + elapsed,
  );
  assert.strictEqual(
    out.statusText,
    `Completed · review opens in ${formatHelper(SELL_PAY_DISPUTE_OPEN_MS - elapsed)}`,
  );
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("completed PAY inside window (1h elapsed): report-problem available", () => {
  const elapsed = 60 * 60 * 1000;
  const out = computeOrderAction(
    baseOrder({ status: "completed", type: "pay" }),
    PLACED_AT_MS + elapsed,
  );
  assert.strictEqual(out.statusText, "Completed");
  if (out.action.kind !== "report-problem") {
    throw new Error("expected report-problem action");
  }
  assert.strictEqual(
    out.action.remainingMs,
    SELL_PAY_DISPUTE_CLOSE_MS - elapsed,
  );
  const windowMs = SELL_PAY_DISPUTE_CLOSE_MS - SELL_PAY_DISPUTE_OPEN_MS;
  assert.strictEqual(
    out.action.filled,
    (SELL_PAY_DISPUTE_CLOSE_MS - elapsed) / windowMs,
  );
});

test("completed SELL past 7d: window closed", () => {
  const elapsed = SELL_PAY_DISPUTE_CLOSE_MS + 1;
  const out = computeOrderAction(
    baseOrder({ status: "completed", type: "sell" }),
    PLACED_AT_MS + elapsed,
  );
  assert.strictEqual(out.statusText, "Completed · review window closed");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── cancelled SELL/PAY ────────────────────────────────────────────────

test("cancelled SELL: terminal, no action", () => {
  const out = computeOrderAction(
    baseOrder({ status: "cancelled", type: "sell" }),
    PLACED_AT_MS + 60 * 60 * 1000,
  );
  assert.strictEqual(out.statusText, "Cancelled");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

// ─── formatRemaining (inlined sibling) ────────────────────────────────

const SEC = 1000;
const MN = 60 * SEC;
const HR = 60 * MN;
const DY = 24 * HR;

test("formatRemaining: 0s for non-positive input", () => {
  assert.strictEqual(formatRemaining(0), "0s");
  assert.strictEqual(formatRemaining(-1), "0s");
});

test("formatRemaining: 0s for non-finite input", () => {
  assert.strictEqual(formatRemaining(Number.NaN), "0s");
  assert.strictEqual(formatRemaining(Number.POSITIVE_INFINITY), "0s");
});

test("formatRemaining: sub-minute → seconds", () => {
  assert.strictEqual(formatRemaining(1 * SEC), "1s");
  assert.strictEqual(formatRemaining(42 * SEC), "42s");
  assert.strictEqual(formatRemaining(59 * SEC + 999), "59s");
});

test("formatRemaining: minute boundary", () => {
  assert.strictEqual(formatRemaining(60 * SEC), "1m");
});

test("formatRemaining: sub-hour → minutes", () => {
  assert.strictEqual(formatRemaining(12 * MN), "12m");
  assert.strictEqual(formatRemaining(59 * MN + 59 * SEC), "59m");
});

test("formatRemaining: hour boundary as 1h 0m", () => {
  assert.strictEqual(formatRemaining(60 * MN), "1h 0m");
});

test("formatRemaining: sub-day → <h>h <m>m", () => {
  assert.strictEqual(formatRemaining(4 * HR + 23 * MN), "4h 23m");
  assert.strictEqual(formatRemaining(23 * HR + 59 * MN), "23h 59m");
});

test("formatRemaining: day boundary as 1d 0h", () => {
  assert.strictEqual(formatRemaining(24 * HR), "1d 0h");
});

test("formatRemaining: multi-day → <d>d <h>h", () => {
  assert.strictEqual(formatRemaining(2 * DY + 4 * HR), "2d 4h");
  assert.strictEqual(formatRemaining(7 * DY), "7d 0h");
});

// Helper used by the order-action cases above. Same logic as
// formatRemaining; defined here so the assertions don't depend on the
// source under test for their own pre-conditions.
function formatHelper(remainingMs: number): string {
  if (remainingMs <= 0) return "0s";
  const totalSeconds = Math.floor(remainingMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remM = totalMinutes - totalHours * 60;
  if (totalHours < 24) return `${totalHours}h ${remM}m`;
  const totalDays = Math.floor(totalHours / 24);
  const remH = totalHours - totalDays * 24;
  return `${totalDays}d ${remH}h`;
}
