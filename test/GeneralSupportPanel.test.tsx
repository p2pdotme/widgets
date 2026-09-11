import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Drive the general panel against its bridge HTTP layer + wallet-session
// acquisition directly, so the behaviour that DIFFERS from the dispute panel is
// exercised: a resolved thread stays writable (a reply reopens it), and the
// thread is opened once via POST /tickets then read/written by ticket id.
const generalBridge = vi.hoisted(() => ({
  openGeneralTicket: vi.fn(),
  fetchGeneralThread: vi.fn(),
  postGeneralMessage: vi.fn(),
  UserBridgeError: class UserBridgeError extends Error {
    status: number;
    reason?: string;
    constructor(status: number, reason?: string) {
      super(`bridge request failed (${status})`);
      this.name = "UserBridgeError";
      this.status = status;
      this.reason = reason;
    }
  },
}));
vi.mock("../src/api/generalBridge", () => generalBridge);

const sessionCache = vi.hoisted(() => ({
  ensureWalletSession: vi.fn(),
  clearCachedSession: vi.fn(),
}));
vi.mock("../src/state/sessionCache", () => sessionCache);

import { GeneralSupportPanel } from "../src/widgets/GeneralSupportPanel";
import type { SupportSigner } from "../src/types";

const signer: SupportSigner = {
  address: "0x00000000000000000000000000000000000000a1",
  signMessage: async () => "0xsig",
  getChainId: async () => 84532,
};

function thread(over: Record<string, unknown> = {}) {
  return { ok: true as const, status: "open", messages: [], ...over };
}

function renderPanel() {
  return render(
    <GeneralSupportPanel signer={signer} bridgeUrl="https://bridge.local" currency="BRL" />,
  );
}

beforeEach(() => {
  sessionCache.ensureWalletSession
    .mockReset()
    .mockResolvedValue({ sessionToken: "wallet.jwt" });
  sessionCache.clearCachedSession.mockReset();
  generalBridge.openGeneralTicket
    .mockReset()
    .mockResolvedValue({ ok: true, ticketId: 900, tier: "proven", created: true });
  generalBridge.fetchGeneralThread.mockReset().mockResolvedValue(thread());
  generalBridge.postGeneralMessage.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => vi.restoreAllMocks());

describe("GeneralSupportPanel", () => {
  it("opens the wallet's ticket once and passes the currency hint", async () => {
    renderPanel();
    await screen.findByText(/No messages yet/i);
    expect(generalBridge.openGeneralTicket).toHaveBeenCalledTimes(1);
    expect(generalBridge.openGeneralTicket).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "BRL", sessionToken: "wallet.jwt" }),
    );
    // Reads go against the opened ticket id.
    expect(generalBridge.fetchGeneralThread).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 900 }),
    );
  });

  it("keeps the composer WRITABLE on a resolved thread (a reply reopens it)", async () => {
    generalBridge.fetchGeneralThread.mockResolvedValue(thread({ status: "resolved" }));
    renderPanel();
    // The dispute panel would replace the composer with a closed notice; here
    // the textarea and Send button stay, plus a reopen hint.
    const box = (await screen.findByLabelText(/message/i)) as HTMLTextAreaElement;
    expect(box).toBeTruthy();
    await screen.findByText(/Send a message to reopen/i);

    fireEvent.change(box, { target: { value: "back again" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    // The reply is posted against the same ticket — that is what reopens it.
    await vi.waitFor(() =>
      expect(generalBridge.postGeneralMessage).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 900, content: "back again" }),
      ),
    );
  });

  it("blocks an over-long message client-side and never calls the bridge", async () => {
    renderPanel();
    const box = (await screen.findByLabelText(/message/i)) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(4096);
    fireEvent.change(box, { target: { value: "a".repeat(5000) } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await screen.findByText(/too long/i);
    expect(generalBridge.postGeneralMessage).not.toHaveBeenCalled();
  });

  it("renders the other side as neutral 'Support', never the raw agent name", async () => {
    generalBridge.fetchGeneralThread.mockResolvedValue(
      thread({
        messages: [
          { id: 9, content: "how can I help", direction: "ops", createdAt: 1000, senderName: "Priya (BRL relay)" },
        ],
      }),
    );
    renderPanel();
    await screen.findByText("how can I help");
    expect(screen.queryByText(/Priya/i)).toBeNull();
    expect(screen.getByText("Support")).toBeTruthy();
  });

  it("shows Try again on a declined signature, then recovers", async () => {
    sessionCache.ensureWalletSession.mockRejectedValueOnce(
      new Error("user rejected signature"),
    );
    renderPanel();
    await screen.findByText(/couldn’t verify your wallet/i);
    expect(generalBridge.openGeneralTicket).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByText(/No messages yet/i);
  });
});
