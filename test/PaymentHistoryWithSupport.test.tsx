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

// Smart-mode rows render <OrderAction> in the action slot, which calls
// computeOrderAction() over a full SDK Order + pulls in the chatwoot chip.
// The legacy chat-mode tests never touch it. Stub it so the smart-mode
// banner test (below) can render with the lightweight mock rows and assert
// purely on the customer banner surface.
vi.mock("../src/widgets/OrderAction", () => ({
  OrderAction: (props: { orderId: string }) => (
    <button data-testid="stub-order-action" data-order-id={props.orderId}>
      action
    </button>
  ),
}));

const stubSigner: SupportSigner = {
  address: "0x0000000000000000000000000000000000000001",
  signMessage: async (_message: string) => "0xsig",
};

const baseProps = {
  signer: stubSigner,
  subgraphUrl: "https://subgraph.example",
  usdcAddress: "0x0000000000000000000000000000000000000099" as const,
  // Existing tests cover the legacy single-button layout; opt into it
  // explicitly so the default ("smart") change doesn't silently flip
  // their assertions.
  actionMode: "chat" as const,
  support: {
    originApp: "merchant-demo",
    bridgeUrl: "https://bridge.local",
    signer: stubSigner,
    // Pre-bridge tests exercise the bridge /auth/me + /tickets/me path; the
    // v1.1.1-bridge default flips chatEnabled to false (which skips the
    // bridge round-trip entirely). Tests below assert on bridge fetches
    // landing, so they opt back into chatEnabled.
    chatEnabled: true,
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

  it("renders Support button on all rows regardless of on-chain status — gating is server-side", async () => {
    mockFetch((input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { sub: stubSigner.address };
      if (url.endsWith("/tickets/me")) return { items: [] };
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
      expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);
    });

    // Even the placed row gets a Support button — the bridge's chain
    // resolver is the source of truth for "can this open a chat", not
    // the SDK's `status` field. The bridge returns `chatwoot: null`
    // when nothing is bound and the widget closes silently from there.
    const row999 = document.querySelector('[data-row="999"]');
    expect(row999?.querySelector("[data-row-resume]")).not.toBeNull();
    expect(row999?.querySelector("[data-support-launcher]")).not.toBeNull();
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

  it("renders the customer P2P tag / resolved banner under the DEFAULT (smart) actionMode", async () => {
    // The default layout renders <OrderAction> in the action slot. The
    // customer-facing banner (D-027-v2) must still surface via the badge
    // slot, otherwise the friendly p2p_tag copy + resolved lock are
    // unreachable in the default config (the review gap this fixes).
    mockFetch((input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { sub: stubSigner.address };
      if (url.endsWith("/tickets/me")) {
        return {
          items: [
            // order 42 → operator set the `reviewing` tag, conv still open.
            { conversationId: 1, orderId: "42", status: "open", p2pTag: "reviewing", updatedAt: 1 },
            // order 7 → conversation resolved → input-lock notice.
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

    // No `actionMode` prop → exercises the default ("smart") layout.
    render(<PaymentHistoryWithSupport {...baseProps} actionMode={undefined} />);

    // Friendly tag copy on the tagged row (operator vocabulary never leaks).
    await waitFor(() => {
      expect(screen.getByText(/our team is reviewing/i)).toBeInTheDocument();
    });
    // Resolved row shows the "Chat closed by support" lock notice.
    expect(screen.getByText(/chat closed by support/i)).toBeInTheDocument();

    // Banners are scoped to the correct rows.
    const row42 = document.querySelector('[data-row="42"]');
    const row7 = document.querySelector('[data-row="7"]');
    expect(row42?.querySelector('[data-p2p-tag-banner="reviewing"]')).not.toBeNull();
    expect(row7?.querySelector('[data-p2p-tag-banner="resolved"]')).not.toBeNull();
    // A row with neither a tag nor a resolved status carries no banner.
    const row999 = document.querySelector('[data-row="999"]');
    expect(row999?.querySelector("[data-p2p-tag-banner]")).toBeNull();
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
