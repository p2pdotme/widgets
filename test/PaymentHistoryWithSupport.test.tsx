import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PaymentHistoryWithSupport } from "../src/widgets/PaymentHistoryWithSupport";
import type { SupportSigner } from "../src/types";

let renderRowAction:
  | ((order: { orderId: bigint; disputeStatus?: string }) => unknown)
  | undefined;

vi.mock("../src/widgets/PaymentHistory", () => ({
  PaymentHistory: (props: {
    renderRowAction?: (order: {
      orderId: bigint;
      disputeStatus?: string;
    }) => unknown;
  }) => {
    renderRowAction = props.renderRowAction;
    return (
      <div data-testid="p2p-payment-history">
        <div data-row="169">
          {props.renderRowAction
            ? (props.renderRowAction({
                orderId: 169n,
                disputeStatus: "open",
              }) as React.ReactNode)
            : null}
        </div>
        <div data-row="42">
          {props.renderRowAction
            ? (props.renderRowAction({
                orderId: 42n,
                disputeStatus: "none",
              }) as React.ReactNode)
            : null}
        </div>
        <div data-row="7">
          {props.renderRowAction
            ? (props.renderRowAction({
                orderId: 7n,
                disputeStatus: "resolved",
              }) as React.ReactNode)
            : null}
        </div>
      </div>
    );
  },
}));

const stubSigner: SupportSigner = {
  address: "0x0000000000000000000000000000000000000001",
  signMessage: async (_message: string) => "0xsig",
};

const baseProps = {
  signer: stubSigner,
  subgraphUrl: "https://subgraph.example",
  usdcAddress: "0x0000000000000000000000000000000000000099" as const,
  support: {
    originApp: "merchant-demo",
    bridgeUrl: "https://bridge.local",
    signer: stubSigner,
  },
};

function mockFetch(handler: (input: RequestInfo, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const out = await handler(input, init);
    if (out && typeof out === "object" && "status" in (out as object)) {
      return out as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => out,
      text: async () => JSON.stringify(out),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  renderRowAction = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaymentHistoryWithSupport", () => {
  it("renders the underlying PaymentHistory without support config", () => {
    render(<PaymentHistoryWithSupport {...baseProps} support={undefined} />);
    expect(screen.getByTestId("p2p-payment-history")).toBeInTheDocument();
  });

  it("decorates only rows with an open (non-resolved) Chatwoot conversation", async () => {
    mockFetch((input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { sub: stubSigner.address };
      if (url.endsWith("/tickets/me")) {
        return {
          items: [
            { conversationId: 1, orderId: "169", status: "open", updatedAt: 1 },
            { conversationId: 2, orderId: "7", status: "resolved", updatedAt: 2 },
          ],
        };
      }
      return {};
    });

    const fresh = {
      ok: true,
      address: stubSigner.address,
      role: "user",
      chatwoot: null,
      sessionToken: "stub.jwt.token",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    window.localStorage.setItem(
      `support.p2p.me:session:https://bridge.local:${stubSigner.address.toLowerCase()}`,
      JSON.stringify(fresh),
    );

    render(<PaymentHistoryWithSupport {...baseProps} />);

    await waitFor(() => {
      const pips = screen.queryAllByLabelText(/active support conversation/i);
      expect(pips).toHaveLength(1);
    });
    // The decoration is on order 169 (open ticket), not 42 (no ticket) or
    // 7 (resolved ticket).
    const row169 = document.querySelector('[data-row="169"]');
    const row42 = document.querySelector('[data-row="42"]');
    const row7 = document.querySelector('[data-row="7"]');
    expect(row169?.querySelector("[data-support-active-pip]")).not.toBeNull();
    expect(row42?.querySelector("[data-support-active-pip]")).toBeNull();
    expect(row7?.querySelector("[data-support-active-pip]")).toBeNull();
  });

  it("silently signs in when there is no cached session and the signer can sign", async () => {
    const signMessage = vi.fn(async () => "0xsig");
    const signer = { ...stubSigner, signMessage };

    mockFetch((input) => {
      const url = String(input);
      if (url.endsWith("/auth/sign-in")) {
        return {
          ok: true,
          address: signer.address,
          role: "user",
          chatwoot: null,
          sessionToken: "fresh.jwt",
          expiresAt: Date.now() + 60_000_000,
        };
      }
      if (url.endsWith("/tickets/me")) return { items: [] };
      return {};
    });

    render(
      <PaymentHistoryWithSupport
        {...baseProps}
        support={{ ...baseProps.support, signer }}
      />,
    );
    await waitFor(() => {
      expect(signMessage).toHaveBeenCalledTimes(1);
    });
    // Cache was populated.
    const raw = window.localStorage.getItem(
      `support.p2p.me:session:https://bridge.local:${signer.address.toLowerCase()}`,
    );
    expect(raw).not.toBeNull();
  });

  it("re-uses a cached session when /auth/me confirms it", async () => {
    const signMessage = vi.fn(async () => "0xsig");
    const signer = { ...stubSigner, signMessage };
    const cached = {
      ok: true,
      address: signer.address,
      role: "user",
      chatwoot: null,
      sessionToken: "cached.jwt",
      expiresAt: Date.now() + 60_000_000,
    };
    window.localStorage.setItem(
      `support.p2p.me:session:https://bridge.local:${signer.address.toLowerCase()}`,
      JSON.stringify(cached),
    );

    mockFetch((input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { sub: signer.address };
      if (url.endsWith("/tickets/me")) return { items: [] };
      return {};
    });

    render(
      <PaymentHistoryWithSupport
        {...baseProps}
        support={{ ...baseProps.support, signer }}
      />,
    );
    await waitFor(() => {
      expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);
    });
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("refreshes silently when the cached /auth/me returns 401", async () => {
    const signMessage = vi.fn(async () => "0xsig");
    const signer = { ...stubSigner, signMessage };
    window.localStorage.setItem(
      `support.p2p.me:session:https://bridge.local:${signer.address.toLowerCase()}`,
      JSON.stringify({
        ok: true,
        address: signer.address,
        role: "user",
        chatwoot: null,
        sessionToken: "stale.jwt",
        expiresAt: Date.now() + 60_000_000,
      }),
    );

    globalThis.fetch = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => "",
        } as unknown as Response;
      }
      if (url.endsWith("/auth/sign-in")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            address: signer.address,
            role: "user",
            chatwoot: null,
            sessionToken: "fresh.jwt",
            expiresAt: Date.now() + 60_000_000,
          }),
          text: async () => "",
        } as unknown as Response;
      }
      if (url.endsWith("/tickets/me")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
          text: async () => "",
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <PaymentHistoryWithSupport
        {...baseProps}
        support={{ ...baseProps.support, signer }}
      />,
    );
    await waitFor(() => {
      expect(signMessage).toHaveBeenCalledTimes(1);
    });
  });
});
