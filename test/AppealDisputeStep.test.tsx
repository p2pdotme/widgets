import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeErrorResult,
} from "viem";
import { AppealDisputeStep } from "../src/widgets/AppealDisputeStep";
import { DIAMOND_ABI } from "../src/core/contracts";
import type { RaiseDisputeSigner } from "../src/widgets/ReportProblemStep";

const simulateContract = vi.fn(async (_args: any) => ({ request: {} }));
const waitForTransactionReceipt = vi.fn(async () => ({ status: "success" }));
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ simulateContract, waitForTransactionReceipt })),
  };
});

const DIAMOND = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as const;
const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;

function makeSigner(): RaiseDisputeSigner {
  return {
    address: USER,
    sendTransaction: vi.fn(async () => ({ hash: "0xabc" as `0x${string}` })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  simulateContract.mockResolvedValue({ request: {} });
});

describe("AppealDisputeStep", () => {
  it("appeal: simulates then sends appealDispute(orderId) from the signer", async () => {
    const signer = makeSigner();
    const onSubmitted = vi.fn();
    render(
      <AppealDisputeStep
        orderId="169"
        signer={signer}
        mode="appeal"
        nextTier={2}
        remainingMs={3 * 3600_000}
        diamondAddress={DIAMOND}
        onSubmitted={onSubmitted}
      />,
    );
    expect(screen.getByRole("heading", { name: /appeal this decision/i })).toBeTruthy();
    expect(screen.getByText(/country admin review/i)).toBeTruthy();
    expect(screen.getByText(/time left to appeal: 3h 0m/i)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^appeal$/i }));
    });
    expect(simulateContract.mock.calls[0][0]).toMatchObject({
      address: DIAMOND,
      functionName: "appealDispute",
      args: [169n],
      account: USER,
    });
    const tx = (signer.sendTransaction as any).mock.calls[0][0];
    expect(tx.to).toBe(DIAMOND);
    const decoded = decodeFunctionData({ abi: DIAMOND_ABI, data: tx.data });
    expect(decoded.functionName).toBe("appealDispute");
    expect(decoded.args).toEqual([169n]);
    expect(onSubmitted).toHaveBeenCalledWith("0xabc");
    expect(screen.getByRole("heading", { name: /appeal sent/i })).toBeTruthy();
    // focus follows the phase change instead of dropping to <body>
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /appeal sent/i }));
  });

  it("escalate: copy and button label", () => {
    render(
      <AppealDisputeStep
        orderId="169"
        signer={makeSigner()}
        mode="escalate"
        nextTier={3}
        diamondAddress={DIAMOND}
      />,
    );
    expect(screen.getByRole("heading", { name: /escalate dispute/i })).toBeTruthy();
    expect(screen.getByText(/did not decide in time/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^escalate$/i })).toBeTruthy();
  });

  it.each([
    ["NotDisputeUser", /only the wallet that placed the order/i],
    ["DisputeAppealWindowClosed", /appeal window for this decision has closed/i],
    ["DisputeAppealNotDue", /still has time to decide/i],
    ["DisputeAtFinalTier", /already at the final review/i],
  ])("maps a %s revert to a friendly message without sending", async (errorName, text) => {
    const err: any = new Error("reverted");
    err.data = { errorName };
    simulateContract.mockRejectedValueOnce(err);
    const signer = makeSigner();
    render(
      <AppealDisputeStep
        orderId="169"
        signer={signer}
        mode="appeal"
        nextTier={2}
        diamondAddress={DIAMOND}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^appeal$/i }));
    });
    expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(screen.getByText(text)).toBeTruthy();
  });

  it.each([
    ["NotDisputeUser", /only the wallet that placed the order/i],
    ["DisputeAppealWindowClosed", /appeal window for this decision has closed/i],
  ])("decodes a real %s revert through DIAMOND_ABI", async (errorName, text) => {
    // Built from the ABI, so this fails if the error entry is missing.
    const err = new ContractFunctionRevertedError({
      abi: DIAMOND_ABI as any,
      data: encodeErrorResult({ abi: DIAMOND_ABI as any, errorName }),
      functionName: "appealDispute",
    });
    expect(err.data?.errorName).toBe(errorName);
    simulateContract.mockRejectedValueOnce(
      new ContractFunctionExecutionError(err, { abi: DIAMOND_ABI as any, functionName: "appealDispute", args: [169n] }),
    );
    render(<AppealDisputeStep orderId="169" signer={makeSigner()} mode="appeal" nextTier={2} diamondAddress={DIAMOND} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^appeal$/i }));
    });
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("an unregistered chain without diamondAddress shows an error instead of throwing in render", async () => {
    render(
      <AppealDisputeStep orderId="169" signer={makeSigner()} mode="appeal" nextTier={2} chainId={8453} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^appeal$/i }));
    });
    expect(screen.getByText(/no diamond address registered/i)).toBeTruthy();
  });
});
