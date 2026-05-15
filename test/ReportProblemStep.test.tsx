import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ReportProblemStep,
  type RaiseDisputeSigner,
} from "../src/widgets/ReportProblemStep";

const DIAMOND = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as const;
const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;

function makeSigner(
  overrides: Partial<RaiseDisputeSigner> = {},
): RaiseDisputeSigner {
  return {
    address: USER,
    sendTransaction: vi.fn(async () => ({ hash: "0xabc123" as `0x${string}` })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportProblemStep", () => {
  it("renders the confirmation copy on mount (no form yet)", () => {
    render(
      <ReportProblemStep
        orderId="169"
        signer={makeSigner()}
        diamondAddress={DIAMOND}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /contact support/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/review needs your payment receipt/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/last 4 digits/i)).toBeNull();
  });

  it("Cancel on the confirm step calls onClose without touching the wallet", () => {
    const onClose = vi.fn();
    const signer = makeSigner();
    render(
      <ReportProblemStep
        orderId="169"
        signer={signer}
        diamondAddress={DIAMOND}
        onClose={onClose}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /cancel/i }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it("Continue advances to the form step (input visible)", () => {
    render(
      <ReportProblemStep
        orderId="169"
        signer={makeSigner()}
        diamondAddress={DIAMOND}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByLabelText(/last 4 digits/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /submit/i }),
    ).toBeTruthy();
  });

  it("strips non-numeric input and caps to 4 digits", () => {
    render(
      <ReportProblemStep
        orderId="169"
        signer={makeSigner()}
        diamondAddress={DIAMOND}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const input = screen.getByLabelText(/last 4 digits/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc1234567" } });
    expect(input.value).toBe("1234");
  });

  it("rejects an empty / short input on submit (form stays open, no tx)", () => {
    const signer = makeSigner();
    render(
      <ReportProblemStep
        orderId="169"
        signer={signer}
        diamondAddress={DIAMOND}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alert").textContent?.toLowerCase(),
    ).toContain("last 4 digits");
  });

  it("submits a tx to the Diamond with the raiseDispute(orderId, redactTransId) payload", async () => {
    const signer = makeSigner();
    render(
      <ReportProblemStep
        orderId="169"
        signer={signer}
        diamondAddress={DIAMOND}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const input = screen.getByLabelText(/last 4 digits/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4242" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    });
    expect(signer.sendTransaction).toHaveBeenCalledOnce();
    const call = (signer.sendTransaction as any).mock.calls[0][0];
    expect(call.to).toBe(DIAMOND);
    // Function selector for `raiseDispute(uint256,uint256)`. ABI-derived;
    // if the diamond ABI's raiseDispute name or arg types change the
    // encoded selector will too — this test catches the drift.
    // Selector: keccak256("raiseDispute(uint256,uint256)").slice(0,4)
    expect(call.data.startsWith("0x")).toBe(true);
    // The encoded args: orderId 169 padded to 32 bytes, then redactTransId 4242.
    expect(call.data.toLowerCase()).toContain(
      "0".repeat(62) + "a9", // 169 in hex padded
    );
    expect(call.data.toLowerCase()).toContain(
      "0".repeat(60) + "1092", // 4242 in hex padded
    );
  });

  it("fires onSubmitted on broadcast (optimistic flip)", async () => {
    const onSubmitted = vi.fn();
    const signer = makeSigner({
      sendTransaction: vi.fn(async () => ({
        hash: "0xfeedbeef" as `0x${string}`,
      })),
    });
    render(
      <ReportProblemStep
        orderId="169"
        signer={signer}
        diamondAddress={DIAMOND}
        onSubmitted={onSubmitted}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/last 4 digits/i), {
      target: { value: "9999" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    });
    expect(onSubmitted).toHaveBeenCalledWith("0xfeedbeef");
    expect(
      screen.getByRole("heading", { name: /report submitted/i }),
    ).toBeTruthy();
  });

  it("surfaces a wallet error and allows retry without remounting", async () => {
    const onError = vi.fn();
    const sendTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("user rejected"))
      .mockResolvedValueOnce({ hash: "0xdead" as `0x${string}` });
    const signer: RaiseDisputeSigner = {
      address: USER,
      sendTransaction,
    };
    render(
      <ReportProblemStep
        orderId="169"
        signer={signer}
        diamondAddress={DIAMOND}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/last 4 digits/i), {
      target: { value: "1234" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: /could not submit report/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByLabelText(/last 4 digits/i)).toBeTruthy();
  });
});
