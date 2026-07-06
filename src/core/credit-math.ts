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

export type GateDecision =
  /** Render the regular pre-order form. No pending order exists (or there's
   *  no placement intent), so the existing flow applies. */
  | { kind: "allow" }
  /** A pending order exists. Block this placement: the widget renders the
   *  rejection screen showing the conflicting order and (when wired) a
   *  Resume affordance. The user must complete or cancel the pending order
   *  before placing another. */
  | { kind: "reject"; conflict: PendingOrderSummary };

/**
 * The concurrency gate. Rule: one in-flight order at a time.
 *
 *   - no pending  → allow
 *   - any pending → reject (regardless of amount or credit)
 *
 * Credit and amount-matching no longer factor into the decision. The
 * product rule is simply "finish your current order before starting
 * another," so a same-amount re-click, a different-amount order, and a
 * credit / no-credit user all block identically and land on the same
 * "complete or cancel it first" screen (with a Resume affordance).
 *
 * `pending` is expected to already be narrowed to the orders that should
 * gate — see `keepOnlyB2BPending` in the order-machine, which drops stale
 * legacy retail orders so they can't permanently lock the user out.
 *
 * `usdcAmount` is the new order's intended purchase total. When undefined
 * (tracking-only mode — the host drives an explicit `orderId` and isn't
 * placing) there's nothing to gate, so we allow.
 */
export function computeGateDecision(
  pending: PendingOrderSummary[],
  usdcAmount: bigint | undefined,
): GateDecision {
  if (pending.length === 0) return { kind: "allow" };

  // No widget-side amount → no placement intent (tracking-only mode). The
  // host already has an explicit orderId and isn't placing, so don't gate.
  if (usdcAmount === undefined) return { kind: "allow" };

  // Any pending order blocks a new placement. Surface the first one (stable
  // ordering) as the conflict; the widget shows it with a Resume affordance.
  return { kind: "reject", conflict: pending[0] };
}

/**
 * Gate status DERIVED from the loaded pending set and the resolved order
 * amount. Kept pure (and out of the reducer) so it recomputes from the
 * *current* `resolvedUsdcAmount` on every render — never from an amount
 * captured when the credit/pending fetch fired.
 *
 * Why derive instead of computing the gate inside the fetch: the fetch is now
 * keyed on the signer alone (credit and pending orders don't depend on the
 * order amount), so it runs once. In `fiatChargeAmount` mode the amount isn't
 * known until the on-chain rate resolves — after the fetch. Deriving folds that
 * later-arriving amount into the decision with no refetch, so a user with a
 * pending order goes straight from "loading" to "reject" and never sees an
 * enabled Pay button on a stale/undefined amount.
 *
 *   - `gateWired` false (no fetchers / no signer) → allow (gate inactive).
 *   - pending not yet fetched (`null`)            → "loading".
 *   - otherwise → {@link computeGateDecision}(pending, resolvedUsdcAmount).
 *     (While the fiat amount is still resolving `resolvedUsdcAmount` is
 *     undefined and this is allow, but the widget holds the button on
 *     `amountStatus === "pending"` in that window, so no enabled allow shows.)
 */
export function deriveGate(
  gateWired: boolean,
  pendingOrders: PendingOrderSummary[] | null,
  resolvedUsdcAmount: bigint | undefined,
): GateDecision | "loading" {
  if (!gateWired) return { kind: "allow" };
  if (pendingOrders === null) return "loading";
  return computeGateDecision(pendingOrders, resolvedUsdcAmount);
}
