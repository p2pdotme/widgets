import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Support } from "../src/widgets/Support";
import type { SupportSigner } from "../src/types";

const stubSigner: SupportSigner = {
  address: "0x0000000000000000000000000000000000000001",
  signMessage: async (_message: string) => "0xdeadbeef",
  getChainId: async () => 84532,
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

  it("with chatEnabled=false (default), opens directly to the 'support request registered' modal and never hits the bridge", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/support request registered/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/check back here in a little while/i),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens the modal, shows masked order context, and renders an actionable unavailable state when the bridge has no inbox bound", async () => {
    const onOpen = vi.fn();
    render(
      <Support
        orderId="0xabcdef1234567890"
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
        chatEnabled
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
    // Sign-in returns chatwoot:null. The widget renders an "unavailable"
    // state inside the modal with a Retry button — NOT a silent close.
    // This is the production-ready behavior: pre-acceptance and
    // missing-inbox are surfaced to the user as a stable, retryable state
    // rather than a flash of nothing.
    await waitFor(() =>
      expect(screen.getByText(/support not available yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each([
    { status: "none", chatState: "new", label: "Get help" },
    { status: "none", chatState: "active", label: "Continue support" },
    { status: "open", chatState: "new", label: "View report" },
    { status: "resolved", chatState: "new", label: "View resolution" },
  ] as const)(
    "adapts the launcher label for disputeStatus=$status / chatState=$chatState",
    ({ status, chatState, label }) => {
      render(
        <Support
          orderId="0xabcdef1234567890"
          originApp="merchant-demo"
          signer={stubSigner}
          bridgeUrl="https://bridge.local"
          disputeStatus={status}
          chatState={chatState}
        />,
      );
      const launcher = screen.getByRole("button", { name: /open support/i });
      expect(launcher).toHaveTextContent(label);
    },
  );

  it("calls the bridge with the signed sign-in payload, binding chainId into the message and body (D-027-v3 §4)", async () => {
    const signSpy = vi.fn(async (_m: string) => "0xsig");
    render(
      <Support
        orderId="0xabcdef1234567890"
        originApp="merchant-demo"
        signer={{
          address: stubSigner.address,
          signMessage: signSpy,
          getChainId: async () => 8453,
        }}
        bridgeUrl="https://bridge.local/"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() => {
      expect(signSpy).toHaveBeenCalledOnce();
    });
    const msg = signSpy.mock.calls[0]![0];
    // New bound format: ${purpose}:${address.toLowerCase()}:${chainId}:${timestamp}
    expect(msg).toMatch(/^support\.p2p\.me:sign-in:0x0+1:8453:\d+$/);

    await waitFor(() => {
      expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);
    });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://bridge.local/auth/sign-in");
    const body = JSON.parse(init.body);
    expect(body.address).toBe(stubSigner.address);
    expect(body.chainId).toBe(8453);
    expect(body.signature).toBe("0xsig");
    expect(typeof body.timestamp).toBe("number");
    // The chainId in the body must match the one bound into the signed
    // message, or the bridge recomputes a different message and 401s.
    expect(msg).toContain(`:${body.chainId}:${body.timestamp}`);
  });

  it("surfaces a retryable error and never hits the bridge when the signer cannot resolve a chainId (hard cutover, no silent default)", async () => {
    const signSpy = vi.fn(async (_m: string) => "0xsig");
    const fetchSpy = globalThis.fetch as any;
    render(
      <Support
        orderId="0xabcdef1234567890"
        originApp="merchant-demo"
        signer={{ address: stubSigner.address, signMessage: signSpy }}
        bridgeUrl="https://bridge.local/"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    // chainId is mandatory: the flow throws before signing or POSTing.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument(),
    );
    expect(signSpy).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.length).toBe(0);
  });

  it("classifies a 4xx sign-in failure as an auth error with a retry CTA", async () => {
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
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    // Friendly title from the auth bucket.
    await waitFor(() =>
      expect(screen.getByText(/^Sign-in failed$/)).toBeInTheDocument(),
    );
    // Raw error preserved as a monospace detail line for debugging.
    expect(screen.getByText(/sign-in failed \(401\)/i)).toBeInTheDocument();
    // Every error state offers Retry + Close, never just close.
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
  });

  it("classifies an EIP-1193 user rejection (code 4001) as a userRejected error", async () => {
    const reject = vi.fn(async () => {
      const err = new Error("User rejected the request");
      (err as { code?: number }).code = 4001;
      throw err;
    });
    render(
      <Support
        originApp="merchant-demo"
        signer={{
          address: stubSigner.address,
          signMessage: reject,
          getChainId: async () => 84532,
        }}
        bridgeUrl="https://bridge.local"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() =>
      expect(screen.getByText(/authorization cancelled/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
  });

  it("retry re-triggers sign-in after a failure", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ ok: false }),
          text: async () => "",
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => stubSession,
        text: async () => JSON.stringify(stubSession),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    render(
      <Support
        originApp="merchant-demo"
        signer={stubSigner}
        bridgeUrl="https://bridge.local"
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() =>
      expect(screen.getByText(/connection issue/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    // Second attempt resolves to chatwoot:null → unavailable state.
    await waitFor(() =>
      expect(screen.getByText(/support not available yet/i)).toBeInTheDocument(),
    );
    expect(call).toBe(2);
  });

  it("reuses a cached session and renders the unavailable state without hitting the bridge", async () => {
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
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    // Cache hit reuses the chatwoot:null session and renders the
    // unavailable state — never silent closes.
    await waitFor(() =>
      expect(screen.getByText(/support not available yet/i)).toBeInTheDocument(),
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
        chatEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open support/i }));
    await waitFor(() => {
      expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    });
  });

  it("closes the modal on backdrop click", async () => {
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
    const dialog = await screen.findByRole("dialog");
    // role="dialog" now lives on Modal's card (single owner of the
    // dialog landmark). Modal renders backdrop > card > children, so
    // the backdrop is the dialog's immediate parent.
    const backdrop = dialog.parentElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes the modal on the close button", async () => {
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
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /close support/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
