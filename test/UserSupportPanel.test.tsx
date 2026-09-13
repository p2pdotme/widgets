import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Drive the panel against the bridge HTTP layer + session acquisition directly
// so every FAILURE path (the ones ContactSupport.test mocks away) is exercised:
// send error, declined-signature retry, reconnect-after-load, length guard.
const userBridge = vi.hoisted(() => ({
  fetchUserThread: vi.fn(),
  postUserMessage: vi.fn(),
  UserBridgeError: class UserBridgeError extends Error {
    status: number;
    reason?: string;
    constructor(status: number, reason?: string) {
      super(`user bridge request failed (${status})`);
      this.name = "UserBridgeError";
      this.status = status;
      this.reason = reason;
    }
  },
}));
vi.mock("../src/api/userBridge", () => userBridge);

const sessionCache = vi.hoisted(() => ({
  ensureUserSession: vi.fn(),
  clearCachedSession: vi.fn(),
}));
vi.mock("../src/state/sessionCache", () => sessionCache);

import { UserSupportPanel } from "../src/widgets/UserSupportPanel";
import type { SupportSigner } from "../src/types";

const signer: SupportSigner = {
  address: "0x00000000000000000000000000000000000000a1",
  signMessage: async () => "0xsig",
  getChainId: async () => 84532,
};

function thread(over: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    status: "open",
    p2pTag: null,
    conversationId: 555,
    messages: [],
    ...over,
  };
}

function renderPanel() {
  return render(
    <UserSupportPanel orderId="227" signer={signer} bridgeUrl="https://bridge.local" />,
  );
}

beforeEach(() => {
  sessionCache.ensureUserSession
    .mockReset()
    .mockResolvedValue({ sessionToken: "user.jwt" });
  sessionCache.clearCachedSession.mockReset();
  userBridge.fetchUserThread.mockReset().mockResolvedValue(thread());
  userBridge.postUserMessage.mockReset().mockResolvedValue({ ok: true, id: 1 });
});

afterEach(() => vi.restoreAllMocks());

describe("UserSupportPanel — failure paths (W2/W3/W4/W5)", () => {
  it("W2: surfaces a reason and restores the draft when a send fails (409 not-ready)", async () => {
    userBridge.postUserMessage.mockRejectedValue(
      new userBridge.UserBridgeError(409, "conversation_not_ready"),
    );
    renderPanel();
    const box = (await screen.findByLabelText(/message/i)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "please help" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // The reason is shown (no internal vocab) ...
    await screen.findByText(/Support isn['\u2019]t ready yet/i);
    // ... the draft is restored so the user doesn't lose their text ...
    expect(box.value).toBe("please help");
    // ... and the optimistic bubble is rolled back (no user message bubble
    // remains; the textarea value above is not a bubble).
    expect(
      document.querySelector('[data-user-message-direction="user"]'),
    ).toBeNull();
  });

  it("W2: maps a 502 to a generic retry message", async () => {
    userBridge.postUserMessage.mockRejectedValue(
      new userBridge.UserBridgeError(502, "chatwoot_unreachable"),
    );
    renderPanel();
    const box = await screen.findByLabelText(/message/i);
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await screen.findByText(/temporarily unavailable/i);
  });

  it("W4: blocks an over-long message client-side and never calls the bridge", async () => {
    renderPanel();
    const box = (await screen.findByLabelText(/message/i)) as HTMLTextAreaElement;
    // The textarea caps input length as the primary guard.
    expect(box.maxLength).toBe(4096);
    // The handleSend pre-check is the backstop for a programmatic/over-long set.
    fireEvent.change(box, { target: { value: "a".repeat(5000) } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await screen.findByText(/too long/i);
    expect(userBridge.postUserMessage).not.toHaveBeenCalled();
  });

  it("W5: shows an explicit Try again on a declined signature, then recovers", async () => {
    // First session acquisition rejects (user declined the wallet signature);
    // subsequent calls succeed (default mock).
    sessionCache.ensureUserSession.mockRejectedValueOnce(
      new Error("user rejected signature"),
    );
    renderPanel();

    await screen.findByText(/couldn['\u2019]t verify your wallet/i);
    // The read was never attempted — no auto-prompt loop.
    expect(userBridge.fetchUserThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    // Recovery: the thread loads and the empty-state placeholder appears.
    await screen.findByText(/No messages yet/i);
  });

  it("W3: keeps the loaded thread and shows reconnecting when a later refresh fails", async () => {
    userBridge.fetchUserThread
      .mockResolvedValueOnce(
        thread({
          messages: [
            { id: 1, content: "earlier reply", direction: "ops", createdAt: 1000, senderName: "Support Team" },
          ],
        }),
      )
      // The refresh that runs right after a successful send fails.
      .mockRejectedValue(new Error("network blip"));
    renderPanel();

    await screen.findByText("earlier reply");
    const box = await screen.findByLabelText(/message/i);
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // The thread is retained (not blanked) and the connection strip appears.
    await screen.findByText(/Reconnecting/i);
    expect(screen.getByText("earlier reply")).toBeTruthy();
  });

  it("X1: renders the other side as neutral 'Support', never the raw agent name", async () => {
    userBridge.fetchUserThread.mockResolvedValue(
      thread({
        messages: [
          { id: 9, content: "how can I help", direction: "ops", createdAt: 1000, senderName: "Priya (Circle 7 Admin)" },
        ],
      }),
    );
    renderPanel();
    await screen.findByText("how can I help");
    // The operator's real Chatwoot name must not leak to the customer.
    expect(screen.queryByText(/Priya/i)).toBeNull();
    expect(screen.getByText("Support")).toBeTruthy();
  });
});
