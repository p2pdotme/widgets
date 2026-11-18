// On-chain read of a raised dispute's position on the 3-tier ladder
// (`getDisputeTier` + `getDisputeDecision`). The subgraph's
// `disputeStatus` only says "open" for the whole ladder, so a row that
// was decided against the user needs this read to show the appeal
// window.
//
// Both views go in one multicall, so they describe the same block (an
// appeal landing between two separate reads could pair the new tier with
// the old decision).
//
// Failures leave `escalation` at its last good value (undefined at first),
// which the row renders as the plain "Under review". It never throws into
// render. Two kinds:
//   - the views revert or there is no diamond for the chain (Base Sepolia
//     has no ladder facet today): permanent, so polling stops;
//   - transport (429, timeout, network): transient, polling carries on.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { DIAMOND_ABI, resolveDiamondAddress } from "../core/contracts";
import {
  parseDisputeEscalation,
  type DisputeEscalation,
} from "../core/order-action";

export interface UseDisputeEscalationOpts {
  orderId: string;
  /** Read only while true — pass `order.disputeStatus === "open"`. */
  enabled: boolean;
  diamondAddress?: Address;
  /** Defaults to 84532 (Base Sepolia), like the rest of the widgets. */
  chainId?: number;
  rpcUrl?: string;
  /** Poll interval in ms. Default 60_000. */
  pollIntervalMs?: number;
}

export interface UseDisputeEscalationResult {
  escalation: DisputeEscalation | undefined;
  /** Re-read now (e.g. after an appeal tx confirms). */
  refetch: () => void;
}

export function useDisputeEscalation(
  opts: UseDisputeEscalationOpts,
): UseDisputeEscalationResult {
  const {
    orderId,
    enabled,
    diamondAddress,
    chainId = 84532,
    rpcUrl,
    pollIntervalMs = 60_000,
  } = opts;
  const [escalation, setEscalation] = useState<DisputeEscalation>();
  const [token, setToken] = useState(0);
  const refetch = useCallback(() => setToken((t) => t + 1), []);
  // A direct user may reuse one hook for different orders: never show the
  // previous order's ladder while the new one loads.
  const lastOrderId = useRef(orderId);

  useEffect(() => {
    if (lastOrderId.current !== orderId) {
      lastOrderId.current = orderId;
      setEscalation(undefined);
    }
    if (!enabled) {
      setEscalation(undefined);
      return;
    }
    // Built here, not per render: a long history mounts one hook per row
    // and only rows with an open dispute should cost anything.
    const chain = chainId === 8453 ? base : baseSepolia;
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
    });
    let cancelled = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const stop = () => clearInterval(id);
    const read = async () => {
      let address: Address;
      try {
        address = resolveDiamondAddress(chainId, diamondAddress);
      } catch {
        stop(); // no diamond registered for this chain: permanent
        return;
      }
      const args = [BigInt(orderId)] as const;
      let results;
      try {
        results = await client.multicall({
          contracts: [
            { address, abi: DIAMOND_ABI, functionName: "getDisputeTier", args },
            { address, abi: DIAMOND_ABI, functionName: "getDisputeDecision", args },
          ],
          allowFailure: true,
        });
      } catch {
        return; // transport error: keep the last value, retry next poll
      }
      if (cancelled) return;
      const [t, d] = results;
      if (t.status !== "success" || d.status !== "success") {
        stop(); // the views revert (no ladder facet): permanent
        return;
      }
      // getDisputeTier returns all zeros once the dispute is no longer
      // RAISED (settled between the subgraph read and this one).
      if (t.result[0] === 0) {
        setEscalation(undefined);
        return;
      }
      setEscalation(parseDisputeEscalation(t.result, d.result));
    };
    id = setInterval(read, pollIntervalMs);
    read();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, orderId, chainId, diamondAddress, rpcUrl, pollIntervalMs, token]);

  return { escalation, refetch };
}
