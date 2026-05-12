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
import type { CheckoutSigner, CheckoutPhase, PlaceOrderResult, PlaceOrderContext, CurrencyOption, PendingOrderSummary, ScreeningConfig } from "../types";
import { OrderStatus } from "../types";
import { DIAMOND_ABI } from "./contracts";
import { DEMO_FIAT_RATE } from "./config";
import { processB2BBuyOrder } from "./b2b-fraud-engine";
import { getActiveOrder, setActiveOrder, removeActiveOrder, keyFor, type ActiveOrderKey } from "./active-orders-store";
import { computeGateDecision, type GateDecision } from "./credit-math";

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
  // Pending-order list from the host. null = unfetched; [] = none.
  pendingOrders: PendingOrderSummary[] | null;
  // Decision derived from (credit, pendingOrders, opts.usdcAmount).
  // "loading" until both fetches resolve; then drives the gate UI.
  gate: GateDecision | "loading";
  // True when the host's `placeOrder` returned `creditOnly: true`. Drives
  // the success-screen copy and tells the polling loop to short-circuit.
  creditOnly: boolean;
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
  // Used while phase=checkout to hold a resumable order in the background.
  // RESUMABLE_FOUND attaches an orderId without flipping out of "checkout"
  // — the user still sees the form. Pay-now uses this id to skip placement.
  | { type: "RESUMABLE_FOUND"; orderId: string; txHash: string }
  | { type: "RESUMABLE_CLEARED" }
  // Credit-accounting actions.
  | { type: "CREDIT_LOADED"; credit: bigint; pending: PendingOrderSummary[]; gate: GateDecision }
  | { type: "CREDIT_AUTO_RESUMED"; orderId: string }
  | { type: "CREDIT_ONLY_PLACED"; orderId: string; txHash: string };

const INITIAL: OrderState = {
  phase: "checkout", orderId: null, txHash: null,
  usdcAmount: null, fiatAmount: null, currency: "INR",
  decryptedUpi: null, error: null,
  buyPrice: null, smallOrderThreshold: null, smallOrderFixedFee: null,
  fee: null, actualUsdcAmount: null,
  acceptedTimestamp: null,
  priceConfigFailed: false,
  credit: null, pendingOrders: null, gate: "loading",
  creditOnly: false,
};

function reducer(state: OrderState, action: OrderAction): OrderState {
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
    case "RESUMABLE_FOUND": return { ...state, orderId: action.orderId, txHash: action.txHash };
    case "RESUMABLE_CLEARED": return { ...state, orderId: null, txHash: null };
    case "CREDIT_LOADED": return {
      ...state, credit: action.credit, pendingOrders: action.pending, gate: action.gate,
    };
    case "CREDIT_AUTO_RESUMED": return {
      ...state, phase: "placed", orderId: action.orderId, txHash: "",
    };
    case "CREDIT_ONLY_PLACED": return {
      ...state, phase: "completed",
      orderId: action.orderId, txHash: action.txHash,
      creditOnly: true,
    };
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
  screening?: ScreeningConfig;
  // Credit accounting (optional; both must be set for the gate to engage).
  fetchCredit?: (user: `0x${string}`) => Promise<bigint>;
  fetchPendingOrders?: (user: `0x${string}`) => Promise<PendingOrderSummary[]>;
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

  // Composite key for the resumable-order store. null when the host hasn't
  // supplied enough context (no signer / no currency picker / no amount) —
  // in that mode the machine just acts like the previous version (no resume).
  const storeKey = useMemo<ActiveOrderKey | null>(() => {
    if (!opts.signer?.address || !opts.selectedCurrency || opts.usdcAmount === undefined) return null;
    return {
      user: opts.signer.address,
      chainId: opts.chainId,
      currency: opts.selectedCurrency.symbol,
      usdcAmount: opts.usdcAmount,
    };
  }, [opts.signer?.address, opts.chainId, opts.selectedCurrency?.symbol, opts.usdcAmount]);
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
          publicClient.readContract({
            address: opts.diamondAddress, abi: DIAMOND_ABI,
            functionName: "getSmallOrderFixedFee", args: [currencyHex],
          }) as Promise<bigint>,
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
  // host didn't supply both callbacks, the gate stays in "loading" until
  // we explicitly mark it allow — done synchronously here.
  //
  // Why both must be set: enforcing the rule with only one callback leaves
  // a half-state — e.g. seeing credit but not knowing if a pending order
  // exists means we either over- or under-block. Easier to require both
  // up-front than to define partial-mode semantics.
  const fetchKeyStr = `${opts.signer?.address ?? ""}|${opts.usdcAmount?.toString() ?? ""}`;
  useEffect(() => {
    if (!opts.fetchCredit || !opts.fetchPendingOrders || !opts.signer?.address) {
      // No gate to compute — record explicit "allow" so the UI doesn't
      // hang on the "loading" state forever.
      dispatch({ type: "CREDIT_LOADED", credit: 0n, pending: [], gate: { kind: "allow" } });
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
        const gate = computeGateDecision(credit, pending, opts.usdcAmount);
        dispatch({ type: "CREDIT_LOADED", credit, pending, gate });
        // Auto-resume side effect: when the gate decides to flip into
        // tracking-only mode for a matching pending order, do it here
        // (the reducer can't fetch chain state — the regular polling
        // effect on `state.orderId` walks it forward from PLACED).
        if (gate.kind === "auto-resume") {
          dispatch({ type: "CREDIT_AUTO_RESUMED", orderId: gate.orderId });
        }
      } catch {
        // Treat fetch failure as no-credit/no-pending so the user can
        // still place an order — better than blocking on a transient RPC
        // blip. The host's `onError` is reserved for placement-side
        // failures; failed credit reads aren't user-facing.
        if (!cancelled) {
          dispatch({ type: "CREDIT_LOADED", credit: 0n, pending: [], gate: { kind: "allow" } });
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKeyStr, state.phase]);

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

    dispatch({ type: "PLACING" });

    if (opts.demo) {
      const fakeId = `demo${Date.now()}`;
      dispatch({ type: "PLACED", orderId: fakeId, txHash: "0xdemo" });
      opts.onOrderPlaced?.(fakeId, "0xdemo");
      const cur = opts.selectedCurrency?.symbol ?? opts.demoCurrency ?? "INR";
      setTimeout(() => {
        const rate = DEMO_FIAT_RATE[cur] ?? 1;
        dispatch({
          type: "ACCEPTED",
          fiatAmount: BigInt(Math.round(10 * 1e6 * rate)),
          usdcAmount: BigInt(10 * 1e6),
          currency: cur,
          fee: 100_000n, // demo: 0.10 USDC
          actualUsdcAmount: BigInt(10 * 1e6) - 100_000n,
          acceptedTimestamp: BigInt(Math.floor(Date.now() / 1000)),
        });
        dispatch({ type: "DECRYPTED_UPI", upi: "p2pdemo@upi" });
      }, 5000);
      return;
    }

    try {
      let resolvedCurrency = opts.selectedCurrency;
      if (resolvedCurrency && resolvedCurrency.circleId === undefined) {
        if (!opts.subgraphUrl || !opts.usdcAddress || opts.usdcAmount === undefined) {
          throw new Error(
            "Routing requires subgraphUrl, usdcAddress, and usdcAmount when circleId is omitted on CurrencyOption.",
          );
        }
        // Prefer an explicit fiatAmount from the host; otherwise derive from
        // the on-chain price config. We pass the GROSS fiat (subtotal + fee
        // converted to fiat) — that's the amount the merchant validates
        // against, so it must include the protocol's small-order fee.
        // Falls back to 0n if buyPrice hasn't loaded yet, which lets the SDK
        // route without an eligibility filter.
        const routingFiat = opts.fiatAmount ?? (() => {
          if (!state.buyPrice) return 0n;
          const subtotal = (opts.usdcAmount * state.buyPrice) / 1_000_000n;
          const feeUsdc =
            state.smallOrderThreshold !== null &&
            state.smallOrderFixedFee !== null &&
            opts.usdcAmount <= state.smallOrderThreshold
              ? state.smallOrderFixedFee
              : 0n;
          const feeFiat = (feeUsdc * state.buyPrice) / 1_000_000n;
          return subtotal + feeFiat;
        })();

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
          amount: opts.usdcAmount,
          fiatAmount: routingFiat,
          recipientAddr: opts.signer.address,
          preferredPaymentChannelConfigId: resolvedCurrency.paymentChannelConfigId ?? 0n,
        });
        if (prepared.isErr()) throw prepared.error;
        const routedCircleId = prepared.value.meta?.circleId;
        if (routedCircleId === undefined) {
          throw new Error("SDK routing returned no circleId");
        }
        resolvedCurrency = { ...resolvedCurrency, circleId: routedCircleId };
      }

      const runPlace = () => opts.placeOrder!({ currency: resolvedCurrency });
      const result = opts.screening
        ? await processB2BBuyOrder({
            signer: opts.signer,
            screening: opts.screening,
            placeOrder: runPlace,
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
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Failed to place order" });
      opts.onError?.(err);
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
    } catch (err: any) {
      // Keep the user on the accepted screen so they can retry. Dumping to a
      // dedicated error phase would erase the payment-details + order context.
      dispatch({ type: "INLINE_ERROR", message: err?.shortMessage || err?.message || "Failed to mark paid" });
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
    } catch (err: any) {
      // Inline-only: keep the accepted-screen context so the user sees what
      // went wrong and can retry / sign in again. The old behavior flipped
      // phase to "error" and blanked the modal.
      dispatch({ type: "INLINE_ERROR", message: err?.shortMessage || err?.message || "Failed to cancel" });
    }
  }, [state.orderId, opts]);

  return { state, handlePlaceOrder, markPaid, cancelOrder };
}
