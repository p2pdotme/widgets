import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PaymentHistoryWithSupport } from "../src/widgets/PaymentHistoryWithSupport";
import type { SupportSigner } from "../src/types";

let renderRowAction:
  | ((order: { orderId: bigint; disputeStatus?: string }) => unknown)
  | undefined;

interface RowOrder {
  orderId: bigint;
  status?: string;
  disputeStatus?: string;
}

vi.mock("../src/widgets/PaymentHistory", () => ({
  PaymentHistory: (props: {
    renderRowAction?: (order: RowOrder) => unknown;
    renderRowBadge?: (order: RowOrder) => unknown;
  }) => {
    renderRowAction = props.renderRowAction;
    const rows: RowOrder[] = [
      { orderId: 169n, status: "accepted", disputeStatus: "open" },
      { orderId: 42n, status: "accepted", disputeStatus: "none" },
      { orderId: 7n, status: "accepted", disputeStatus: "resolved" },
      { orderId: 999n, status: "placed", disputeStatus: "none" },
    ];
    return (
      <div data-testid="p2p-payment-history">
        {rows.map((order) => (
          <div data-row={order.orderId.toString()} key={order.orderId.toString()}>
            {/* PaymentHistory always renders the order metadata + a Resume
                button on pending rows. The mock stands in for that
                always-rendered surface so tests can verify the Support
                slots compose, not replace, the underlying row. */}
            <span data-row-resume>Resume</span>
            {props.renderRowBadge
              ? (props.renderRowBadge(order) as React.ReactNode)
              : null}
            {props.renderRowAction
              ? (props.renderRowAction(order) as React.ReactNode)
              : null}
          </div>
        ))}
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

  it("hides Support button and pip on pre-acceptance orders (status: placed)", async () => {
    mockFetch((input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { sub: stubSigner.address };
      if (url.endsWith("/tickets/me")) {
        return {
          items: [
            // Even when a synthetic conversation exists for the placed
            // order, the pip should NOT appear — there is no on-chain
            // circle binding yet so a click would be a no-op.
            { conversationId: 9, orderId: "999", status: "open", updatedAt: 1 },
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
      // Wait for /tickets/me to land so the indicator state has settled.
      expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);
    });

    const row999 = document.querySelector('[data-row="999"]');
    expect(row999?.querySelector("[data-support-active-pip]")).toBeNull();
    expect(row999?.querySelector("[data-support-launcher]")).toBeNull();
    // The row itself + Resume action stay visible so the user can still
    // resume a pre-acceptance order. Only the Support surfaces are gated.
    expect(row999?.querySelector("[data-row-resume]")).not.toBeNull();
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
