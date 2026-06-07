import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Isolate ContactSupport's chat-open effect from the bridge + Chatwoot SDK.
const bridge = vi.hoisted(() => ({ signInWithBridge: vi.fn() }));
vi.mock("../src/api/bridge", () => bridge);
const sdk = vi.hoisted(() => ({
  bootChatwoot: vi.fn(async () => {}),
  openChatwoot: vi.fn(),
}));
vi.mock("../src/chatwoot/sdk", () => sdk);

import { ContactSupport } from "../src/widgets/ContactSupport";
import type { OrderActionState } from "../src/core/order-action";
import type { SupportSigner } from "../src/types";

const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;
const signer: SupportSigner = { address: USER };

const session = {
  ok: true,
  address: USER,
  role: "user",
  chatwoot: {
    baseUrl: "https://cw.test",
    websiteToken: "ws_one",
    identifier: USER.toLowerCase(),
    identifierHash: "deadbeef",
  },
  conversationId: 27,
  sessionToken: "stub.jwt",
  expiresAt: Date.now() + 60_000,
};

const disputeOpen: OrderActionState = {
  statusText: "Paid · in dispute",
  action: { kind: "none" },
  disputeState: "open",
};

beforeEach(() => {
  window.localStorage.clear();
  bridge.signInWithBridge.mockReset().mockResolvedValue(session);
  sdk.bootChatwoot.mockReset().mockResolvedValue(undefined);
  sdk.openChatwoot.mockReset();
});

afterEach(() => vi.restoreAllMocks());

function renderCS(extra: Record<string, unknown> = {}) {
  return render(
    <ContactSupport
      orderId="227"
      state={disputeOpen}
      signer={signer}
      bridgeUrl="https://bridge.local"
      originApp="test-app"
      chatEnabled
      {...extra}
    />,
  );
}

describe("ContactSupport chat-open lifecycle (stuck-loader regression)", () => {
  it("boots Chatwoot, opens it, and dismisses the loading overlay on success", async () => {
    renderCS();
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));

    // The whole flow must complete: bootChatwoot then openChatwoot. The
    // self-cancelling-effect bug cancelled the async after bootChatwoot,
    // so openChatwoot was never reached and the overlay never dismissed.
    await waitFor(() => expect(sdk.openChatwoot).toHaveBeenCalledTimes(1));
    expect(sdk.bootChatwoot).toHaveBeenCalledWith(session.chatwoot);

    // Overlay (Signing in / Loading chat) is gone — modal closed.
    await waitFor(() => {
      expect(screen.queryByText(/Loading chat/i)).toBeNull();
      expect(screen.queryByText(/Signing in/i)).toBeNull();
    });
  });

  it("signs in exactly once per open (no effect re-fire storm)", async () => {
    renderCS();
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    await waitFor(() => expect(sdk.openChatwoot).toHaveBeenCalledTimes(1));
    expect(bridge.signInWithBridge).toHaveBeenCalledTimes(1);
  });

  it("does not silently re-open chat when the signer changes after a successful open (no click)", async () => {
    const { rerender } = render(
      <ContactSupport
        orderId="227"
        state={disputeOpen}
        signer={signer}
        bridgeUrl="https://bridge.local"
        originApp="test-app"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    await waitFor(() => expect(sdk.openChatwoot).toHaveBeenCalledTimes(1));
    expect(bridge.signInWithBridge).toHaveBeenCalledTimes(1);

    // An in-place wallet switch (new signer object AND new address) after a
    // completed open must NOT re-fire sign-in or pop the chat open — the
    // effect is keyed only on the click/retry signal, not on props. A
    // regression that put signer/signer.address back in the deps would
    // re-open here with zero clicks.
    rerender(
      <ContactSupport
        orderId="227"
        state={disputeOpen}
        signer={{ address: "0x00000000000000000000000000000000000000Ff" }}
        bridgeUrl="https://bridge.local"
        originApp="test-app"
        chatEnabled
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.signInWithBridge).toHaveBeenCalledTimes(1);
    expect(sdk.openChatwoot).toHaveBeenCalledTimes(1);
  });

  it("shows the not-ready error and re-fires sign-in on Try again", async () => {
    // First sign-in: bridge has no chatwoot session yet -> graceful error,
    // chat NOT opened. (Default mock resolves a good session for the retry.)
    bridge.signInWithBridge.mockResolvedValueOnce({ ...session, chatwoot: null });
    render(
      <ContactSupport
        orderId="227"
        state={disputeOpen}
        signer={signer}
        bridgeUrl="https://bridge.local"
        originApp="test-app"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    await waitFor(() =>
      expect(screen.getByText(/Could not open support/i)).toBeInTheDocument(),
    );
    expect(sdk.openChatwoot).not.toHaveBeenCalled();
    expect(bridge.signInWithBridge).toHaveBeenCalledTimes(1);

    // Try again must re-fire sign-in (the effect's only retry trigger is the
    // chatAttempt bump now) and, on success, open the chat.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(sdk.openChatwoot).toHaveBeenCalledTimes(1));
    expect(bridge.signInWithBridge).toHaveBeenCalledTimes(2);
  });

  it("does not force chat open if the user dismisses the loader mid sign-in", async () => {
    // Defer the sign-in so we can dismiss while it is in flight.
    let resolveSignIn!: (s: unknown) => void;
    bridge.signInWithBridge.mockReturnValueOnce(
      new Promise((r) => {
        resolveSignIn = r as (s: unknown) => void;
      }),
    );
    render(
      <ContactSupport
        orderId="227"
        state={disputeOpen}
        signer={signer}
        bridgeUrl="https://bridge.local"
        originApp="test-app"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    // Loader is up (sign-in pending). The user backs out via the backdrop.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.parentElement!);
    // Sign-in now resolves with a good session — but the user already left, so
    // the chat must NOT be force-opened on top of whatever they navigated to.
    resolveSignIn(session);
    await Promise.resolve();
    await Promise.resolve();
    expect(sdk.openChatwoot).not.toHaveBeenCalled();
  });
});
