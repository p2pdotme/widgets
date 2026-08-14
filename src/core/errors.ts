/**
 * Unified error handling for the widget.
 *
 * Single source of truth for classifying anything thrown inside the order /
 * offramp / fraud-engine flows. Walks the cause chain to identify wallet
 * rejections, on-chain reverts (with selector → name registry), network
 * failures, routing failures, screening API failures, and validation issues —
 * then produces a `P2PError` carrying:
 *   • a stable `code` for branching in host code,
 *   • a `userMessage` safe to render in the UI (jargon-free),
 *   • a `devMessage` plus selector / revert data / cause chain for logs,
 *   • `retryable` so the UI can decide whether to show "Try again".
 *
 * Hosts can extend the revert registry with their integrator's custom errors
 * via `registerRevertSelectors({ "0x...": { name, userMessage, hint } })` so
 * widget-side logs decode them by name instead of "Execution reverted for an
 * unknown reason". See README §"Error handling".
 */

// ─── Public types ─────────────────────────────────────────────────────

export type P2PErrorCategory =
  | "wallet"      // user rejected, insufficient gas, wallet disconnected
  | "revert"      // on-chain revert (decoded or raw)
  | "network"     // RPC / fetch / timeout
  | "routing"     // SDK couldn't pick a merchant
  | "screening"   // fraud-engine API / signing
  | "encryption"  // crypto polyfill / encrypt failure
  | "validation"  // bad input / missing required prop
  | "order"       // order-state mismatch (retry on non-ACCEPTED, etc.)
  | "unknown";

export type P2PErrorCode =
  | "WALLET_USER_REJECTED"
  | "WALLET_INSUFFICIENT_FUNDS"
  | "REVERT_KNOWN"
  | "REVERT_UNKNOWN"
  | "NETWORK_RPC_UNREACHABLE"
  | "NETWORK_TIMEOUT"
  | "ROUTING_NO_MERCHANTS"
  | "ROUTING_MISSING_INPUTS"
  | "SCREENING_API_ERROR"
  | "SCREENING_SIGN_REJECTED"
  | "SCREENING_REJECTED"
  | "SCREENING_LIVENESS_REQUIRED"
  | "ENCRYPTION_FAILED"
  | "ENCRYPTION_PREFLIGHT_FAILED"
  | "ORDER_BAD_STATUS"
  | "ORDER_MISSING_DATA"
  | "INPUT_INVALID"
  | "UNKNOWN";

/** Where the error came from — used to scope log lines and inform retry UX. */
export type P2PErrorFlow =
  | "place-buy"
  | "place-sell"
  | "mark-paid"
  | "cancel"
  | "deliver-upi"
  | "retry-deliver"
  | "credit-fetch"
  | "status-poll"
  | "screening"
  | "liveness";

export interface P2PErrorContext {
  flow?: P2PErrorFlow;
  chainId?: number;
  diamondAddress?: string;
  user?: string;
  orderId?: string;
  currency?: string;
  circleId?: string;
  amountUsdc?: string;
  /** Free-form extra context for log lines (e.g. integrator address). */
  [key: string]: unknown;
}

export interface P2PErrorInput {
  code: P2PErrorCode;
  category: P2PErrorCategory;
  /** Safe to render to end users. No protocol jargon ("circles", selectors). */
  userMessage: string;
  /** Internal message — extra detail for the log + Error.message. Defaults to userMessage. */
  devMessage?: string;
  /**
   * Optional i18n catalog path (e.g. `"checkout.rateLoadFailed"`). When set,
   * widget UI prefers `t(i18nKey)` via `translateError` over code-based maps.
   * `userMessage` remains the English fallback for hosts / logs.
   */
  i18nKey?: string;
  retryable?: boolean;
  context?: P2PErrorContext;
  /** Raw 4-byte selector when category=revert. */
  revertSelector?: string;
  /** Full revert data (0x-prefixed) when available. */
  revertData?: string;
  /** Decoded Solidity name when the selector is registered. */
  revertName?: string;
  /** Free-form actionable hint for the dev log. */
  hint?: string;
  cause?: unknown;
}

/**
 * The single error type the widget surfaces. Subclasses `Error` so existing
 * `onError(err: Error)` hosts keep working unchanged — but typed checks
 * against `err instanceof P2PError` (or `err.code`) unlock the rich shape.
 */
export class P2PError extends Error {
  override readonly name = "P2PError";
  readonly code: P2PErrorCode;
  readonly category: P2PErrorCategory;
  readonly userMessage: string;
  readonly i18nKey?: string;
  readonly retryable: boolean;
  readonly context: P2PErrorContext;
  readonly revertSelector?: string;
  readonly revertData?: string;
  readonly revertName?: string;
  readonly hint?: string;
  // `cause` is in the ES2022 `Error` lib but not all TS lib targets — declare
  // it as a plain readonly to stay compatible without `override`.
  readonly cause?: unknown;

  constructor(input: P2PErrorInput) {
    super(input.devMessage ?? input.userMessage);
    this.code = input.code;
    this.category = input.category;
    this.userMessage = input.userMessage;
    this.i18nKey = input.i18nKey;
    this.retryable = input.retryable ?? true;
    this.context = input.context ?? {};
    this.revertSelector = input.revertSelector;
    this.revertData = input.revertData;
    this.revertName = input.revertName;
    this.hint = input.hint;
    this.cause = input.cause;
  }
}

// ─── Revert selector registry ─────────────────────────────────────────

export interface RevertEntry {
  /** Solidity error name without params, e.g. "B2BProxyAddressMismatch". */
  name: string;
  /** End-user-friendly text. When omitted, classifier falls back to a generic
   *  "<name> reverted on-chain" message. */
  userMessage?: string;
  /** Free-form dev hint (root cause / runbook pointer). Surfaces in the log. */
  hint?: string;
  /** Override retry hint. Defaults to true. */
  retryable?: boolean;
}

// Defaults cover the protocol-level selectors host ABIs rarely include:
// the B2B Gateway custom errors (the post-mortem in
// `docs/lotpot-credit-integrator-revert.md` exists because none of these
// were decoded in the field) + the Diamond order-flow selectors most
// frequently seen by users + a handful of common integrator reverts.
const DEFAULT_REVERT_REGISTRY: Record<string, RevertEntry> = {
  // ── B2B Gateway (contracts-v4/contracts/facets/B2BGatewayFacet.sol) ──
  "0x746c8c18": {
    name: "B2BProxyAddressMismatch",
    userMessage:
      "This payment route is misconfigured. Please contact support — the on-chain integrator address does not match what's registered.",
    hint:
      "Diamond's stored proxyImpl ≠ integrator's deployed proxyImpl (CREATE2 prediction failed). " +
      "See docs/lotpot-credit-integrator-revert.md for the fix.",
    retryable: false,
  },
  "0xee5603c8": {
    name: "B2BIntegratorInactive",
    userMessage:
      "This payment route is currently unavailable. Please try again later — the integrator has been deactivated on-chain.",
    hint:
      "cfg.isActive==false on the Diamond's IntegratorConfig. Re-register with the same proxyImpl to re-activate.",
    retryable: false,
  },
  "0x80d991d1": {
    name: "B2BIntegratorRejectedOrder",
    userMessage:
      "The merchant integrator rejected this order. You may have hit a per-tx, per-user, or daily limit.",
    hint:
      "Integrator.validateOrder returned false. Check the integrator's userTxLimit / dailyTxCountLimit / baseTxLimit.",
  },
  "0xfe375dba": {
    name: "B2BCallerNotContract",
    userMessage:
      "The transaction was sent from an unsupported address. This should never happen during normal checkout — please report it.",
    hint:
      "msg.sender to placeB2BOrder has no contract code. Indicates an EOA tried to bypass the integrator/proxy.",
    retryable: false,
  },
  "0x6edf6388": {
    name: "B2BProxyIntegratorReadFailed",
    userMessage: "On-chain proxy is in a bad state. Please contact support.",
    hint:
      "IUserProxy(proxy).integrator() reverted. Proxy bytecode may be corrupted or not initialised.",
    retryable: false,
  },
  "0x96713800": {
    name: "B2BProxyOwnerReadFailed",
    userMessage: "On-chain proxy is in a bad state. Please contact support.",
    hint: "IUserProxy(proxy).owner() reverted.",
    retryable: false,
  },
  "0x240368e1": {
    name: "B2BProxyOwnerZero",
    userMessage: "On-chain proxy is uninitialised. Please contact support.",
    hint: "Proxy owner returned address(0). Likely a fresh clone that wasn't initialised.",
    retryable: false,
  },
  "0xbf0ec43e": {
    name: "B2BProxyImplLocked",
    userMessage:
      "This integrator was registered with a different proxy template and cannot be updated in place.",
    hint:
      "registerIntegrator was called with a different proxyImpl. Deploy a fresh integrator address; proxyImpl is set-once.",
    retryable: false,
  },

  // ── Diamond order-flow (contracts-v4/contracts/libraries/Errors.sol) ──
  "0x5d04ff4c": {
    name: "NotEnoughEligibleMerchants",
    userMessage:
      "No eligible P2P merchants were found to fulfill this transaction.",
    hint: "Diamond couldn't assign a merchant — check circle eligibility, merchant approvals, and on-chain limits.",
  },
  "0x4bbac5de": {
    name: "ExchangeNotOperational",
    userMessage:
      "The P2P exchange is temporarily disabled. Please try again later.",
    retryable: false,
  },
  "0xebb6f34b": {
    name: "UserIsBlacklisted",
    userMessage:
      "This wallet has been blocked from placing orders. Contact support if you believe this is a mistake.",
    retryable: false,
  },
  "0xd2e1e6e0": {
    name: "ZeroReputationPoints",
    userMessage:
      "Your account doesn't yet have the reputation required to place this order.",
    retryable: false,
  },
  "0xc56873ba": {
    name: "OrderExpired",
    userMessage: "This order has expired. Please start a new one.",
    retryable: false,
  },
  "0xe6c4247b": {
    name: "InvalidAddress",
    userMessage: "An on-chain address was rejected as invalid.",
  },
  "0x2c5211c6": {
    name: "InvalidAmount",
    userMessage: "The order amount was rejected as invalid on-chain.",
  },
  "0x02a6fdd2": {
    name: "CurrencyNotSupported",
    userMessage: "This currency isn't currently supported on-chain.",
    retryable: false,
  },
  "0x149f9fca": {
    name: "UsdtTransferFailed",
    userMessage:
      "USDC transfer failed — please confirm your wallet has the balance + allowance and try again.",
  },
  "0xe595a7bf": {
    name: "DailyBuyOrderLimitExceeded",
    userMessage: "You've hit today's buy-order limit. Try again tomorrow.",
    retryable: false,
  },
  "0x675dbc86": {
    name: "MonthlyBuyOrderLimitExceeded",
    userMessage: "You've hit this month's buy-order limit. Try again next month.",
    retryable: false,
  },
  "0x917c7aef": {
    name: "DailyBuyOrderPlacementLimitExceeded",
    userMessage: "You've placed too many orders today. Please try again later.",
    retryable: false,
  },
  "0x91da284f": {
    name: "BuyOrderAmountExceedsLimit",
    userMessage: "The buy amount exceeds the protocol's per-order limit.",
    retryable: false,
  },
  "0xb407b9ec": {
    name: "SellOrderAmountExceedsLimit",
    userMessage: "The sell amount exceeds the protocol's per-order limit.",
    retryable: false,
  },
  "0x7e2ee654": {
    name: "DailyVolumeLimitExceeded",
    userMessage: "You've hit today's volume limit. Try again tomorrow.",
    retryable: false,
  },
  "0xb14a1ff3": {
    name: "UserYearlyVolumeLimitExceeded",
    userMessage: "You've hit this year's volume limit.",
    retryable: false,
  },
  "0xa6af7ebe": { name: "MerchantNotRegistered" },
  "0x7290a612": { name: "MerchantNotApproved" },
  "0x6764f4d6": { name: "PaymentChannelNotApproved" },
  "0x9ae55bc7": { name: "MerchantBlacklisted" },
  "0x58db8ed6": { name: "OrderNotPlaced" },
  "0x6b1b90b4": { name: "OrderNotAccepted" },
  "0x181b1b2e": { name: "OrderStatusInvalid" },
  "0x03683687": { name: "OrderAlreadyCompleted" },
  "0x7f61b868": { name: "OrderAlreadyPaid" },
  "0xc1654697": {
    name: "UpiAlreadySent",
    userMessage: "Payment details were already submitted for this order.",
    retryable: false,
  },
  "0xaa60ec26": {
    name: "InvalidOrderUpi",
    userMessage: "Your payment address could not be accepted by the protocol.",
  },

  // ── Common integrator reverts (p2p-checkout/contracts/*) ──────────────
  // LotPot / V2 / Marketplace share short, generic Solidity names. Hosts that
  // need richer wording can override these.
  "0x06b3b5a7": { name: "OnlyDiamond", hint: "Only the P2P Diamond can call this integrator entry." },
  "0xfcacca5e": { name: "OnlyOwner" },
  "0xeed1c4ef": { name: "OrderAlreadyFulfilled", retryable: false },
  "0x0f8d4a4f": {
    name: "OrderAlreadyCancelled",
    userMessage: "This order was already cancelled.",
    retryable: false,
  },
};

const revertRegistry: Map<string, RevertEntry> = new Map(
  Object.entries(DEFAULT_REVERT_REGISTRY).map(([k, v]) => [k.toLowerCase(), v]),
);

/**
 * Register additional revert selectors so the widget can decode them by name
 * in logs and surface friendly messages in the UI. Call once at host app
 * startup; selectors persist for the lifetime of the page.
 *
 * Selectors are 0x-prefixed 4-byte hex strings (the first 4 bytes of
 * `keccak256("Error(args)")`). The widget compares case-insensitively.
 *
 * Example — append your integrator's custom errors:
 *
 *   registerRevertSelectors({
 *     "0xabcd1234": { name: "MyCustomError", userMessage: "..." },
 *   });
 */
export function registerRevertSelectors(
  entries: Record<string, RevertEntry>,
): void {
  for (const [selector, entry] of Object.entries(entries)) {
    revertRegistry.set(selector.toLowerCase(), entry);
  }
}

/** Read-only lookup, exposed for hosts that want to consult the registry. */
export function lookupRevertSelector(selector: string): RevertEntry | undefined {
  return revertRegistry.get(selector.toLowerCase());
}

// ─── Internal helpers ─────────────────────────────────────────────────

const MAX_CAUSE_DEPTH = 8;

function walkCauseChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let cur: any = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && cur != null; i++) {
    chain.push(cur);
    cur = cur.cause;
  }
  return chain;
}

function extractRevertData(err: unknown): string | undefined {
  for (const node of walkCauseChain(err)) {
    const n = node as any;
    // viem ContractFunctionRevertedError exposes .raw; JSON-RPC errors expose .data.
    const candidates = [n?.raw, n?.data, n?.cause?.data, n?.error?.data];
    for (const c of candidates) {
      if (typeof c === "string" && c.startsWith("0x") && c.length >= 10) return c;
    }
  }
  return undefined;
}

function isUserRejection(err: unknown): boolean {
  for (const node of walkCauseChain(err)) {
    const n = node as any;
    if (n?.name === "UserRejectedRequestError") return true;
    // EIP-1193 user-rejected code
    if (n?.code === 4001 || n?.code === "ACTION_REJECTED") return true;
    const msg = `${n?.shortMessage ?? ""} ${n?.message ?? ""}`;
    if (/user (?:rejected|denied)|user_?rejected|transaction was rejected|request.+rejected/i.test(msg)) {
      return true;
    }
  }
  return false;
}

function isInsufficientFunds(err: unknown): boolean {
  for (const node of walkCauseChain(err)) {
    const n = node as any;
    const msg = `${n?.shortMessage ?? ""} ${n?.message ?? ""}`;
    if (/insufficient funds|exceeds balance|insufficient balance/i.test(msg)) {
      return true;
    }
  }
  return false;
}

function isNetworkError(err: unknown): { kind: "rpc" | "timeout" } | null {
  for (const node of walkCauseChain(err)) {
    const n = node as any;
    const name = n?.name ?? "";
    if (name === "TimeoutError" || name === "WaitForTransactionReceiptTimeoutError") {
      return { kind: "timeout" };
    }
    if (name === "HttpRequestError" || name === "InternalRpcError") {
      return { kind: "rpc" };
    }
    const msg = `${n?.shortMessage ?? ""} ${n?.message ?? ""}`;
    if (/failed to fetch|fetch failed|network ?(error|request failed)|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
      return { kind: "rpc" };
    }
    if (/timeout|timed out/i.test(msg)) return { kind: "timeout" };
  }
  return null;
}

function getShortMessage(err: unknown): string {
  const e = err as any;
  return (
    e?.shortMessage ??
    e?.userMessage ??
    e?.message ??
    (typeof e === "string" ? e : "Unknown error")
  );
}

// ─── Classifier ───────────────────────────────────────────────────────

/**
 * Inspect any thrown value and produce a `P2PError` describing it. Idempotent:
 * passing a `P2PError` back through layers in the call stack returns the same
 * instance (with context merged) instead of double-wrapping. That lets inner
 * helpers throw `new P2PError(...)` with rich context, and outer catches just
 * call `classifyError(err, ctx)` without losing the inner classification.
 */
export function classifyError(err: unknown, ctx: P2PErrorContext = {}): P2PError {
  // Pass-through: preserve inner classification, only enrich context.
  if (err instanceof P2PError) {
    if (Object.keys(ctx).length === 0) return err;
    return new P2PError({
      code: err.code,
      category: err.category,
      userMessage: err.userMessage,
      i18nKey: err.i18nKey,
      devMessage: err.message,
      retryable: err.retryable,
      context: { ...err.context, ...ctx },
      revertSelector: err.revertSelector,
      revertData: err.revertData,
      revertName: err.revertName,
      hint: err.hint,
      cause: err.cause ?? err,
    });
  }

  const short = getShortMessage(err);

  // 1) Wallet — user rejected the prompt
  if (isUserRejection(err)) {
    return new P2PError({
      code: "WALLET_USER_REJECTED",
      category: "wallet",
      userMessage: "Transaction was rejected in your wallet. Approve it to continue.",
      devMessage: short,
      retryable: true,
      context: ctx,
      cause: err,
    });
  }

  // 2) Wallet — insufficient funds for gas / value
  if (isInsufficientFunds(err)) {
    return new P2PError({
      code: "WALLET_INSUFFICIENT_FUNDS",
      category: "wallet",
      userMessage:
        "Your wallet doesn't have enough funds for this transaction (including gas).",
      devMessage: short,
      retryable: true,
      context: ctx,
      cause: err,
    });
  }

  // 3) Revert — extract selector + map to friendly name when known
  const revertData = extractRevertData(err);
  if (revertData) {
    const selector = revertData.slice(0, 10).toLowerCase();
    const entry = revertRegistry.get(selector);
    if (entry) {
      return new P2PError({
        code: "REVERT_KNOWN",
        category: "revert",
        userMessage:
          entry.userMessage ??
          `The transaction reverted on-chain (${entry.name}).`,
        devMessage: `${entry.name}() — ${short}`,
        retryable: entry.retryable ?? true,
        context: ctx,
        revertSelector: selector,
        revertData,
        revertName: entry.name,
        hint: entry.hint,
        cause: err,
      });
    }
    return new P2PError({
      code: "REVERT_UNKNOWN",
      category: "revert",
      userMessage:
        "The transaction reverted on-chain for an unrecognized reason. Please try again or contact support.",
      devMessage: `Unknown revert selector ${selector} — ${short}`,
      retryable: true,
      context: ctx,
      revertSelector: selector,
      revertData,
      hint:
        `Decode with \`cast 4byte ${selector}\` or https://openchain.xyz/signatures?function=${selector}. ` +
        `Then call \`registerRevertSelectors({ "${selector}": { name, userMessage } })\` to add it to the registry.`,
      cause: err,
    });
  }

  // 4) Network — RPC unreachable / timeout
  const network = isNetworkError(err);
  if (network) {
    return new P2PError({
      code: network.kind === "timeout" ? "NETWORK_TIMEOUT" : "NETWORK_RPC_UNREACHABLE",
      category: "network",
      userMessage:
        network.kind === "timeout"
          ? "The network is slow to respond. Please try again in a moment."
          : "Couldn't reach the network. Check your connection and try again.",
      devMessage: short,
      retryable: true,
      context: ctx,
      cause: err,
    });
  }

  // 5) Default — preserve the raw message but classify as unknown
  return new P2PError({
    code: "UNKNOWN",
    category: "unknown",
    userMessage: short || "Something went wrong. Please try again.",
    devMessage: short,
    retryable: true,
    context: ctx,
    cause: err,
  });
}

// ─── Logger ───────────────────────────────────────────────────────────

const LOG_NAMESPACE = "[p2p-widget]";

/** Single structured log emitter. Replaces the per-flow logger in
 *  `place-error.ts`. Always logs at `console.error` so it shows up in
 *  Sentry / DataDog without extra wiring. */
export function logP2PError(err: P2PError): void {
  const flow = err.context.flow ?? "unknown";
  // eslint-disable-next-line no-console
  console.error(`${LOG_NAMESPACE}:${flow} ${err.code}`, {
    code: err.code,
    category: err.category,
    userMessage: err.userMessage,
    devMessage: err.message,
    retryable: err.retryable,
    revertName: err.revertName,
    revertSelector: err.revertSelector,
    revertData: err.revertData,
    selectorLookup: err.revertSelector
      ? `https://openchain.xyz/signatures?function=${err.revertSelector}`
      : undefined,
    hint: err.hint,
    context: err.context,
    cause: err.cause,
  });
}

/** Convenience: classify + log + return. The shape every catch site wants. */
export function toP2PError(err: unknown, ctx: P2PErrorContext = {}): P2PError {
  const p2p = classifyError(err, ctx);
  logP2PError(p2p);
  return p2p;
}

// ─── Pre-built constructors for the validation/routing/screening paths ──
// These are sites where the widget itself throws (not wrapping a caller's
// error). Using the constructors here keeps the messages consistent and
// classifies them correctly the first time, so the outer catch's
// `classifyError` is a no-op pass-through.

export function noEligibleMerchantsError(
  ctx: P2PErrorContext,
  cause?: unknown,
): P2PError {
  return new P2PError({
    code: "ROUTING_NO_MERCHANTS",
    category: "routing",
    userMessage: "No eligible P2P merchants were found to fulfill this transaction.",
    devMessage:
      "SDK placeOrder.prepare returned an Err / no circleId — see cause for the SDK error.",
    retryable: false,
    context: ctx,
    cause,
  });
}

export function missingRoutingInputsError(
  message: string,
  ctx: P2PErrorContext,
): P2PError {
  return new P2PError({
    code: "ROUTING_MISSING_INPUTS",
    category: "validation",
    userMessage:
      "This widget is missing required setup to find a merchant. Please contact the site owner.",
    devMessage: message,
    retryable: false,
    context: ctx,
  });
}

export function encryptionPreflightError(reason: string, ctx: P2PErrorContext): P2PError {
  return new P2PError({
    code: "ENCRYPTION_PREFLIGHT_FAILED",
    category: "encryption",
    userMessage:
      "Couldn't initialize secure messaging. Reload the page — if it keeps failing, contact support.",
    devMessage: `Encryption stack not ready: ${reason}. Bundler may be missing crypto polyfills.`,
    retryable: true,
    context: ctx,
  });
}

export function encryptionFailedError(reason: string, ctx: P2PErrorContext): P2PError {
  return new P2PError({
    code: "ENCRYPTION_FAILED",
    category: "encryption",
    userMessage:
      "Couldn't encrypt your payment details. Try again — if it persists, contact support.",
    devMessage: `Encrypt failed: ${reason}`,
    retryable: true,
    context: ctx,
  });
}

export function orderBadStatusError(
  message: string,
  ctx: P2PErrorContext,
): P2PError {
  return new P2PError({
    code: "ORDER_BAD_STATUS",
    category: "order",
    userMessage:
      "This order has moved on and can't be retried from here. Refresh to see its current state.",
    devMessage: message,
    retryable: false,
    context: ctx,
  });
}

export function screeningApiError(
  status: number,
  endpoint: string,
  ctx: P2PErrorContext,
): P2PError {
  return new P2PError({
    code: "SCREENING_API_ERROR",
    category: "screening",
    userMessage:
      "Fraud screening is temporarily unavailable. Your order can still proceed.",
    devMessage: `${endpoint} returned ${status}`,
    retryable: true,
    context: ctx,
  });
}

/**
 * Backend explicitly rejected the order at the screening gate
 * (`approved=false`). Distinct from `screeningApiError`, which is a
 * fail-open transport-level failure. Carries `reason` so the host can
 * render a tailored message; `restrictedUntil` is set when
 * `reason==='user_restricted'`.
 */
export function screeningRejectedError(
  res: {
    reason?: string | null;
    message?: string | null;
    restricted_until?: string | null;
  },
  ctx: P2PErrorContext,
): P2PError {
  const reason = res.reason ?? "unknown";
  const restrictedUntil = res.restricted_until ?? undefined;

  let userMessage: string;
  if (reason === "user_restricted") {
    userMessage = "We saw unusual activity - pls wait for sometime as a minor update";
  } else if (reason === "cluster_blacklisted") {
    userMessage =
      "This order cannot be processed. Please contact support if you believe this is in error.";
  } else {
    userMessage =
      res.message ||
      "This order cannot be processed. Please contact support if you believe this is in error.";
  }

  return new P2PError({
    code: "SCREENING_REJECTED",
    category: "screening",
    userMessage,
    devMessage: `Screening rejected (reason=${reason})`,
    retryable: false,
    context: { ...ctx, screeningReason: reason, restrictedUntil },
  });
}

/**
 * Screening determined this buyer must pass a one-time liveness
 * (proof-of-personhood) check before the order can proceed. Not a
 * rejection: the caller should surface the liveness step and retry the
 * order once the user is verified.
 */
export function livenessRequiredError(
  res: { message?: string | null },
  ctx: P2PErrorContext,
): P2PError {
  return new P2PError({
    code: "SCREENING_LIVENESS_REQUIRED",
    category: "screening",
    userMessage:
      res.message || "Quick human check required before you can continue.",
    devMessage: "Screening requires liveness verification",
    retryable: true,
    context: { ...ctx, screeningReason: "liveliness_required" },
  });
}

