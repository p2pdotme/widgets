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
import type { Translator } from "../i18n/t";

export type { Translator };

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
export function formatRemaining(remainingMs: number, t: Translator): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return t("orderAction.remainingSeconds", { n: 0 });
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  if (totalSeconds < 60) {
    return t("orderAction.remainingSeconds", { n: totalSeconds });
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return t("orderAction.remainingMinutes", { n: totalMinutes });
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes - totalHours * 60;
  if (totalHours < 24) {
    return t("orderAction.remainingHoursMinutes", {
      h: totalHours,
      m: remainderMinutes,
    });
  }
  const totalDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours - totalDays * 24;
  return t("orderAction.remainingDaysHours", {
    d: totalDays,
    h: remainderHours,
  });
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
  /** True when the row changes purely from the passage of time and must
   *  re-render to stay correct: a live countdown (report-problem chip, the
   *  pre-window "review opens in", the BUY/PAID "will resolve within"), or a
   *  dispute-window open/close boundary the row will cross. Drives the
   *  per-row 1s ticker (OrderAction.useCountdownTicker) so these rows stay
   *  live even on an all-terminal screen where the parent poll is idle (the
   *  poll only re-renders pending statuses). Static/terminal rows omit it. */
  live?: boolean;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const BUY_DISPUTE_OPEN_MS = 15 * MIN;
export const BUY_DISPUTE_CLOSE_MS = 24 * HOUR;
export const SELL_PAY_DISPUTE_OPEN_MS = 30 * MIN;
export const SELL_PAY_DISPUTE_CLOSE_MS = 7 * DAY;

// Threshold past which a still-unmatched PLACED order is "taking longer than
// usual". Anything beyond this is past the chain's typical accept window, so
// the row's status text reflects the staleness even when the on-chain status
// hasn't flipped to CANCELLED yet (the chain only flips on
// `autoCancelExpiredOrders` keeper sweeps, which can lag).
export const PLACED_STALE_THRESHOLD_MS = 5 * MIN;

// BUY/PAID staleness threshold (5min handled by PLACED_STALE_THRESHOLD_MS):
//   < 5min  → "Paid · processing payment"
//   5–30min → "Paid · processing payment · taking longer than usual"
//   ≥ 30min → "Paid · processing payment · will resolve within <countdown>"
// The "will resolve within" countdown is anchored on `BUY_DISPUTE_CLOSE_MS`
// (24h after placement) — the chain's outermost resolution deadline.
export const BUY_PAID_PROCESSING_WINDOW_MS = 30 * MIN;

/** Dummy translator for callers that only inspect `action.kind` (not copy). */
const noopT: Translator = (path) => path;

export function computeOrderAction(
  order: Order,
  nowMs: number,
  t: Translator,
): OrderActionState {
  // Dispute lifecycle is short-circuited at the top. A raised or settled
  // dispute is always the most relevant state; downstream status flow
  // becomes secondary.
  if (order.disputeStatus === "open") {
    return {
      statusText: t("orderAction.underReview"),
      action: { kind: "none" },
      disputeState: "open",
    };
  }
  if (order.disputeStatus === "resolved") {
    return {
      statusText: t("orderAction.resolved"),
      action: { kind: "none" },
      disputeState: "resolved",
    };
  }

  const placedMs = Number(order.placedAt) * 1000;
  const elapsed = nowMs - placedMs;

  switch (order.status) {
    case "placed":
      // The chain's status field is sticky on PLACED until an explicit
      // `autoCancelExpiredOrders` sweep runs, which can lag the actual
      // accept-window expiry. Past `PLACED_STALE_THRESHOLD_MS` we surface
      // the staleness in the row so users don't keep waiting on an order
      // that no merchant can pick up anymore.
      if (elapsed >= PLACED_STALE_THRESHOLD_MS) {
        return noAction(t("orderAction.placedStale"));
      }
      return noAction(t("orderAction.placedMatching"));

    case "accepted":
      if (order.type === "buy") {
        return resumeable(t("orderAction.acceptedAwaitingPayment"));
      }
      return noAction(t("orderAction.acceptedProcessing"));

    case "paid": {
      if (order.type === "buy") {
        // BUY/PAID = user paid, fulfillment in progress. The on-chain
        // raiseDispute rejects this status (contracts-v4 #raiseDispute
        // gates BUY on status=CANCELLED). The user waits for completion
        // or auto-cancellation.
        //
        // Three tiers of urgency:
        //   < 5min   → plain "Paid · processing payment"
        //   5–30min  → "· taking longer than usual" (gentle warning)
        //   ≥ 30min  → "· will resolve within <countdown>" anchored on
        //              the contract's auto-cancel deadline. Gives the
        //              user a hard upper bound when the merchant has
        //              clearly missed the typical window.
        if (elapsed >= BUY_PAID_PROCESSING_WINDOW_MS) {
          const remaining = BUY_DISPUTE_CLOSE_MS - elapsed;
          if (remaining > 0) {
            return noAction(
              t("orderAction.paidWillResolveWithin", {
                remaining: formatRemaining(remaining, t),
              }),
              true,
            );
          }
          return noAction(t("orderAction.paidProcessing"));
        }
        if (elapsed >= PLACED_STALE_THRESHOLD_MS) {
          return noAction(t("orderAction.paidTakingLonger"));
        }
        return noAction(t("orderAction.paidProcessing"));
      }
      // SELL or PAY in PAID state means the user has been paid; they
      // mark complete next.
      return noAction(t("orderAction.paymentReceivedConfirm"));
    }

    case "completed": {
      if (order.type === "buy") {
        // BUY/COMPLETED is terminal-good — no dispute affordance.
        return noAction(t("orderAction.completed"));
      }
      return computeDisputeWindow({
        openMs: SELL_PAY_DISPUTE_OPEN_MS,
        closeMs: SELL_PAY_DISPUTE_CLOSE_MS,
        elapsed,
        beforeOpenLabel: t("orderAction.completed"),
        insideLabel: t("orderAction.completed"),
        afterCloseLabel: t("orderAction.completedReviewClosed"),
        t,
      });
    }

    case "cancelled": {
      if (order.type === "buy") {
        // The only BUY dispute path: status=CANCELLED AND the user paid
        // before cancellation. Without paidAt > 0 the order expired before
        // any USDC was pulled — nothing to recover.
        if (order.paidAt === 0n) {
          return noAction(t("orderAction.cancelled"));
        }
        return computeDisputeWindow({
          openMs: BUY_DISPUTE_OPEN_MS,
          closeMs: BUY_DISPUTE_CLOSE_MS,
          elapsed,
          beforeOpenLabel: t("orderAction.cancelled"),
          insideLabel: t("orderAction.cancelledContactSupport"),
          afterCloseLabel: t("orderAction.cancelledReviewClosed"),
          t,
        });
      }
      // SELL/PAY cancelled = terminal-bad (e.g. merchant refunded). No
      // dispute path.
      return noAction(t("orderAction.cancelled"));
    }

    default:
      // Defensive: an unknown status maps to a no-op informational line
      // rather than crashing the row. The actual SDK union is closed, but
      // an over-the-wire change could surface a new value before the
      // widget catches up.
      return noAction(t("orderAction.statusUnavailable"));
  }
}

function noAction(statusText: string, live = false): OrderActionState {
  return { statusText, action: { kind: "none" }, disputeState: "none", live };
}

/** Is this past-window order still worth showing in an "actionable only"
 *  list? Returns `true` when the row has either an open dispute (the user
 *  can view it / chat is reachable when re-enabled) OR a user-actionable
 *  CTA the smart layout would render. Pending in-flight orders (placed /
 *  accepted / paid) are NOT in scope here — embedders include those
 *  unconditionally. Used by PaymentHistory's `filter="actionable"` mode
 *  to prevent the history list from accumulating completed-good and
 *  past-window-cancelled rows. */
export function isOrderActionable(
  order: Order,
  nowMs: number = Date.now(),
): boolean {
  if (order.disputeStatus === "open") return true;
  const state = computeOrderAction(order, nowMs, noopT);
  return state.action.kind !== "none";
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
  t: Translator;
}

function computeDisputeWindow(input: DisputeWindowInput): OrderActionState {
  const {
    openMs,
    closeMs,
    elapsed,
    beforeOpenLabel,
    insideLabel,
    afterCloseLabel,
    t,
  } = input;

  if (elapsed < openMs) {
    const remaining = openMs - elapsed;
    return {
      statusText: t("orderAction.reviewOpensIn", {
        label: beforeOpenLabel,
        remaining: formatRemaining(remaining, t),
      }),
      action: { kind: "none" },
      disputeState: "none",
      // Live: ticking the countdown also re-renders the row the instant it
      // crosses into the disputable window, surfacing the report-problem
      // recovery chip. Terminal-status pre-window rows have no parent poll.
      live: true,
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
      live: true,
    };
  }
  return {
    statusText: afterCloseLabel,
    action: { kind: "none" },
    disputeState: "none",
  };
}
