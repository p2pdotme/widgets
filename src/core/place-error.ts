/**
 * Diagnostic logger for `placeOrder` / `placeOfframp` callback failures.
 *
 * Why this exists: those callbacks submit on-chain txs against an integrator
 * the widget doesn't know about (no integrator ABI is bundled). When the
 * integrator reverts with a custom error not in the host's ABI fragment —
 * e.g. B2B gateway errors like `B2BProxyAddressMismatch()` — viem can't
 * decode it and the wallet surfaces "Execution reverted for an unknown
 * reason". The 4-byte selector is then invisible unless the host added
 * explicit logging.
 *
 * This helper walks the error's `cause` chain to pull out the raw revert
 * data + selector, and console.errors a single structured object with the
 * attempted-placement context. Decode the selector with `cast 4byte
 * 0x<selector>` or https://openchain.xyz/signatures. See
 * `docs/lotpot-credit-integrator-revert.md` for the post-mortem this was
 * added to short-circuit.
 */

const MAX_CAUSE_DEPTH = 6;

function walkCauseChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let cur: any = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && cur; i++) {
    chain.push(cur);
    cur = cur.cause;
  }
  return chain;
}

function extractRevertData(err: unknown): string | undefined {
  for (const node of walkCauseChain(err)) {
    const n = node as any;
    // viem ContractFunctionRevertedError exposes .raw; RpcRequestError /
    // generic JSON-RPC errors expose .data. Walk a few likely fields.
    const candidates = [n?.raw, n?.data, n?.cause?.data];
    for (const c of candidates) {
      if (typeof c === "string" && c.startsWith("0x") && c.length >= 10) return c;
    }
  }
  return undefined;
}

export interface PlacementErrorContext {
  flow: "buy" | "sell";
  chainId?: number;
  user?: string;
  diamondAddress?: string;
  currency?: string;
  circleId?: string;
  amountUsdc?: string;
}

export function logPlacementError(err: unknown, ctx: PlacementErrorContext): void {
  const e = err as any;
  const revertData = extractRevertData(err);
  const selector = revertData ? revertData.slice(0, 10) : undefined;
  // eslint-disable-next-line no-console
  console.error(`[p2p-widget:place:${ctx.flow}] placement failed`, {
    name: e?.name,
    shortMessage: e?.shortMessage,
    details: e?.details,
    metaMessages: e?.metaMessages,
    revertData,
    selector,
    selectorLookup: selector
      ? `https://openchain.xyz/signatures?function=${selector}`
      : undefined,
    context: ctx,
    hint: selector
      ? `Decode: \`cast 4byte ${selector}\`. Common B2B gateway custom errors: ` +
        `B2BProxyAddressMismatch, B2BIntegratorInactive, B2BIntegratorRejectedOrder, ` +
        `B2BCallerNotContract, B2BProxyImplLocked.`
      : "No revert data on the error chain — likely a wallet/network error before the tx hit the chain.",
  });
}
