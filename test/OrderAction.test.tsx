import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Order } from "@p2pdotme/sdk/orders";
import { OrderAction } from "../src/widgets/OrderAction";
import type { SupportSigner } from "../src/types";

// Mock <ContactSupport> so OrderAction tests don't pull in chatwoot
// boot plumbing. Each render exposes the props the wrapper passed —
// presence of the chip is the contract, not its internals.
let contactSupportProps: any = null;
vi.mock("../src/widgets/ContactSupport", () => ({
  ContactSupport: (props: any) => {
    contactSupportProps = props;
    return (
      <button data-testid="stub-contact-support">
        {props.state.disputeState}/{props.state.action.kind}
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
    signer: stubSigner,
    bridgeUrl: "https://bridge.local",
    originApp: "test-app",
    txSigner: stubTxSigner,
    diamondAddress: DIAMOND,
    ...extra,
  };
}

beforeEach(() => {
  contactSupportProps = null;
  vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000);
});

describe("OrderAction", () => {
  it("always renders the status line from state.statusText", () => {
    render(
      <OrderAction {...baseProps(baseOrder({ status: "placed" }))} />,
    );
    expect(screen.getByText("Placed · matching")).toBeTruthy();
  });

  it("renders Resume button when state.action=resume AND onResumeOrder provided", () => {
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

  it("forwards the computed state to <ContactSupport>", () => {
    // BUY cancelled with paidAt > 0, 1h elapsed → inside the
    // disputable window per OrderProcessorFacet#raiseDispute.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    render(
      <OrderAction
        {...baseProps(
          baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
        )}
      />,
    );
    expect(contactSupportProps).not.toBeNull();
    expect(contactSupportProps.state.action.kind).toBe("report-problem");
    expect(contactSupportProps.state.action.remainingMs).toBeGreaterThan(0);
    expect(contactSupportProps.state.action.filled).toBeGreaterThan(0);
    expect(contactSupportProps.state.action.filled).toBeLessThan(1);
    expect(contactSupportProps.txSigner).toBe(stubTxSigner);
  });

  it("forwards dispute=open state to <ContactSupport>", () => {
    render(
      <OrderAction
        {...baseProps(
          baseOrder({ status: "paid", type: "buy", disputeStatus: "open" }),
        )}
      />,
    );
    expect(contactSupportProps.state.disputeState).toBe("open");
    expect(contactSupportProps.state.action.kind).toBe("none");
  });

  // CPU-loop regression: a row with no live countdown must NOT arm a
  // per-second interval. The old useNowTick ran setInterval unconditionally
  // in every row forever, re-rendering all of (typically terminal) order
  // history once a second.
  it("does not arm a per-second interval for a row with no live countdown", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    render(<OrderAction {...baseProps(baseOrder({ status: "placed" }))} />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("arms the countdown interval only while a report-problem countdown is live", () => {
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    const spy = vi.spyOn(globalThis, "setInterval");
    render(
      <OrderAction
        {...baseProps(
          baseOrder({ status: "cancelled", type: "buy", paidAt: 1n }),
        )}
      />,
    );
    expect(spy).toHaveBeenCalled();
  });

  it("tears down the armed interval when the row crosses out of its window", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    // In-window report-problem row (BUY cancelled, paid, 1h elapsed).
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    const order = baseOrder({ status: "cancelled", type: "buy", paidAt: 1n });
    const { rerender } = render(<OrderAction {...baseProps(order)} />);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const armedId = setSpy.mock.results[0].value;
    // Advance past the 24h BUY close → action.kind flips to "none", live
    // false → the prior interval is cleared and none re-armed.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 25 * 60 * 60) * 1000);
    rerender(<OrderAction {...baseProps(order)} />);
    expect(clearSpy).toHaveBeenCalledWith(armedId);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a pre-window dispute row live so the recovery chip appears when its window opens", () => {
    // BUY cancelled (paid), 10 min elapsed — before the 15-min review window.
    // Terminal status, so the parent poll never re-renders it; the row must
    // self-tick to catch the boundary.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 10 * 60) * 1000);
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const order = baseOrder({ status: "cancelled", type: "buy", paidAt: 1n });
    const { rerender } = render(<OrderAction {...baseProps(order)} />);
    // Pre-window: no recovery chip yet, but the ticker IS armed.
    expect(contactSupportProps.state.action.kind).toBe("none");
    expect(setSpy).toHaveBeenCalled();
    // Cross into the window → the report-problem recovery chip appears.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 20 * 60) * 1000);
    rerender(<OrderAction {...baseProps(order)} />);
    expect(contactSupportProps.state.action.kind).toBe("report-problem");
  });

  it("ticks the paid-BUY 'will resolve within' countdown, then tears down at the 24h close", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    // Paid BUY, 1h elapsed — past the 30min mark, inside the live countdown.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 60 * 60) * 1000);
    const order = baseOrder({ status: "paid", type: "buy", paidAt: 1n });
    const { rerender } = render(<OrderAction {...baseProps(order)} />);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const armedId = setSpy.mock.results[0].value;
    // Past the 24h dispute close → countdown clamps, live false → torn down.
    vi.spyOn(Date, "now").mockReturnValue((NOW_SEC + 25 * 60 * 60) * 1000);
    rerender(<OrderAction {...baseProps(order)} />);
    expect(clearSpy).toHaveBeenCalledWith(armedId);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });
});
