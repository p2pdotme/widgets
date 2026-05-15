import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Order } from "@p2pdotme/sdk/orders";
import { OrderAction } from "../src/widgets/OrderAction";
import type { SupportSigner } from "../src/types";

// Mock <Support> so the OrderAction tests don't pull in chatwoot bridge
// plumbing. We assert on the props it receives instead.
let supportProps: any = null;
vi.mock("../src/widgets/Support", () => ({
  Support: (props: any) => {
    supportProps = props;
    return (
      <button data-stub-support>{props.disputeStatus}/{props.chatState}</button>
    );
  },
}));

// Mock <RaiseDisputeStep> so we can drive its onSubmitted callback
// without exercising the full form.
let raiseStepProps: any = null;
vi.mock("../src/widgets/RaiseDisputeStep", () => ({
  RaiseDisputeStep: (props: any) => {
    raiseStepProps = props;
    return (
      <button
        data-testid="stub-raise-submit"
        onClick={() => props.onSubmitted?.("0xfeed" as `0x${string}`)}
      >
        stub-submit
      </button>
    );
  },
}));

const DIAMOND = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as const;
const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;

const stubSigner: SupportSigner = { address: USER };
const stubTxSigner = {
  address: USER,
  sendTransaction: vi.fn(async () => ({ hash: "0xtx" as `0x${string}` })),
};

const NOW_SEC = 1_700_000_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: 169n,
    type: "buy",
    status: "placed",
    usdcAmount: 0n,
    fiatAmount: 0n,
    actualUsdcAmount: 0n,
    actualFiatAmount: 0n,
    currency: "INR",
    user: USER,
    recipient: USER,
    acceptedMerchant: "0x0000000000000000000000000000000000000002",
    placedAt: BigInt(NOW_SEC),
    acceptedAt: 0n,
    paidAt: 0n,
    completedAt: 0n,
    circleId: 1n,
    fixedFeePaid: 0n,
    tipsPaid: 0n,
    disputeStatus: "none",
    encUpi: "",
    encMerchantUpi: "",
    pubkey: "",
    ...overrides,
  } as Order;
}

function baseProps(order: Order, extra: Record<string, any> = {}) {
  return {
    orderId: order.orderId.toString(),
    order,
    hasActiveSupportConversation: false,
    signer: stubSigner,
    bridgeUrl: "https://bridge.local",
    originApp: "test-app",
    txSigner: stubTxSigner,
    diamondAddress: DIAMOND,
    ...extra,
  };
}

beforeEach(() => {
  supportProps = null;
  raiseStepProps = null;
  // Pin the local clock so `useNowTick` returns deterministic values
  // and the dispute-window math lines up with the fixture's placedAt.
  vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000);
});

describe("OrderAction", () => {
  it("always renders the status line from state.statusText", () => {
    render(
      <OrderAction {...baseProps(baseOrder({ status: "placed" }))} />,
    );
    expect(screen.getByText("Placed · awaiting merchant")).toBeTruthy();
  });

  it("renders Resume button when action=resume AND onResumeOrder provided", () => {
    const onResumeOrder = vi.fn();
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "accepted", type: "buy" }), {
          onResumeOrder,
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /resume order/i });
    fireEvent.click(btn);
    expect(onResumeOrder).toHaveBeenCalledWith("169");
  });

  it("suppresses Resume button when no onResumeOrder callback", () => {
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "accepted", type: "buy" }))}
      />,
    );
    expect(screen.queryByRole("button", { name: /resume order/i })).toBeNull();
  });

  it("renders Raise dispute button with countdown when action=raise-dispute", () => {
    // BUY paid, 15min into the dispute window → 23h 45m left.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 15 * 60) * 1000);
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "paid", type: "buy" }))}
      />,
    );
    expect(
      screen.getByRole("button", { name: /raise dispute · 23h 45m left/i }),
    ).toBeTruthy();
  });

  it("clicking Raise dispute opens the dispute modal", () => {
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "paid", type: "buy" }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /raise dispute/i }));
    expect(raiseStepProps).not.toBeNull();
    expect(raiseStepProps.orderId).toBe("169");
    expect(raiseStepProps.diamondAddress).toBe(DIAMOND);
    expect(raiseStepProps.signer).toBe(stubTxSigner);
  });

  it("Submitting the dispute optimistically flips status + suppresses action button", () => {
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    const onDisputeRaised = vi.fn();
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "paid", type: "buy" }), {
          onDisputeRaised,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /raise dispute/i }));
    act(() => {
      fireEvent.click(screen.getByTestId("stub-raise-submit"));
    });
    expect(onDisputeRaised).toHaveBeenCalledWith("169", "0xfeed");
    expect(screen.getByText("Dispute under review")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^raise dispute/i }),
    ).toBeNull();
  });

  it("propagates disputeStatus='open' to Support + chatState='active'", () => {
    render(
      <OrderAction
        {...baseProps(
          baseOrder({ status: "paid", type: "buy", disputeStatus: "open" }),
        )}
      />,
    );
    expect(supportProps.disputeStatus).toBe("open");
    expect(supportProps.chatState).toBe("active");
  });

  it("hasActiveSupportConversation=true on a non-dispute order → chatState='active'", () => {
    render(
      <OrderAction
        {...baseProps(
          baseOrder({ status: "completed", type: "buy" }),
          { hasActiveSupportConversation: true },
        )}
      />,
    );
    expect(supportProps.disputeStatus).toBe("none");
    expect(supportProps.chatState).toBe("active");
  });

  it("no chat conv and dispute=none → chatState='new'", () => {
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "completed", type: "buy" }))}
      />,
    );
    expect(supportProps.disputeStatus).toBe("none");
    expect(supportProps.chatState).toBe("new");
  });

  it("suppresses the Raise button when no txSigner is provided", () => {
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    render(
      <OrderAction
        {...baseProps(baseOrder({ status: "paid", type: "buy" }), {
          txSigner: undefined,
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /raise dispute/i })).toBeNull();
  });
});
