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
import { fetchB2BMap, type B2BOrderMeta } from "../core/b2b-orders";
import type { CheckoutSigner } from "../types";
import { I18nProvider, useI18n, useT, type Translator } from "../i18n";

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
  /**
   * Restrict the list to B2B orders only (orders placed through a B2B
   * integrator gateway). Implied when `integrators` is non-empty.
   *
   * B2B orders are identified by a companion `b2Borders` subgraph query
   * keyed on the connected user — the canonical order list is intersected
   * with that set, so a row shows only when it's a genuine B2B order.
   *
   * NOTE: the SDK fetches the most-recent `limit` orders (B2B + retail) and
   * the intersection happens client-side, so a user with more than `limit`
   * total orders may not see older B2B orders. Raise `limit` for B2B-heavy
   * histories.
   */
  b2bOnly?: boolean;
  /**
   * Allow-list of integrator contract addresses (case-insensitive). When
   * non-empty, only B2B orders placed through one of these integrators are
   * shown (and B2B-only mode is implied). Omit or pass `[]` to show the
   * user's B2B orders across every integrator, including deactivated ones.
   */
  integrators?: string[];
  /**
   * Optional address → display-name map for labeling integrators. Used for
   * the per-row integrator tag (shown only when the visible list spans more
   * than one integrator). Unmapped integrators fall back to a shortened
   * address. Lookup is case-insensitive.
   */
  integratorNames?: Record<string, string>;
  /**
   * Optional — extra addresses to merge into this user's history. For
   * integrators that place orders under a per-user proxy (e.g. TradeStars
   * offramp v2, where `order.user` is the user's proxy), resolve the proxy
   * address(es) here so those orders show alongside the EOA's. Results are
   * merged, de-duped by orderId, and re-sorted newest-first; extra-address
   * orders bypass the b2b intersection (they're keyed on the proxy, not the EOA).
   */
  resolveExtraAddresses?: (user: `0x${string}`) => Promise<`0x${string}`[]>;
  /** Optional theming overrides. See `P2PTheme` for the surface. */
  theme?: P2PTheme;
  /**
   * UI locale (`en` | `es` | `pt-BR`). When omitted, derived from
   * `navigator.language` with English as the fallback.
   */
  locale?: string;
}

const PENDING_STATUSES: ReadonlyArray<Order["status"]> = ["placed", "accepted", "paid"];

export function PaymentHistory(props: PaymentHistoryProps) {
  return (
    <I18nProvider locale={props.locale}>
      <PaymentHistoryInner {...props} />
    </I18nProvider>
  );
}

function PaymentHistoryInner(props: PaymentHistoryProps) {
  const {
    signer, subgraphUrl, usdcAddress,
    chainId = 84532, diamondAddress = DEFAULT_DIAMOND_ADDRESS, rpcUrl,
    limit = 20, onResume, renderRowAction, renderRowBadge,
    filter = "all",
    refreshKey,
    optimisticUpdates,
    pollIntervalMs = 15_000,
    b2bOnly,
    integrators,
    integratorNames,
    resolveExtraAddresses,
    theme,
  } = props;
  const t = useT();
  const { localeTag } = useI18n();
  const themeStyle = themeToCssVars(theme);

  // Stable, lowercased key for the integrator allow-list so prop identity
  // churn (a fresh array literal each render) doesn't retrigger effects.
  const integratorsKey = (integrators ?? [])
    .map((a) => a.toLowerCase())
    .sort()
    .join(",");
  // B2B mode is on when explicitly requested or when an allow-list is given.
  const b2bMode = b2bOnly === true || integratorsKey.length > 0;
  const integratorFilter = useMemo(
    () => (integratorsKey ? new Set(integratorsKey.split(",")) : null),
    [integratorsKey],
  );
  const hideWhenEmpty =
    props.hideWhenEmpty ?? (filter === "pending" || filter === "actionable");
  const title =
    props.title ??
    (filter === "pending" || filter === "actionable"
      ? t("history.pendingOrders")
      : t("history.orderHistory"));

  useEffect(injectKeyframes, []);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // orderId (decimal string) → owning integrator, populated only in B2B mode.
  const [b2bMap, setB2bMap] = useState<Map<string, B2BOrderMeta> | null>(null);
  // orderIds sourced from an extra (proxy) address via `resolveExtraAddresses`;
  // these bypass the b2b intersection since they're keyed on the proxy.
  const [extraOrderIds, setExtraOrderIds] = useState<Set<string>>(new Set());
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
      // Fetch the canonical order list and (in B2B mode) the user's B2B
      // order→integrator map together so they land in the same render and
      // the list never flickers through a "no orders" frame.
      const extraAddrs = resolveExtraAddresses
        ? await resolveExtraAddresses(signer.address)
        : [];
      const [result, b2b, ...extra] = await Promise.all([
        client.getOrders({ userAddress: signer.address, skip: 0, limit }),
        b2bMode ? fetchB2BMap(subgraphUrl, signer.address) : Promise.resolve(null),
        ...extraAddrs.map((a) => client.getOrders({ userAddress: a, skip: 0, limit })),
      ]);
      if (result.isErr()) throw result.error;
      // Merge the EOA's orders with any extra-address (e.g. per-user proxy)
      // orders, de-duping by orderId and re-sorting newest-first.
      const merged = [...result.value];
      const seen = new Set(merged.map((o) => o.orderId.toString()));
      const extraIds = new Set<string>();
      for (const r of extra) {
        if (r.isErr()) continue;
        for (const o of r.value) {
          const id = o.orderId.toString();
          if (seen.has(id)) continue;
          seen.add(id);
          extraIds.add(id);
          merged.push(o);
        }
      }
      merged.sort((a, b) => Number(b.placedAt - a.placedAt));
      setOrders(merged);
      setExtraOrderIds(extraIds);
      setB2bMap(b2b);
    } catch (err: any) {
      setError(err?.message ?? t("history.fetchFailed"));
    } finally {
      setLoading(false);
    }
  }, [signer?.address, subgraphUrl, usdcAddress, chainId, diamondAddress, rpcUrl, limit, b2bMode, resolveExtraAddresses, t]);

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

  // B2B filtering: keep only orders present in the B2B map (genuine B2B
  // orders), and — when an allow-list is set — only those whose owning
  // integrator is on it. In non-B2B mode this is a no-op pass-through.
  const allOrders = b2bMode
    ? overlaidOrders.filter((o) => {
        // Extra-address (per-user proxy) orders are keyed on the proxy, not the
        // EOA's b2Borders set, so the intersection would drop them — keep them.
        if (extraOrderIds.has(o.orderId.toString())) return true;
        const meta = b2bMap?.get(o.orderId.toString());
        if (!meta) return false;
        if (integratorFilter && !integratorFilter.has(meta.integrator)) return false;
        return true;
      })
    : overlaidOrders;

  // Tag rows with their integrator only when the visible list spans more
  // than one — for a single-integrator list the heading already implies it.
  const showIntegratorTag =
    b2bMode &&
    !!b2bMap &&
    new Set(
      allOrders
        .map((o) => b2bMap.get(o.orderId.toString())?.integrator)
        .filter((x): x is string => !!x),
    ).size > 1;
  const integratorLabelFor = (o: Order): string | undefined => {
    if (!showIntegratorTag || !b2bMap) return undefined;
    const meta = b2bMap.get(o.orderId.toString());
    return meta ? resolveIntegratorLabel(meta.integrator, integratorNames) : undefined;
  };

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
          {loading ? t("history.refreshing") : t("history.refresh")}
        </button>
      </div>

      {loading && !orders && (
        <CenterStatus icon={<Spinner />} title={t("history.loadingTitle")} subtitle={t("history.loadingSubtitle")} />
      )}

      {error && (
        <div style={{ padding: 12, background: color.dangerSoft, borderRadius: radius.md, color: color.danger, fontSize: font.md, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {hasNothingToShow && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <p style={S.muted}>{filter === "pending" ? t("history.noPending") : t("history.noOrders")}</p>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: past.length > 0 ? 20 : 0 }}>
          {past.length > 0 && <p style={{ ...S.label, marginBottom: 8 }}>{t("history.pending")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((o) => (
              <OrderRow key={o.orderId.toString()} order={o} onResume={onResume} renderRowAction={renderRowAction} renderRowBadge={renderRowBadge} highlight config={currencyConfigs[o.currency]} integratorLabel={integratorLabelFor(o)} localeTag={localeTag} />
            ))}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          {pending.length > 0 && <p style={{ ...S.label, marginBottom: 8 }}>{t("history.past")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {past.map((o) => (
              <OrderRow key={o.orderId.toString()} order={o} onResume={onResume} renderRowAction={renderRowAction} renderRowBadge={renderRowBadge} config={currencyConfigs[o.currency]} integratorLabel={integratorLabelFor(o)} localeTag={localeTag} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onResume, renderRowAction, renderRowBadge, highlight, config, integratorLabel, localeTag }: {
  order: Order;
  onResume?: (orderId: string) => void;
  renderRowAction?: (order: Order) => React.ReactNode;
  renderRowBadge?: (order: Order) => React.ReactNode;
  highlight?: boolean;
  config?: { buyPrice: bigint; smallOrderThreshold: bigint; smallOrderFixedFee: bigint };
  integratorLabel?: string;
  localeTag: string;
}) {
  const t = useT();
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
  const when = ts > 0 ? relativeTime(ts, t, localeTag) : "—";

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
          {integratorLabel ? (
            <span style={{
              padding: "2px 8px", borderRadius: radius.pill,
              background: color.surfaceAlt, color: color.textMuted,
              fontSize: font.xs, fontWeight: weight.medium,
              maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {integratorLabel}
            </span>
          ) : null}
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
            {t("history.resume")}
          </button>
        )}
        {renderRowAction ? renderRowAction(order) : null}
      </div>
    </div>
  );
}

function DisputeBadge({ status }: { status: "open" | "resolved" }) {
  const t = useT();
  const { bg, fg, label } =
    status === "open"
      ? { bg: color.dangerSoft, fg: color.danger, label: t("history.disputeInSupport") }
      : { bg: color.successSoft, fg: color.success, label: t("history.disputeResolved") };
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
  const t = useT();
  const { bg, fg, label } = (() => {
    switch (status) {
      case "placed": return { bg: color.accentSoft, fg: color.accent, label: t("history.statusMatching") };
      case "accepted": return { bg: color.warningSoft, fg: color.warning, label: t("history.statusAwaitingPayment") };
      case "paid": return { bg: color.accentSoft, fg: color.accent, label: t("history.statusVerifying") };
      case "completed": return { bg: color.successSoft, fg: color.success, label: t("history.statusCompleted") };
      case "cancelled": return { bg: color.dangerSoft, fg: color.danger, label: t("history.statusCancelled") };
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

// ─── B2B integrator labels ───────────────────────────────────────────
// `B2BOrderMeta` + `fetchB2BMap` (the `b2Borders` subgraph lookup) live in
// `../core/b2b-orders` so the checkout concurrency gate can reuse them.

function shortenAddress(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Resolve a display label for an integrator address (case-insensitive map). */
function resolveIntegratorLabel(
  address: string,
  names?: Record<string, string>,
): string {
  if (names) {
    for (const [k, v] of Object.entries(names)) {
      if (k.toLowerCase() === address) return v;
    }
  }
  return shortenAddress(address);
}

function relativeTime(ts: number, t: Translator, localeTag: string): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return t("history.justNow");
  if (diffSec < 3600) return t("history.minutesAgo", { n: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("history.hoursAgo", { n: Math.floor(diffSec / 3600) });
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return t("history.daysAgo", { n: days });
  return new Date(ts).toLocaleDateString(localeTag);
}
