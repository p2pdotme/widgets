/**
 * Pure helpers for the credit-aware checkout flow. Kept integrator-agnostic
 * — the host's `fetchCredit` / `fetchPendingOrders` callbacks supply the raw
 * numbers; everything else (display math, gate decision) is just arithmetic
 * and array search.
 *
 * Extracted into its own module so the helpers can be unit-tested without
 * spinning up the React reducer or a publicClient.
 */

/** A user's currently-pending order, as reported by the host's
 *  `fetchPendingOrders` callback. `usdcAmount` is the FULL purchase intent
 *  (not the Diamond-side delta on a credit-applied order). */
export interface PendingOrderSummary {
  orderId: string;
  usdcAmount: bigint;
}

/** Net USDC the user is actually charged for an order, after the integrator
 *  nets stranded proxy credit. Clamps at 0 — credit can cover the order
 *  fully, but it can't "owe" the user. */
export function chargedUsdc(usdcAmount: bigint, credit: bigint): bigint {
  if (credit >= usdcAmount) return 0n;
  return usdcAmount - credit;
}

/** True when credit fully covers the order. In this case, the host's
 *  integrator-side `userPlaceOrder` (or equivalent) is expected to take the
 *  credit-only fast path: no Diamond order is placed, tickets/goods are
 *  redeemed directly from proxy USDC. The host then returns
 *  `{ ..., creditOnly: true }` from its `placeOrder` callback and the widget
 *  collapses to the redeemed success screen. */
export function creditFullyCovers(usdcAmount: bigint, credit: bigint): boolean {
  return credit >= usdcAmount && usdcAmount > 0n;
}

/** Find a pending order whose full-purchase-intent USDC amount matches the
 *  widget's `usdcAmount` prop EXACTLY. Used by the credit-aware concurrency
 *  gate to decide between "auto-resume the same-amount pending order" and
 *  "reject this new order until the pending one finishes". */
export function findMatchingPending(
  pending: PendingOrderSummary[],
  usdcAmount: bigint,
): PendingOrderSummary | null {
  return pending.find((p) => p.usdcAmount === usdcAmount) ?? null;
}

export type GateDecision =
  /** Render the regular pre-order form. Either there's no credit or no
   *  pending order, so the existing flow applies. */
  | { kind: "allow" }
  /** Same-amount pending order found while credit > 0 — flip the widget
   *  into tracking-only mode for `orderId` and skip placement. */
  | { kind: "auto-resume"; orderId: string }
  /** credit > 0 AND a pending order exists but its amount doesn't match the
   *  current widget's `usdcAmount`. The widget renders the rejection
   *  screen showing the conflicting order; host can navigate via
   *  `onResumeRequest`. */
  | { kind: "reject"; conflict: PendingOrderSummary };

/**
 * The concurrency gate. Rule:
 *
 *   - no pending                  → allow
 *   - pending matches `usdcAmount` → auto-resume that order (regardless of credit)
 *   - pending doesn't match:
 *       - credit > 0              → reject (credit can race across orders)
 *       - credit == 0             → allow (concurrent different-amount orders ok)
 *
 * The same-amount auto-resume engages regardless of credit because clicking
 * "Pay" with the same amount as an existing pending order is almost always
 * a duplicate-click / refresh, not intentional concurrency. The
 * different-amount-with-credit reject still exists because the integrator's
 * on-chain credit-netting can produce inconsistent Diamond deltas if two
 * orders compete for the same proxy USDC.
 *
 * `usdcAmount` is the new order's intended purchase total (full intent,
 * matching what hosts report via `fetchPendingOrders`).
 */
export function computeGateDecision(
  credit: bigint,
  pending: PendingOrderSummary[],
  usdcAmount: bigint | undefined,
): GateDecision {
  if (pending.length === 0) return { kind: "allow" };

  // No widget-side amount to compare against → fall through to allow. This
  // happens for tracking-only modes where the host never set `usdcAmount`;
  // those flows already have an explicit orderId and aren't placing a new
  // order anyway, so gating doesn't apply.
  if (usdcAmount === undefined) return { kind: "allow" };

  const match = findMatchingPending(pending, usdcAmount);
  if (match) return { kind: "auto-resume", orderId: match.orderId };

  // No same-amount match. With credit, the user must finish the pending
  // order first because the integrator's proxy USDC can be raced by two
  // in-flight orders. Without credit, concurrent different-amount orders
  // are independent and safe to allow.
  if (credit > 0n) return { kind: "reject", conflict: pending[0] };
  return { kind: "allow" };
}
