import { useReducer, useCallback, useEffect, useRef } from "react";
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
import type { CheckoutSigner, CheckoutPhase, PlaceOrderResult, PlaceOrderContext, CurrencyOption } from "../types";
import { OrderStatus } from "../types";
import { DIAMOND_ABI } from "./contracts";
import { DEMO_FIAT_RATE } from "./config";

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
  | { type: "PRICE_CONFIG"; currency: string; buyPrice: bigint; smallOrderThreshold: bigint; smallOrderFixedFee: bigint };

const INITIAL: OrderState = {
  phase: "checkout", orderId: null, txHash: null,
  usdcAmount: null, fiatAmount: null, currency: "INR",
  decryptedUpi: null, error: null,
  buyPrice: null, smallOrderThreshold: null, smallOrderFixedFee: null,
  fee: null, actualUsdcAmount: null,
  acceptedTimestamp: null,
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

  const fetchOrderStatus = useCallback(async () => {
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

      // Resume-safe: walk the local state machine forward to whatever the
      // chain says, regardless of where we currently are. A page refresh
      // mid-flow lands here with `state.phase === "placed"` and may need to
      // jump straight to accepted / paid / completed in one tick.

      if (status === OrderStatus.CANCELLED) {
        if (state.phase !== "cancelled") {
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
        dispatch({ type: "COMPLETED" });
        opts.onComplete?.(state.orderId);
      }
    } catch {}
  }, [state.orderId, state.phase, state.acceptedTimestamp, opts.diamondAddress]);

  // Fire one immediate fetch as soon as we have an orderId (covers the
  // resume-from-localStorage case — no 3s "Finding merchant" flash for orders
  // that were already accepted before the refresh).
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (!state.orderId || state.orderId.startsWith("demo") || didInitialFetch.current) return;
    didInitialFetch.current = true;
    fetchOrderStatus();
  }, [state.orderId, fetchOrderStatus]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!state.orderId || state.orderId.startsWith("demo")) return;
    let interval: number | null = null;
    if (state.phase === "placed") interval = 3000;
    else if (state.phase === "accepted") interval = 15000;
    else if (state.phase === "paid") interval = 10000;
    if (interval) pollingRef.current = setInterval(fetchOrderStatus, interval);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [state.phase, state.orderId, fetchOrderStatus]);

  // Fetch on-chain price config for the selected currency so we can derive a
  // pre-order fiat quote + fee estimate. One read per currency change; no
  // polling — buy-price is effectively static for the duration of checkout.
  const currencySymbol = opts.selectedCurrency?.symbol;
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
        // `fiatAmount` prop (or 0n) and the UI omits the breakdown.
      }
    })();
    return () => { cancelled = true; };
  }, [currencySymbol, opts.diamondAddress, opts.demo]);

  const handlePlaceOrder = useCallback(async () => {
    if (!opts.placeOrder) return;
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

      const result = await opts.placeOrder({ currency: resolvedCurrency });
      dispatch({ type: "PLACED", orderId: result.orderId, txHash: result.txHash });
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
