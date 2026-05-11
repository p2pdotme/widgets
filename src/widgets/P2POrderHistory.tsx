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
import type { CheckoutSigner } from "../types";

export interface P2POrderHistoryProps {
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
   * (placed/accepted/paid). The host should open `P2PCheckout` with this
   * orderId; the checkout widget polls chain state and lands on the right
   * screen automatically.
   */
  onResume?: (orderId: string) => void;
  /** Optional title override. */
  title?: string;
  /**
   * Which orders to render. "pending" shows only placed/accepted/paid;
   * "all" shows everything. Default: "all".
   */
  filter?: "pending" | "all";
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
   * Bump this value to force an immediate refetch. Useful after a P2PCheckout
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

export function P2POrderHistory(props: P2POrderHistoryProps) {
  const {
    signer, subgraphUrl, usdcAddress,
    chainId = 84532, diamondAddress = DEFAULT_DIAMOND_ADDRESS, rpcUrl,
    limit = 20, onResume,
    filter = "all",
    refreshKey,
    optimisticUpdates,
    pollIntervalMs = 15_000,
    theme,
  } = props;
  const themeStyle = themeToCssVars(theme);
  const hideWhenEmpty = props.hideWhenEmpty ?? filter === "pending";
  const title = props.title ?? (filter === "pending" ? "Pending orders" : "Order history");

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
  const past = filter === "pending" ? [] : allOrders.filter((o) => !PENDING_STATUSES.includes(o.status));

  // Auto-poll while there's at least one non-terminal order. Catches state
  // changes that happen outside this widget (e.g., merchant just accepted)
  // and keeps the post-completion view fresh as the subgraph catches up.
  const hasPendingForPoll = pending.length > 0;
  useEffect(() => {
    if (!hasPendingForPoll || pollIntervalMs <= 0) return;
    const id = setInterval(fetchOrders, pollIntervalMs);
    return () => clearInterval(id);
  }, [hasPendingForPoll, pollIntervalMs, fetchOrders]);
  const visibleCount = filter === "pending" ? pending.length : allOrders.length;
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
              <OrderRow key={o.orderId.toString()} order={o} onResume={onResume} highlight config={currencyConfigs[o.currency]} />
            ))}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          {pending.length > 0 && <p style={{ ...S.label, marginBottom: 8 }}>Past</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {past.map((o) => (
              <OrderRow key={o.orderId.toString()} order={o} onResume={onResume} config={currencyConfigs[o.currency]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onResume, highlight, config }: {
  order: Order;
  onResume?: (orderId: string) => void;
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
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <StatusBadge status={order.status} />
          <span style={{ ...S.faint, ...S.mono }}>#{order.orderId.toString()}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: font.base, fontWeight: weight.semibold, ...S.num }}>{order.currency} {fiat}</span>
          <span style={{ ...S.faint, ...S.num }}>· {usdc} USDC</span>
        </div>
        <div style={{ ...S.faint, marginTop: 2 }}>{when}</div>
      </div>
      {isPending && onResume && (
        <button
          type="button"
          style={{ ...S.primaryBtn, width: "auto", height: 36, padding: "0 14px", fontSize: font.md }}
          onClick={() => onResume(order.orderId.toString())}
        >
          Resume
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Order["status"] }) {
  const { bg, fg, label } = (() => {
    switch (status) {
      case "placed": return { bg: color.accentSoft, fg: color.accent, label: "Finding merchant" };
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
