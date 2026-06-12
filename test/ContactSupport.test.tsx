import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Isolate ContactSupport + UserSupportPanel from the bridge HTTP layer. The
// chat path now renders the embedded UserSupportPanel, which signs in against
// the bridge and reads/writes the per-order thread via `/me/*` — no Chatwoot
// website SDK is involved any more.
const bridge = vi.hoisted(() => ({ signInWithBridge: vi.fn() }));
vi.mock("../src/api/bridge", () => bridge);
const userBridge = vi.hoisted(() => ({
  fetchUserThread: vi.fn(),
  postUserMessage: vi.fn(),
  // Re-export the error class shape the panel imports.
  UserBridgeError: class UserBridgeError extends Error {
    status: number;
    reason?: string;
    constructor(status: number, reason?: string) {
      super(`user bridge request failed (${status})`);
      this.status = status;
      this.reason = reason;
    }
  },
}));
vi.mock("../src/api/userBridge", () => userBridge);

import { ContactSupport } from "../src/widgets/ContactSupport";
import type { OrderActionState } from "../src/core/order-action";
import type { SupportSigner } from "../src/types";

const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;
const signer: SupportSigner = { address: USER };

const session = {
  ok: true,
  address: USER,
  role: "user",
  chatwoot: null,
  conversationId: 27,
  sessionToken: "stub.jwt",
  expiresAt: Date.now() + 60_000,
};

const emptyThread = {
  ok: true,
  status: null,
  p2pTag: null,
  conversationId: null,
  messages: [],
};

const disputeOpen: OrderActionState = {
  statusText: "Paid · in dispute",
  action: { kind: "none" },
  disputeState: "open",
};

beforeEach(() => {
  window.localStorage.clear();
  bridge.signInWithBridge.mockReset().mockResolvedValue(session);
  userBridge.fetchUserThread.mockReset().mockResolvedValue(emptyThread);
  userBridge.postUserMessage.mockReset().mockResolvedValue({ ok: true, id: 1 });
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

describe("ContactSupport chat path (bridge-proxied user thread)", () => {
  it("opens the embedded chat panel on click: signs in once and loads the thread", async () => {
    renderCS();
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));

    await waitFor(() =>
      expect(userBridge.fetchUserThread).toHaveBeenCalled(),
    );
    expect(bridge.signInWithBridge).toHaveBeenCalledTimes(1);
    expect(bridge.signInWithBridge).toHaveBeenCalledWith({
      signer,
      bridgeUrl: "https://bridge.local",
      orderId: "227",
    });
    // The empty-thread placeholder renders inside the panel.
    await screen.findByText(/No messages yet/i);
  });

  it("renders ops + user messages from the thread", async () => {
    userBridge.fetchUserThread.mockResolvedValue({
      ok: true,
      status: "open",
      p2pTag: null,
      conversationId: 555,
      messages: [
        { id: 1, content: "hi from me", direction: "user", createdAt: 1000, senderName: "You" },
        { id: 2, content: "reply from support", direction: "ops", createdAt: 2000, senderName: "Support Team" },
      ],
    });
    renderCS();
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));

    await screen.findByText("hi from me");
    await screen.findByText("reply from support");
  });

  it("sends the user's message via the bridge", async () => {
    renderCS();
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    const box = await screen.findByLabelText(/message/i);
    fireEvent.change(box, { target: { value: "please help" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(userBridge.postUserMessage).toHaveBeenCalledWith({
        bridgeUrl: "https://bridge.local",
        sessionToken: "stub.jwt",
        orderId: "227",
        content: "please help",
      }),
    );
  });

  it("locks the composer when the conversation is resolved", async () => {
    userBridge.fetchUserThread.mockResolvedValue({
      ok: true,
      status: "resolved",
      p2pTag: null,
      conversationId: 555,
      messages: [],
    });
    renderCS();
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    await screen.findByText(/This conversation has been closed/i);
    expect(screen.queryByLabelText(/message/i)).toBeNull();
  });

  it("shows the static registered modal (no chat) when chatEnabled is false", async () => {
    renderCS({ chatEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: /contact support/i }));
    await screen.findByText(/support request registered/i);
    expect(bridge.signInWithBridge).not.toHaveBeenCalled();
    expect(userBridge.fetchUserThread).not.toHaveBeenCalled();
  });
});
