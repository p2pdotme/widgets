import { useEffect, useState } from "react";
import { PaymentHistory, type PaymentHistoryProps } from "./PaymentHistory";
import { Support } from "./Support";
import type {
  SupportProps,
  SupportTheme,
  SupportSigner,
  SupportStatus,
} from "../types";
import {
  readCachedSession,
  writeCachedSession,
} from "../state/sessionCache";
import {
  fetchAuthMe,
  fetchTicketsMe,
  signInWithBridge,
  type TicketSummary,
} from "../api/bridge";

type SupportConfig = Pick<
  SupportProps,
  "originApp" | "bridgeUrl" | "chatwootBaseUrl" | "chatwootInboxIdentifier" | "theme"
>;

export interface PaymentHistoryWithSupportProps
  extends Omit<PaymentHistoryProps, "renderRowAction"> {
  /**
   * Support widget configuration. When present, every order row renders a
   * Support launcher next to the Resume button. The launcher label adapts
   * to the order's on-chain disputeStatus ("Support", "View support",
   * "View resolution"). When absent, the wrapper renders PaymentHistory
   * without support.
   *
   * Per D-022-v2 the wrapper also silently refreshes the session on mount
   * and renders an "Active support" indicator on rows that match an open
   * Chatwoot conversation in `/tickets/me`. The indicator overlays the
   * on-chain dispute badge from `PaymentHistory`.
   */
  support?: SupportConfig & {
    /** Wallet signer for the user opening support. */
    signer: SupportSigner;
    /** Optional theme override for just the support surface. Falls back
     * to the OrderHistory `theme` when omitted. */
    theme?: SupportTheme;
  };
}

/**
 * Composed widget: `PaymentHistory` plus the Support launcher per row.
 * Consumers drop this single component into their UI to get order history
 * with support fully integrated. All exports live on `@p2pdotme/widgets/support`.
 *
 * The native dispute badge in PaymentHistory continues to render on rows
 * where the on-chain disputeStatus is "open" or "resolved", regardless of
 * whether `support` is provided.
 */
export function PaymentHistoryWithSupport(
  props: PaymentHistoryWithSupportProps,
) {
  const { support, ...orderHistoryProps } = props;
  const activeOrderIds = useActiveSupportTickets(support);

  if (!support) {
    return <PaymentHistory {...orderHistoryProps} />;
  }

  return (
    <PaymentHistory
      {...orderHistoryProps}
      renderRowAction={(order: { orderId: { toString(): string }; disputeStatus?: string }) => {
        const id = order.orderId.toString();
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {activeOrderIds.has(id) ? <ActiveSupportPip /> : null}
            <Support
              orderId={id}
              originApp={support.originApp}
              signer={support.signer}
              bridgeUrl={support.bridgeUrl}
              disputeStatus={(order.disputeStatus ?? "none") as SupportStatus}
              chatwootBaseUrl={support.chatwootBaseUrl}
              chatwootInboxIdentifier={support.chatwootInboxIdentifier}
              theme={support.theme}
            />
          </span>
        );
      }}
    />
  );
}

function ActiveSupportPip() {
  return (
    <span
      data-support-active-pip
      aria-label="Active support conversation"
      title="You have an active support conversation on this order"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: "rgba(34, 197, 94, 0.15)",
        color: "rgb(22, 101, 52)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "rgb(22, 163, 74)",
        }}
      />
      Active support
    </span>
  );
}

/**
 * On mount, ensure the wallet has a valid bridge session (silently
 * refreshing via signature when the cached token is missing or expired)
 * and then fetch the user's open Chatwoot conversations. The returned
 * Set is keyed by `orderId` so per-row decoration is O(1).
 */
function useActiveSupportTickets(
  support: PaymentHistoryWithSupportProps["support"],
): Set<string> {
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!support) return;
    let cancelled = false;

    (async () => {
      try {
        const session = await ensureWalletSession({
          bridgeUrl: support.bridgeUrl,
          signer: support.signer,
        });
        if (cancelled || !session) return;
        const tickets = await fetchTicketsMe({
          bridgeUrl: support.bridgeUrl,
          sessionToken: session.sessionToken,
        });
        if (cancelled) return;
        setActiveIds(buildActiveOrderSet(tickets));
      } catch {
        // Silent: the indicator is best-effort. If the bridge is down or
        // Chatwoot is not configured, rows render without the pip.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [support?.bridgeUrl, support?.signer]);

  return activeIds;
}

function buildActiveOrderSet(tickets: TicketSummary[]): Set<string> {
  const out = new Set<string>();
  for (const t of tickets) {
    if (!t.orderId) continue;
    // Treat anything not explicitly resolved as active. The Chatwoot
    // status surface has "open", "pending", "snoozed", "resolved" — only
    // resolved is a closed thread.
    if (t.status === "resolved") continue;
    out.add(t.orderId);
  }
  return out;
}

/**
 * Returns a valid bridge session for the wallet. Reuses a cached token
 * when one exists and `/auth/me` confirms it. Falls back to a silent
 * `/auth/sign-in` (no orderId, so chatwoot session is null) otherwise.
 * Returns null when the signer cannot produce a signature.
 */
async function ensureWalletSession(opts: {
  bridgeUrl: string;
  signer: SupportSigner;
}) {
  const cached = readCachedSession(opts.bridgeUrl, opts.signer.address);
  if (cached) {
    const ok = await fetchAuthMe({
      bridgeUrl: opts.bridgeUrl,
      sessionToken: cached.sessionToken,
    });
    if (ok) return cached;
  }
  if (!opts.signer.signMessage) return null;
  const fresh = await signInWithBridge({
    signer: opts.signer,
    bridgeUrl: opts.bridgeUrl,
  });
  writeCachedSession(opts.bridgeUrl, opts.signer.address, fresh);
  return fresh;
}
