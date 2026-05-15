// Pure state machine that maps (Order, now) → what to render in the
// smart layout per row of <PaymentHistoryWithSupport>. Three independent
// outputs:
//
//   - statusText   : informational line, ALWAYS rendered
//   - action       : the action button variant (none | resume | raise-dispute)
//                    with the remaining ms for countdown rendering
//   - disputeState : the chain's view of the dispute lifecycle; used by
//                    the support button to pick `dispute-open` /
//                    `dispute-resolved` variants. The support button's
//                    `chat-active` vs `chat-new` variant is decided
//                    separately by the parent component using ticket
//                    data from `/tickets/me` — that's outside this
//                    pure function's scope.
//
// Dispute windows match the on-chain enforcement in
// contracts-v4/contracts/facets/OrderProcessorFacet.sol#raiseDispute:
//
//   BUY,         status=PAID       : 15m  – 24h after `placedAt`
//   SELL or PAY, status=COMPLETED  : 30m  – 7d  after `placedAt`
//
// `now` is injected for deterministic tests and to support a one-time
// clock-skew correction at hook init (chain block.timestamp vs browser
// Date.now()).

import type { Order } from "@p2pdotme/sdk/orders";

// Compact remaining-time formatter inlined here (vs. a peer file
// imported by relative path) because node:test for the bridge runs
// without a TypeScript loader and won't resolve extension-less peer
// `.ts` imports. `formatRemaining` is small + tightly coupled to the
// state machine and tested alongside it.
//
//   < 60s        →  "<n>s"      (e.g. "42s")
//   < 60m        →  "<n>m"      (e.g. "12m")
//   < 24h        →  "<h>h <m>m" (e.g. "4h 23m")
//   ≥ 24h        →  "<d>d <h>h" (e.g. "2d 4h")
//
// Negative or non-finite input clamps to "0s" so the formatter never
// returns an empty or negative-looking string when a state machine
// slips one tick past its window.
export function formatRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0s";
  const totalSeconds = Math.floor(remainingMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes - totalHours * 60;
  if (totalHours < 24) return `${totalHours}h ${remainderMinutes}m`;
  const totalDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours - totalDays * 24;
  return `${totalDays}d ${remainderHours}h`;
}

export type ActionVariant =
  | { kind: "none" }
  | { kind: "resume" }
  | {
      kind: "report-problem";
      /** Time-left to file a report. Renders as the chip's countdown. */
      remainingMs: number;
      /** Doughnut fill fraction, drains 1.0 (window just opened) → 0.0
       *  (window just closed). Linear in elapsed-since-window-open. */
      filled: number;
    };

export type DisputeState = "none" | "open" | "resolved";

export interface OrderActionState {
  statusText: string;
  action: ActionVariant;
  disputeState: DisputeState;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const BUY_DISPUTE_OPEN_MS = 15 * MIN;
export const BUY_DISPUTE_CLOSE_MS = 24 * HOUR;
export const SELL_PAY_DISPUTE_OPEN_MS = 30 * MIN;
export const SELL_PAY_DISPUTE_CLOSE_MS = 7 * DAY;

export function computeOrderAction(
  order: Order,
  nowMs: number,
): OrderActionState {
  // Dispute lifecycle is short-circuited at the top. A raised or settled
  // dispute is always the most relevant state; downstream status flow
  // becomes secondary.
  if (order.disputeStatus === "open") {
    return {
      statusText: "Under review",
      action: { kind: "none" },
      disputeState: "open",
    };
  }
  if (order.disputeStatus === "resolved") {
    return {
      statusText: "Resolved",
      action: { kind: "none" },
      disputeState: "resolved",
    };
  }

  const placedMs = Number(order.placedAt) * 1000;
  const elapsed = nowMs - placedMs;

  switch (order.status) {
    case "placed":
      return noAction("Placed · awaiting merchant");

    case "accepted":
      if (order.type === "buy") {
        return resumeable("Accepted · awaiting your payment");
      }
      return noAction("Accepted · awaiting merchant payment");

    case "paid": {
      if (order.type === "buy") {
        // BUY/PAID = user paid, merchant hasn't completed yet. The on-chain
        // raiseDispute rejects this status (contracts-v4 #raiseDispute
        // gates BUY on status=CANCELLED). The user must wait for the
        // merchant to either complete or for the order to auto-cancel.
        return noAction("Paid · awaiting merchant completion");
      }
      // SELL or PAY in PAID state means the merchant has paid the user;
      // user must mark complete next.
      return noAction("Merchant paid · awaiting your confirmation");
    }

    case "completed": {
      if (order.type === "buy") {
        // BUY/COMPLETED is terminal-good — no dispute affordance.
        return noAction("Completed");
      }
      return computeDisputeWindow({
        openMs: SELL_PAY_DISPUTE_OPEN_MS,
        closeMs: SELL_PAY_DISPUTE_CLOSE_MS,
        elapsed,
        beforeOpenLabel: "Completed",
        insideLabel: "Completed",
        afterCloseLabel: "Completed · review window closed",
      });
    }

    case "cancelled": {
      if (order.type === "buy") {
        // The only BUY dispute path: status=CANCELLED AND the user paid
        // before cancellation. Without paidAt > 0 the order expired before
        // any USDC was pulled — nothing to recover.
        if (order.paidAt === 0n) {
          return noAction("Cancelled");
        }
        return computeDisputeWindow({
          openMs: BUY_DISPUTE_OPEN_MS,
          closeMs: BUY_DISPUTE_CLOSE_MS,
          elapsed,
          beforeOpenLabel: "Cancelled",
          insideLabel: "Cancelled · contact support to recover funds",
          afterCloseLabel: "Cancelled · review window closed",
        });
      }
      // SELL/PAY cancelled = terminal-bad (e.g. merchant refunded). No
      // dispute path.
      return noAction("Cancelled");
    }

    default:
      // Defensive: an unknown status maps to a no-op informational line
      // rather than crashing the row. The actual SDK union is closed, but
      // an over-the-wire change could surface a new value before the
      // widget catches up.
      return noAction("Status unavailable");
  }
}

function noAction(statusText: string): OrderActionState {
  return { statusText, action: { kind: "none" }, disputeState: "none" };
}

function resumeable(statusText: string): OrderActionState {
  return { statusText, action: { kind: "resume" }, disputeState: "none" };
}

interface DisputeWindowInput {
  openMs: number;
  closeMs: number;
  elapsed: number;
  /** Status prefix used when the window hasn't opened yet. The function
   *  appends ` · dispute opens in <countdown>`. */
  beforeOpenLabel: string;
  /** Status used inside the disputable window. The action button carries
   *  the countdown; this label stays static for readability. */
  insideLabel: string;
  afterCloseLabel: string;
}

function computeDisputeWindow(input: DisputeWindowInput): OrderActionState {
  const { openMs, closeMs, elapsed, beforeOpenLabel, insideLabel, afterCloseLabel } =
    input;

  if (elapsed < openMs) {
    const remaining = openMs - elapsed;
    return {
      statusText: `${beforeOpenLabel} · review opens in ${formatRemaining(remaining)}`,
      action: { kind: "none" },
      disputeState: "none",
    };
  }
  if (elapsed <= closeMs) {
    const remaining = closeMs - elapsed;
    const windowMs = closeMs - openMs;
    const filled = windowMs > 0 ? remaining / windowMs : 0;
    return {
      statusText: insideLabel,
      action: { kind: "report-problem", remainingMs: remaining, filled },
      disputeState: "none",
    };
  }
  return {
    statusText: afterCloseLabel,
    action: { kind: "none" },
    disputeState: "none",
  };
}
