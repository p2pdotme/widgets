import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOrderStates } from "../src/hooks/useOrderStates";

// Stub viem's `createPublicClient` so the hook gets a deterministic
// fake that records calls. The chain shape is intentionally bare —
// only the fields the hook reads.

const multicall = vi.fn();
const getBlock = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      multicall,
      getBlock,
    })),
  };
});

const DIAMOND = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as const;

function additionalDetails(overrides: Record<string, unknown> = {}) {
  return {
    fixedFeePaid: 0n,
    tipsPaid: 0n,
    acceptedTimestamp: 0n,
    paidTimestamp: 0n,
    reserved2: 0n,
    actualUsdtAmount: 0n,
    actualFiatAmount: 0n,
    ...overrides,
  };
}

/** Build the multicall result tuple for one orderId: [order, details]. */
function row(
  storage: Record<string, unknown>,
  details: Record<string, unknown> = {},
) {
  return [
    { status: "success", result: storageOrder(storage) },
    { status: "success", result: additionalDetails(details) },
  ];
}

function storageOrder(overrides: Record<string, unknown> = {}) {
  return {
    amount: 0n,
    fiatAmount: 0n,
    placedTimestamp: 1_700_000_000n, // a fixed epoch second
    completedTimestamp: 0n,
    userCompletedTimestamp: 0n,
    acceptedMerchant: "0x0000000000000000000000000000000000000002",
    user: "0x0000000000000000000000000000000000000001",
    recipientAddr: "0x0000000000000000000000000000000000000001",
    pubkey: "",
    encUpi: "",
    userCompleted: false,
    status: 0, // placed
    orderType: 0, // buy
    disputeInfo: {
      raisedBy: 0,
      status: 0,
      redactTransId: 0n,
      accountNumber: 0n,
    },
    id: 169n,
    userPubKey: "",
    encMerchantUpi: "",
    acceptedAccountNo: 0n,
    assignedAccountNos: [] as bigint[],
    currency:
      "0x494e520000000000000000000000000000000000000000000000000000000000",
    preferredPaymentChannelConfigId: 0n,
    circleId: 1n,
    ...overrides,
  };
}

beforeEach(() => {
  multicall.mockReset();
  getBlock.mockReset();
  getBlock.mockResolvedValue({ timestamp: 1_700_000_000n });
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOrderStates", () => {
  it("stays idle when orderIds is empty (no multicall, no getBlock)", () => {
    renderHook(() =>
      useOrderStates({
        orderIds: [],
        diamondAddress: DIAMOND,
        chainId: 84532,
      }),
    );
    expect(multicall).not.toHaveBeenCalled();
    expect(getBlock).not.toHaveBeenCalled();
  });

  it("issues one multicall.aggregate (getOrdersById + getAdditionalOrderDetails) for all visible orderIds", async () => {
    multicall.mockResolvedValueOnce([
      ...row({ id: 169n }),
      ...row({ id: 42n }),
    ]);
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169", "42"],
        diamondAddress: DIAMOND,
        chainId: 84532,
      }),
    );
    await waitFor(() => expect(result.current.rows.size).toBe(2));
    expect(multicall).toHaveBeenCalledTimes(1);
    const args = multicall.mock.calls[0][0];
    // 2 rows × 2 calls (getOrdersById + getAdditionalOrderDetails).
    expect(args.contracts).toHaveLength(4);
    expect(args.contracts[0].functionName).toBe("getOrdersById");
    expect(args.contracts[0].args).toEqual([169n]);
    expect(args.contracts[1].functionName).toBe("getAdditionalOrderDetails");
    expect(args.contracts[1].args).toEqual([169n]);
    expect(args.contracts[2].functionName).toBe("getOrdersById");
    expect(args.contracts[2].args).toEqual([42n]);
    expect(args.allowFailure).toBe(true);
    expect(args.multicallAddress).toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11",
    );
  });

  it("maps the storage struct → SDK Order shape (enums decoded)", async () => {
    multicall.mockResolvedValueOnce([
      ...row(
        {
          id: 169n,
          orderType: 1, // sell
          status: 3, // completed
          disputeInfo: {
            raisedBy: 0,
            status: 1, // raised → "open"
            redactTransId: 0n,
            accountNumber: 0n,
          },
        },
      ),
    ]);
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
      }),
    );
    await waitFor(() => expect(result.current.rows.size).toBe(1));
    const got = result.current.rows.get("169");
    expect(row).toBeDefined();
    expect(got?.order.type).toBe("sell");
    expect(got?.order.status).toBe("completed");
    expect(got?.order.disputeStatus).toBe("open");
    expect(got?.order.currency).toBe("INR");
    // Dispute short-circuits status flow per the state machine.
    expect(got?.state.statusText).toBe("Under review");
    expect(got?.state.disputeState).toBe("open");
    expect(got?.state.action).toEqual({ kind: "none" });
  });

  it("uses chain block.timestamp for the now reference (clock-skew correction)", async () => {
    // Browser clock is way ahead of the chain so without correction the
    // dispute window math would already report the order as past-close.
    // The hook should use chain time and report a SELL order inside its
    // 30-minute → 7-day dispute window (SELL/PAY uses status=COMPLETED
    // for the dispute path, simpler to set up than the BUY/CANCELLED
    // path which additionally requires paidAt > 0).
    const FAR_FUTURE_BROWSER = 2_000_000_000_000; // year 2033 ms
    vi.spyOn(Date, "now").mockReturnValue(FAR_FUTURE_BROWSER);
    getBlock.mockResolvedValueOnce({ timestamp: 1_700_000_000n + 60n * 60n }); // 1h after placement
    multicall.mockResolvedValueOnce([
      ...row({
        id: 169n,
        orderType: 1, // sell
        status: 3, // completed (the SELL/PAY dispute path)
      }),
    ]);

    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
      }),
    );
    await waitFor(() => expect(result.current.rows.size).toBe(1));
    const got = result.current.rows.get("169");
    expect(got?.state.action.kind).toBe("report-problem");
  });

  it("re-fetches on the slow tick (pollIntervalMs)", async () => {
    multicall.mockResolvedValue([
      ...row({ id: 169n }),
    ]);
    vi.useFakeTimers();
    renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
        pollIntervalMs: 500,
        fastTickMs: 100_000_000, // disable fast tick noise
      }),
    );
    await vi.waitFor(() => expect(multicall).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });
    expect(multicall).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });
    expect(multicall).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("refetch() forces an immediate re-read without waiting for the slow tick", async () => {
    multicall.mockResolvedValue([
      ...row({ id: 169n }),
    ]);
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
        pollIntervalMs: 60_000,
      }),
    );
    await waitFor(() => expect(multicall).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(multicall).toHaveBeenCalledTimes(2));
  });

  it("surfaces an error when the multicall throws (loading flips back to false)", async () => {
    multicall.mockRejectedValueOnce(new Error("rpc died"));
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
      }),
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toMatch(/rpc died/);
    expect(result.current.loading).toBe(false);
  });

  it("clears intervals on unmount (no further multicall after teardown)", async () => {
    multicall.mockResolvedValue([
      ...row({ id: 169n }),
    ]);
    vi.useFakeTimers();
    const { unmount } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
        pollIntervalMs: 500,
        fastTickMs: 100_000_000,
      }),
    );
    await vi.waitFor(() => expect(multicall).toHaveBeenCalledTimes(1));
    unmount();
    const callsBefore = multicall.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(multicall.mock.calls.length).toBe(callsBefore);
    vi.useRealTimers();
  });

  it("preserves rows from a failed row inside an otherwise-successful multicall", async () => {
    // The hook issues 2 calls per row in order:
    // [order0, details0, order1, details1, order2, details2]. Failing
    // the order-read for row 999 should drop only that row.
    multicall.mockResolvedValueOnce([
      ...row({ id: 169n }),
      { status: "failure", result: undefined },
      { status: "failure", result: undefined },
      ...row({ id: 42n }),
    ]);
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169", "999", "42"],
        diamondAddress: DIAMOND,
      }),
    );
    await waitFor(() => expect(result.current.rows.size).toBe(2));
    expect(result.current.rows.has("169")).toBe(true);
    expect(result.current.rows.has("999")).toBe(false);
    expect(result.current.rows.has("42")).toBe(true);
  });

  it("tolerates getBlock failure — keeps the multicall result", async () => {
    // Reproduces the prior bug where Promise.all aborted the whole
    // read on a transient getBlock error. Now multicall result survives
    // even when the clock-skew refresh fails.
    getBlock.mockRejectedValueOnce(new Error("rpc transient"));
    multicall.mockResolvedValueOnce([...row({ id: 169n })]);
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
      }),
    );
    await waitFor(() => expect(result.current.rows.size).toBe(1));
    expect(result.current.error).toBeNull();
  });

  it("populates paidAt from getAdditionalOrderDetails so BUY/CANCELLED dispute paths work", async () => {
    multicall.mockResolvedValueOnce([
      ...row(
        {
          id: 169n,
          orderType: 0, // buy
          status: 4, // cancelled
        },
        { paidTimestamp: 1_700_000_500n }, // user paid before cancellation
      ),
    ]);
    const { result } = renderHook(() =>
      useOrderStates({
        orderIds: ["169"],
        diamondAddress: DIAMOND,
      }),
    );
    await waitFor(() => expect(result.current.rows.size).toBe(1));
    const r = result.current.rows.get("169");
    expect(r?.order.paidAt).toBe(1_700_000_500n);
  });
});
