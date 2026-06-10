import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Order } from "@p2pdotme/sdk/orders";
import { PaymentHistory, type PaymentHistoryProps } from "./PaymentHistory";
import { Support } from "./Support";
import { OrderAction } from "./OrderAction";
import { P2PTagBanner } from "./P2PTagBanner";
import type { RaiseDisputeSigner } from "./ReportProblemStep";
import type {
  SupportProps,
  SupportTheme,
  SupportSigner,
  SupportStatus,
  SupportP2PTag,
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
    /**
     * Required when `actionMode="smart"` AND any row is dispute-eligible:
     * the signer that can `sendTransaction` for the on-chain
     * `raiseDispute(orderId, redactTransId)` call. Absent → the
     * dispute action button is suppressed (status line still informs
     * the user) but chat stays available.
     */
    txSigner?: RaiseDisputeSigner;
    /** Diamond address for the `raiseDispute` write. Defaults to the
     *  outer `PaymentHistory` `diamondAddress`, then the widget's
     *  `DEFAULT_DIAMOND_ADDRESS`. */
    diamondAddress?: Address;
    /** Read RPC for the report-problem pre-flight simulation. Defaults
     *  to the outer `PaymentHistory` `rpcUrl`. */
    rpcUrl?: string;
    /** Chain id for the pre-flight simulation. Defaults to the outer
     *  `PaymentHistory` `chainId`. */
    chainId?: number;
    /**
     * Called from the smart layout when the user clicks "Resume order"
     * on a BUY ACCEPTED row. Absent → Resume button is suppressed (V1
     * decision; status line still says payment is needed).
     */
    onResumeOrder?: (orderId: string) => void;
    /** Fires the moment the on-chain report (`raiseDispute`) tx
     *  broadcasts (hash known, receipt pending). Optimistic
     *  state-machine flip per V1 decision. */
    onReportSubmitted?: (orderId: string, txHash: `0x${string}`) => void;
    /** Toggle for the Chatwoot chat path. Default `false` (v1.1.1-bridge
     *  fallback): every click that would have opened chat instead opens
     *  a static "support request registered" modal. Flip to `true` only
     *  when the bridge + Chatwoot stack is healthy. */
    chatEnabled?: boolean;
  };
  /**
   * Per-row layout:
   *   - `"chat"` (legacy) — keeps the historical behaviour: dispute badge
   *     above the row + a single Support launcher in the action slot. No
   *     resume / raise-dispute UI from the widget itself.
   *   - `"smart"` (default) — replaces the action slot with
   *     `<OrderAction>` which surfaces the current order state, an
   *     action button (resume / raise dispute) when one is actionable,
   *     and a Support button with chat-active vs chat-new differentiation.
   *
   * Set to `"chat"` to preserve the prior visuals.
   */
  actionMode?: "chat" | "smart";
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
  const { support, actionMode = "smart", ...orderHistoryProps } = props;
  const { activeOrderIds, tagByOrder } = useActiveSupportTickets(support);

  if (!support) {
    return <PaymentHistory {...orderHistoryProps} />;
  }

  if (actionMode === "smart") {
    // Smart layout: status + action + support per row. PaymentHistory's
    // native Resume button is suppressed (OrderAction owns the action
    // slot now); the dispute badge stays since OrderAction's Support
    // button reflects dispute state too and double-marking is fine.
    //
    // The embedder's existing `onResume` prop is reused as the resume
    // handler unless `support.onResumeOrder` is explicitly set — keeps
    // the smart-mode flip a zero-config upgrade for embedders that
    // already wired the legacy onResume.
    const onResumeOrder =
      support.onResumeOrder ?? orderHistoryProps.onResume;
    return (
      <PaymentHistory
        {...orderHistoryProps}
        onResume={undefined}
        // Same customer-facing decoration as the legacy chat path: the
        // active-support pip plus the D-027-v2 P2P tag / resolved banner.
        // Without this the friendly tag copy and "Chat closed by support"
        // lock are unreachable under the default smart layout.
        renderRowBadge={(order: { orderId: { toString(): string } }) => {
          const id = order.orderId.toString();
          const tagged = tagByOrder.get(id);
          return (
            <>
              {activeOrderIds.has(id) ? <ActiveSupportPip /> : null}
              {tagged ? (
                <P2PTagBanner tag={tagged.p2pTag} status={tagged.status} />
              ) : null}
            </>
          );
        }}
        renderRowAction={(order: Order) => (
          <OrderAction
            orderId={order.orderId.toString()}
            order={order}
            signer={support.signer}
            bridgeUrl={support.bridgeUrl}
            originApp={support.originApp ?? "this app"}
            txSigner={support.txSigner}
            diamondAddress={
              support.diamondAddress ?? orderHistoryProps.diamondAddress
            }
            rpcUrl={support.rpcUrl ?? orderHistoryProps.rpcUrl}
            chainId={support.chainId ?? orderHistoryProps.chainId}
            onResumeOrder={onResumeOrder}
            onReportSubmitted={support.onReportSubmitted}
            chatEnabled={support.chatEnabled}
            theme={support.theme}
          />
        )}
      />
    );
  }

  // Legacy chat mode — preserved for callers that opt into the old
  // single-button layout.
  return (
    <PaymentHistory
      {...orderHistoryProps}
      renderRowBadge={(order: { orderId: { toString(): string } }) => {
        const id = order.orderId.toString();
        const tagged = tagByOrder.get(id);
        return (
          <>
            {activeOrderIds.has(id) ? <ActiveSupportPip /> : null}
            {/* Customer-facing P2P tag / resolved banner (D-027-v2). Only
                renders once `/tickets/me` surfaces `p2p_tag` / a resolved
                status; otherwise tagByOrder has no entry and this is null. */}
            {tagged ? (
              <P2PTagBanner tag={tagged.p2pTag} status={tagged.status} />
            ) : null}
          </>
        );
      }}
      renderRowAction={(order: { orderId: { toString(): string }; disputeStatus?: string }) => (
        <Support
          orderId={order.orderId.toString()}
          originApp={support.originApp}
          signer={support.signer}
          bridgeUrl={support.bridgeUrl}
          disputeStatus={(order.disputeStatus ?? "none") as SupportStatus}
          chatwootBaseUrl={support.chatwootBaseUrl}
          chatwootInboxIdentifier={support.chatwootInboxIdentifier}
          theme={support.theme}
        />
      )}
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

interface TicketDecoration {
  /** Operator-set P2P tag, when the bridge surfaces it. */
  p2pTag?: SupportP2PTag;
  /** Chatwoot conversation status (drives the resolved banner). */
  status?: string;
}

/**
 * On mount, ensure the wallet has a valid bridge session (silently
 * refreshing via signature when the cached token is missing or expired)
 * and then fetch the user's open Chatwoot conversations. Returns:
 *  - `activeOrderIds`: set of orderIds with an open (non-resolved) thread,
 *     keyed for O(1) per-row decoration.
 *  - `tagByOrder`: per-order `{ p2pTag, status }` used to render the
 *     customer-facing `P2PTagBanner`. Only populated for rows whose ticket
 *     carries a `p2pTag` or a resolved status (D-027-v2).
 */
function useActiveSupportTickets(
  support: PaymentHistoryWithSupportProps["support"],
): { activeOrderIds: Set<string>; tagByOrder: Map<string, TicketDecoration> } {
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set());
  const [tagByOrder, setTagByOrder] = useState<Map<string, TicketDecoration>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!support) return;
    // v1.1.1-bridge: the "active support" pip is sourced from the
    // bridge's `/auth/me` + `/tickets/me` endpoints, which only exist
    // when the chat path is on. When `chatEnabled` is off the bridge
    // may be unreachable / mis-configured; skip the fetch entirely so
    // we don't spam CORS preflight failures into the console. The pip
    // is best-effort anyway — falling back to "no active conversation
    // indicators" is the safe default.
    if (support.chatEnabled === false || support.chatEnabled === undefined) {
      return;
    }
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
        setTagByOrder(buildTagByOrder(tickets));
      } catch {
        // Silent: the indicator is best-effort. If the bridge is down or
        // Chatwoot is not configured, rows render without the pip.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [support?.bridgeUrl, support?.signer, support?.chatEnabled]);

  return { activeOrderIds: activeIds, tagByOrder };
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
 * Per-order `{ p2pTag, status }` for rows whose ticket carries a P2P tag or
 * a resolved status. Rows with neither are omitted so the banner stays
 * absent until the bridge surfaces the field (D-027-v2).
 */
function buildTagByOrder(
  tickets: TicketSummary[],
): Map<string, TicketDecoration> {
  const out = new Map<string, TicketDecoration>();
  for (const t of tickets) {
    if (!t.orderId) continue;
    const resolved = t.status === "resolved";
    if (!t.p2pTag && !resolved) continue;
    out.set(t.orderId, { p2pTag: t.p2pTag, status: t.status });
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
