import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http, formatUnits, stringToHex } from "viem";
import { baseSepolia, base } from "viem/chains";
import {
  createOrders,
  createLocalStorageRelayStore,
  type Order,
} from "@p2pdotme/sdk/orders";
import { DEFAULT_DIAMOND_ADDRESS, DIAMOND_ABI, USDC_DECIMALS } from "../core/contracts";
import { color, radius, font, weight, S, themeToCssVars, type P2PTheme } from "../ui/theme";
import { Spinner, CenterStatus, injectKeyframes } from "../ui/components";
import { isOrderActionable } from "../core/order-action";
import type { CheckoutSigner } from "../types";

export interface PaymentHistoryProps {
  signer: CheckoutSigner;
  /** Subgraph URL — required, this is a read-only widget that runs purely off the subgraph. */
  subgraphUrl: string;
  /** USDC token address. */
  usdcAddress: `0x${string}`;
  chainId?: number;
  diamondAddress?: `0x${string}`;
  rpcUrl?: string;
  /** Page size — defaults to 20, max 100 (SDK enforced). */
  limit?: number;
  /**
   * Called when the user clicks the "Resume" button on a pending order
   * (placed/accepted/paid). The host should open `Checkout` with this
   * orderId; the checkout widget polls chain state and lands on the right
   * screen automatically.
   */
  onResume?: (orderId: string) => void;
  /**
   * Optional render slot for an additional action per row. Receives the
   * full Order so the host can branch on status, currency, age, etc.
   * Renders to the right of the Resume button (when both are present).
   * Use cases include surfacing per-order support, escalation, or
   * marketplace-specific actions without forking the widget. The support
   * subpath's `PaymentHistoryWithSupport` is the canonical consumer.
   */
  renderRowAction?: (order: Order) => React.ReactNode;
  /**
   * Optional render slot at the top-right corner of each row. Useful for
   * status overlays — e.g. the support subpath uses it to render an
   * "Active support" pip alongside the on-chain dispute badge. Rendered
   * absolutely positioned so it never shifts the row's primary layout.
   */
  renderRowBadge?: (order: Order) => React.ReactNode;
  /** Optional title override. */
  title?: string;
  /**
   * Which orders to render.
   *
   *   - `"pending"` shows only placed/accepted/paid (in-flight).
   *   - `"all"` shows every order returned by the subgraph.
   *   - `"actionable"` shows in-flight orders PLUS past orders that still
   *     have an action surface (in-window cancelled-with-funds, open
   *     dispute). Terminal-good and terminal-bad rows (completed,
   *     cancelled-no-funds, past-window cancelled, resolved dispute) are
   *     hidden so embedders that show this widget on a primary screen
   *     don't accumulate a never-ending history.
   *
   * Default: `"all"`.
   */
  filter?: "pending" | "all" | "actionable";
  /**
   * When there are no orders to show (after filtering, loading, or on error),
   * return `null` instead of rendering an empty-state card. Useful for inline
   * "needs attention" surfaces that should disappear when there's no signal.
   * Defaults to `true` when `filter === "pending"`, `false` otherwise.
   */
  hideWhenEmpty?: boolean;
  /** Style overrides applied to the root card. Convenient for outer spacing
   * (`marginBottom`, etc.) that should disappear when the widget auto-hides. */
  style?: React.CSSProperties;
  /**
   * Bump this value to force an immediate refetch. Useful after a Checkout
   * `onComplete` / `onCancel` callback fires — the host knows the state
   * changed before the subgraph has indexed it.
   */
  refreshKey?: number | string;
  /**
   * Local status overlay — overrides the subgraph status for these orderIds
   * until the next fetch returns a matching value. Use to bridge subgraph
   * indexing latency (~10–20s) after a known terminal transition. Keyed by
   * orderId string.
   *
   * IMPORTANT: pass a stable reference (useMemo / useState) — a new object
   * literal each render will retrigger effects unnecessarily.
   */
  optimisticUpdates?: Record<string, "completed" | "cancelled">;
  /**
   * Auto-poll interval in ms, applied only while there's at least one
   * non-terminal order in the result set. Set to `0` to disable polling
   * (manual refetch via `refreshKey` only). Default: 15000.
   */
  pollIntervalMs?: number;
  /** Optional theming overrides. See `P2PTheme` for the surface. */
  theme?: P2PTheme;
}

const PENDING_STATUSES: ReadonlyArray<Order["status"]> = ["placed", "accepted", "paid"];

export function PaymentHistory(props: PaymentHistoryProps) {
  const {
    signer, subgraphUrl, usdcAddress,
    chainId = 84532, diamondAddress = DEFAULT_DIAMOND_ADDRESS, rpcUrl,
    limit = 20, onResume, renderRowAction, renderRowBadge,
    filter = "all",
    refreshKey,
    optimisticUpdates,
    pollIntervalMs = 15_000,
    theme,
  } = props;
  const themeStyle = themeToCssVars(theme);
  const hideWhenEmpty =
    props.hideWhenEmpty ?? (filter === "pending" || filter === "actionable");
  const title =
    props.title ??
    (filter === "pending" || filter === "actionable"
      ? "Pending orders"
      : "Order history");

  useEffect(injectKeyframes, []);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-currency on-chain config — fetched lazily for currencies that have
  // at least one order missing `actualFiatAmount` (i.e. pre-acceptance:
  // placed orders and orders cancelled before a merchant accepted). Lets us
  // reconstruct the gross-fiat (subtotal + fee) the user would have paid,
  // instead of falling back to the base `fiatAmount`.
  const [currencyConfigs, setCurrencyConfigs] = useState<Record<string, {
    buyPrice: bigint; smallOrderThreshold: bigint; smallOrderFixedFee: bigint;
  }>>({});

  const fetchOrders = useCallback(async () => {
    if (!signer?.address) return;
    setLoading(true);
    setError(null);
    try {
      const chain = chainId === 84532 ? baseSepolia : base;
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
      const client = createOrders({
        publicClient: publicClient as any,
        diamondAddress,
        usdcAddress,
        subgraphUrl,
        relayIdentityStore: createLocalStorageRelayStore(),
      });
      const result = await client.getOrders({ userAddress: signer.address, skip: 0, limit });
      if (result.isErr()) throw result.error;
      setOrders(result.value);
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  }, [signer?.address, subgraphUrl, usdcAddress, chainId, diamondAddress, rpcUrl, limit]);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshKey]);

  // Currencies that need on-chain config to compute a gross display amount
  // (any order whose chain-side `actualFiatAmount` hasn't been populated yet).
  // Deduped via a stable key so we don't refetch on every render.
  const currenciesNeedingConfig = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders ?? []) {
      if (o.actualFiatAmount === 0n && o.currency) set.add(o.currency);
    }
    return Array.from(set);
  }, [orders]);
  const currenciesKey = currenciesNeedingConfig.join(",");

  useEffect(() => {
    const missing = currenciesNeedingConfig.filter((c) => !currencyConfigs[c]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const chain = chainId === 84532 ? baseSepolia : base;
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
      const results = await Promise.all(missing.map(async (currency) => {
        try {
          const currencyHex = stringToHex(currency, { size: 32 });
          const [price, threshold, fixedFee] = await Promise.all([
            publicClient.readContract({
              address: diamondAddress, abi: DIAMOND_ABI,
              functionName: "getPriceConfig", args: [currencyHex],
            }) as Promise<{ buyPrice: bigint }>,
            publicClient.readContract({
              address: diamondAddress, abi: DIAMOND_ABI,
              functionName: "getSmallOrderThreshold", args: [currencyHex],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: diamondAddress, abi: DIAMOND_ABI,
              functionName: "getSmallOrderFixedFee", args: [currencyHex],
            }) as Promise<bigint>,
          ]);
          return [currency, {
            buyPrice: price.buyPrice,
            smallOrderThreshold: threshold,
            smallOrderFixedFee: fixedFee,
          }] as const;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      const fetched = results.filter((r): r is NonNullable<typeof r> => r !== null);
      if (fetched.length === 0) return;
      setCurrencyConfigs((prev) => {
        const next = { ...prev };
        for (const [currency, cfg] of fetched) next[currency] = cfg;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currenciesKey, diamondAddress, chainId, rpcUrl]);

  // Apply optimistic overrides BEFORE filtering / rendering. The host knows
  // about terminal transitions (onComplete/onCancel) before the subgraph
  // has indexed them; this overlay makes the UI feel instant.
  const overlaidOrders = (orders ?? []).map((o) => {
    const override = optimisticUpdates?.[o.orderId.toString()];
    return override ? { ...o, status: override } : o;
  });

  const allOrders = overlaidOrders;
  const pending = allOrders.filter((o) => PENDING_STATUSES.includes(o.status));
  // For "actionable" mode, past orders are kept only when they still surface
  // a user action (in-window cancelled-with-funds → Contact Support chip,
  // open dispute → View report). Terminal-good and post-window-terminal
  // rows fall off so a primary-surface embedder doesn't accumulate a
  // perpetually-growing history.
  const past = (() => {
    if (filter === "pending") return [];
    const candidates = allOrders.filter(
      (o) => !PENDING_STATUSES.includes(o.status),
    );
    if (filter !== "actionable") return candidates;
    const now = Date.now();
    return candidates.filter((o) => isOrderActionable(o, now));
  })();

  // Auto-poll while there's at least one non-terminal order. Catches state
  // changes that happen outside this widget (e.g., merchant just accepted)
  // and keeps the post-completion view fresh as the subgraph catches up.
  const hasPendingForPoll = pending.length > 0;
  useEffect(() => {
    if (!hasPendingForPoll || pollIntervalMs <= 0) return;
    const id = setInterval(fetchOrders, pollIntervalMs);
    return () => clearInterval(id);
  }, [hasPendingForPoll, pollIntervalMs, fetchOrders]);
  const visibleCount =
    filter === "pending" ? pending.length : pending.length + past.length;
  const hasNothingToShow = !loading && !error && visibleCount === 0;

  // Auto-hide surfaces (e.g. inline "needs attention" on a home page) collapse
  // to nothing when there's no signal — including during the initial fetch.
  if (hideWhenEmpty && (hasNothingToShow || (!orders && loading) || error)) {
    return null;
  }

  return (
    <div style={{ ...themeStyle, ...S.card, padding: 20, fontFamily: "var(--p2p-font, inherit)", color: color.text, ...props.style }}>
      <div style={{ ...S.rowBetween, marginBottom: 16 }}>
        <h2 style={{ ...S.h2, margin: 0 }}>{title}</h2>
        <button
          type="button"
          style={{ ...S.ghostBtn, height: 32, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={fetchOrders}
          disabled={loading}
        >
          {loading && orders ? <Spinner size={12} /> : null}
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && !orders && (
        <CenterStatus icon={<Spinner />} title="Loading orders" subtitle="Querying the subgraph…" />
      )}

      {error && (
        <div style={{ padding: 12, background: color.dangerSoft, borderRadius: radius.md, color: color.danger, fontSize: font.md, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {hasNothingToShow && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <p style={S.muted}>{filter === "pending" ? "No pending orders." : "No orders yet."}</p>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: past.length > 0 ? 20 : 0 }}>
          {past.length > 0 && <p style={{ ...S.label, marginBottom: 8 }}>Pending</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((o) => (
              <OrderRow key={o.orderId.toString()} order={o} onResume={onResume} renderRowAction={renderRowAction} renderRowBadge={renderRowBadge} highlight config={currencyConfigs[o.currency]} />
            ))}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          {pending.length > 0 && <p style={{ ...S.label, marginBottom: 8 }}>Past</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {past.map((o) => (
              <OrderRow key={o.orderId.toString()} order={o} onResume={onResume} renderRowAction={renderRowAction} renderRowBadge={renderRowBadge} config={currencyConfigs[o.currency]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onResume, renderRowAction, renderRowBadge, highlight, config }: {
  order: Order;
  onResume?: (orderId: string) => void;
  renderRowAction?: (order: Order) => React.ReactNode;
  renderRowBadge?: (order: Order) => React.ReactNode;
  highlight?: boolean;
  config?: { buyPrice: bigint; smallOrderThreshold: bigint; smallOrderFixedFee: bigint };
}) {
  const isPending = PENDING_STATUSES.includes(order.status);
  // Source-of-truth precedence for the gross fiat the user paid (or would
  // pay): chain-stored `actualFiatAmount` is set on merchant acceptance and
  // already includes the protocol fee. Pre-acceptance (placed orders, or
  // orders cancelled before any merchant accepted) the chain hasn't
  // committed it — we reconstruct from on-chain config so the row still
  // shows the gross figure consistently.
  const fiatRaw: bigint = (() => {
    if (order.actualFiatAmount > 0n) return order.actualFiatAmount;
    if (config) {
      const feeUsdc =
        order.usdcAmount <= config.smallOrderThreshold ? config.smallOrderFixedFee : 0n;
      const feeFiat = (feeUsdc * config.buyPrice) / 1_000_000n;
      return order.fiatAmount + feeFiat;
    }
    return order.fiatAmount;
  })();
  const fiat = (Number(fiatRaw) / 1e6).toFixed(2);
  const usdc = formatUnits(order.usdcAmount, USDC_DECIMALS);
  const ts = Number(order.placedAt) * 1000;
  const when = ts > 0 ? relativeTime(ts) : "—";

  return (
    <div
      style={{
        padding: "12px 14px",
        border: `1px solid ${highlight ? color.accentSoft : color.border}`,
        background: highlight ? color.accentSoft : color.surface,
        borderRadius: radius.md,
        display: "flex",
        // Wrap the row's left + right columns onto a new line on narrow
        // surfaces (e.g. a side drawer) instead of letting them overlap.
        // align-items: flex-start so the right column tops out next to the
        // left column's status badges, not centered onto its amount row.
        flexWrap: "wrap",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        position: "relative",
      }}
    >
      {renderRowBadge ? (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 10,
            display: "inline-flex",
            alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>{renderRowBadge(order)}</div>
        </div>
      ) : null}
      <div
        style={{
          // `flex: 1 1 160px` gives the left column (badge / amount / age)
          // a 160px basis — enough to read at a glance — and lets it
          // shrink only when the row itself is wider than 160 + right
          // col's natural width. Below that the row wraps and the right
          // column drops to its own line.
          flex: "1 1 160px",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <StatusBadge status={order.status} />
          {order.disputeStatus && order.disputeStatus !== "none" ? (
            <DisputeBadge status={order.disputeStatus} />
          ) : null}
          <span style={{ ...S.faint, ...S.mono }}>#{order.orderId.toString()}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: font.base, fontWeight: weight.semibold, ...S.num }}>{order.currency} {fiat}</span>
          <span style={{ ...S.faint, ...S.num }}>· {usdc} USDC</span>
        </div>
        <div style={{ ...S.faint, marginTop: 2 }}>{when}</div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          // `flex: 1 1 160px` matches the left column basis. On wide rows
          // both share the line; on narrow rows the outer flex-wrap
          // pushes this column onto its own line under the left column
          // instead of overlapping it.
          flex: "1 1 160px",
          minWidth: 0,
          justifyContent: "flex-end",
        }}
      >
        {isPending && onResume && (
          <button
            type="button"
            style={{ ...S.primaryBtn, width: "auto", height: 36, padding: "0 14px", fontSize: font.md }}
            onClick={() => onResume(order.orderId.toString())}
          >
            Resume
          </button>
        )}
        {renderRowAction ? renderRowAction(order) : null}
      </div>
    </div>
  );
}

function DisputeBadge({ status }: { status: "open" | "resolved" }) {
  const { bg, fg, label } =
    status === "open"
      ? { bg: color.dangerSoft, fg: color.danger, label: "In support" }
      : { bg: color.successSoft, fg: color.success, label: "Support resolved" };
  return (
    <span style={{
      padding: "2px 8px", borderRadius: radius.pill,
      background: bg, color: fg,
      fontSize: font.xs, fontWeight: weight.semibold,
    }}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: Order["status"] }) {
  const { bg, fg, label } = (() => {
    switch (status) {
      case "placed": return { bg: color.accentSoft, fg: color.accent, label: "Matching" };
      case "accepted": return { bg: color.warningSoft, fg: color.warning, label: "Awaiting payment" };
      case "paid": return { bg: color.accentSoft, fg: color.accent, label: "Verifying" };
      case "completed": return { bg: color.successSoft, fg: color.success, label: "Completed" };
      case "cancelled": return { bg: color.dangerSoft, fg: color.danger, label: "Cancelled" };
    }
  })();
  return (
    <span style={{
      padding: "2px 8px", borderRadius: radius.pill,
      background: bg, color: fg,
      fontSize: font.xs, fontWeight: weight.semibold,
    }}>
      {label}
    </span>
  );
}

function relativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
