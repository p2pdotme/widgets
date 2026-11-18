// Feeds the hook's failure classification the exact shapes a real viem
// client produces, via a custom JSON-RPC transport (no network).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const real = vi.hoisted(() => ({ request: async (_: any): Promise<any> => null }));
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    // The hook's client, but on a scripted transport.
    createPublicClient: (opts: any) =>
      actual.createPublicClient({
        ...opts,
        transport: actual.custom({ request: (a: any) => real.request(a) }, { retryCount: 0 }),
      }),
  };
});

import { encodeErrorResult, encodeFunctionResult, multicall3Abi, parseAbi } from "viem";
import { useDisputeEscalation } from "../src/hooks/useDisputeEscalation";

const DIAMOND = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as const;
const calls = { n: 0 };
// aggregate3 succeeds; both inner calls revert with the diamond's message
// (what Base Sepolia returns today).
const diamondMissing = () => {
  const revert = encodeErrorResult({
    abi: parseAbi(["error Error(string)"]),
    errorName: "Error",
    args: ["Diamond: Function does not exist"],
  });
  return encodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    result: [
      { success: false, returnData: revert },
      { success: false, returnData: revert },
    ],
  });
};
const rpcError = (code: number, message: string) => {
  const e: any = new Error(message);
  e.code = code;
  return e;
};

beforeEach(() => {
  calls.n = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function run(respond: () => Promise<any>) {
  real.request = async ({ method }: any) => {
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_call") {
      calls.n++;
      return respond();
    }
    throw rpcError(-32601, `unexpected ${method}`);
  };
  return renderHook(() =>
    useDisputeEscalation({ orderId: "7", enabled: true, diamondAddress: DIAMOND, pollIntervalMs: 1000 }),
  );
}

describe("useDisputeEscalation against real viem error shapes", () => {
  it("diamond without the ladder facet (Sepolia): stops polling", async () => {
    const { result } = run(async () => diamondMissing());
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls.n).toBe(1);
    expect(result.current.escalation).toBeUndefined();
  });

  it("-32603 internal error (viem labels it a revert): keeps polling", async () => {
    run(async () => {
      throw rpcError(-32603, "internal error");
    });
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(calls.n).toBeGreaterThanOrEqual(3);
  });

  it("code 3 execution reverted: stops polling", async () => {
    run(async () => {
      throw rpcError(3, "execution reverted");
    });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls.n).toBe(1);
  });

  it("-32005 limit exceeded: keeps polling", async () => {
    run(async () => {
      throw rpcError(-32005, "limit exceeded");
    });
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(calls.n).toBeGreaterThanOrEqual(3);
  });
});
