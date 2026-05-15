// Batched chain read + tick loop powering the smart per-row layout in
// <PaymentHistoryWithSupport actionMode="smart">. One multicall3
// aggregate per refresh, regardless of row count.
//
// Outputs per orderId:
//
//   { order, state }
//
// where `order` is the SDK-shaped Order and `state` is
// `computeOrderAction(order, now)` with `now = Date.now() + clockSkewMs`.
// Clock skew is computed once at init from the latest block's timestamp
// so countdowns line up with chain time, not browser wallclock.
//
// Tick cadence:
//   - default 10s polls
//   - 1s sub-tick when any visible row's countdown is under 60s
//
// The sub-tick re-runs `computeOrderAction` against the same cached
// orders (no extra RPC) so the countdown text stays current.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPublicClient, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Order } from "@p2pdotme/sdk/orders";
import { DEFAULT_DIAMOND_ADDRESS, DIAMOND_ABI } from "../core/contracts";
import {
  computeOrderAction,
  type OrderActionState,
} from "../core/order-action";

// Canonical Multicall3 deployment (deterministic CREATE2 address; same on
// Base mainnet and Base Sepolia).
export const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const ORDER_TYPE_MAP = ["buy", "sell", "pay"] as const;
const ORDER_STATUS_MAP = [
  "placed",
  "accepted",
  "paid",
  "completed",
  "cancelled",
] as const;
const DISPUTE_STATUS_MAP = ["none", "open", "resolved"] as const;

export interface UseOrderStatesOpts {
  /** Visible orderIds. Empty array → hook stays idle (no RPC). */
  orderIds: ReadonlyArray<string>;
  diamondAddress?: Address;
  chainId?: number; // defaults to 84532 (Base Sepolia)
  rpcUrl?: string;
  multicallAddress?: Address;
  /** Base poll interval in ms. Default 10_000. */
  pollIntervalMs?: number;
  /** Fast tick interval when any countdown is under
   *  `fastTickThresholdMs`. Default 1_000. */
  fastTickMs?: number;
  /** Threshold under which the hook switches to fast tick. Default
   *  60_000 (one minute remaining). */
  fastTickThresholdMs?: number;
}

export interface OrderStateRow {
  order: Order;
  state: OrderActionState;
}

export interface UseOrderStatesResult {
  /** Map keyed by `orderId.toString()`. Missing key = either the order
   *  hasn't been fetched yet OR the chain read for that id failed (see
   *  `error`). */
  rows: Map<string, OrderStateRow>;
  loading: boolean;
  error: Error | null;
  /** Forces a fresh chain read on the next tick. */
  refetch: () => void;
}

interface AdditionalOrderDetails {
  fixedFeePaid: bigint;
  tipsPaid: bigint;
  acceptedTimestamp: bigint;
  paidTimestamp: bigint;
  reserved2: bigint;
  actualUsdtAmount: bigint;
  actualFiatAmount: bigint;
}

interface StorageOrder {
  amount: bigint;
  fiatAmount: bigint;
  placedTimestamp: bigint;
  completedTimestamp: bigint;
  userCompletedTimestamp: bigint;
  acceptedMerchant: Address;
  user: Address;
  recipientAddr: Address;
  pubkey: string;
  encUpi: string;
  userCompleted: boolean;
  status: number;
  orderType: number;
  disputeInfo: {
    raisedBy: number;
    status: number;
    redactTransId: bigint;
    accountNumber: bigint;
  };
  id: bigint;
  userPubKey: string;
  encMerchantUpi: string;
  acceptedAccountNo: bigint;
  assignedAccountNos: ReadonlyArray<bigint>;
  currency: `0x${string}`;
  preferredPaymentChannelConfigId: bigint;
  circleId: bigint;
}

/** Storage `Order` (22 fields, raw chain shape) → SDK `Order` (normalized
 *  with string enums). `acceptedAt` / `paidAt` / fee values are read from
 *  the paired `getAdditionalOrderDetails` call when supplied — without
 *  them the BUY/CANCELLED dispute eligibility predicate (which gates on
 *  `paidAt > 0n`) would never fire. */
function storageToOrder(
  s: StorageOrder,
  details?: AdditionalOrderDetails,
): Order {
  return {
    orderId: s.id,
    type: ORDER_TYPE_MAP[s.orderType] ?? "buy",
    status: ORDER_STATUS_MAP[s.status] ?? "placed",
    usdcAmount: s.amount,
    fiatAmount: s.fiatAmount,
    actualUsdcAmount: details?.actualUsdtAmount ?? s.amount,
    actualFiatAmount: details?.actualFiatAmount ?? s.fiatAmount,
    currency: bytes32ToString(s.currency),
    user: s.user,
    recipient: s.recipientAddr,
    acceptedMerchant: s.acceptedMerchant,
    placedAt: s.placedTimestamp,
    acceptedAt: details?.acceptedTimestamp ?? 0n,
    paidAt: details?.paidTimestamp ?? 0n,
    completedAt: s.completedTimestamp,
    circleId: s.circleId,
    fixedFeePaid: details?.fixedFeePaid ?? 0n,
    tipsPaid: details?.tipsPaid ?? 0n,
    disputeStatus:
      DISPUTE_STATUS_MAP[s.disputeInfo?.status ?? 0] ?? "none",
    encUpi: s.encUpi,
    encMerchantUpi: s.encMerchantUpi,
    pubkey: s.pubkey,
  } as Order;
}

function bytes32ToString(hex: `0x${string}`): string {
  // bytes32 currency is right-padded with null bytes; strip them.
  const stripped = hex.replace(/^0x/, "").replace(/(00)+$/, "");
  if (stripped.length === 0) return "";
  return new TextDecoder().decode(
    Uint8Array.from(
      stripped.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [],
    ),
  );
}

/** Returns the smallest remaining-ms across rows whose action carries a
 *  countdown, or +Infinity when no row has one. Used to decide whether
 *  to engage the 1s sub-tick. */
function smallestCountdownMs(rows: Map<string, OrderStateRow>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const { state } of rows.values()) {
    if (state.action.kind === "report-problem") {
      if (state.action.remainingMs < min) min = state.action.remainingMs;
    }
  }
  return min;
}

export function useOrderStates(
  opts: UseOrderStatesOpts,
): UseOrderStatesResult {
  const {
    orderIds,
    diamondAddress = DEFAULT_DIAMOND_ADDRESS,
    chainId = 84532,
    rpcUrl,
    multicallAddress = MULTICALL3_ADDRESS,
    pollIntervalMs = 10_000,
    fastTickMs = 1_000,
    fastTickThresholdMs = 60_000,
  } = opts;

  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [rows, setRows] = useState<Map<string, OrderStateRow>>(new Map());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Clock-skew offset (chainNow - browserNow) computed once at init.
  // Refreshed alongside the first multicall response.
  const clockSkewMs = useRef<number>(0);

  // Trigger to force-refetch (refetch()).
  const [refetchToken, setRefetchToken] = useState(0);
  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  // Stable key for the visible orderIds so effect re-runs only when the
  // set itself changes, not when the host re-renders the array literal.
  const orderIdsKey = useMemo(
    () => [...orderIds].sort().join(","),
    [orderIds],
  );

  const client = useMemo(() => {
    const chain = chainId === 8453 ? base : baseSepolia;
    return createPublicClient({
      chain,
      transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
      batch: { multicall: { batchSize: 1024, wait: 0 } },
    });
  }, [chainId, rpcUrl]);

  // Chain read — runs on mount, on orderIds change, on poll tick, on
  // explicit refetch.
  useEffect(() => {
    if (orderIds.length === 0) {
      setOrders(new Map());
      setRows(new Map());
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // Two parallel calls per row: getOrdersById + getAdditionalOrderDetails.
        // The additional-details read is required to populate `paidAt`
        // — without it, the BUY/CANCELLED dispute eligibility predicate
        // is structurally broken (it gates on `order.paidAt > 0n`).
        const contracts = orderIds.flatMap((id) => [
          {
            address: diamondAddress,
            abi: DIAMOND_ABI,
            functionName: "getOrdersById" as const,
            args: [BigInt(id)] as const,
          },
          {
            address: diamondAddress,
            abi: DIAMOND_ABI,
            functionName: "getAdditionalOrderDetails" as const,
            args: [BigInt(id)] as const,
          },
        ]);

        const results = (await (client as any).multicall({
          contracts,
          multicallAddress,
          allowFailure: true,
        })) as Array<{ status: "success" | "failure"; result?: unknown }>;

        if (cancelled) return;

        // Fetch latest block separately and tolerate failure — a
        // transient getBlock error must not erase the (successful)
        // multicall result. Skew defaults to 0 (use browser clock).
        try {
          const latestBlock = (await (client as any).getBlock({
            blockTag: "latest",
          })) as { timestamp: bigint };
          if (!cancelled) {
            clockSkewMs.current =
              Number(latestBlock.timestamp) * 1000 - Date.now();
          }
        } catch {
          // Keep prior clockSkewMs (or 0). Logged at debug level only.
        }

        const nextOrders = new Map<string, Order>();
        for (let i = 0; i < orderIds.length; i++) {
          const id = orderIds[i];
          const orderRes = results[i * 2];
          const detailsRes = results[i * 2 + 1];
          if (orderRes?.status === "success" && orderRes.result) {
            try {
              const details =
                detailsRes?.status === "success"
                  ? (detailsRes.result as AdditionalOrderDetails)
                  : undefined;
              nextOrders.set(
                id,
                storageToOrder(orderRes.result as StorageOrder, details),
              );
            } catch {
              // Decode failure on this row only; other rows keep their
              // values. Surface as missing-key in the result.
            }
          }
        }

        setOrders(nextOrders);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderIdsKey, diamondAddress, multicallAddress, client, refetchToken]);

  // Compute rows from orders + the corrected wall clock. This effect
  // also drives the tick loop — it re-runs on `tickToken` bumps so the
  // statusText / remainingMs stays current without re-fetching from
  // chain.
  const [tickToken, setTickToken] = useState(0);
  useEffect(() => {
    const now = Date.now() + clockSkewMs.current;
    const next = new Map<string, OrderStateRow>();
    for (const [id, order] of orders) {
      next.set(id, { order, state: computeOrderAction(order, now) });
    }
    setRows(next);
  }, [orders, tickToken]);

  // Poll + sub-tick. Two intervals: a slow one that triggers a fresh
  // chain read every `pollIntervalMs` and a fast one that re-derives
  // the local state every `fastTickMs` once any row is close to its
  // dispute window expiry.
  useEffect(() => {
    if (orderIds.length === 0) return;
    const slow = setInterval(() => {
      setRefetchToken((t) => t + 1);
    }, pollIntervalMs);

    // Fast tick stays armed even when no row currently qualifies — its
    // own callback gates the state bump on the current threshold. This
    // is simpler than tearing the interval up and down as rows cross
    // the threshold.
    const fast = setInterval(() => {
      // Read from the latest rows via a state-getter pattern: bump tick
      // only if we'd actually move a countdown. setState's callback
      // form gives us access to current state.
      setRows((current) => {
        const min = smallestCountdownMs(current);
        if (min < fastTickThresholdMs) {
          // Schedule a tickToken bump for the next microtask so React
          // batches it correctly.
          queueMicrotask(() => setTickToken((t) => t + 1));
        }
        return current;
      });
    }, fastTickMs);

    return () => {
      clearInterval(slow);
      clearInterval(fast);
    };
  }, [orderIds.length, pollIntervalMs, fastTickMs, fastTickThresholdMs]);

  return { rows, loading, error, refetch };
}
