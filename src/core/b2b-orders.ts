// src/core/b2b-orders.ts
//
// Shared B2B-order identification against the P2P subgraph. A "B2B order" is
// one placed through a whitelisted integrator gateway, as opposed to a retail
// peer-to-peer order placed directly against the Diamond. The subgraph records
// these as a separate `B2BOrder` entity joined to the owning integrator; the
// collection field is generated as `b2Borders` (graph-node lowercases only the
// first char of `B2BOrder`, then pluralises).
//
// Two consumers:
//   • <PaymentHistory b2bOnly> intersects the canonical order list with the
//     user's B2B set so only genuine B2B rows render.
//   • the checkout concurrency gate (order-machine) narrows the host's
//     pending-order list to B2B orders before deciding whether to block a new
//     placement — so legacy retail orders (including ones stuck "pending"
//     forever from before auto-cancellation existed) never gate.

export interface B2BOrderMeta {
  /** Owning integrator contract address, lowercased. */
  integrator: string;
  /** False when the integrator has been deactivated (an "old" integrator). */
  integratorActive: boolean;
}

// `integrator { id }` is the integrator contract address.
const B2B_ORDERS_BY_USER_QUERY = `
  query B2BOrdersByUser($user: Bytes!, $first: Int!) {
    b2Borders(
      where: { user: $user }
      orderBy: blockTimestamp
      orderDirection: desc
      first: $first
    ) {
      orderId
      integrator { id isActive }
    }
  }
`;

/**
 * Fetch the connected user's B2B orders from the subgraph, returning an
 * orderId→integrator map. Runs against `subgraphUrl` directly (the SDK's order
 * query doesn't expose the B2B join). Capped at the subgraph's 1000-row page;
 * per-user B2B order counts are well within that.
 *
 * Throws on transport / GraphQL errors — callers that must stay resilient
 * (e.g. the checkout gate via `keepOnlyB2BPending`) should catch and degrade.
 */
export async function fetchB2BMap(
  subgraphUrl: string,
  user: string,
): Promise<Map<string, B2BOrderMeta>> {
  const res = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: B2B_ORDERS_BY_USER_QUERY,
      variables: { user: user.toLowerCase(), first: 1000 },
    }),
  });
  if (!res.ok) throw new Error(`B2B subgraph query failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "B2B subgraph error");
  const rows: Array<{ orderId: string; integrator: { id: string; isActive: boolean } }> =
    json.data?.b2Borders ?? [];
  const map = new Map<string, B2BOrderMeta>();
  for (const r of rows) {
    if (!r.integrator) continue;
    map.set(String(r.orderId), {
      integrator: r.integrator.id.toLowerCase(),
      integratorActive: r.integrator.isActive,
    });
  }
  return map;
}

/**
 * Pure: keep only the pending orders whose id is a known B2B order.
 *
 * `b2bOrderIds === null` means B2B-ness couldn't be determined (no subgraph
 * URL configured, or the lookup failed). In that case the list passes through
 * unchanged so behaviour matches the pre-B2B-filter widget, rather than
 * silently dropping every order.
 */
export function filterPendingToB2B<T extends { orderId: string }>(
  pending: readonly T[],
  b2bOrderIds: ReadonlySet<string> | null,
): T[] {
  if (b2bOrderIds === null) return pending.slice();
  return pending.filter((p) => b2bOrderIds.has(p.orderId));
}

/**
 * Network + filter, resilient. Narrows `pending` to B2B orders only.
 *
 * Returns the list unchanged when there's nothing to filter, no `subgraphUrl`
 * is configured, or the subgraph lookup fails. Failing toward the widget's
 * prior behaviour (rather than dropping everything) keeps the pending-order
 * concurrency gate intact during a transient subgraph blip — the host's
 * `fetchPendingOrders` reads the same subgraph, so a full outage already
 * yields an empty pending list upstream.
 */
export async function keepOnlyB2BPending<T extends { orderId: string }>(
  pending: readonly T[],
  subgraphUrl: string | undefined,
  user: string,
): Promise<T[]> {
  if (pending.length === 0 || !subgraphUrl) return pending.slice();
  try {
    const map = await fetchB2BMap(subgraphUrl, user);
    return filterPendingToB2B(pending, new Set(map.keys()));
  } catch {
    return pending.slice();
  }
}
