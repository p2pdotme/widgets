import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUserTxLimit } from "../core/contracts";

export interface UseUserTxLimitOptions {
  chainId?: number;
  rpcUrl?: string;
  decimals?: number;
  /** Skip the fetch (e.g. while integratorAddress is still resolving). */
  enabled?: boolean;
}

export interface UseUserTxLimitResult {
  data: { raw: bigint; formatted: string } | null;
  error: Error | null;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * React hook that reads `userTxLimit()` from an integrator. Returns the
 * per-tx USDC cap as a raw bigint (6-decimals by default) plus a formatted
 * decimal string. Re-fetches when integratorAddress, chainId, rpcUrl, or
 * decimals change. Stale responses from previous fetches are discarded.
 */
export function useUserTxLimit(
  integratorAddress: `0x${string}` | null | undefined,
  opts: UseUserTxLimitOptions = {},
): UseUserTxLimitResult {
  const { chainId, rpcUrl, decimals, enabled = true } = opts;
  const [data, setData] = useState<{ raw: bigint; formatted: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    if (!enabled || !integratorAddress) return;
    const id = ++reqId.current;
    setIsLoading(true);
    setError(null);
    fetchUserTxLimit(integratorAddress, { chainId, rpcUrl, decimals })
      .then((res) => {
        if (id !== reqId.current) return;
        setData(res);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== reqId.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  }, [integratorAddress, chainId, rpcUrl, decimals, enabled, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, isLoading, refetch };
}
