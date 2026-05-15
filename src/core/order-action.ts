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
import { formatRemaining } from "./format-remaining.ts";

export type ActionVariant =
  | { kind: "none" }
  | { kind: "resume" }
  | { kind: "raise-dispute"; remainingMs: number };

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
      statusText: "Dispute under review",
      action: { kind: "none" },
      disputeState: "open",
    };
  }
  if (order.disputeStatus === "resolved") {
    return {
      statusText: "Dispute resolved",
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
        return computeDisputeWindow({
          openMs: BUY_DISPUTE_OPEN_MS,
          closeMs: BUY_DISPUTE_CLOSE_MS,
          elapsed,
          beforeOpenLabel: "Paid",
          insideLabel: "Paid · awaiting merchant completion",
          afterCloseLabel: "Paid · dispute window closed",
        });
      }
      // SELL or PAY in PAID state means the merchant has paid the user;
      // user must mark complete next.
      return noAction("Merchant paid · awaiting your confirmation");
    }

    case "completed": {
      if (order.type === "buy") {
        // BUY's dispute window is [PAID +15m, PAID +24h]; once completed
        // it's terminal-good. No dispute affordance.
        return noAction("Completed");
      }
      return computeDisputeWindow({
        openMs: SELL_PAY_DISPUTE_OPEN_MS,
        closeMs: SELL_PAY_DISPUTE_CLOSE_MS,
        elapsed,
        beforeOpenLabel: "Completed",
        insideLabel: "Completed",
        afterCloseLabel: "Completed · dispute window closed",
      });
    }

    case "cancelled":
      return noAction("Cancelled");

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
      statusText: `${beforeOpenLabel} · dispute opens in ${formatRemaining(remaining)}`,
      action: { kind: "none" },
      disputeState: "none",
    };
  }
  if (elapsed <= closeMs) {
    const remaining = closeMs - elapsed;
    return {
      statusText: insideLabel,
      action: { kind: "raise-dispute", remainingMs: remaining },
      disputeState: "none",
    };
  }
  return {
    statusText: afterCloseLabel,
    action: { kind: "none" },
    disputeState: "none",
  };
}
