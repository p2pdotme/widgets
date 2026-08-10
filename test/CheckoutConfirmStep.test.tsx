// The accepted phase's biggest failure mode isn't a crash — it's a user who
// pays from their banking app and never comes back to tap "I've paid", leaving
// the order to auto-cancel. These tests cover the affordances that exist purely
// to prevent that: the numbered second step, the return-from-payment nudge, and
// the intent signals that arm it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { Checkout } from "../src/widgets/Checkout";

const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;

/** Captured IntersectionObserver callback, so a test can say "the in-flow
 *  confirm CTA just scrolled out of the modal's scrollport". */
let ioCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;

class MockIntersectionObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    ioCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Drives the observer to report the CTA on/off screen. */
async function setCtaOnScreen(onScreen: boolean) {
  await act(async () => {
    ioCallback?.([{ isIntersecting: onScreen }]);
  });
}

/** The slim pinned bar, located via its own label. */
function confirmBar(): HTMLElement {
  const label = screen.getByText(/Step 2 · Confirm once you've paid|Back from your .*Confirm to settle/i);
  return label.closest("div[aria-hidden]") as HTMLElement;
}

/** The in-flow confirm CTA (first in DOM order; the bar's copy is second). */
function inFlowConfirmButton(): HTMLElement {
  return screen.getAllByRole("button", { name: /I've sent INR|I've made the payment/i })[0];
}

const stubSigner = {
  address: USER,
  sendTransaction: vi.fn(async () => ({ hash: "0xtx" as `0x${string}` })),
};

/** Demo mode dispatches ACCEPTED 5s after the order is placed. */
const DEMO_ACCEPT_DELAY = 5000;

function renderCheckout(props: Record<string, unknown> = {}) {
  return render(
    <Checkout
      demo
      mode="modal"
      open
      currency="INR"
      productName="Test order"
      usdcAmount={10n * 1_000_000n}
      signer={stubSigner as never}
      placeOrder={async () => ({ orderId: "demo1", txHash: "0xdemo" })}
      {...props}
    />,
  );
}

/** Places the order and advances demo timers into the accepted phase. */
async function reachAcceptedPhase() {
  fireEvent.click(screen.getByRole("button", { name: /pay/i }));
  await act(async () => {
    vi.advanceTimersByTime(DEMO_ACCEPT_DELAY);
  });
  await screen.findByText(/Pay exactly/i);
}

/** Simulates leaving for a banking app and returning `awayMs` later. */
async function leaveAndReturn(awayMs: number) {
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    vi.advanceTimersByTime(awayMs);
  });
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("Checkout — accepted-phase confirm step", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    Element.prototype.scrollIntoView = vi.fn();
    ioCallback = null;
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("frames paying and confirming as two numbered steps", async () => {
    renderCheckout();
    await reachAcceptedPhase();

    expect(screen.getByText(/Send INR/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirm you've paid/i)).toBeInTheDocument();
  });

  it("names the amount in the confirm CTA so it reads as an attestation", async () => {
    renderCheckout();
    await reachAcceptedPhase();

    expect(inFlowConfirmButton()).toBeInTheDocument();
    expect(inFlowConfirmButton()).toHaveTextContent("I've sent INR");
  });

  it("states the confirm deadline, not just the pay deadline", async () => {
    renderCheckout();
    await reachAcceptedPhase();

    expect(screen.getByText(/Confirm within \d+:\d\d or the order auto-cancels/i)).toBeInTheDocument();
  });

  it("nudges the user to confirm when they return from their payment app", async () => {
    renderCheckout();
    await reachAcceptedPhase();

    expect(screen.queryByText(/the order won't settle until you do/i)).not.toBeInTheDocument();

    await leaveAndReturn(30_000);

    expect(await screen.findByText(/the order won't settle until you do/i)).toBeInTheDocument();
  });

  it("scrolls the confirm CTA into view on return — it sits below the QR", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await leaveAndReturn(30_000);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("ignores a brief tab blur — only a real trip away arms the nudge", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await leaveAndReturn(500);

    expect(screen.queryByText(/Back from your/i)).not.toBeInTheDocument();
  });

  it("marks step 1 done once the user copies the payout id", async () => {
    renderCheckout();
    await reachAcceptedPhase();

    // The order-tracking stepper renders its own ✓ marks, so count the delta
    // rather than asserting on a bare "✓" anywhere in the tree.
    const before = screen.getAllByText("✓").length;
    fireEvent.click(screen.getByRole("button", { name: /^Copy$/i }));

    await waitFor(() => expect(screen.getAllByText("✓").length).toBe(before + 1));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("p2pdemo@upi");
  });

  it("clears the nudge as soon as the user confirms", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await leaveAndReturn(30_000);
    expect(await screen.findByText(/the order won't settle until you do/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(inFlowConfirmButton());
    });

    expect(screen.queryByText(/the order won't settle until you do/i)).not.toBeInTheDocument();
  });

  // The pinned bar exists only to recover a CTA that scrolled away — an
  // always-on bar this tall covered the QR on a phone, which is the bug it
  // was introduced to avoid.
  it("keeps the pinned bar collapsed while the confirm CTA is on screen", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await setCtaOnScreen(true);

    const bar = confirmBar();
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveStyle({ height: "0px" });
  });

  it("reveals the pinned bar once the confirm CTA scrolls out of view", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await setCtaOnScreen(false);

    const bar = confirmBar();
    expect(bar).toHaveAttribute("aria-hidden", "false");
    expect(bar).not.toHaveStyle({ height: "0px" });
    expect(screen.getByText(/Step 2 · Confirm once you've paid/i)).toBeInTheDocument();
  });

  it("confirms the order from the pinned bar's own button", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await setCtaOnScreen(false);

    const barButton = screen.getAllByRole("button", { name: /I've sent INR/i })[1];
    await act(async () => {
      fireEvent.click(barButton);
    });

    expect(await screen.findByText(/Verifying your payment/i)).toBeInTheDocument();
  });

  it("suppresses the pinned bar once the window closes — the write would revert", async () => {
    renderCheckout();
    await reachAcceptedPhase();
    await setCtaOnScreen(false);
    expect(confirmBar()).toHaveAttribute("aria-hidden", "false");

    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 1000);
    });

    expect(confirmBar()).toHaveAttribute("aria-hidden", "true");
  });

  it("tells a late payer not to pay twice once the window closes", async () => {
    renderCheckout();
    await reachAcceptedPhase();

    // Run out the 5-minute auto-cancel window.
    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 1000);
    });

    expect(screen.getByRole("button", { name: /Payment window closed/i })).toBeDisabled();
    expect(screen.getByText(/Don't send it again/i)).toBeInTheDocument();
    expect(screen.getByText(/can no longer be confirmed on-chain/i)).toBeInTheDocument();
  });
});
