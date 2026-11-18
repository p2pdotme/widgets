import { test } from "node:test";
import assert from "node:assert";
import type { Order } from "@p2pdotme/sdk/orders";
import {
  computeOrderAction,
  formatRemaining,
  isOrderActionable,
  parseDisputeEscalation,
  type DisputeEscalation,
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

test("placed: past staleness threshold surfaces 'taking longer'", () => {
  const out = computeOrderAction(
    baseOrder({ status: "placed" }),
    PLACED_AT_MS + 6 * 60 * 1000, // 6 minutes after placement, past 5-min threshold
  );
  assert.match(out.statusText, /taking longer than usual/);
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

test("paid BUY: status escalates by elapsed, no action (chain requires CANCELLED)", () => {
  const cases: ReadonlyArray<{ elapsed: number; expect: RegExp | string }> = [
    // < 5min: plain
    { elapsed: 60 * 1000, expect: "Paid · processing payment" },
    // 5–30min: taking longer than usual
    { elapsed: 10 * 60 * 1000, expect: "Paid · processing payment · taking longer than usual" },
    { elapsed: 29 * 60 * 1000, expect: "Paid · processing payment · taking longer than usual" },
    // ≥ 30min: will resolve within <countdown>, anchored on BUY_DISPUTE_CLOSE_MS
    { elapsed: 30 * 60 * 1000, expect: /^Paid · processing payment · will resolve within / },
    { elapsed: 10 * 60 * 60 * 1000, expect: /^Paid · processing payment · will resolve within / },
    // Past BUY_DISPUTE_CLOSE_MS (24h): countdown clamps, falls back to plain
    { elapsed: BUY_DISPUTE_CLOSE_MS + 1, expect: "Paid · processing payment" },
  ];
  for (const { elapsed, expect } of cases) {
    const out = computeOrderAction(
      baseOrder({ status: "paid", type: "buy", paidAt: 1n }),
      PLACED_AT_MS + elapsed,
    );
    if (typeof expect === "string") {
      assert.strictEqual(out.statusText, expect, `elapsed=${elapsed}ms`);
    } else {
      assert.match(out.statusText, expect, `elapsed=${elapsed}ms`);
    }
    assert.deepStrictEqual(out.action, { kind: "none" });
  }
});

test("paid BUY: live flag is set only for the 'will resolve within' countdown tier", () => {
  // Guards the OrderActionState.live flag on this branch: it drives the 1s
  // ticker, and a silent drop would freeze a long-pending paid-BUY countdown.
  const cases: ReadonlyArray<{ elapsed: number; live: boolean }> = [
    { elapsed: 60 * 1000, live: false }, // < 5min: plain
    { elapsed: 10 * 60 * 1000, live: false }, // 5-30min: taking longer
    { elapsed: 30 * 60 * 1000, live: true }, // >= 30min: live countdown begins
    { elapsed: 10 * 60 * 60 * 1000, live: true }, // mid-countdown
    { elapsed: BUY_DISPUTE_CLOSE_MS + 1, live: false }, // past 24h close: clamped to plain
  ];
  for (const { elapsed, live } of cases) {
    const out = computeOrderAction(
      baseOrder({ status: "paid", type: "buy", paidAt: 1n }),
      PLACED_AT_MS + elapsed,
    );
    assert.strictEqual(out.live === true, live, `elapsed=${elapsed}ms`);
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
// ─── isOrderActionable ─────────────────────────────────────────────────
//
// Used by `PaymentHistory` `filter="actionable"` to drop terminal /
// non-recoverable rows from the displayed list. Mirrors the smart-action
// machine: an order is "actionable" when it has an open dispute OR when
// the action variant computed for it is anything other than `"none"`.

test("isOrderActionable: open dispute → true regardless of base status", () => {
  for (const status of ["placed", "accepted", "paid", "completed", "cancelled"] as const) {
    const out = isOrderActionable(
      baseOrder({ status, disputeStatus: "open" }),
      PLACED_AT_MS,
    );
    assert.strictEqual(out, true, `expected actionable for status=${status}/disputeStatus=open`);
  }
});

test("isOrderActionable: resolved dispute → false (terminal-good for user)", () => {
  const out = isOrderActionable(
    baseOrder({ status: "completed", disputeStatus: "resolved" }),
    PLACED_AT_MS + 1,
  );
  assert.strictEqual(out, false);
});

test("isOrderActionable: BUY completed → false (terminal-good)", () => {
  const out = isOrderActionable(
    baseOrder({ status: "completed", type: "buy" }),
    PLACED_AT_MS + 1,
  );
  assert.strictEqual(out, false);
});

test("isOrderActionable: BUY cancelled with paidAt=0 → false (no funds at risk)", () => {
  const out = isOrderActionable(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 0n }),
    PLACED_AT_MS + BUY_DISPUTE_OPEN_MS + 1,
  );
  assert.strictEqual(out, false);
});

test("isOrderActionable: BUY cancelled paidAt>0 inside window → true (Contact Support chip)", () => {
  const out = isOrderActionable(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
    PLACED_AT_MS + BUY_DISPUTE_OPEN_MS + 1,
  );
  assert.strictEqual(out, true);
});

test("isOrderActionable: BUY cancelled paidAt>0 PAST window → false (review window closed)", () => {
  const out = isOrderActionable(
    baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
    PLACED_AT_MS + BUY_DISPUTE_CLOSE_MS + 1,
  );
  assert.strictEqual(out, false);
});

test("isOrderActionable: BUY accepted → true (Resume action)", () => {
  const out = isOrderActionable(
    baseOrder({ status: "accepted", type: "buy" }),
    PLACED_AT_MS,
  );
  assert.strictEqual(out, true);
});

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

// ─── 3-tier dispute ladder (escalation) ────────────────────────────────
//
// Timestamps in seconds; `now` is ms. USER = the order's user (baseOrder's
// `user`), so `actor: USER` is the wallet allowed to appeal.

const USER = "0x0000000000000000000000000000000000000001";
const OTHER = "0x00000000000000000000000000000000000000AA";
const T0 = 1_800_000_000;
const NOW_MS = T0 * 1000;
const H = 3600;

function undecided(tier: 1 | 2 | 3, appealableAt: number): DisputeEscalation {
  return { tier, tierSince: T0 - H, appealableAt, decision: null };
}
function decided(appealableUntil: number, decisionTier: 1 | 2 = 1, faultType: "USER" | "MERCHANT" = "USER"): DisputeEscalation {
  return {
    tier: decisionTier,
    tierSince: T0 - 2 * H,
    appealableAt: 0,
    decision: { faultType, decisionTier, decidedAt: T0 - H, appealableUntil },
  };
}
const openOrder = (overrides: Partial<Order> = {}) =>
  baseOrder({ status: "completed", type: "sell", disputeStatus: "open", user: USER, ...overrides });

test("escalation: parseDisputeEscalation maps tuples, tier 0 → 1, no decision when decidedAt=0", () => {
  const e = parseDisputeEscalation(
    [0, 5n, 9n],
    [0, 0, "0x0000000000000000000000000000000000000000", 0n, 0n],
  );
  assert.deepStrictEqual(e, { tier: 1, tierSince: 5, appealableAt: 9, decision: null });
  const d = parseDisputeEscalation([2, 5n, 0n], [1, 2, USER, 100n, 200n]);
  assert.deepStrictEqual(d.decision, { faultType: "USER", decisionTier: 2, decidedAt: 100, appealableUntil: 200 });
});

test("escalation: decision against the user, window open, actor is user → appeal action", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: decided(T0 + 3 * H), actor: USER });
  assert.strictEqual(out.statusText, "Decided against you · appeal within 3h 0m");
  assert.deepStrictEqual(out.action, { kind: "appeal", mode: "appeal", nextTier: 2, remainingMs: 3 * H * 1000 });
  assert.strictEqual(out.disputeState, "open");
  assert.strictEqual(out.live, true);
});

test("escalation: a pre-ladder dispute (tierSince 0, read straight off chain) is escalatable at once", () => {
  // getDisputeTier for a dispute raised before the ladder: tier 1, tierSince 0,
  // appealableAt = 0 + 24h SLA, i.e. long past.
  const e = parseDisputeEscalation([1, 0n, 86400n], [0, 0, "0x0000000000000000000000000000000000000000", 0n, 0n]);
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: e, actor: USER });
  assert.strictEqual(out.statusText, "Circle review · decision overdue");
  assert.deepStrictEqual(out.action, { kind: "appeal", mode: "escalate", nextTier: 2 });
});

test("escalation: actor match is case-insensitive", () => {
  const out = computeOrderAction(openOrder({ user: OTHER.toLowerCase() as `0x${string}` }), NOW_MS, {
    escalation: decided(T0 + H),
    actor: OTHER,
  });
  assert.strictEqual(out.action.kind, "appeal");
});

test("escalation: decision pending but actor is not order.user → neutral text, no action", () => {
  for (const actor of [OTHER, undefined]) {
    const out = computeOrderAction(openOrder(), NOW_MS, { escalation: decided(T0 + 3 * H), actor });
    assert.strictEqual(out.statusText, "Decided against the order's wallet · appeal window closes in 3h 0m");
    assert.deepStrictEqual(out.action, { kind: "none" });
  }
});

test("escalation: tier-2 decision appeals to tier 3", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: decided(T0 + H, 2), actor: USER });
  assert.strictEqual(out.action.kind === "appeal" && out.action.nextTier, 3);
});

test("escalation: at appealableUntil the window is closed → decision stands, no action", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: decided(T0), actor: USER });
  assert.strictEqual(out.statusText, "Decided against you · decision stands");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("escalation: decision stands, viewed without the order's wallet → neutral text", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: decided(T0) });
  assert.strictEqual(out.statusText, "Decided against the order's wallet · decision stands");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("escalation: a non-USER pending decision is not shown as against the user", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: decided(T0 + H, 1, "MERCHANT"), actor: USER });
  assert.strictEqual(out.statusText, "Circle review · decision recorded");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("escalation: undecided before the SLA → countdown, no action", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: undecided(1, T0 + 5 * H), actor: USER });
  assert.strictEqual(out.statusText, "Circle review · decision due in 5h 0m");
  assert.deepStrictEqual(out.action, { kind: "none" });
  assert.strictEqual(out.live, true);
});

test("escalation: SLA lapsed exactly at appealableAt → escalate (owner only)", () => {
  const own = computeOrderAction(openOrder(), NOW_MS, { escalation: undecided(2, T0), actor: USER });
  assert.strictEqual(own.statusText, "Country admin review · decision overdue");
  assert.deepStrictEqual(own.action, { kind: "appeal", mode: "escalate", nextTier: 3 });
  const other = computeOrderAction(openOrder(), NOW_MS, { escalation: undecided(2, T0), actor: OTHER });
  assert.strictEqual(other.statusText, "Country admin review · decision overdue");
  assert.deepStrictEqual(other.action, { kind: "none" });
});

test("escalation: tier 3 undecided → final review, no action", () => {
  const out = computeOrderAction(openOrder(), NOW_MS, { escalation: undecided(3, 0), actor: USER });
  assert.strictEqual(out.statusText, "Final review · the decision will be final");
  assert.deepStrictEqual(out.action, { kind: "none" });
});

test("escalation: ignored unless disputeStatus is open", () => {
  const out = computeOrderAction(openOrder({ disputeStatus: "resolved" }), NOW_MS, {
    escalation: decided(T0 + H),
    actor: USER,
  });
  assert.strictEqual(out.statusText, "Resolved");
});
