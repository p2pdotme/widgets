import { useReducer, useCallback, useEffect, useMemo, useRef } from "react";
import { createPublicClient, http } from "viem";
import { baseSepolia, base } from "viem/chains";
import {
  createOrders,
  createLocalStorageRelayStore,
  createRelayIdentity,
  type OrdersClient,
} from "@p2pdotme/sdk/orders";
import type {
  CheckoutSigner, CurrencyOption, CashoutPhase,
  PlaceCashoutContext, PlaceCashoutResult,
  DeliverUpiContext, ReconcileContext,
} from "../types";
import { DIAMOND_ABI } from "./contracts";
import {
  toP2PError,
  noEligibleMerchantsError,
  missingRoutingInputsError,
  encryptionPreflightError,
  encryptionFailedError,
  orderBadStatusError,
  type P2PErrorContext,
} from "./errors";

/**
 * Callback-based offramp state machine. Widget-side responsibilities:
 *   - Auto-route circleId via SDK (Diamond-level; uses subgraph)
 *   - Mint a relay identity & supply userPubKey
 *   - Encrypt the user's payment address against the merchant's chain pubkey
 *   - Poll Diamond status (PLACED → ACCEPTED → PAID → COMPLETED/CANCELLED)
 *   - Drive the visual state machine
 *
 * Host-side responsibilities (via callbacks):
 *   - `placeCashout`   — approve USDC, submit the integrator-specific
 *                        userInitiateOfframp / equivalent tx, parse the
 *                        receipt for an orderId.
 *   - `deliverUpi`     — submit the integrator's deliverOfframpUpi (the
 *                        widget hands over the already-encrypted blob).
 *   - `reconcile`      — optional. Submit the integrator's reconcile() so
 *                        the integrator's local order state catches up to
 *                        the Diamond. Skip if your integrator doesn't need it.
 */
interface OfframpState {
  phase: CashoutPhase;
  orderId: string | null;
  txHash: string | null;
  currency: CurrencyOption | null;
  paymentAddress: string | null;
  usdcAmount: bigint | null;
  fiatAmount: bigint | null;
  error: string | null;
}

type OfframpAction =
  | { type: "PLACING"; currency: CurrencyOption; paymentAddress: string; usdcAmount: bigint }
  | { type: "PLACED"; orderId: string; txHash: string }
  | { type: "ACCEPTED" }
  | { type: "ENCRYPTING" }
  | { type: "PAID"; fiatAmount: bigint }
  | { type: "COMPLETED" }
  | { type: "CANCELLED" }
  | { type: "RESET" }
  | { type: "ERROR"; message: string };

const INITIAL: OfframpState = {
  phase: "form",
  orderId: null, txHash: null, currency: null, paymentAddress: null,
  usdcAmount: null, fiatAmount: null, error: null,
};

function reducer(s: OfframpState, a: OfframpAction): OfframpState {
  switch (a.type) {
    case "PLACING": return { ...s, phase: "placing", currency: a.currency, paymentAddress: a.paymentAddress, usdcAmount: a.usdcAmount, error: null };
    case "PLACED": return { ...s, phase: "placed", orderId: a.orderId, txHash: a.txHash };
    case "ACCEPTED": return { ...s, phase: "accepted" };
    case "ENCRYPTING": return { ...s, phase: "encrypting" };
    case "PAID": return { ...s, phase: "paid", fiatAmount: a.fiatAmount };
    case "COMPLETED": return { ...s, phase: "completed" };
    case "CANCELLED": return { ...s, phase: "cancelled" };
    case "ERROR": return { ...s, phase: "error", error: a.message };
    case "RESET": return INITIAL;
    default: return s;
  }
}

export interface UseOfframpMachineOpts {
  usdcAddress: `0x${string}`;
  diamondAddress: `0x${string}`;
  signer: CheckoutSigner;
  chainId?: number;
  rpcUrl?: string;
  /** Required when any `CurrencyOption.circleId` is omitted — used for SDK auto-routing. */
  subgraphUrl?: string;
  /** Slippage floor on fiat amount; 0 = no check. */
  fiatAmountLimit?: bigint;

  // ─── Host callbacks (integrator-specific) ────────────────────────────
  placeCashout: (ctx: PlaceCashoutContext) => Promise<PlaceCashoutResult>;
  deliverUpi:   (ctx: DeliverUpiContext)   => Promise<{ txHash: string }>;
  reconcile?:   (ctx: ReconcileContext)    => Promise<{ txHash: string }>;

  // ─── Events ──────────────────────────────────────────────────────────
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?:    (orderId: string) => void;
  onCancelled?:   (orderId: string) => void;
  onError?:       (err: Error) => void;
}

export function useOfframpMachine(opts: UseOfframpMachineOpts) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const chain = opts.chainId === 8453 ? base : baseSepolia;
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(opts.rpcUrl) }),
    [chain, opts.rpcUrl]
  );

  // SDK orders client — used for the `placeOrder.prepare` auto-routing call
  // (when host omits circleId) AND for encrypting the user's payment address
  // against the merchant's on-chain pubkey at the ACCEPTED handoff.
  const ordersClient: OrdersClient = useMemo(
    () => createOrders({
      publicClient: publicClient as any,
      diamondAddress: opts.diamondAddress,
      usdcAddress: opts.usdcAddress,
      subgraphUrl: opts.subgraphUrl ?? "",
      relayIdentityStore: createLocalStorageRelayStore(),
    }),
    [publicClient, opts.diamondAddress, opts.usdcAddress, opts.subgraphUrl]
  );

  // ─── User submits the form ───────────────────────────────────────────

  const submit = useCallback(
    async (currency: CurrencyOption, paymentAddress: string, usdcAmount: bigint, feeUsdc: bigint) => {
      // Transition to "placing" IMMEDIATELY so the form unmounts and the
      // user sees the loading screen — the steps below (encryption preflight,
      // SDK routing, host's approve+place txs) can each take several seconds
      // and would otherwise leave the user staring at a disabled button
      // with no feedback.
      dispatch({ type: "PLACING", currency, paymentAddress, usdcAmount });

      const errorCtx: P2PErrorContext = {
        flow: "place-sell",
        chainId: opts.chainId,
        user: opts.signer?.address,
        diamondAddress: opts.diamondAddress,
        currency: currency?.symbol,
        circleId: currency?.circleId?.toString(),
        amountUsdc: usdcAmount?.toString(),
      };

      try {
        // Pre-flight: verify the encryption stack works BEFORE the host
        // pulls user funds. Surfaces broken crypto polyfills early.
        await preflightEncryption(ordersClient, errorCtx);

        // Auto-route circleId via the SDK if the host didn't pin one.
        // Diamond-level operation — no integrator code involved.
        let resolvedCircleId = currency.circleId;
        if (resolvedCircleId === undefined) {
          if (!opts.subgraphUrl) {
            throw missingRoutingInputsError(
              "Offramp routing requires either CurrencyOption.circleId or `subgraphUrl` (so the SDK can pick a merchant).",
              errorCtx,
            );
          }
          const prepared = await ordersClient.placeOrder.prepare({
            orderType: 1, // SELL
            currency: currency.symbol as any,
            user: opts.signer.address,
            amount: usdcAmount,
            // SELL routing uses fiatAmount as an eligibility floor. 0n
            // disables the filter; host can pin a real number via
            // `fiatAmountLimit` opt to restrict to merchants that can settle
            // at that fiat size.
            fiatAmount: opts.fiatAmountLimit ?? 0n,
            // recipientAddr unused for SELL; SDK still requires the field.
            recipientAddr: opts.signer.address,
            preferredPaymentChannelConfigId: currency.paymentChannelConfigId ?? 0n,
          });
          if (prepared.isErr()) {
            // SDK throws "No eligible circles" or similar — "circles" is
            // protocol-internal jargon. Translate to a user-friendly
            // routing error with the SDK error on err.cause.
            throw noEligibleMerchantsError(errorCtx, prepared.error);
          }
          resolvedCircleId = prepared.value.meta?.circleId;
          if (resolvedCircleId === undefined) {
            throw noEligibleMerchantsError(errorCtx);
          }
        }

        // Host integrator txs need the user's relay pubkey (so merchants can
        // encrypt their UPI back to the user later). Pull from SDK store.
        const userPubKey = await ensureRelayPubKey();

        // Hand off to the host. Host approves USDC + submits whatever
        // integrator-specific tx places the SELL, then returns orderId.
        // `feeUsdc` is the small-order fee the Diamond will pull on top of
        // `usdcAmount` (= principal) at setSellOrderUpi — host should
        // approve `usdcAmount + feeUsdc` so the user's balance covers both.
        const result = await opts.placeCashout({
          currency: { ...currency, circleId: resolvedCircleId },
          paymentAddress,
          usdcAmount,
          feeUsdc,
          userPubKey,
        });

        dispatch({ type: "PLACED", orderId: result.orderId, txHash: result.txHash });
        opts.onOrderPlaced?.(result.orderId, result.txHash);
      } catch (err: unknown) {
        const p2p = toP2PError(err, errorCtx);
        dispatch({ type: "ERROR", message: p2p.userMessage });
        opts.onError?.(p2p);
      }
    },
    [opts, ordersClient]
  );

  // ─── Polling: PLACED → ACCEPTED → PAID → COMPLETED ───────────────────

  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const encryptAndDeliver = useCallback(async (merchantPubkey: string) => {
    const ctx: P2PErrorContext = {
      flow: "deliver-upi",
      chainId: opts.chainId,
      user: opts.signer?.address,
      diamondAddress: opts.diamondAddress,
      orderId: state.orderId ?? undefined,
    };
    if (!state.paymentAddress) throw orderBadStatusError("No payment address recorded", ctx);
    if (!state.orderId) throw orderBadStatusError("No orderId recorded", ctx);

    dispatch({ type: "ENCRYPTING" });

    // SDK encrypts the user's payment address (UPI / PIX / etc) with the
    // merchant's relay pubkey, signed under the user's relay identity.
    const encResult = await ordersClient.encryptPaymentAddress({
      paymentAddress: state.paymentAddress,
      recipientPublicKey: merchantPubkey,
    });
    if (encResult.isErr()) throw encryptionFailedError(encResult.error.message, ctx);

    // Hand the encrypted blob to the host so they can submit the
    // integrator's deliverOfframpUpi tx.
    await opts.deliverUpi({ orderId: state.orderId, encryptedUpi: encResult.value });
  }, [state.paymentAddress, state.orderId, ordersClient, opts]);

  const runReconcile = useCallback(async (status: number) => {
    if (!state.orderId || !opts.reconcile) return;
    try { await opts.reconcile({ orderId: state.orderId, status }); }
    catch { /* best-effort — Diamond status is the source of truth */ }
  }, [state.orderId, opts]);

  const checkOrderStatus = useCallback(async () => {
    if (!state.orderId) return;
    try {
      const order = (await publicClient.readContract({
        address: opts.diamondAddress, abi: DIAMOND_ABI,
        functionName: "getOrdersById", args: [BigInt(state.orderId)],
      })) as any;
      const numStatus = Number(order.status);
      const merchantPubkey: string = order.pubkey;
      const fiatAmount: bigint = order.fiatAmount;

      if (numStatus === 1 && state.phase === "placed") {
        dispatch({ type: "ACCEPTED" });
        try { await encryptAndDeliver(merchantPubkey); }
        catch (err: unknown) {
          const p2p = toP2PError(err, {
            flow: "deliver-upi",
            chainId: opts.chainId,
            user: opts.signer?.address,
            diamondAddress: opts.diamondAddress,
            orderId: state.orderId ?? undefined,
          });
          dispatch({ type: "ERROR", message: p2p.userMessage });
          opts.onError?.(p2p);
        }
        return;
      }
      if (numStatus === 2 && (state.phase === "encrypting" || state.phase === "accepted")) {
        dispatch({ type: "PAID", fiatAmount });
        return;
      }
      if (numStatus === 3 && state.phase !== "completed") {
        dispatch({ type: "COMPLETED" });
        runReconcile(3);
        opts.onComplete?.(state.orderId);
        return;
      }
      if (numStatus === 4 && state.phase !== "cancelled") {
        dispatch({ type: "CANCELLED" });
        runReconcile(4);
        opts.onCancelled?.(state.orderId);
        return;
      }
    } catch { /* transient RPC */ }
  }, [state.orderId, state.phase, publicClient, opts, encryptAndDeliver, runReconcile]);

  useEffect(() => {
    if (polling.current) clearInterval(polling.current);
    if (!state.orderId) return;
    if (state.phase === "completed" || state.phase === "cancelled" || state.phase === "error") return;
    const interval = state.phase === "placed" ? 3000 : 8000;
    polling.current = setInterval(() => { checkOrderStatus(); }, interval);
    return () => { if (polling.current) clearInterval(polling.current); };
  }, [state.phase, state.orderId, checkOrderStatus]);

  /**
   * Re-attempt encrypt + deliver from the error screen. Useful if the
   * encrypt path hiccupped (polyfill issue, wallet disconnect mid-tx) and
   * the order is still ACCEPTED on chain.
   */
  const retryDeliver = useCallback(async () => {
    if (!state.orderId) return;
    const ctx: P2PErrorContext = {
      flow: "retry-deliver",
      chainId: opts.chainId,
      user: opts.signer?.address,
      diamondAddress: opts.diamondAddress,
      orderId: state.orderId,
    };
    try {
      const order = (await publicClient.readContract({
        address: opts.diamondAddress, abi: DIAMOND_ABI,
        functionName: "getOrdersById", args: [BigInt(state.orderId)],
      })) as any;
      const numStatus = Number(order.status);
      if (numStatus !== 1) {
        throw orderBadStatusError(
          `Order is in status ${numStatus}; can only retry from ACCEPTED (1)`,
          ctx,
        );
      }
      dispatch({ type: "ACCEPTED" });
      await encryptAndDeliver(order.pubkey);
    } catch (err: unknown) {
      const p2p = toP2PError(err, ctx);
      dispatch({ type: "ERROR", message: p2p.userMessage });
      opts.onError?.(p2p);
    }
  }, [state.orderId, publicClient, opts, encryptAndDeliver]);

  return {
    state,
    submit,
    retryDeliver,
    canRetry: state.phase === "error" && state.orderId !== null,
    reset: () => dispatch({ type: "RESET" }),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

async function preflightEncryption(
  ordersClient: OrdersClient,
  ctx: P2PErrorContext,
): Promise<void> {
  const ephemeral = createRelayIdentity();
  const r = await ordersClient.encryptPaymentAddress({
    paymentAddress: "__preflight__",
    recipientPublicKey: ephemeral.publicKey,
  });
  if (r.isErr()) {
    throw encryptionPreflightError(r.error.message, ctx);
  }
}

async function ensureRelayPubKey(): Promise<string> {
  const store = createLocalStorageRelayStore();
  let id = await store.get();
  if (!id) {
    const { createRelayIdentity } = await import("@p2pdotme/sdk/orders");
    id = createRelayIdentity();
    await store.set(id);
  }
  return id.publicKey;
}
