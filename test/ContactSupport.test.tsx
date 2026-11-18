import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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

// Opt-in chain stub for the appeal in-flight test; other tests get real viem.
const chain = vi.hoisted(() => ({
  stub: false,
  simulate: async (): Promise<any> => ({ request: {} }),
  // never-settling by default = tx still pending
  receipt: (): Promise<any> => new Promise(() => {}),
}));
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: (...args: any[]) =>
      chain.stub
        ? {
            simulateContract: () => chain.simulate(),
            waitForTransactionReceipt: () => chain.receipt(),
          }
        : (actual.createPublicClient as any)(...args),
  };
});

import { ContactSupport } from "../src/widgets/ContactSupport";
import type { OrderActionState } from "../src/core/order-action";
import type { SupportSigner } from "../src/types";

const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;
// A realistic wallet signer: chat sign-in goes through `ensureUserSession`,
// which (like `ensureOpsSession`) short-circuits to null without a real
// `signMessage`. `signInWithBridge` is mocked below, so these are only probed
// by the session layer, never actually invoked against a wallet.
const signer: SupportSigner = {
  address: USER,
  signMessage: async () => "0xsig",
  getChainId: async () => 84532,
};

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

describe("ContactSupport appeal button (3-tier dispute ladder)", () => {
  const appealState: OrderActionState = {
    statusText: "Decided against you · appeal within 3h 0m",
    action: { kind: "appeal", mode: "appeal", nextTier: 2, remainingMs: 3 * 3600_000 },
    disputeState: "open",
    live: true,
  };
  const txSigner = {
    address: USER,
    sendTransaction: vi.fn(async () => ({ hash: "0xabc" as `0x${string}` })),
  };

  it("renders Appeal decision next to Contact Support and opens the appeal modal", async () => {
    renderCS({ state: appealState, txSigner });
    expect(screen.getByRole("button", { name: /contact support/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
    await screen.findByRole("heading", { name: /appeal this decision/i });
  });

  it("keeps the appeal modal content when the live state moves off appeal", async () => {
    const { rerender } = renderCS({ state: appealState, txSigner });
    fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
    await screen.findByRole("heading", { name: /appeal this decision/i });
    rerender(
      <ContactSupport
        orderId="227"
        state={{ ...appealState, action: { kind: "none" } }}
        signer={signer}
        bridgeUrl="https://bridge.local"
        originApp="test-app"
        chatEnabled
        txSigner={txSigner}
      />,
    );
    expect(screen.getByRole("heading", { name: /appeal this decision/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /appeal decision/i })).toBeNull();
  });

  it("labels the escalate mode", () => {
    renderCS({
      state: { ...appealState, action: { kind: "appeal", mode: "escalate", nextTier: 2 } },
      txSigner,
    });
    expect(screen.getByRole("button", { name: /^escalate dispute$/i })).toBeTruthy();
  });

  it("swaps the button for an in-flight note after the appeal broadcasts", async () => {
    chain.stub = true;
    try {
      renderCS({ state: appealState, txSigner });
      fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^appeal$/i }));
      await screen.findByRole("heading", { name: /appeal sent/i });
      expect(screen.queryByRole("button", { name: /appeal decision/i })).toBeNull();
      expect(screen.getByText(/appeal sent · confirming/i)).toBeTruthy();
    } finally {
      chain.stub = false;
    }
  });

  it("on a successful receipt: calls onAppealConfirmed and the modal says confirmed", async () => {
    chain.stub = true;
    chain.receipt = async () => ({ status: "success" });
    const onAppealConfirmed = vi.fn();
    try {
      renderCS({ state: appealState, txSigner, onAppealConfirmed } as any);
      fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^appeal$/i }));
      await screen.findByRole("heading", { name: /appeal confirmed/i });
      expect(onAppealConfirmed).toHaveBeenCalledWith("227");
      expect(screen.getByText(/appeal sent · updating/i)).toBeTruthy();
    } finally {
      chain.stub = false;
      chain.receipt = () => new Promise(() => {});
    }
  });

  it("keeps 'Appeal confirmed' in the modal after the row moves off appeal", async () => {
    chain.stub = true;
    chain.receipt = async () => ({ status: "success" });
    try {
      const { rerender } = renderCS({ state: appealState, txSigner });
      fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^appeal$/i }));
      await screen.findByRole("heading", { name: /appeal confirmed/i });
      rerender(
        <ContactSupport
          orderId="227"
          state={{ ...appealState, statusText: "Country admin review · decision due in 3d", action: { kind: "none" } }}
          signer={signer}
          bridgeUrl="https://bridge.local"
          originApp="test-app"
          chatEnabled
          txSigner={txSigner}
        />,
      );
      expect(screen.getByRole("heading", { name: /appeal confirmed/i })).toBeTruthy();
    } finally {
      chain.stub = false;
      chain.receipt = () => new Promise(() => {});
    }
  });

  it("while submitting: Escape does not close the modal and the row button is hidden", async () => {
    chain.stub = true;
    chain.simulate = () => new Promise(() => {}); // wallet / simulate still busy
    try {
      renderCS({ state: appealState, txSigner });
      fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^appeal$/i }));
      await screen.findByText(/waiting for wallet/i);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByRole("heading", { name: /appeal this decision/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /appeal decision/i })).toBeNull();
    } finally {
      chain.stub = false;
      chain.simulate = async () => ({ request: {} });
    }
  });

  it("a confirmed appeal whose row still offers the action after 150s says it couldn't confirm", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    chain.stub = true;
    chain.receipt = async () => ({ status: "success" });
    try {
      renderCS({ state: appealState, txSigner });
      fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^appeal$/i }));
      await screen.findByRole("heading", { name: /appeal confirmed/i });
      await act(() => vi.advanceTimersByTimeAsync(150_000));
      expect(screen.getByRole("heading", { name: /couldn't confirm the appeal/i })).toBeTruthy();
      expect(screen.getByText(/couldn't confirm the last attempt/i)).toBeTruthy();
      expect(screen.queryByText(/failed on chain/i)).toBeNull();
    } finally {
      vi.useRealTimers();
      chain.stub = false;
      chain.receipt = () => new Promise(() => {});
    }
  });

  it("on a reverted receipt: the modal says failed and the button comes back with a note", async () => {
    chain.stub = true;
    chain.receipt = async () => ({ status: "reverted" });
    const onAppealConfirmed = vi.fn();
    try {
      renderCS({ state: appealState, txSigner, onAppealConfirmed } as any);
      fireEvent.click(screen.getByRole("button", { name: /appeal decision/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^appeal$/i }));
      await screen.findByRole("heading", { name: /appeal failed/i });
      expect(onAppealConfirmed).not.toHaveBeenCalled();
      expect(screen.getByText(/last attempt failed on chain/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /appeal decision/i })).toBeTruthy();
    } finally {
      chain.stub = false;
      chain.receipt = () => new Promise(() => {});
    }
  });

  it("disputeAppeals={false} hides the button and points to support instead", () => {
    renderCS({ state: appealState, txSigner, disputeAppeals: false });
    expect(screen.queryByRole("button", { name: /appeal decision/i })).toBeNull();
    expect(screen.getByText(/appeals aren't available in this app/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /contact support/i })).toBeTruthy();
  });

  it("disputeAppeals={false} on an escalate row says escalate", () => {
    renderCS({
      state: { ...appealState, action: { kind: "appeal", mode: "escalate", nextTier: 2 } },
      txSigner,
      disputeAppeals: false,
    });
    expect(screen.queryByRole("button", { name: /escalate dispute/i })).toBeNull();
    expect(screen.getByText(/escalation isn't available in this app/i)).toBeTruthy();
  });

  it("keeps the pre-ladder DOM when there is no appeal (button is the root's direct child)", () => {
    const { container } = renderCS({ txSigner });
    const root = container.querySelector("[data-contact-support-root]")!;
    expect(root.firstElementChild?.hasAttribute("data-contact-support-button")).toBe(true);
  });

  it("hides the appeal button without a txSigner", () => {
    renderCS({ state: appealState });
    expect(screen.queryByRole("button", { name: /appeal decision/i })).toBeNull();
    expect(screen.getByRole("button", { name: /contact support/i })).toBeTruthy();
  });
});
