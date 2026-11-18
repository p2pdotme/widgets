import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const multicall = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return { ...actual, createPublicClient: vi.fn(() => ({ multicall })) };
});

import { useDisputeEscalation } from "../src/hooks/useDisputeEscalation";

const DIAMOND = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const ok = (result: unknown) => ({ status: "success", result });
const reverted = { status: "failure", error: new Error("Diamond: Function does not exist") };

beforeEach(() => {
  multicall.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDisputeEscalation", () => {
  it("reads both views in one multicall and parses them", async () => {
    multicall.mockResolvedValue([ok([1, 100n, 200n]), ok([0, 0, ZERO, 0n, 0n])]);
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: true, diamondAddress: DIAMOND }),
    );
    await waitFor(() =>
      expect(result.current.escalation).toEqual({
        tier: 1,
        tierSince: 100,
        appealableAt: 200,
        decision: null,
      }),
    );
    const call = multicall.mock.calls[0][0];
    expect(call.contracts.map((c: any) => c.functionName)).toEqual([
      "getDisputeTier",
      "getDisputeDecision",
    ]);
    expect(call.contracts[0]).toMatchObject({ address: DIAMOND, args: [7n] });
  });

  it("does not read when disabled", () => {
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: false, diamondAddress: DIAMOND }),
    );
    expect(multicall).not.toHaveBeenCalled();
    expect(result.current.escalation).toBeUndefined();
  });

  it("views revert (no ladder facet, Base Sepolia): stays undefined and stops polling", async () => {
    vi.useFakeTimers();
    multicall.mockResolvedValue([reverted, reverted]);
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: true, diamondAddress: DIAMOND, pollIntervalMs: 1000 }),
    );
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(multicall).toHaveBeenCalledTimes(1);
    expect(result.current.escalation).toBeUndefined();
  });

  it("transport error (429/timeout) keeps polling and recovers", async () => {
    vi.useFakeTimers();
    multicall
      .mockRejectedValueOnce(new Error("HTTP request failed. Status: 429"))
      .mockResolvedValue([ok([2, 100n, 300n]), ok([0, 0, ZERO, 0n, 0n])]);
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: true, diamondAddress: DIAMOND, pollIntervalMs: 1000 }),
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.escalation).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(multicall).toHaveBeenCalledTimes(2);
    expect(result.current.escalation?.tier).toBe(2);
  });

  it("a transport error after a success keeps the last good value", async () => {
    vi.useFakeTimers();
    multicall
      .mockResolvedValueOnce([ok([1, 100n, 200n]), ok([0, 0, ZERO, 0n, 0n])])
      .mockRejectedValue(new Error("timeout"));
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: true, diamondAddress: DIAMOND, pollIntervalMs: 1000 }),
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(multicall.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.escalation?.tier).toBe(1);
  });

  it("does not throw or read for a chain with no registered diamond", () => {
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: true, chainId: 8453 }),
    );
    expect(result.current.escalation).toBeUndefined();
    expect(multicall).not.toHaveBeenCalled();
  });

  it("returns undefined when the dispute is no longer raised (tier 0)", async () => {
    multicall.mockResolvedValue([ok([0, 0n, 0n]), ok([0, 0, ZERO, 0n, 0n])]);
    const { result } = renderHook(() =>
      useDisputeEscalation({ orderId: "7", enabled: true, diamondAddress: DIAMOND }),
    );
    await waitFor(() => expect(multicall).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.escalation).toBeUndefined();
  });

  it("clears the previous order's ladder when orderId changes", async () => {
    multicall.mockResolvedValueOnce([ok([1, 100n, 200n]), ok([0, 0, ZERO, 0n, 0n])]);
    const { result, rerender } = renderHook(
      ({ id }) => useDisputeEscalation({ orderId: id, enabled: true, diamondAddress: DIAMOND }),
      { initialProps: { id: "7" } },
    );
    await waitFor(() => expect(result.current.escalation?.tier).toBe(1));
    multicall.mockReturnValue(new Promise(() => {}));
    rerender({ id: "8" });
    expect(result.current.escalation).toBeUndefined();
  });
});
