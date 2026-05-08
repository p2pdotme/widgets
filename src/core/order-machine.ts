import { useReducer, useCallback, useEffect, useRef } from "react";
import { createPublicClient, http, encodeFunctionData, fromHex } from "viem";
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
import type { CheckoutSigner, CheckoutPhase, PlaceOrderResult, PlaceOrderContext, CurrencyOption, ScreeningConfig } from "../types";
import { OrderStatus } from "../types";
import { DIAMOND_ABI } from "./contracts";
import { DEMO_FIAT_RATE } from "./config";
import { processB2BBuyOrder } from "./b2b-fraud-engine";

interface OrderState {
  phase: CheckoutPhase;
  orderId: string | null;
  txHash: string | null;
  usdcAmount: bigint | null;
  fiatAmount: bigint | null;
  currency: string;
  decryptedUpi: string | null;
  error: string | null;
}

type OrderAction =
  | { type: "PLACING" }
  | { type: "PLACED"; orderId: string; txHash: string }
  | { type: "ACCEPTED"; fiatAmount: bigint; usdcAmount: bigint; currency: string }
  | { type: "DECRYPTED_UPI"; upi: string }
  | { type: "PAID" }
  | { type: "COMPLETED" }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string };

const INITIAL: OrderState = {
  phase: "checkout", orderId: null, txHash: null,
  usdcAmount: null, fiatAmount: null, currency: "INR",
  decryptedUpi: null, error: null,
};

function reducer(state: OrderState, action: OrderAction): OrderState {
  switch (action.type) {
    case "PLACING": return { ...state, phase: "placing", error: null };
    case "PLACED": return { ...state, phase: "placed", orderId: action.orderId, txHash: action.txHash };
    case "ACCEPTED": return { ...state, phase: "accepted", fiatAmount: action.fiatAmount, usdcAmount: action.usdcAmount, currency: action.currency };
    case "DECRYPTED_UPI": return { ...state, decryptedUpi: action.upi };
    case "PAID": return { ...state, phase: "paid" };
    case "COMPLETED": return { ...state, phase: "completed" };
    case "CANCELLED": return { ...state, phase: "cancelled" };
    case "ERROR": return { ...state, phase: "error", error: action.message };
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

      if (status === OrderStatus.ACCEPTED && state.phase === "placed") {
        const actualFiat = d.actualFiatAmount > 0n ? d.actualFiatAmount : o.fiatAmount;
        dispatch({ type: "ACCEPTED", fiatAmount: actualFiat, usdcAmount: o.amount, currency: cur });
        const recipientIdentity = await resolveIdentity();
        const result = await decryptPaymentAddress({ encrypted: o.encUpi, recipientIdentity });
        dispatch({ type: "DECRYPTED_UPI", upi: result.isOk() ? result.value : "Session changed" });
      } else if (status === OrderStatus.COMPLETED && state.phase === "paid") {
        dispatch({ type: "COMPLETED" });
        opts.onComplete?.(state.orderId);
      } else if (status === OrderStatus.CANCELLED) {
        dispatch({ type: "CANCELLED" });
        opts.onCancel?.(state.orderId);
      }
    } catch {}
  }, [state.orderId, state.phase, opts.diamondAddress]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!state.orderId || state.orderId.startsWith("demo")) return;
    let interval: number | null = null;
    if (state.phase === "placed") interval = 3000;
    else if (state.phase === "paid") interval = 10000;
    if (interval) pollingRef.current = setInterval(fetchOrderStatus, interval);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [state.phase, state.orderId, fetchOrderStatus]);

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
        dispatch({ type: "ACCEPTED", fiatAmount: BigInt(Math.round(10 * 1e6 * rate)), usdcAmount: BigInt(10 * 1e6), currency: cur });
        dispatch({ type: "DECRYPTED_UPI", upi: "p2pdemo@upi" });
      }, 5000);
      return;
    }

    try {
      let resolvedCurrency = opts.selectedCurrency;
      if (resolvedCurrency && resolvedCurrency.circleId === undefined) {
        if (!opts.subgraphUrl || !opts.usdcAddress || opts.usdcAmount === undefined || opts.fiatAmount === undefined) {
          throw new Error(
            "Routing requires subgraphUrl, usdcAddress, usdcAmount, and fiatAmount when circleId is omitted on CurrencyOption.",
          );
        }
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
          fiatAmount: opts.fiatAmount,
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
    try {
      const data = encodeFunctionData({ abi: DIAMOND_ABI, functionName: "paidBuyOrder", args: [BigInt(state.orderId)] });
      const { hash } = await opts.signer.sendTransaction({ to: opts.diamondAddress, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      dispatch({ type: "PAID" });
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Failed to mark paid" });
    }
  }, [state.orderId, opts]);

  const cancelOrder = useCallback(async () => {
    if (!state.orderId) return;
    if (opts.demo) { dispatch({ type: "CANCELLED" }); opts.onCancel?.(state.orderId); return; }
    try {
      const data = encodeFunctionData({
        abi: [{ name: "cancelOrder", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_orderId", type: "uint256" }], outputs: [] }],
        functionName: "cancelOrder", args: [BigInt(state.orderId)],
      });
      const { hash } = await opts.signer.sendTransaction({ to: opts.diamondAddress, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      dispatch({ type: "CANCELLED" }); opts.onCancel?.(state.orderId);
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Failed to cancel" });
    }
  }, [state.orderId, opts]);

  return { state, handlePlaceOrder, markPaid, cancelOrder };
}
