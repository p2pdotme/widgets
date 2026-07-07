/**
 * Pure fiat ⇄ USDC conversion helpers for the checkout amount pipeline.
 *
 * All amounts are 6-decimal bigints. `buyPrice` is the on-chain
 * `getPriceConfig(currency).buyPrice` — fiat-per-USDC, also 6-decimal.
 *
 * Extracted into its own module (like `credit-math.ts`) so the arithmetic can
 * be unit-tested without a React reducer or a publicClient. The widget's
 * fiat-denominated checkout mode (`fiatChargeAmount`) is the only consumer of
 * the inversion; the forward `usdcToFiat` mirrors the breakdown math the UI
 * already does inline so the two stay in lockstep.
 */

/**
 * Fiat value of a USDC amount at the given buy price.
 *   fiat = usdc × buyPrice / 1e6
 * Matches the breakdown math in `Checkout.tsx` / `order-machine.ts`.
 */
export function usdcToFiat(usdc: bigint, buyPrice: bigint): bigint {
  return (usdc * buyPrice) / 1_000_000n;
}

/**
 * USDC amount for a fiat value at the given buy price, rounded to the nearest
 * micro-USDC (round-half-up).
 *   usdc = round(fiat × 1e6 / buyPrice)
 * Returns 0n for a non-positive buyPrice (broken/unloaded config) rather than
 * dividing by zero — callers gate on a positive price before trusting this.
 */
export function fiatToUsdc(fiat: bigint, buyPrice: bigint): bigint {
  if (buyPrice <= 0n) return 0n;
  const numerator = fiat * 1_000_000n;
  // round(numerator / buyPrice) == floor((2·numerator + buyPrice) / (2·buyPrice))
  return (2n * numerator + buyPrice) / (2n * buyPrice);
}

/** Inputs for {@link resolveSellAmount} — the `<Cashout>` fiat-payout resolver
 *  mapped from props + reducer state (no React), so the gating is unit-tested. */
export interface SellAmountInputs {
  /** Host `fiatPayoutAmount`; `undefined` = plain USDC-input mode (not fiat). */
  fiatPayoutAmount?: bigint;
  /** `getPriceConfig(currency).sellPrice` (fiat-per-USDC, 6-dec). */
  sellPrice: bigint | null;
  /** True once the loaded price is for the currently-selected currency
   *  (`priceCurrency === selected`) — guards against a stale-rate misconvert. */
  priceReadyForCurrency: boolean;
  priceConfigFailed: boolean;
  threshold: bigint | null;
  fixedFee: bigint | null;
}

export type SellAmountResolution =
  /** Plain USDC-input mode — the widget parses the amount field instead. */
  | { status: "none" }
  /** Fiat mode, rate still loading — hold the Withdraw button. */
  | { status: "pending" }
  /** Rate read failed — can't price the payout. */
  | { status: "unavailable" }
  /** Payout rounds to a non-positive principal, or the small-order fee meets
   *  or exceeds the principal (a fee-dominated dust order). Block placement. */
  | { status: "too-small" }
  | { status: "ready"; principal: bigint; feeUsdc: bigint };

/**
 * Resolve a fiat payout into the USDC principal to **sell** plus the offramp
 * fee. Sell-side analog of the buy `computeAmountResolution`, but simpler: the
 * fee is charged separately in USDC (pulled on top of the principal at
 * `setSellOrderUpi`) and never reduces the payout, so there is no fee to back
 * out — `principal = fiatPayout / sellPrice`.
 *
 * Blocks (`"too-small"`) when the principal rounds to ≤ 0, **or** when the
 * small-order fee is ≥ the principal (a fee-dominated dust order the user
 * shouldn't pay — issue #58). `threshold` / `fixedFee` null → fee treated as 0.
 */
export function resolveSellAmount(i: SellAmountInputs): SellAmountResolution {
  if (i.fiatPayoutAmount === undefined) return { status: "none" };
  if (i.priceConfigFailed) return { status: "unavailable" };
  if (!i.priceReadyForCurrency || i.sellPrice === null || i.sellPrice <= 0n) {
    return { status: "pending" };
  }
  const principal = fiatToUsdc(i.fiatPayoutAmount, i.sellPrice);
  if (principal <= 0n) return { status: "too-small" };
  const feeUsdc =
    i.threshold !== null && i.fixedFee !== null && principal <= i.threshold ? i.fixedFee : 0n;
  if (feeUsdc >= principal) return { status: "too-small" };
  return { status: "ready", principal, feeUsdc };
}

/**
 * Gross fiat for a USDC order: the subtotal plus the protocol small-order fee,
 * converted at `buyPrice`. The fee applies when the order is `0 < order ≤
 * threshold` (mirrors the pre-order breakdown's total). Used for the SDK
 * routing eligibility filter and the fiat echoed back to the host. `threshold`
 * / `fixedFee` may be null (config not loaded) → no fee.
 */
export function grossFiatForOrder(
  orderUsdc: bigint,
  buyPrice: bigint,
  threshold: bigint | null,
  fixedFee: bigint | null,
): bigint {
  const feeUsdc =
    threshold !== null && fixedFee !== null && orderUsdc > 0n && orderUsdc <= threshold
      ? fixedFee
      : 0n;
  return usdcToFiat(orderUsdc, buyPrice) + usdcToFiat(feeUsdc, buyPrice);
}

/**
 * Result of inverting an all-in fiat total into a placeable USDC order amount.
 * `feeUsdc` is the protocol small-order fee that was assumed (0n for orders
 * above the threshold). On failure, `usdcAmount` is absent — the entered total
 * doesn't cover the fee, so there's no positive order to place.
 */
export type AllInResolution =
  | { ok: true; usdcAmount: bigint; feeUsdc: bigint }
  | { ok: false; reason: "fee-exceeds-amount"; feeUsdc: bigint };

/**
 * Convert an **all-in** fiat total (what the user pays, protocol fee included)
 * into the USDC order amount the widget bills — the inverse of the pre-order
 * breakdown.
 *
 * The protocol charges a fixed `fixedFee` (USDC) on orders whose on-chain
 * amount is ≤ `threshold`, and nothing above it. Crucially, that on-chain
 * amount is the **post-credit delta** (`order − credit`) — when an integrator
 * nets stranded proxy credit, the Diamond order is the delta, and
 * `isOrderSmall` keys off `amount <= threshold` (contracts-v4
 * `libOrderProcessorFacet.sol`). So the fee bracket must be decided on the
 * delta, not the gross intent — otherwise credit that drags the delta below
 * the threshold introduces a fee that was never in the all-in total (see
 * issue #51).
 *
 * Inversion:
 *   1. gross  = fiatToUsdc(totalFiat, buyPrice)   — the no-credit gross.
 *   2. gross ≤ fixedFee → no positive order exists (block, credit-independent;
 *      preserves the original no-credit "too small" guard).
 *   3. delta  = gross − credit                    — what reaches the Diamond.
 *      • delta >  threshold        → large order, no fee: usdcAmount = gross.
 *      • fixedFee < delta ≤ threshold → small order with room: absorb the fee,
 *        usdcAmount = gross − fixedFee, so `(delta + fee) × price` reconstructs
 *        the entered total (minus the credit value).
 *      • delta ≤ fixedFee          → credit covers all but (at most) a sub-fee
 *        sliver: no absorption, usdcAmount = gross. When delta ≤ 0 the caller's
 *        credit-covers-fully path takes over (no Diamond order, no fee). When
 *        0 < delta ≤ fixedFee (the narrow "E1" residual) the chain still levies
 *        the fee on the tiny delta and it rides on top — matching how
 *        `usdcAmount` + credit already behaves for tiny deltas.
 *
 * `credit` defaults to 0n; with no credit, delta == gross and this reduces to
 * the plain all-in inversion (large / small-with-room / block) unchanged.
 *
 * `feeUsdc` in the result is the fee the chain will actually charge on the
 * delta (0n for a large order or a fully-covered order), for callers/tests
 * that want to assert the bracket.
 */
export function resolveUsdcFromAllInFiat(
  totalFiat: bigint,
  buyPrice: bigint,
  threshold: bigint,
  fixedFee: bigint,
  credit: bigint = 0n,
): AllInResolution {
  const grossUsdc = fiatToUsdc(totalFiat, buyPrice);

  // Order gross smaller than the fee itself → no positive order exists,
  // independent of credit. Preserves the no-credit "too small" block.
  if (grossUsdc <= fixedFee) {
    return { ok: false, reason: "fee-exceeds-amount", feeUsdc: fixedFee };
  }

  // Decide the fee bracket on the post-credit delta — the amount that reaches
  // the Diamond and that `isOrderSmall` actually tests.
  const delta = grossUsdc - credit;

  // Large-order delta, OR credit covers all but a sub-fee sliver: no fee is
  // absorbed into the all-in total. usdcAmount is the full gross; the forward
  // breakdown re-derives the fee (zero for a large delta / fully-covered
  // order, or the fee on the tiny remainder in the E1 residual) from the
  // post-credit charged amount and stays in lockstep.
  if (delta > threshold || delta <= fixedFee) {
    const feeUsdc = delta > 0n && delta <= threshold ? fixedFee : 0n;
    return { ok: true, usdcAmount: grossUsdc, feeUsdc };
  }

  // Small-order delta with room for the fee → absorb it into the all-in total.
  return { ok: true, usdcAmount: grossUsdc - fixedFee, feeUsdc: fixedFee };
}

/**
 * Which amount input is in play, and whether it has resolved to a placeable
 * USDC order amount yet. Drives the widget's Pay button + breakdown:
 *   • "none"        — neither amount input (tracking-only / product-priced).
 *   • "ready"       — `usdcAmount` is the effective order amount.
 *   • "pending"     — fiat mode, still waiting on the rate or the async credit
 *                     read (hold the button; never decide the fee on stale data).
 *   • "too-small"   — fiat total can't cover the protocol fee (block).
 *   • "unavailable" — can't price the order: rate read failed, or fiat mode
 *                     was given no selectable currency to convert against.
 */
export type AmountStatus = "ready" | "pending" | "too-small" | "unavailable" | "none";
export interface AmountResolution {
  status: AmountStatus;
  usdcAmount?: bigint;
}

/** Plain inputs for {@link computeAmountResolution} — the hook maps its
 *  props + reducer state onto this so the decision is a pure, testable
 *  function of values (no React, no publicClient). */
export interface AmountResolutionInputs {
  /** Host-passed USDC amount (wins if both are set). */
  usdcAmount?: bigint;
  /** Host-passed all-in fiat total. */
  fiatChargeAmount?: bigint;
  demo?: boolean;
  /** Static demo fiat-per-USDC rate (DEMO_FIAT_RATE[cur] ?? 1); demo only. */
  demoRate?: number;
  /** False when no `currencies` were supplied — fiat mode can't price. */
  hasSelectedCurrency: boolean;
  /** Symbol of the picked currency; the loaded price must match it. */
  selectedSymbol?: string;
  /** Currency the loaded price config is for (reducer `state.currency`). */
  priceLoadedCurrency?: string;
  buyPrice: bigint | null;
  threshold: bigint | null;
  fixedFee: bigint | null;
  priceConfigFailed: boolean;
  /** Redeemable credit; `null` = the async credit read is still in flight. */
  credit: bigint | null;
}

/**
 * Resolve the effective USDC order amount from the two input modes. Pure —
 * unit-tested directly. `usdcAmount` mode short-circuits to "ready" (never
 * gated on rate/credit); `fiatChargeAmount` mode holds until both the on-chain
 * rate for the *selected* currency and the async credit read land, then
 * inverts the all-in total (credit-aware) via {@link resolveUsdcFromAllInFiat}.
 */
export function computeAmountResolution(i: AmountResolutionInputs): AmountResolution {
  // Explicit USDC amount always wins (both-set is a caller-warned misconfig)
  // and is never gated on rate/credit.
  if (i.usdcAmount !== undefined) return { status: "ready", usdcAmount: i.usdcAmount };
  if (i.fiatChargeAmount === undefined) return { status: "none" };

  // ── Fiat all-in mode ──
  if (i.demo) {
    // Demo skips on-chain reads — convert with the static demo rate.
    const demoPrice = BigInt(Math.round((i.demoRate ?? 1) * 1e6));
    const usdc = fiatToUsdc(i.fiatChargeAmount, demoPrice);
    return usdc > 0n ? { status: "ready", usdcAmount: usdc } : { status: "too-small" };
  }
  // Fiat mode needs a currency to price against; none supplied → can't price.
  if (!i.hasSelectedCurrency) return { status: "unavailable" };
  // Rate read failed → surface an error rather than guess an amount.
  if (i.priceConfigFailed) return { status: "unavailable" };
  // Hold until the on-chain price config for the *selected* currency lands
  // (a stale currency's price would misconvert).
  const priceReady =
    i.buyPrice !== null &&
    i.threshold !== null &&
    i.fixedFee !== null &&
    (i.selectedSymbol === undefined || i.priceLoadedCurrency === i.selectedSymbol);
  if (!priceReady || (i.buyPrice ?? 0n) <= 0n) return { status: "pending" };
  // Hold until the async credit read resolves, so the fee bracket is never
  // decided on stale zero-credit (issue #51 watch-out). `null` = in flight;
  // with no credit fetchers wired the caller sets it to 0n immediately.
  if (i.credit === null) return { status: "pending" };
  const res = resolveUsdcFromAllInFiat(
    i.fiatChargeAmount,
    i.buyPrice as bigint,
    i.threshold as bigint,
    i.fixedFee as bigint,
    i.credit,
  );
  return res.ok ? { status: "ready", usdcAmount: res.usdcAmount } : { status: "too-small" };
}
