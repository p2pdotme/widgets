import { useReducer, useCallback, useEffect, useMemo, useRef } from "react";
import { createPublicClient, http, encodeFunctionData, fromHex, stringToHex } from "viem";
import { baseSepolia, base } from "viem/chains";
import {
  decryptPaymentAddress,
  createLocalStorageRelayStore,
  createRelayIdentity,
  createOrders,
  type RelayIdentity,
} from "@p2pdotme/sdk/orders";

// SDK 1.1.3 dropped the singleton `getRelayIdentity` from /payload.
// Resolve the identity from localStorage (creating one if needed), cached.
let cachedIdentity: RelayIdentity | null = null;
async function resolveIdentity(): Promise<RelayIdentity> {
  if (cachedIdentity) return cachedIdentity;
  const store = createLocalStorageRelayStore();
  let id = await store.get();
  if (!id) { id = createRelayIdentity(); await store.set(id); }
  cachedIdentity = id;
  return id;
}
import type { CheckoutSigner, CheckoutPhase, PlaceOrderResult, PlaceOrderContext, CurrencyOption, PendingOrderSummary, ScreeningConfig, LivenessConfig } from "../types";
import { OrderStatus } from "../types";
import { DIAMOND_ABI, readSmallOrderFixedFee, LIVENESS_GATE_ABI, fetchLivenessStatus } from "./contracts";
import { DEMO_FIAT_RATE } from "./config";
import { processB2BBuyOrder } from "./b2b-fraud-engine";
import { getActiveOrder, setActiveOrder, removeActiveOrder, keyFor, type ActiveOrderKey } from "./active-orders-store";
import { deriveGate } from "./credit-math";
import { grossFiatForOrder, computeAmountResolution, type AmountResolution } from "./price-math";
import { keepOnlyB2BPending } from "./b2b-orders";
import { computeLivenessGate, createLivenessSession, redeemLivenessAttestation, openVerifyPopup } from "./liveness";
import {
  toP2PError,
  noEligibleMerchantsError,
  missingRoutingInputsError,
  type P2PErrorContext,
} from "./errors";

interface OrderState {
  phase: CheckoutPhase;
  orderId: string | null;
  txHash: string | null;
  usdcAmount: bigint | null;
  fiatAmount: bigint | null;
  currency: string;
  decryptedUpi: string | null;
  error: string | null;
  // Pre-order quote — `buyPrice` is fiat-per-USDC at 6 decimals, fetched from
  // the diamond's `getPriceConfig`. Used to derive the routing `fiatAmount`
  // and to render the price breakdown before the user clicks "Pay now".
  buyPrice: bigint | null;
  smallOrderThreshold: bigint | null;
  smallOrderFixedFee: bigint | null;
  // Post-order breakdown from `getAdditionalOrderDetails` — populated when the
  // merchant accepts. `fee` is the protocol's fixed fee paid in USDC (6 dec);
  // `actualUsdcAmount` is the net USDC the user actually receives.
  fee: bigint | null;
  actualUsdcAmount: bigint | null;
  // Unix seconds, from `getAdditionalOrderDetails.acceptedTimestamp`. Used to
  // drive the auto-cancellation countdown on the accepted screen.
  acceptedTimestamp: bigint | null;
  // True if the on-chain price-config fetch failed for the current currency.
  // Lets the widget release the "Pay now" gate without a stuck spinner —
  // the user can still proceed (SDK routing falls back to a 0n fiatAmount,
  // i.e., no eligibility filter), they just won't see a fee breakdown.
  priceConfigFailed: boolean;

  // ─── Credit accounting (host-supplied via fetchCredit / fetchPendingOrders) ─
  // `credit` is the integrator-side redeemable balance (USDC, 6 dec).
  // `null` means the host didn't provide a fetcher OR the fetch is still
  // in flight on initial mount. Distinguished from `0n` (fetcher returned
  // zero) so the UI can hide the credit row entirely until we know.
  credit: bigint | null;
  // Pending-order list from the host. null = unfetched; [] = none. The gate
  // status is DERIVED from this plus the resolved order amount (see
  // `deriveGate` / the hook return), never stored — so it always reflects the
  // current amount, not one captured when the credit fetch fired.
  pendingOrders: PendingOrderSummary[] | null;
  // True when the host's `placeOrder` returned `creditOnly: true`. Drives
  // the success-screen copy and tells the polling loop to short-circuit.
  creditOnly: boolean;

  // ─── Liveness gate (host-supplied via `liveness` config) ────────────
  // The prompt TRIGGER is the fraud engine's `liveliness_required` screening
  // response (suspect-scoped) — NOT a blanket on-chain read. The on-chain read
  // is verify-once only: it sets `livenessCleared` (user is already verified,
  // or the integrator isn't enforcing), which lets an already-cleared suspect
  // skip the prompt. `livenessGate` drives the UI: "loading" until the
  // verify-once read resolves; "ok" = not currently gated; "required" = the
  // screening flag fired (must verify); "verifying" = wizard + submit in
  // flight. `livenessError` holds a user-facing message on a failed verify.
  livenessGate: "loading" | "ok" | "required" | "verifying";
  // True when the user needs no liveness check: already verified on-chain, or
  // the integrator's gate is off. Passed to screening as `isLivenessVerified`
  // so a cleared user bypasses a `liveliness_required` response.
  livenessCleared: boolean;
  livenessError: string | null;
}

type OrderAction =
  | { type: "PLACING" }
  | { type: "PLACED"; orderId: string; txHash: string }
  | { type: "ACCEPTED"; fiatAmount: bigint; usdcAmount: bigint; currency: string; fee: bigint; actualUsdcAmount: bigint; acceptedTimestamp: bigint }
  | { type: "DECRYPTED_UPI"; upi: string }
  | { type: "PAID" }
  | { type: "COMPLETED" }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string }
  | { type: "INLINE_ERROR"; message: string | null }
  | { type: "PRICE_CONFIG"; currency: string; buyPrice: bigint; smallOrderThreshold: bigint; smallOrderFixedFee: bigint }
  | { type: "PRICE_CONFIG_FAILED" }
  // Clears a stale failure flag at the start of a fresh price-config read
  // (e.g. currency switch) so a prior currency's failure can't flash the
  // "rate unavailable" banner over the new currency while it loads.
  | { type: "PRICE_CONFIG_RESET" }
  // Used while phase=checkout to hold a resumable order in the background.
  // RESUMABLE_FOUND attaches an orderId without flipping out of "checkout"
  // — the user still sees the form. Pay-now uses this id to skip placement.
  | { type: "RESUMABLE_FOUND"; orderId: string; txHash: string }
  | { type: "RESUMABLE_CLEARED" }
  // Credit-accounting actions.
  | { type: "CREDIT_LOADED"; credit: bigint; pending: PendingOrderSummary[] }
  | { type: "CREDIT_ONLY_PLACED"; orderId: string; txHash: string }
  // Liveness-gate actions.
  // Feature off (no config) → cleared, no gate. STATUS carries the verify-once
  // read result. REQUIRED is the screening-flag trigger (resets phase so the
  // block renders). VERIFYING/VERIFIED/VERIFY_FAILED drive the wizard.
  | { type: "LIVENESS_OFF" }
  | { type: "LIVENESS_STATUS"; cleared: boolean }
  | { type: "LIVENESS_REQUIRED" }
  | { type: "LIVENESS_VERIFYING" }
  | { type: "LIVENESS_VERIFIED" }
  | { type: "LIVENESS_VERIFY_FAILED"; message: string };

// Exported for unit tests (order-machine internals are not re-exported from the
// package entrypoints, so this doesn't widen the public API).
export const INITIAL: OrderState = {
  phase: "checkout", orderId: null, txHash: null,
  usdcAmount: null, fiatAmount: null, currency: "INR",
  decryptedUpi: null, error: null,
  buyPrice: null, smallOrderThreshold: null, smallOrderFixedFee: null,
  fee: null, actualUsdcAmount: null,
  acceptedTimestamp: null,
  priceConfigFailed: false,
  credit: null, pendingOrders: null,
  creditOnly: false,
  livenessGate: "loading", livenessCleared: false, livenessError: null,
};

export function reducer(state: OrderState, action: OrderAction): OrderState {
  switch (action.type) {
    case "PLACING": return { ...state, phase: "placing", error: null };
    case "PLACED": return { ...state, phase: "placed", orderId: action.orderId, txHash: action.txHash };
    case "ACCEPTED": return {
      ...state, phase: "accepted",
      fiatAmount: action.fiatAmount, usdcAmount: action.usdcAmount, currency: action.currency,
      fee: action.fee, actualUsdcAmount: action.actualUsdcAmount,
      acceptedTimestamp: action.acceptedTimestamp,
    };
    case "DECRYPTED_UPI": return { ...state, decryptedUpi: action.upi };
    case "PAID": return { ...state, phase: "paid", error: null };
    case "COMPLETED": return { ...state, phase: "completed" };
    case "CANCELLED": return { ...state, phase: "cancelled", error: null };
    case "ERROR": return { ...state, phase: "error", error: action.message };
    case "INLINE_ERROR": return { ...state, error: action.message };
    case "PRICE_CONFIG": return {
      ...state, currency: action.currency, buyPrice: action.buyPrice,
      smallOrderThreshold: action.smallOrderThreshold, smallOrderFixedFee: action.smallOrderFixedFee,
      priceConfigFailed: false,
    };
    case "PRICE_CONFIG_FAILED": return { ...state, priceConfigFailed: true };
    case "PRICE_CONFIG_RESET": return state.priceConfigFailed ? { ...state, priceConfigFailed: false } : state;
    case "RESUMABLE_FOUND": return { ...state, orderId: action.orderId, txHash: action.txHash };
    case "RESUMABLE_CLEARED": return { ...state, orderId: null, txHash: null };
    case "CREDIT_LOADED": return {
      ...state, credit: action.credit, pendingOrders: action.pending,
    };
    case "CREDIT_ONLY_PLACED": return {
      ...state, phase: "completed",
      orderId: action.orderId, txHash: action.txHash,
      creditOnly: true,
    };
    // No config → feature off: cleared, never gated.
    case "LIVENESS_OFF": return { ...state, livenessGate: "ok", livenessCleared: true };
    // Verify-once read resolved: record cleared status; release the button
    // (loading → ok). Never sets "required" — the screening flag does that.
    case "LIVENESS_STATUS": return {
      ...state, livenessCleared: action.cleared,
      livenessGate: state.livenessGate === "loading" ? "ok" : state.livenessGate,
    };
    // Screening returned `liveliness_required`. The order was NOT placed, so
    // reset phase back to the form and surface the block.
    case "LIVENESS_REQUIRED": return { ...state, phase: "checkout", livenessGate: "required", error: null };
    case "LIVENESS_VERIFYING": return { ...state, livenessGate: "verifying", livenessError: null };
    case "LIVENESS_VERIFIED": return { ...state, livenessGate: "ok", livenessCleared: true, livenessError: null };
    case "LIVENESS_VERIFY_FAILED": return { ...state, livenessGate: "required", livenessError: action.message };
    default: return state;
  }
}

export interface UseOrderMachineOpts {
  orderId?: string;
  placeOrder?: (ctx: PlaceOrderContext) => Promise<PlaceOrderResult>;
  signer: CheckoutSigner;
  chainId: number;
  diamondAddress: `0x${string}`;
  rpcUrl?: string;
  demo?: boolean;
  demoCurrency?: string;
  selectedCurrency?: CurrencyOption;
  // Routing inputs — only required when `selectedCurrency.circleId` is undefined.
  subgraphUrl?: string;
  usdcAddress?: `0x${string}`;
  usdcAmount?: bigint;
  fiatAmount?: bigint;
  // All-in fiat total (6-dec). Alternative to `usdcAmount`; the widget
  // converts it to a USDC order amount via the selected currency's buyPrice.
  fiatChargeAmount?: bigint;
  screening?: ScreeningConfig;
  // Credit accounting (optional; both must be set for the gate to engage).
  fetchCredit?: (user: `0x${string}`) => Promise<bigint>;
  fetchPendingOrders?: (user: `0x${string}`) => Promise<PendingOrderSummary[]>;
  // Liveness gate (optional). When set, gate the order on a simple-kyc check.
  liveness?: LivenessConfig;
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  onError?: (error: Error) => void;
  onCancel?: (orderId: string) => void;
}

export function useOrderMachine(opts: UseOrderMachineOpts) {
  const initState: OrderState = opts.orderId
    ? { ...INITIAL, phase: "placed", orderId: opts.orderId, txHash: "" }
    : INITIAL;
  const [state, dispatch] = useReducer(reducer, initState);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chain = opts.chainId === 84532 ? baseSepolia : base;
  const publicClient = createPublicClient({ chain, transport: http(opts.rpcUrl) });

  // ─── Amount resolution ──────────────────────────────────────────────
  // The order amount arrives one of two ways:
  //   • usdcAmount        → used as-is (the original contract).
  //   • fiatChargeAmount  → an all-in fiat total; convert to a USDC order
  //     amount via the selected currency's on-chain buyPrice, backing the
  //     protocol small-order fee out of the POST-CREDIT delta (issue #51).
  // `status` drives the UI: "pending" holds the Pay button while the rate /
  // async credit read loads; "too-small" / "unavailable" surface a blocking
  // error; "ready" exposes the resolved `usdcAmount`; "none" = tracking-only.
  // Decision is a pure function (computeAmountResolution) so it's unit-tested
  // directly and the hook just maps props + reducer state onto it.
  const selSym = opts.selectedCurrency?.symbol;
  const hasCurrency = opts.selectedCurrency !== undefined;
  const demoCur = selSym ?? opts.demoCurrency ?? "INR";
  // Mutually-exclusive misconfig — warn (don't throw); `usdcAmount` wins.
  useEffect(() => {
    if (opts.usdcAmount !== undefined && opts.fiatChargeAmount !== undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        "[p2p-widget] Pass either `usdcAmount` or `fiatChargeAmount`, not both — using `usdcAmount`.",
      );
    }
  }, [opts.usdcAmount, opts.fiatChargeAmount]);
  const amountResolution = useMemo<AmountResolution>(
    () =>
      computeAmountResolution({
        usdcAmount: opts.usdcAmount,
        fiatChargeAmount: opts.fiatChargeAmount,
        demo: opts.demo,
        demoRate: DEMO_FIAT_RATE[demoCur] ?? 1,
        hasSelectedCurrency: hasCurrency,
        selectedSymbol: selSym,
        priceLoadedCurrency: state.currency,
        buyPrice: state.buyPrice,
        threshold: state.smallOrderThreshold,
        fixedFee: state.smallOrderFixedFee,
        priceConfigFailed: state.priceConfigFailed,
        credit: state.credit,
      }),
    [
      opts.usdcAmount, opts.fiatChargeAmount, opts.demo, demoCur, hasCurrency, selSym,
      state.currency, state.buyPrice, state.smallOrderThreshold, state.smallOrderFixedFee,
      state.priceConfigFailed, state.credit,
    ],
  );
  const resolvedUsdcAmount = amountResolution.usdcAmount;

  // Composite key for the resumable-order store. null when the host hasn't
  // supplied enough context (no signer / no currency picker / no resolved
  // amount) — in that mode the machine just acts like the previous version
  // (no resume). In fiat mode the key stays null until the rate resolves.
  const storeKey = useMemo<ActiveOrderKey | null>(() => {
    if (!opts.signer?.address || !opts.selectedCurrency || resolvedUsdcAmount === undefined) return null;
    return {
      user: opts.signer.address,
      chainId: opts.chainId,
      currency: opts.selectedCurrency.symbol,
      usdcAmount: resolvedUsdcAmount,
    };
  }, [opts.signer?.address, opts.chainId, opts.selectedCurrency?.symbol, resolvedUsdcAmount]);
  const storeKeyStr = storeKey ? keyFor(storeKey) : null;

  // Hold a ref to current state so the resumable-store effect can decide
  // whether to attach a stored order without re-firing on every state tick.
  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchOrderStatus = useCallback(async () => {
    // Credit-only orders aren't on the Diamond — `state.orderId` is a host-
    // chosen sentinel (e.g. "0" for LotPot's credit-only path). Reading
    // getOrdersById against it would revert. Skip entirely.
    if (state.creditOnly) return;
    if (!state.orderId || state.orderId.startsWith("demo")) return;
    try {
      const [rawOrder, details] = await Promise.all([
        publicClient.readContract({ address: opts.diamondAddress, abi: DIAMOND_ABI, functionName: "getOrdersById", args: [BigInt(state.orderId)] }),
        publicClient.readContract({ address: opts.diamondAddress, abi: DIAMOND_ABI, functionName: "getAdditionalOrderDetails", args: [BigInt(state.orderId)] }),
      ]);
      const o = rawOrder as any;
      const d = details as any;
      const status = Number(o.status) as OrderStatus;

      let cur = "";
      try { cur = fromHex(o.currency as `0x${string}`, "string").replace(/\0/g, ""); } catch { cur = "INR"; }

      // Background poll while the user is still on the form, holding a
      // resumable order in state.orderId. Only act on terminal status —
      // anything else stays parked until the user clicks "Pay now". This
      // is what surfaces auto-cancellations: a stored order that the
      // protocol has already expired gets silently dropped here so the
      // user doesn't try to resume a dead order.
      if (state.phase === "checkout") {
        if (status === OrderStatus.CANCELLED || status === OrderStatus.COMPLETED) {
          if (storeKey) removeActiveOrder(storeKey);
          dispatch({ type: "RESUMABLE_CLEARED" });
        }
        return;
      }

      // Resume-safe: walk the local state machine forward to whatever the
      // chain says, regardless of where we currently are. A page refresh
      // mid-flow lands here with `state.phase === "placed"` and may need to
      // jump straight to accepted / paid / completed in one tick.

      if (status === OrderStatus.CANCELLED) {
        if (state.phase !== "cancelled") {
          if (storeKey) removeActiveOrder(storeKey);
          dispatch({ type: "CANCELLED" });
          opts.onCancel?.(state.orderId);
        }
        return;
      }

      const needsAcceptedData = state.acceptedTimestamp === null;
      const isAtLeastAccepted =
        status === OrderStatus.ACCEPTED ||
        status === OrderStatus.PAID ||
        status === OrderStatus.COMPLETED;

      if (isAtLeastAccepted && needsAcceptedData) {
        const actualFiat = d.actualFiatAmount > 0n ? d.actualFiatAmount : o.fiatAmount;
        const actualUsdc = d.actualUsdtAmount > 0n ? d.actualUsdtAmount : o.amount;
        const acceptedTs =
          d.acceptedTimestamp && d.acceptedTimestamp > 0n
            ? BigInt(d.acceptedTimestamp)
            : BigInt(Math.floor(Date.now() / 1000));
        dispatch({
          type: "ACCEPTED",
          fiatAmount: actualFiat,
          usdcAmount: o.amount,
          currency: cur,
          fee: BigInt(d.fixedFeePaid ?? 0n),
          actualUsdcAmount: actualUsdc,
          acceptedTimestamp: acceptedTs,
        });
        const recipientIdentity = await resolveIdentity();
        const result = await decryptPaymentAddress({ encrypted: o.encUpi, recipientIdentity });
        dispatch({ type: "DECRYPTED_UPI", upi: result.isOk() ? result.value : "Session changed" });
      }

      if (status === OrderStatus.PAID && state.phase !== "paid" && state.phase !== "completed") {
        dispatch({ type: "PAID" });
      }

      if (status === OrderStatus.COMPLETED && state.phase !== "completed") {
        if (storeKey) removeActiveOrder(storeKey);
        dispatch({ type: "COMPLETED" });
        opts.onComplete?.(state.orderId);
      }
    } catch {}
  }, [state.orderId, state.phase, state.acceptedTimestamp, opts.diamondAddress, storeKeyStr]);

  // Fire one immediate fetch as soon as we have an orderId (covers the
  // resume-from-localStorage case — no 3s "Finding merchant" flash for orders
  // that were already accepted before the refresh).
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (state.creditOnly) return;
    if (!state.orderId || state.orderId.startsWith("demo") || didInitialFetch.current) return;
    didInitialFetch.current = true;
    fetchOrderStatus();
  }, [state.orderId, fetchOrderStatus, state.creditOnly]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!state.orderId || state.orderId.startsWith("demo")) return;
    let interval: number | null = null;
    if (state.phase === "placed") interval = 3000;
    else if (state.phase === "accepted") interval = 15000;
    else if (state.phase === "paid") interval = 10000;
    // Slower poll while the user holds the resumable order on the form —
    // we only need to notice the auto-cancel before they click "Pay now".
    else if (state.phase === "checkout") interval = 8000;
    if (interval) pollingRef.current = setInterval(fetchOrderStatus, interval);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [state.phase, state.orderId, fetchOrderStatus]);

  // Attach (or detach) a resumable order whenever the composite store key
  // changes — currency switch, amount edit, signer rotation. Gated on
  // phase=checkout so it can't override a mid-flow orderId.
  useEffect(() => {
    if (stateRef.current.phase !== "checkout") return;
    if (!storeKey) {
      if (stateRef.current.orderId) dispatch({ type: "RESUMABLE_CLEARED" });
      return;
    }
    const entry = getActiveOrder(storeKey);
    if (entry) {
      dispatch({ type: "RESUMABLE_FOUND", orderId: entry.orderId, txHash: entry.txHash });
    } else if (stateRef.current.orderId) {
      dispatch({ type: "RESUMABLE_CLEARED" });
    }
  }, [storeKeyStr]);

  // Fetch on-chain price config for the selected currency so we can derive a
  // pre-order fiat quote + fee estimate. One read per currency change; no
  // polling — buy-price is effectively static for the duration of checkout.
  //
  // Source-of-truth precedence:
  //   • post-ACCEPTED → `state.currency` (chain-confirmed; survives resume
  //     when the host didn't pass a `currencies` prop)
  //   • pre-ACCEPTED  → `opts.selectedCurrency?.symbol` (what the user picked)
  const currencySymbol = state.acceptedTimestamp !== null
    ? state.currency
    : opts.selectedCurrency?.symbol;
  useEffect(() => {
    if (opts.demo || !currencySymbol) return;
    // Clear any prior currency's failure before the new read so a stale flag
    // can't surface "rate unavailable" over the freshly-picked currency
    // (no-op when already clear — the reducer returns the same state).
    dispatch({ type: "PRICE_CONFIG_RESET" });
    let cancelled = false;
    const currencyHex = stringToHex(currencySymbol, { size: 32 });
    (async () => {
      try {
        const [price, threshold, fixedFee] = await Promise.all([
          publicClient.readContract({
            address: opts.diamondAddress, abi: DIAMOND_ABI,
            functionName: "getPriceConfig", args: [currencyHex],
          }) as Promise<{ buyPrice: bigint }>,
          publicClient.readContract({
            address: opts.diamondAddress, abi: DIAMOND_ABI,
            functionName: "getSmallOrderThreshold", args: [currencyHex],
          }) as Promise<bigint>,
          // V22 charges half the unified fee on BUY; reads from the
          // typed selector and falls back to the deprecated one for
          // pre-V22 Diamonds. See `readSmallOrderFixedFee`.
          readSmallOrderFixedFee(publicClient, opts.diamondAddress, currencyHex, "buy"),
        ]);
        if (cancelled) return;
        dispatch({
          type: "PRICE_CONFIG",
          currency: currencySymbol,
          buyPrice: price.buyPrice,
          smallOrderThreshold: threshold,
          smallOrderFixedFee: fixedFee,
        });
      } catch {
        // Quote fetch is best-effort; routing falls back to the explicit
        // `fiatAmount` prop (or 0n) and the UI omits the breakdown. Mark
        // the failure so the widget can release the "Pay now" gate instead
        // of waiting on a fetch that won't recover.
        if (!cancelled) dispatch({ type: "PRICE_CONFIG_FAILED" });
      }
    })();
    return () => { cancelled = true; };
  }, [currencySymbol, opts.diamondAddress, opts.demo]);

  // Credit + pending-order fetch. Runs on mount, on signer rotation, and
  // after each completion (so post-redemption credit refreshes). When the
  // host didn't supply both callbacks, we record empty credit/pending here so
  // the derived gate resolves to allow instead of hanging on "loading".
  //
  // Why both must be set: enforcing the rule with only one callback leaves
  // a half-state — e.g. seeing credit but not knowing if a pending order
  // exists means we either over- or under-block. Easier to require both
  // up-front than to define partial-mode semantics.
  //
  // Keyed on the signer ALONE — credit and pending orders don't depend on the
  // order amount, so the fetch runs once. In fiatChargeAmount mode the amount
  // isn't known until the on-chain rate resolves (after this fetch); the gate
  // folds that later-arriving amount in via `deriveGate` at the return, with no
  // refetch. Keying on the amount here would fire a second fetch and, worse,
  // decide the gate from an amount still `undefined` at fetch time.
  const fetchKeyStr = opts.signer?.address ?? "";
  useEffect(() => {
    if (!opts.fetchCredit || !opts.fetchPendingOrders || !opts.signer?.address) {
      // No gate wired — record empty credit/pending so the derived gate is
      // allow and the UI doesn't hang on "loading".
      dispatch({ type: "CREDIT_LOADED", credit: 0n, pending: [] });
      return;
    }
    // Re-fetch is gated on `phase === "checkout"` so we don't churn the
    // gate state mid-flow; the post-completion refresh hook below
    // re-triggers explicitly when needed.
    if (state.phase !== "checkout") return;
    const userAddr = opts.signer.address;
    let cancelled = false;
    (async () => {
      try {
        const [credit, pending] = await Promise.all([
          opts.fetchCredit!(userAddr),
          opts.fetchPendingOrders!(userAddr),
        ]);
        if (cancelled) return;
        // Only B2B orders (placed through an integrator gateway) can race the
        // integrator's proxy credit, so only they should gate a new placement.
        // Narrow the host's pending list to the user's B2B order set from the
        // subgraph; legacy retail orders — including ones stuck "pending"
        // forever from before auto-cancellation existed — fall out and no
        // longer block. Resilient: passes through unchanged if it can't run.
        const b2bPending = await keepOnlyB2BPending(pending, opts.subgraphUrl, userAddr);
        if (cancelled) return;
        dispatch({ type: "CREDIT_LOADED", credit, pending: b2bPending });
      } catch {
        // Treat fetch failure as no-credit/no-pending so the user can
        // still place an order — better than blocking on a transient RPC
        // blip. The host's `onError` is reserved for placement-side
        // failures; failed credit reads aren't user-facing.
        if (!cancelled) {
          dispatch({ type: "CREDIT_LOADED", credit: 0n, pending: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKeyStr, state.phase]);

  // Liveness verify-once read. Reads livenessVerified(user) + livenessRequired()
  // and records whether the user is CLEARED (already verified, or the gate is
  // off) — it does NOT gate here. The prompt trigger is the fraud engine's
  // `liveliness_required` screening response, which is suspect-scoped; blanket-
  // gating on `livenessRequired()` would prompt every non-suspect user, since
  // the NEW integrator (V2) enforces only against fraud-engine-flagged wallets.
  //
  // No config → cleared (feature off). A read that reverts (integrator without
  // the gate) or an RPC blip → cleared=true (fail-open): the on-chain
  // validateOrder is the authoritative backstop, and a suspect that can't route
  // to the gate-less OLD integrator (no V1 credit) still reverts there. Re-reads
  // only while phase=checkout.
  const livenessKey = `${opts.liveness?.integratorAddress ?? ""}|${opts.signer?.address ?? ""}`;
  useEffect(() => {
    if (!opts.liveness || !opts.signer?.address) {
      dispatch({ type: "LIVENESS_OFF" });
      return;
    }
    if (state.phase !== "checkout") return;
    const cfg = opts.liveness;
    const userAddr = opts.signer.address;
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchLivenessStatus(cfg.integratorAddress, userAddr, {
          chainId: opts.chainId,
          rpcUrl: opts.rpcUrl,
        });
        if (cancelled) return;
        // Cleared ⟺ computeLivenessGate is "ok" (gate off OR already verified).
        dispatch({ type: "LIVENESS_STATUS", cleared: computeLivenessGate(status, true) === "ok" });
      } catch {
        if (!cancelled) dispatch({ type: "LIVENESS_STATUS", cleared: true });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livenessKey, state.phase]);

  // Inline fast-forward: when the user clicks Pay on a resumable order,
  // dispatch PLACED to flip out of the form, then read on-chain status
  // and walk the state machine forward to ACCEPTED / PAID / COMPLETED /
  // CANCELLED in one shot — avoids the 3s "Finding a merchant" flash on
  // an order that was already accepted while the modal was closed.
  // Mirrors the relevant branches of fetchOrderStatus; failures fall
  // back to the regular polling loop.
  const resumeOrder = useCallback(async (orderId: string, txHash: string) => {
    dispatch({ type: "PLACED", orderId, txHash });
    opts.onOrderPlaced?.(orderId, txHash);
    try {
      const [rawOrder, details] = await Promise.all([
        publicClient.readContract({ address: opts.diamondAddress, abi: DIAMOND_ABI, functionName: "getOrdersById", args: [BigInt(orderId)] }),
        publicClient.readContract({ address: opts.diamondAddress, abi: DIAMOND_ABI, functionName: "getAdditionalOrderDetails", args: [BigInt(orderId)] }),
      ]);
      const o = rawOrder as any;
      const d = details as any;
      const status = Number(o.status) as OrderStatus;

      if (status === OrderStatus.CANCELLED) {
        if (storeKey) removeActiveOrder(storeKey);
        dispatch({ type: "CANCELLED" });
        opts.onCancel?.(orderId);
        return;
      }

      if (status >= OrderStatus.ACCEPTED) {
        let cur = "INR";
        try { cur = fromHex(o.currency as `0x${string}`, "string").replace(/\0/g, ""); } catch {}
        const actualFiat = d.actualFiatAmount > 0n ? d.actualFiatAmount : o.fiatAmount;
        const actualUsdc = d.actualUsdtAmount > 0n ? d.actualUsdtAmount : o.amount;
        const acceptedTs = d.acceptedTimestamp && d.acceptedTimestamp > 0n
          ? BigInt(d.acceptedTimestamp)
          : BigInt(Math.floor(Date.now() / 1000));
        dispatch({
          type: "ACCEPTED",
          fiatAmount: actualFiat,
          usdcAmount: o.amount,
          currency: cur,
          fee: BigInt(d.fixedFeePaid ?? 0n),
          actualUsdcAmount: actualUsdc,
          acceptedTimestamp: acceptedTs,
        });
        const recipientIdentity = await resolveIdentity();
        const dec = await decryptPaymentAddress({ encrypted: o.encUpi, recipientIdentity });
        dispatch({ type: "DECRYPTED_UPI", upi: dec.isOk() ? dec.value : "Session changed" });

        if (status === OrderStatus.PAID) dispatch({ type: "PAID" });
        if (status === OrderStatus.COMPLETED) {
          if (storeKey) removeActiveOrder(storeKey);
          dispatch({ type: "COMPLETED" });
          opts.onComplete?.(orderId);
        }
      }
    } catch {
      // Non-fatal — the regular polling loop will catch up.
    }
  }, [opts, storeKeyStr]);

  const handlePlaceOrder = useCallback(async () => {
    if (!opts.placeOrder) return;

    // Resume short-circuit. The mount-time `RESUMABLE_FOUND` effect
    // populates `state.orderId` async, so a fast click before it fires
    // would miss the resume and place a duplicate. Read the store
    // synchronously as a safety net. "Pending" here means any non-
    // terminal status — PLACED, ACCEPTED, PAID all resume to the
    // tracking flow, which then fast-forwards to the right phase via
    // the inline chain fetch below. The 8s background poll handles
    // the cancellation case by clearing the entry before we get here.
    if (state.phase === "checkout") {
      let resumeOrderId = state.orderId;
      let resumeTxHash = state.txHash;
      if (!resumeOrderId && storeKey) {
        const stored = getActiveOrder(storeKey);
        if (stored) {
          resumeOrderId = stored.orderId;
          resumeTxHash = stored.txHash;
        }
      }
      if (resumeOrderId && !resumeOrderId.startsWith("demo")) {
        await resumeOrder(resumeOrderId, resumeTxHash ?? "");
        return;
      }
    }

    // Fiat all-in mode that hasn't resolved to a placeable USDC amount. The
    // Pay button is already gated on this, but guard defensively so a fast
    // click can't fire a zero/negative order before the rate lands (or when
    // the entered total is too small to cover the fee).
    if (!opts.demo && opts.fiatChargeAmount !== undefined && resolvedUsdcAmount === undefined) {
      const message =
        amountResolution.status === "too-small"
          ? "This amount is too small to process — it doesn't cover the transaction fee. Please use a larger amount."
          : amountResolution.status === "unavailable"
            ? "Couldn't load the exchange rate to price this order. Please try again."
            : "Still loading the exchange rate — please wait a moment and try again.";
      dispatch({ type: "INLINE_ERROR", message });
      return;
    }

    dispatch({ type: "PLACING" });

    if (opts.demo) {
      const fakeId = `demo${Date.now()}`;
      dispatch({ type: "PLACED", orderId: fakeId, txHash: "0xdemo" });
      opts.onOrderPlaced?.(fakeId, "0xdemo");
      const cur = opts.selectedCurrency?.symbol ?? opts.demoCurrency ?? "INR";
      // Honor the resolved amount in demo too (fiat mode converts via the
      // static demo rate); default to 10 USDC when no amount was supplied.
      const demoUsdc = resolvedUsdcAmount ?? BigInt(10 * 1e6);
      setTimeout(() => {
        const rate = DEMO_FIAT_RATE[cur] ?? 1;
        const demoFee = 100_000n; // demo: 0.10 USDC
        const demoFiat = opts.fiatChargeAmount ?? BigInt(Math.round(Number(demoUsdc) * rate));
        dispatch({
          type: "ACCEPTED",
          fiatAmount: demoFiat,
          usdcAmount: demoUsdc,
          currency: cur,
          fee: demoFee,
          // Clamp so a tiny fiatChargeAmount can't render a negative "you
          // receive" in demo (demo-only; no funds move).
          actualUsdcAmount: demoUsdc > demoFee ? demoUsdc - demoFee : 0n,
          acceptedTimestamp: BigInt(Math.floor(Date.now() / 1000)),
        });
        dispatch({ type: "DECRYPTED_UPI", upi: "p2pdemo@upi" });
      }, 5000);
      return;
    }

    const errorCtx: P2PErrorContext = {
      flow: "place-buy",
      chainId: opts.chainId,
      user: opts.signer?.address,
      diamondAddress: opts.diamondAddress,
      currency: opts.selectedCurrency?.symbol,
      circleId: opts.selectedCurrency?.circleId?.toString(),
      amountUsdc: resolvedUsdcAmount?.toString(),
    };
    try {
      let resolvedCurrency = opts.selectedCurrency;
      // Credit-only short-circuit: when credit fully covers the order, no
      // Diamond order is placed (the integrator redeems credit directly into
      // upstream goods), so the resolved circleId is unused on-chain.
      // Skip SDK routing — otherwise the SDK would probe `checkAssignable`
      // against the FULL `usdcAmount`, which can fail for unrelated reasons
      // (sole merchant has an ongoing order, daily cap, etc.) and block a
      // redemption that doesn't actually need a merchant. The host's
      // `placeOrder` callback is expected to return `creditOnly: true` here.
      const creditCoversFully =
        state.credit !== null &&
        resolvedUsdcAmount !== undefined &&
        resolvedUsdcAmount > 0n &&
        state.credit >= resolvedUsdcAmount;
      if (resolvedCurrency && resolvedCurrency.circleId === undefined && creditCoversFully) {
        // 0n is a sentinel — integrators that take the credit-only path
        // (e.g. LotPot's `userPlaceOrder` when `credit >= total`) ignore
        // the circleId argument entirely; we just need *something* to
        // pass through to the host callback.
        resolvedCurrency = { ...resolvedCurrency, circleId: 0n };
      }
      if (resolvedCurrency && resolvedCurrency.circleId === undefined) {
        if (!opts.subgraphUrl || !opts.usdcAddress || resolvedUsdcAmount === undefined) {
          throw missingRoutingInputsError(
            "Routing requires subgraphUrl, usdcAddress, and an amount (usdcAmount or fiatChargeAmount) when circleId is omitted on CurrencyOption.",
            errorCtx,
          );
        }
        // Resolved USDC order amount is known here (guarded above).
        const orderUsdc: bigint = resolvedUsdcAmount;
        // GROSS fiat the merchant validates against (subtotal + small-order
        // fee, in fiat). Precedence: explicit routing override → the all-in
        // fiat the integrator already gave us → derived from on-chain price.
        // Falls back to 0n if buyPrice hasn't loaded, letting the SDK route
        // without an eligibility filter.
        const routingFiat =
          opts.fiatAmount ??
          opts.fiatChargeAmount ??
          (state.buyPrice
            ? grossFiatForOrder(orderUsdc, state.buyPrice, state.smallOrderThreshold, state.smallOrderFixedFee)
            : 0n);

        const orders = createOrders({
          publicClient: publicClient as any,
          diamondAddress: opts.diamondAddress,
          usdcAddress: opts.usdcAddress,
          subgraphUrl: opts.subgraphUrl,
          relayIdentityStore: createLocalStorageRelayStore(),
        });
        const prepared = await orders.placeOrder.prepare({
          orderType: 0, // BUY
          // Widget's CurrencyOption.symbol is `string`; SDK validates against
          // its CurrencyCode enum at runtime via Zod. Cast to satisfy TS.
          currency: resolvedCurrency.symbol as any,
          user: opts.signer.address,
          amount: orderUsdc,
          fiatAmount: routingFiat,
          recipientAddr: opts.signer.address,
          preferredPaymentChannelConfigId: resolvedCurrency.paymentChannelConfigId ?? 0n,
        });
        if (prepared.isErr()) {
          // SDK error (e.g. "No eligible circles") is protocol jargon —
          // surface as a user-friendly routing error with the SDK error
          // preserved on err.cause for diagnostics.
          throw noEligibleMerchantsError(errorCtx, prepared.error);
        }
        const routedCircleId = prepared.value.meta?.circleId;
        if (routedCircleId === undefined) {
          throw noEligibleMerchantsError(errorCtx);
        }
        resolvedCurrency = { ...resolvedCurrency, circleId: routedCircleId };
      }

      // Fiat handed back to the host alongside the resolved USDC amount: the
      // exact all-in total in fiat mode, else the gross derived from the
      // resolved amount. Lets payment-gateway `placeOrder` callbacks encode
      // the widget-computed amount into their integrator tx.
      const contextFiat =
        opts.fiatChargeAmount ??
        (resolvedUsdcAmount !== undefined && state.buyPrice
          ? grossFiatForOrder(resolvedUsdcAmount, state.buyPrice, state.smallOrderThreshold, state.smallOrderFixedFee)
          : undefined);
      const runPlace = () =>
        opts.placeOrder!({
          currency: resolvedCurrency,
          usdcAmount: resolvedUsdcAmount,
          fiatAmount: contextFiat,
        });
      const result = opts.screening
        ? await processB2BBuyOrder({
            signer: opts.signer,
            screening: opts.screening,
            placeOrder: runPlace,
            // Cleared users (already verified on-chain, or the gate is off)
            // pass a `liveliness_required` response through without prompting.
            isLivenessVerified: state.livenessCleared,
          })
        : await runPlace();

      // Credit-only fast path: the host's integrator skipped the Diamond
      // entirely and redeemed credit on the spot (e.g. LotPot's
      // `userPlaceOrder` returning orderId=0 with credit covering the
      // total). No order tracking is needed — snap to the redeemed
      // success screen and fire onComplete immediately. The active-order
      // store is intentionally NOT touched here: no Diamond order id
      // means nothing to resume on a page reload.
      if (result.creditOnly) {
        dispatch({ type: "CREDIT_ONLY_PLACED", orderId: result.orderId, txHash: result.txHash });
        opts.onOrderPlaced?.(result.orderId, result.txHash);
        opts.onComplete?.(result.orderId);
        return;
      }

      dispatch({ type: "PLACED", orderId: result.orderId, txHash: result.txHash });
      if (storeKey) setActiveOrder(storeKey, { orderId: result.orderId, txHash: result.txHash });
      opts.onOrderPlaced?.(result.orderId, result.txHash);
    } catch (err: unknown) {
      const p2p = toP2PError(err, errorCtx);
      if (p2p.code === "SCREENING_LIVENESS_REQUIRED") {
        // Not an error: screening requires a one-time liveness check for
        // this (suspect) buyer. Surface the gate and let the user retry the
        // order once verified — the order was NOT placed. LIVENESS_REQUIRED
        // resets phase from "placing" back to "checkout" so the block renders.
        dispatch({ type: "LIVENESS_REQUIRED" });
        return;
      }
      dispatch({ type: "ERROR", message: p2p.userMessage });
      opts.onError?.(p2p);
    }
  }, [opts]);

  const markPaid = useCallback(async () => {
    if (!state.orderId) return;
    if (opts.demo) {
      dispatch({ type: "PAID" });
      setTimeout(() => { dispatch({ type: "COMPLETED" }); opts.onComplete?.(state.orderId!); }, 10000);
      return;
    }
    dispatch({ type: "INLINE_ERROR", message: null });
    try {
      const data = encodeFunctionData({ abi: DIAMOND_ABI, functionName: "paidBuyOrder", args: [BigInt(state.orderId)] });
      const { hash } = await opts.signer.sendTransaction({ to: opts.diamondAddress, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      dispatch({ type: "PAID" });
    } catch (err: unknown) {
      // Keep the user on the accepted screen so they can retry. Dumping to a
      // dedicated error phase would erase the payment-details + order context.
      const p2p = toP2PError(err, {
        flow: "mark-paid",
        chainId: opts.chainId,
        user: opts.signer?.address,
        diamondAddress: opts.diamondAddress,
        orderId: state.orderId ?? undefined,
      });
      dispatch({ type: "INLINE_ERROR", message: p2p.userMessage });
    }
  }, [state.orderId, opts]);

  const cancelOrder = useCallback(async () => {
    if (!state.orderId) return;
    if (opts.demo) { dispatch({ type: "CANCELLED" }); opts.onCancel?.(state.orderId); return; }
    dispatch({ type: "INLINE_ERROR", message: null });
    try {
      const data = encodeFunctionData({
        abi: [{ name: "cancelOrder", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_orderId", type: "uint256" }], outputs: [] }],
        functionName: "cancelOrder", args: [BigInt(state.orderId)],
      });
      const { hash } = await opts.signer.sendTransaction({ to: opts.diamondAddress, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      if (storeKey) removeActiveOrder(storeKey);
      dispatch({ type: "CANCELLED" }); opts.onCancel?.(state.orderId);
    } catch (err: unknown) {
      // Inline-only: keep the accepted-screen context so the user sees what
      // went wrong and can retry / sign in again. The old behavior flipped
      // phase to "error" and blanked the modal.
      const p2p = toP2PError(err, {
        flow: "cancel",
        chainId: opts.chainId,
        user: opts.signer?.address,
        diamondAddress: opts.diamondAddress,
        orderId: state.orderId ?? undefined,
      });
      dispatch({ type: "INLINE_ERROR", message: p2p.userMessage });
    }
  }, [state.orderId, opts]);

  // Run the one-time liveness check: open the hosted wizard in a popup, redeem
  // the returned code for an attestation, and submit it on-chain. Mirrors the
  // markPaid write pattern (encodeFunctionData → signer.sendTransaction →
  // wait). The on-chain `livenessVerified[user]` flag makes this verify-once.
  const startLivenessVerification = useCallback(async () => {
    const cfg = opts.liveness;
    if (!cfg || !opts.signer?.address) return;
    dispatch({ type: "LIVENESS_VERIFYING" });
    try {
      const verifyState = `lv-${Math.random().toString(36).slice(2)}`;
      const returnUrl = window.location.origin + window.location.pathname;
      const { widget_url } = await createLivenessSession(cfg.proxyUrl, {
        wallet_pubkey: opts.signer.address,
        redirect_uri: returnUrl,
        tenant: cfg.tenant,
        state: verifyState,
      });
      const code = await openVerifyPopup(widget_url, window.location.origin, verifyState);
      if (!code) {
        dispatch({
          type: "LIVENESS_VERIFY_FAILED",
          message: "Verification was not completed. Please try again.",
        });
        return;
      }
      const att = await redeemLivenessAttestation(cfg.proxyUrl, code);
      const data = encodeFunctionData({
        abi: LIVENESS_GATE_ABI,
        functionName: "submitLivenessAttestation",
        args: [att.nullifier, att.limit, att.expiry, att.signature],
      });
      const { hash } = await opts.signer.sendTransaction({
        to: cfg.integratorAddress,
        data,
        gasLimit: 250000,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      dispatch({ type: "LIVENESS_VERIFIED" });
    } catch (err: unknown) {
      const p2p = toP2PError(err, {
        flow: "liveness",
        chainId: opts.chainId,
        user: opts.signer?.address,
      });
      dispatch({ type: "LIVENESS_VERIFY_FAILED", message: p2p.userMessage });
    }
  }, [opts]);

  // Concurrency gate, DERIVED (not stored) so it recomputes from the current
  // resolved amount every render — see `deriveGate`. Keeps fiatChargeAmount
  // mode from flashing an enabled Pay button to a user with a pending order in
  // the window after the rate resolves but before an amount-keyed refetch used
  // to correct the gate. The fetch above is signer-keyed and runs once.
  const gateWired = Boolean(
    opts.fetchCredit && opts.fetchPendingOrders && opts.signer?.address,
  );
  const gate = useMemo(
    () => deriveGate(gateWired, state.pendingOrders, resolvedUsdcAmount),
    [gateWired, state.pendingOrders, resolvedUsdcAmount],
  );

  return {
    state,
    handlePlaceOrder,
    markPaid,
    cancelOrder,
    startLivenessVerification,
    // Effective order amount + its resolution status, so the widget renders
    // the breakdown / gates the Pay button consistently in both usdcAmount
    // and fiatChargeAmount modes.
    resolvedUsdcAmount,
    amountStatus: amountResolution.status,
    // Derived credit/concurrency gate: "loading" | { allow } | { reject }.
    gate,
  };
}
