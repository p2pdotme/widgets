// Pure state machine that maps (Order, now) → what to render in the
// smart layout per row of <PaymentHistoryWithSupport>. Three independent
// outputs:
//
//   - statusText   : informational line, ALWAYS rendered
//   - action       : the action button variant (none | resume |
//                    report-problem | appeal) with the remaining ms for
//                    countdown rendering
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
    }
  | {
      kind: "appeal";
      /** `appeal`: challenge a pending decision against the user.
       *  `escalate`: the current tier missed its decision deadline. */
      mode: "appeal" | "escalate";
      /** Tier the dispute moves to on `appealDispute`. */
      nextTier: DisputeTier;
      /** Time left to appeal a pending decision (absent for escalate,
       *  which stays open until the tier decides). */
      remainingMs?: number;
    };

export type DisputeState = "none" | "open" | "resolved";

// ─── 3-tier dispute ladder ─────────────────────────────────────────────
//
// Mirrors contracts-v4 OrderProcessorFacet (appealDispute / finalizeDispute
// / adminSettleDispute). A raised dispute starts at tier 1 (circle), can be
// appealed to tier 2 (country admin) and tier 3 (ops lead, final). Only a
// tier-1/2 USER-fault decision is parked for the currency's appeal window
// (MERCHANT / BANK and tier-3 decisions settle in the same tx), so a
// pending decision is a decision against the order's user. Throughout the
// window `disputeInfo.status` stays RAISED, so `disputeStatus` alone reads
// "open" and cannot tell the user they lost. Only `order.user` can appeal.

export type DisputeTier = 1 | 2 | 3;

export const DISPUTE_TIER_LABEL: Record<DisputeTier, string> = {
  1: "Circle review",
  2: "Country admin review",
  3: "Final review",
};

/** On-chain FaultType enum order (OrderProcessorStorage.FaultType). */
const FAULT_TYPES = ["DEFAULT", "USER", "MERCHANT", "BANK"] as const;
export type DisputeFaultType = (typeof FAULT_TYPES)[number];

export interface DisputeDecision {
  faultType: DisputeFaultType;
  decisionTier: DisputeTier;
  /** unix seconds */
  decidedAt: number;
  /** unix seconds — end of the appeal window */
  appealableUntil: number;
}

/** A raised dispute's position on the ladder, from `getDisputeTier` +
 *  `getDisputeDecision`. Timestamps are unix seconds. */
export interface DisputeEscalation {
  tier: DisputeTier;
  tierSince: number;
  /** When an undecided dispute may be escalated (0 at tier 3 or while a
   *  decision is pending). */
  appealableAt: number;
  decision: DisputeDecision | null;
}

export type DisputeEscalationPhase =
  /** undecided, decision SLA still running */
  | "awaiting-decision"
  /** undecided, SLA lapsed — the user may escalate */
  | "escalatable"
  /** decision recorded and still open to appeal */
  | "decision-pending"
  /** decision recorded, appeal window over — waits for finalizeDispute */
  | "decision-stands"
  /** undecided at the final tier */
  | "final-review";

const toTier = (raw: number): DisputeTier =>
  raw <= 1 ? 1 : raw >= 3 ? 3 : 2;

/** Build a `DisputeEscalation` from the raw `getDisputeTier` and
 *  `getDisputeDecision` results. */
export function parseDisputeEscalation(
  tierTuple: readonly [number, bigint, bigint],
  decisionTuple: readonly [number, number, string, bigint, bigint],
): DisputeEscalation {
  const [tier, tierSince, appealableAt] = tierTuple;
  const [faultType, decisionTier, , decidedAt, appealableUntil] =
    decisionTuple;
  return {
    tier: toTier(tier),
    tierSince: Number(tierSince),
    appealableAt: Number(appealableAt),
    decision:
      decidedAt === 0n
        ? null
        : {
            faultType: FAULT_TYPES[faultType] ?? "DEFAULT",
            decisionTier: toTier(decisionTier),
            decidedAt: Number(decidedAt),
            appealableUntil: Number(appealableUntil),
          },
  };
}

export function disputeEscalationPhase(
  escalation: DisputeEscalation,
  nowMs: number,
): DisputeEscalationPhase {
  const { tier, appealableAt, decision } = escalation;
  if (decision) {
    return nowMs < decision.appealableUntil * 1000
      ? "decision-pending"
      : "decision-stands";
  }
  if (tier >= 3) return "final-review";
  return appealableAt > 0 && nowMs >= appealableAt * 1000
    ? "escalatable"
    : "awaiting-decision";
}

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

export interface ComputeOrderActionOpts {
  /** On-chain ladder state for an open dispute (see `useDisputeEscalation`).
   *  Absent → an open dispute renders the plain "Under review". */
  escalation?: DisputeEscalation;
  /** Address that would sign `appealDispute`. The appeal action is only
   *  offered when it equals `order.user` (the contract rejects anyone
   *  else). Without a match (no `txSigner`, or a different wallet) the
   *  row shows the stage in neutral wording and offers no action. */
  actor?: string;
}

export function computeOrderAction(
  order: Order,
  nowMs: number,
  opts: ComputeOrderActionOpts = {},
): OrderActionState {
  // Dispute lifecycle is short-circuited at the top. A raised or settled
  // dispute is always the most relevant state; downstream status flow
  // becomes secondary.
  if (order.disputeStatus === "open") {
    if (opts.escalation) {
      const canAct =
        !!opts.actor &&
        !!order.user &&
        opts.actor.toLowerCase() === order.user.toLowerCase();
      return openDisputeState(opts.escalation, nowMs, canAct);
    }
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
      // The chain's status field is sticky on PLACED until an explicit
      // `autoCancelExpiredOrders` sweep runs, which can lag the actual
      // accept-window expiry. Past `PLACED_STALE_THRESHOLD_MS` we surface
      // the staleness in the row so users don't keep waiting on an order
      // that no merchant can pick up anymore.
      if (elapsed >= PLACED_STALE_THRESHOLD_MS) {
        return noAction(
          "Placed · still matching, this is taking longer than usual",
        );
      }
      return noAction("Placed · matching");

    case "accepted":
      if (order.type === "buy") {
        return resumeable("Accepted · awaiting your payment");
      }
      return noAction("Accepted · processing payment");

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
              `Paid · processing payment · will resolve within ${formatRemaining(remaining)}`,
              true,
            );
          }
          return noAction("Paid · processing payment");
        }
        if (elapsed >= PLACED_STALE_THRESHOLD_MS) {
          return noAction(
            "Paid · processing payment · taking longer than usual",
          );
        }
        return noAction("Paid · processing payment");
      }
      // SELL or PAY in PAID state means the user has been paid; they
      // mark complete next.
      return noAction("Payment received · confirm to complete");
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

function openDisputeState(
  escalation: DisputeEscalation,
  nowMs: number,
  canAct: boolean,
): OrderActionState {
  const phase = disputeEscalationPhase(escalation, nowMs);
  const tierLabel = DISPUTE_TIER_LABEL[escalation.tier];
  const open = (
    statusText: string,
    action: ActionVariant = { kind: "none" },
    live = false,
  ): OrderActionState => ({ statusText, action, disputeState: "open", live });

  switch (phase) {
    case "decision-pending": {
      const decision = escalation.decision!;
      const remainingMs = decision.appealableUntil * 1000 - nowMs;
      // Only USER fault is parked on chain today; anything else would be
      // in the user's favour and is shown without an appeal.
      if (decision.faultType !== "USER") {
        return open(`${DISPUTE_TIER_LABEL[decision.decisionTier]} · decision recorded`);
      }
      const left = formatRemaining(remainingMs);
      return canAct
        ? open(
            `Decided against you · appeal within ${left}`,
            {
              kind: "appeal",
              mode: "appeal",
              nextTier: toTier(decision.decisionTier + 1),
              remainingMs,
            },
            true,
          )
        // Neutral wording: this viewer may not be the order's user.
        : open(`Decided against the order's wallet · appeal window closes in ${left}`, undefined, true);
    }
    case "decision-stands":
      return open(
        escalation.decision!.faultType === "USER"
          ? canAct
            ? "Decided against you · decision stands"
            : "Decided against the order's wallet · decision stands"
          : `${DISPUTE_TIER_LABEL[escalation.decision!.decisionTier]} · decision recorded`,
      );
    case "escalatable":
      return open(
        `${tierLabel} · decision overdue`,
        canAct
          ? { kind: "appeal", mode: "escalate", nextTier: toTier(escalation.tier + 1) }
          : undefined,
      );
    case "awaiting-decision":
      return escalation.appealableAt > 0
        ? open(
            `${tierLabel} · decision due in ${formatRemaining(escalation.appealableAt * 1000 - nowMs)}`,
            undefined,
            true,
          )
        : open(`${tierLabel} · under review`);
    case "final-review":
      return open("Final review · the decision will be final");
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
  const state = computeOrderAction(order, nowMs);
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
