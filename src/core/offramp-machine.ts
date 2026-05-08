import { useReducer, useCallback, useEffect, useMemo, useRef } from "react";
import { createPublicClient, http, encodeFunctionData } from "viem";
import { baseSepolia, base } from "viem/chains";
import {
  createOrders,
  createLocalStorageRelayStore,
  createRelayIdentity,
  type OrdersClient,
} from "@p2pdotme/sdk/orders";
import type { CheckoutSigner, CurrencyOption, OfframpPhase } from "../types";
import {
  MARKETPLACE_INTEGRATOR_ABI,
  MARKETPLACE_CLIENT_ABI,
  USER_PROXY_ABI,
  DIAMOND_ABI,
  parseOfframpOrderIdFromReceipt,
} from "./contracts";

/**
 * State machine for the offramp (sell-back) flow. Mirrors how user-app-spa
 * structures its sell flow:
 *   - SDK orders client (createOrders) holds the relay identity in
 *     localStorage and exposes encryptPaymentAddress + getOrder.
 *   - Encryption runs through the SDK so it picks up the same crypto
 *     primitives + relay identity that production uses.
 *   - The integrator-mediated wrapper layer (userInitiateSellBack +
 *     deliverOfframpUpi) is widget-specific.
 */
interface OfframpState {
  phase: OfframpPhase;
  orderId: string | null;
  txHash: string | null;
  currency: CurrencyOption | null;
  paymentAddress: string | null;
  usdcAmount: bigint | null;
  fiatAmount: bigint | null;
  error: string | null;
}

type OfframpAction =
  | { type: "SWEEPING" }
  | { type: "PLACING"; currency: CurrencyOption; paymentAddress: string }
  | { type: "PLACED"; orderId: string; txHash: string; usdcAmount: bigint }
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
    case "SWEEPING": return { ...s, phase: "sweeping", error: null };
    case "PLACING": return { ...s, phase: "placing", currency: a.currency, paymentAddress: a.paymentAddress, error: null };
    case "PLACED": return { ...s, phase: "placed", orderId: a.orderId, txHash: a.txHash, usdcAmount: a.usdcAmount };
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
  integratorAddress: `0x${string}`;
  marketplaceAddress: `0x${string}`;
  tokenId: bigint;
  signer: CheckoutSigner;
  diamondAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  chainId?: number;
  rpcUrl?: string;
  subgraphUrl?: string;
  fiatAmountLimit?: bigint;
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  onCancelled?: (orderId: string) => void;
  onError?: (err: Error) => void;
}

export function useOfframpMachine(opts: UseOfframpMachineOpts) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const chain = opts.chainId === 8453 ? base : baseSepolia;
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(opts.rpcUrl) }),
    [chain, opts.rpcUrl]
  );

  // SDK orders client — same pattern as user-app-spa's <SdkProvider>.
  // Reuses the relay identity from localStorage so encrypt operations
  // run through the production crypto path (and node-polyfills make
  // crypto.getRandomValues reachable in the browser bundle).
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

  // ─── Pre-flight: ensure caller (or proxy → caller) owns the token ─

  const ensureOwnedByCaller = useCallback(async (): Promise<void> => {
    const owner = (await publicClient.readContract({
      address: opts.marketplaceAddress, abi: MARKETPLACE_CLIENT_ABI as any,
      functionName: "ownerOf", args: [opts.tokenId],
    })) as `0x${string}`;

    if (owner.toLowerCase() === opts.signer.address.toLowerCase()) return;

    const proxyAddr = (await publicClient.readContract({
      address: opts.integratorAddress, abi: MARKETPLACE_INTEGRATOR_ABI as any,
      functionName: "proxyAddress", args: [opts.signer.address],
    })) as `0x${string}`;

    if (owner.toLowerCase() !== proxyAddr.toLowerCase()) {
      throw new Error(
        `Token ${opts.tokenId} is owned by ${owner} — neither your wallet nor your proxy.`
      );
    }

    dispatch({ type: "SWEEPING" });
    const data = encodeFunctionData({
      abi: USER_PROXY_ABI, functionName: "sweepERC721",
      args: [opts.marketplaceAddress, opts.tokenId],
    });
    const { hash } = await opts.signer.sendTransaction({
      to: proxyAddr, data, gasLimit: 200_000,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }, [opts, publicClient]);

  // ─── Place sell-back ──────────────────────────────────────────────

  const placeSell = useCallback(
    async (currency: CurrencyOption, paymentAddress: string) => {
      try {
        // Pre-flight the encryption stack BEFORE we burn the NFT. If the
        // SDK's randomness path is broken in this environment, fail loudly
        // here rather than after the burn has already happened.
        await preflightEncryption(ordersClient);

        await ensureOwnedByCaller();
        dispatch({ type: "PLACING", currency, paymentAddress });

        const unitPrice = (await publicClient.readContract({
          address: opts.marketplaceAddress, abi: MARKETPLACE_CLIENT_ABI as any,
          functionName: "tokenPrice", args: [opts.tokenId],
        })) as bigint;

        // Stable user pubkey from the SDK's relay identity (lazily created
        // + persisted in localStorage by the SDK).
        const userPubKey = await ensureRelayPubKey();

        const data = encodeFunctionData({
          abi: MARKETPLACE_INTEGRATOR_ABI, functionName: "userInitiateSellBack",
          args: [
            opts.marketplaceAddress,
            opts.tokenId,
            stringTo32(currency.symbol),
            opts.fiatAmountLimit ?? 0n,
            // Offramp does not yet auto-route. Callers must pass an explicit
            // circleId on each CurrencyOption used with P2POfframp.
            (() => {
              if (currency.circleId === undefined) {
                throw new Error("P2POfframp requires CurrencyOption.circleId to be set");
              }
              return currency.circleId;
            })(),
            0n,
            userPubKey,
          ],
        });

        const { hash } = await opts.signer.sendTransaction({
          to: opts.integratorAddress, data, gasLimit: 1_000_000,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const orderId = parseOfframpOrderIdFromReceipt(receipt as any);
        if (!orderId) throw new Error("Sell order placed but orderId not found in tx logs");

        dispatch({ type: "PLACED", orderId, txHash: hash, usdcAmount: unitPrice });
        opts.onOrderPlaced?.(orderId, hash);
      } catch (err: any) {
        const message = err?.shortMessage || err?.message || "Failed to place sell order";
        dispatch({ type: "ERROR", message });
        opts.onError?.(err);
      }
    },
    [opts, publicClient, ordersClient, ensureOwnedByCaller]
  );

  // ─── Polling: PLACED → ACCEPTED → PAID → COMPLETED ────────────────

  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const encryptAndDeliver = useCallback(async (merchantPubkey: string) => {
    if (!state.paymentAddress) throw new Error("No payment address recorded");
    if (!state.orderId) throw new Error("No orderId recorded");

    dispatch({ type: "ENCRYPTING" });

    // SDK encrypts the user's payment address with the merchant's pubkey,
    // signed under the user's relay identity. Same call user-app-spa makes.
    const encResult = await ordersClient.encryptPaymentAddress({
      paymentAddress: state.paymentAddress,
      recipientPublicKey: merchantPubkey,
    });
    if (encResult.isErr()) throw new Error(`Encrypt failed: ${encResult.error.message}`);
    const encUpi = encResult.value;

    const data = encodeFunctionData({
      abi: MARKETPLACE_INTEGRATOR_ABI, functionName: "deliverOfframpUpi",
      args: [BigInt(state.orderId), encUpi],
    });
    const { hash } = await opts.signer.sendTransaction({
      to: opts.integratorAddress, data, gasLimit: 500_000,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }, [state.paymentAddress, state.orderId, ordersClient, opts, publicClient]);

  const reconcile = useCallback(async (status: number) => {
    if (!state.orderId) return;
    const data = encodeFunctionData({
      abi: MARKETPLACE_INTEGRATOR_ABI, functionName: "reconcile",
      args: [BigInt(state.orderId), status],
    });
    try {
      const { hash } = await opts.signer.sendTransaction({
        to: opts.integratorAddress, data, gasLimit: 200_000,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } catch { /* best-effort */ }
  }, [state.orderId, opts, publicClient]);

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
        catch (err: any) {
          dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Encrypt/deliver failed" });
          opts.onError?.(err);
        }
        return;
      }
      if (numStatus === 2 && (state.phase === "encrypting" || state.phase === "accepted")) {
        dispatch({ type: "PAID", fiatAmount });
        return;
      }
      if (numStatus === 3 && state.phase !== "completed") {
        dispatch({ type: "COMPLETED" });
        reconcile(3).catch(() => {});
        opts.onComplete?.(state.orderId);
        return;
      }
      if (numStatus === 4 && state.phase !== "cancelled") {
        dispatch({ type: "CANCELLED" });
        reconcile(4).catch(() => {});
        opts.onCancelled?.(state.orderId);
        return;
      }
    } catch { /* transient RPC */ }
  }, [state.orderId, state.phase, publicClient, opts, encryptAndDeliver, reconcile]);

  useEffect(() => {
    if (polling.current) clearInterval(polling.current);
    if (!state.orderId) return;
    if (state.phase === "completed" || state.phase === "cancelled" || state.phase === "error") return;
    const interval = state.phase === "placed" ? 3000 : 8000;
    polling.current = setInterval(() => { checkOrderStatus(); }, interval);
    return () => { if (polling.current) clearInterval(polling.current); };
  }, [state.phase, state.orderId, checkOrderStatus]);

  /**
   * Re-attempt encrypt + deliver from the error screen. Useful if a polyfill
   * issue corrected itself (page reload), or the wallet was disconnected.
   */
  const retryDeliver = useCallback(async () => {
    if (!state.orderId) return;
    try {
      const order = (await publicClient.readContract({
        address: opts.diamondAddress, abi: DIAMOND_ABI,
        functionName: "getOrdersById", args: [BigInt(state.orderId)],
      })) as any;
      const numStatus = Number(order.status);
      if (numStatus !== 1) {
        throw new Error(`Order is in status ${numStatus}; can only retry from ACCEPTED (1)`);
      }
      dispatch({ type: "ACCEPTED" });
      await encryptAndDeliver(order.pubkey);
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Retry failed" });
      opts.onError?.(err);
    }
  }, [state.orderId, publicClient, opts, encryptAndDeliver]);

  return {
    state,
    placeSell,
    retryDeliver,
    canRetry: state.phase === "error" && state.orderId !== null,
    reset: () => dispatch({ type: "RESET" }),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Touch the SDK's encrypt path with throwaway inputs so any environment
 * issue (broken polyfill, missing crypto, etc.) surfaces *before* we burn
 * the NFT. Uses a fresh on-the-fly keypair as the recipient — guaranteed
 * to be a valid secp256k1 curve point.
 */
async function preflightEncryption(ordersClient: OrdersClient): Promise<void> {
  const ephemeral = createRelayIdentity();
  const r = await ordersClient.encryptPaymentAddress({
    paymentAddress: "__preflight__",
    recipientPublicKey: ephemeral.publicKey,
  });
  if (r.isErr()) {
    throw new Error(
      `Encryption stack not ready: ${r.error.message}. Reload the page; ` +
      `if it persists, the bundler is missing crypto polyfills.`
    );
  }
}

/**
 * Read the SDK's relay identity (creates one if needed) and return the
 * uncompressed public key as a hex string — same shape merchant bots
 * encrypt against.
 */
async function ensureRelayPubKey(): Promise<string> {
  // The SDK persists this in localStorage via createLocalStorageRelayStore.
  // We could also call ordersClient.getRelayIdentity but the SDK doesn't
  // expose it directly; cleaner to read from the same store.
  const store = createLocalStorageRelayStore();
  let id = await store.get();
  if (!id) {
    const { createRelayIdentity } = await import("@p2pdotme/sdk/orders");
    id = createRelayIdentity();
    await store.set(id);
  }
  return id.publicKey;
}

function stringTo32(s: string): `0x${string}` {
  const hex = Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
  return `0x${hex}` as `0x${string}`;
}
