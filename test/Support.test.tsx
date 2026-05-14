import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Support } from "../src/widgets/Support";
import type { SupportSigner } from "../src/types";

const stubSigner: SupportSigner = {
  address: "0x0000000000000000000000000000000000000001",
  signMessage: async (_message: string) => "0xdeadbeef",
};

const stubSession = {
  ok: true,
  address: "0x0000000000000000000000000000000000000001",
  role: "user",
  chatwoot: null,
  sessionToken: "stub.jwt.token",
  expiresAt: Date.now() + 60_000,
};

beforeEach(() => {
  // jsdom shares a window across tests in a file. The widget caches the
  // sign-in response keyed by (bridgeUrl, address) per D-024-v2, so without
  // clearing localStorage one test's cache write would let the next skip
  // the fetch and break sign-in assertions.
  window.localStorage.clear();
  // Bridge `/auth/sign-in` mock: returns a session with chatwoot:null so
  // tests exercise the "bridge OK, chatwoot not configured" branch without
  // booting the real SDK.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => stubSession,
    text: async () => JSON.stringify(stubSession),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Support", () => {
  it("renders a launcher button by default", () => {
    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
      />,
    );
    expect(
      screen.getByRole("button", { name: /open support/i }),
    ).toBeInTheDocument();
  });

  it("opens the modal and shows masked order context when launched", async () => {
    const onOpen = vi.fn();
    render(
      <Support
        orderId="0xabcdef1234567890"
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/0xabcd\.\.\.7890/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2 }),
    ).toHaveTextContent(/^Support\s+Order 0xabcd\.\.\.7890$/);
    // Sign-in returns chatwoot:null (no inbox provisioned for this order's
    // circle). The widget silently closes the modal — no wall of explainer
    // text, the click is a no-op. The Support button stays clickable so
    // the user can retry once the order is accepted.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it.each([
    { status: "none", label: "Support" },
    { status: "open", label: "View support" },
    { status: "resolved", label: "View resolution" },
  ] as const)(
    "adapts the launcher label for disputeStatus=$status",
    ({ status, label }) => {
      render(
        <Support
          orderId="0xabcdef1234567890"
          originApp="merchant-demo"
          signer={stubSigner}
          bridgeUrl="https://bridge.local"
          disputeStatus={status}
        />,
      );
      const launcher = screen.getByRole("button", { name: /open support/i });
      expect(launcher).toHaveTextContent(label);
    },
  );

  it("calls the bridge with the signed sign-in payload", async () => {
    const signSpy = vi.fn(async (_m: string) => "0xsig");
    render(
      <Support
        orderId="0xabcdef1234567890"
        originApp="merchant-demo"
        signer={{ address: stubSigner.address, signMessage: signSpy }}
        bridgeUrl="https://bridge.local/"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() => {
      expect(signSpy).toHaveBeenCalledOnce();
    });
    const msg = signSpy.mock.calls[0]![0];
    expect(msg).toMatch(/^support\.p2p\.me:sign-in:0x0+1:\d+$/);

    await waitFor(() => {
      expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);
    });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://bridge.local/auth/sign-in");
    const body = JSON.parse(init.body);
    expect(body.address).toBe(stubSigner.address);
    expect(body.signature).toBe("0xsig");
    expect(typeof body.timestamp).toBe("number");
  });

  it("shows an error when sign-in fails", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, reason: "bad_signature" }),
      text: async () => '{"ok":false,"reason":"bad_signature"}',
    })) as unknown as typeof fetch;

    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() =>
      expect(screen.getByText(/could not open support/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/sign-in failed \(401\)/i)).toBeInTheDocument();
  });

  it("reuses a cached session and skips the bridge call when re-opened", async () => {
    const longLivedSession = {
      ...stubSession,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    window.localStorage.setItem(
      `support.p2p.me:session:https://bridge.local:${stubSigner.address.toLowerCase()}`,
      JSON.stringify(longLivedSession),
    );

    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    // Cache hits the chatwoot:null branch directly without a fetch.
    // The widget silently closes the modal instead of showing copy.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("evicts an expired cache entry and falls back to sign-in", async () => {
    window.localStorage.setItem(
      `support.p2p.me:session:https://bridge.local:${stubSigner.address.toLowerCase()}`,
      JSON.stringify({ ...stubSession, expiresAt: Date.now() - 1000 }),
    );

    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() => {
      expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    });
  });

  it("closes the modal on overlay click", () => {
    const onClose = vi.fn();
    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
