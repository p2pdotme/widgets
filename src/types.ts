import type { P2PTheme } from "./ui/theme";
export type { P2PTheme } from "./ui/theme";

export interface CheckoutSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
  // EIP-191 personal_sign. Required when `screening` is configured on
  // the widget so we can authenticate to the fraud engine. For plain
  // EOAs this is the same wallet that produces sendTransaction.
  signMessage?: (message: string) => Promise<string>;
  // Smart-wallet admin EOA — the address that actually produces the
  // EIP-191 signature when `address` is an ERC-4337 smart account.
  // Omit for plain EOAs; defaults to `address`.
  signerAddress?: `0x${string}`;
}

export interface ScreeningOrderDetails {
  cryptoAmount?: number;
  fiatAmount?: number;
  currency?: string;
  recipientAddress?: string;
  fee?: number;
  amountAfterFee?: number;
  paymentMethod?: string;
  estimatedProcessingTime?: string;
}

export interface ScreeningUserDetails {
  currency?: string;
  country?: string;
  language?: string;
  loginMethod?: "email" | "google" | "phone" | "passkey" | "unknown";
  loginEmail?: string;
  loginPhone?: string;
}

export interface ScreeningConfig {
  // Fraud-engine base URL including the /v1 prefix, e.g.
  // "https://fraud-engine.p2p.me/v1".
  apiUrl: string;
  // 64-char hex AES-256-GCM key (must match the backend's
  // SEON_ENCRYPTION_KEY for the same environment).
  encryptionKey: string;
  // Free-form analytics tag stored on the activity log.
  orderSource?: string;
  // Optional context attached to the screening payload.
  orderDetails?: ScreeningOrderDetails;
  userDetails?: ScreeningUserDetails;
}

export interface PlaceOrderResult {
  orderId: string;
  txHash: string;
  /** Set to `true` when the host's tx redeemed integrator-side credit
   *  exclusively — no Diamond order was placed. The widget snaps to the
   *  "redeemed" success screen, skips merchant polling, and fires
   *  `onComplete` immediately. `orderId` can be any host-chosen sentinel
   *  (e.g. "0" for LotPot's credit-only path). When omitted or false, the
   *  widget runs the normal place → accept → pay → complete flow. */
  creditOnly?: boolean;
}

/** A user's currently-pending order, returned by the host's
 *  `fetchPendingOrders` callback. `usdcAmount` is the FULL purchase intent
 *  (not the Diamond-side delta on a credit-applied order) so the widget
 *  can compare against its own `usdcAmount` prop for the same-amount
 *  auto-resume rule. */
export interface PendingOrderSummary {
  orderId: string;
  usdcAmount: bigint;
}

/**
 * Validates a payment-address input (UPI handle, IBAN, PIX key, etc).
 * Returns null if valid, or a human-readable error string.
 */
export type PaymentAddressValidator = (input: string) => string | null;

// User-selected currency for a checkout session. Present in PlaceOrderContext
// only when the caller passed the `currencies` prop and the widget rendered
// the currency picker.
//
// `circleId` is optional. When omitted, the widget runs SDK circle routing
// (epsilon-greedy + on-chain eligibility validation, same path user-app-client
// uses) and injects the resolved circleId into `ctx.currency.circleId` before
// invoking the host's `placeOrder` callback. When provided, the widget passes
// it through unchanged — explicit values are honored as an override / escape
// hatch. Routing requires `subgraphUrl`, `usdcAddress`, `usdcAmount`, and
// `fiatAmount` on `CheckoutProps`.
export interface CurrencyOption {
  symbol: string;
  flag: string;
  paymentMethod: string;
  /** Native currency symbol shown in the selector's circular badge (e.g. "R$", "₹", "Mx").
   *  Optional — when omitted, the widget resolves it from `@p2pdotme/sdk/country` by `symbol`. */
  symbolNative?: string;
  /** Display name of the country (e.g. "Brazil"). Optional — resolved from SDK when omitted. */
  country?: string;
  /** When true, the selector tags the currency with an "Alpha" pill.
   *  Optional — resolved from SDK's `isAlpha` flag when omitted. */
  isAlpha?: boolean;
  circleId?: bigint;
  /** Optional preferred payment-channel config id forwarded to the router. */
  paymentChannelConfigId?: bigint;
  /** Optional override for cashout payment-address validation. */
  validatePaymentAddress?: PaymentAddressValidator;
  /** Optional placeholder for the cashout address input. */
  paymentAddressPlaceholder?: string;
}

export interface PlaceOrderContext {
  currency?: CurrencyOption;
}

export interface CheckoutProps {
  // --- Order source (pick one) ---
  // A: tracking only — client already placed the order
  orderId?: string;
  // B: client provides a callback; widget shows "Pay now" and runs it.
  // If `currencies` is also provided, `ctx.currency` holds the user's pick.
  placeOrder?: (ctx: PlaceOrderContext) => Promise<PlaceOrderResult>;

  // Enables an in-widget currency picker on the pre-order screen.
  // Caller is responsible for only passing currencies that map to a
  // registered merchant on the Diamond (circleId must match).
  currencies?: CurrencyOption[];

  // Display hints (used in mode B's pre-order screen)
  amount?: string;
  productName?: string;

  // Optional notice rendered above the "Pay now" button on the pre-order
  // screen. Use for caller-specific context such as "wallet will be charged
  // for gas" vs. "gas sponsored".
  paymentNotice?: React.ReactNode;

  // Required for paidBuyOrder + cancelOrder on Diamond
  signer: CheckoutSigner;

  // Optional
  chainId?: number;
  diamondAddress?: `0x${string}`;
  rpcUrl?: string;
  currency?: string;

  // Required when any selected `CurrencyOption` omits `circleId` — the widget
  // calls `@p2pdotme/sdk/orders` `placeOrder.prepare()` purely for circle
  // selection, then forwards the resolved circleId to the host's `placeOrder`
  // callback. Ignored when every currency in `currencies` already has an
  // explicit `circleId`.
  subgraphUrl?: string;
  usdcAddress?: `0x${string}`;
  /** USDC amount (6-dec bigint) the user will be charged. */
  usdcAmount?: bigint;
  /**
   * Expected fiat amount (6-dec bigint) for SDK routing eligibility. Optional
   * — when omitted, the widget derives it from the diamond's on-chain
   * `getPriceConfig(currency).buyPrice × usdcAmount`. Pass this only when you
   * want to override the on-chain quote (e.g., a fixed-price merchant promo).
   */
  fiatAmount?: bigint;

  // UI
  mode?: "inline" | "modal";
  open?: boolean;
  demo?: boolean;
  /** Optional theming overrides. See `P2PTheme` for the surface. */
  theme?: P2PTheme;

  // Optional B2B fraud screening. When provided, the widget logs the
  // buy attempt to the fraud engine before invoking `placeOrder`, then
  // links the on-chain orderId back so the merchant app sees the order
  // as screened+approved. Requires `signer.signMessage`.
  screening?: ScreeningConfig;

  // ─── Credit accounting (optional, integrator-agnostic) ──────────────
  //
  // When the integrator implements proxy-side credit (USDC stranded on a
  // user's proxy from a previous skipped fulfillment, auto-applied to the
  // next order), the host can plumb both callbacks below to (i) show the
  // user their available credit on the pre-order screen and (ii) enforce
  // the credit-aware concurrency rule. The widget itself stays
  // integrator-agnostic — it never imports integrator ABIs. See README
  // §"Credit accounting" for the host-side recipe.

  /** Returns the user's redeemable USDC credit (6-dec bigint). The widget
   *  reads at mount + after each completion. When > 0:
   *   - shows a "Credit applied: −X USDC" row in the fiat breakdown,
   *   - bills `max(usdcAmount − credit, 0)` instead of the full amount,
   *   - when credit ≥ usdcAmount, the CTA becomes "Redeem credit"
   *     (no fiat is charged) and the host's `placeOrder` is expected
   *     to take the integrator's credit-only fast path and return
   *     `{ ..., creditOnly: true }`.
   *  Hosts read this from whatever surface their integrator exposes
   *  (e.g. LotPot's `availableCredit(user)` view). */
  fetchCredit?: (user: `0x${string}`) => Promise<bigint>;

  /** Returns the user's currently-pending orders (Diamond status PLACED /
   *  ACCEPTED / PAID). `usdcAmount` must be the full purchase intent (not
   *  the Diamond delta on a credit-applied order). When both this and
   *  `fetchCredit` are provided, the widget enforces:
   *   - credit == 0                → no gate (existing `<PaymentHistory>`
   *                                  resume flow applies separately).
   *   - credit > 0, no pending      → no gate.
   *   - credit > 0, amount match   → auto-resume that order in tracking
   *                                  mode (placement is skipped).
   *   - credit > 0, no match       → render the rejection screen showing
   *                                  the conflicting pending order's
   *                                  amount; the user must finish that
   *                                  order before placing a new one. */
  fetchPendingOrders?: (user: `0x${string}`) => Promise<PendingOrderSummary[]>;

  /** Fired when the rejection screen's "Resume that order" button is
   *  clicked. The host should navigate the user (or re-open `<Checkout>`)
   *  with `orderId={pendingOrderId}` so the widget enters tracking-only
   *  mode against that order. Omit to hide the resume button on the
   *  rejection screen. */
  onResumeRequest?: (pendingOrderId: string) => void;

  // Events
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  /** Fires on placement / screening / wallet failure during checkout.
   *  Always a `P2PError` (subclass of `Error`) — narrow on `err.code` for
   *  branching, or read `err.userMessage` for jargon-free copy. */
  onError?: (error: Error) => void;
  onCancel?: (orderId: string) => void;
  onClose?: () => void;
}

export enum OrderStatus {
  PLACED = 0,
  ACCEPTED = 1,
  PAID = 2,
  COMPLETED = 3,
  CANCELLED = 4,
}

export type CheckoutPhase =
  | "checkout"
  | "placing"
  | "placed"
  | "accepted"
  | "paid"
  | "completed"
  | "cancelled"
  | "error";

// ─── Cashout (USDC balance → fiat) ──────────────────────────────────
//
// The widget orchestrates the Diamond-level offramp lifecycle (the protocol
// term for "USDC-to-fiat") and delegates integrator-specific work — USDC
// approve, integrator tx encoding, receipt parsing — to host callbacks. The
// widget itself never imports an integrator ABI. See README §"Cashout
// callback contract" for the host-side recipe against any specific
// integrator (LotPotCheckoutIntegrator, etc.).

export type CashoutPhase =
  /** Pre-order screen: collect currency + amount + payment address. */
  | "form"
  /** Host's `placeCashout` callback is running (approve + integrator tx). */
  | "placing"
  /** Sell order placed; waiting for a merchant to accept. */
  | "placed"
  /** Merchant accepted; about to encrypt + deliver UPI. */
  | "accepted"
  /** Encrypting UPI in-browser + host's `deliverUpi` callback running. */
  | "encrypting"
  /** Encrypted UPI submitted; Diamond pulled USDC; merchant paying user fiat. */
  | "paid"
  /** Merchant confirmed fiat sent; reconciling integrator state. */
  | "completed"
  /** Order cancelled (timeout / dispute / merchant didn't pay). USDC refunded. */
  | "cancelled"
  | "error";

/**
 * Passed to the host's `placeCashout` callback. The host is responsible for
 * approving USDC to its integrator and submitting whatever integrator-specific
 * tx places the SELL on the Diamond.
 *
 * `currency.circleId` is guaranteed populated — either the value the host
 * pinned on `CurrencyOption.circleId`, or the value the widget routed via
 * the SDK when the host left `circleId` undefined.
 */
export interface PlaceCashoutContext {
  currency: CurrencyOption;
  /** Raw fiat payment address the user entered. NOT yet encrypted — host
   *  must NOT submit this on-chain. The widget encrypts it at the ACCEPTED
   *  handoff and calls `deliverUpi` separately. */
  paymentAddress: string;
  /** USDC principal the user is cashing out (6-decimal bigint). This is the
   *  `amount` you pass to the integrator's place-offramp tx / Diamond SELL —
   *  NOT what the user's wallet is debited (see `feeUsdc`). */
  usdcAmount: bigint;
  /** Small-order fixed fee (6-decimal bigint), read from
   *  `getSmallOrderFixedFee(currency)`. `0n` when the principal exceeds
   *  `getSmallOrderThreshold(currency)`. The Diamond pulls
   *  `actualUsdtAmount = usdcAmount + feeUsdc` from `order.user` at
   *  `setSellOrderUpi`, so the integrator must end up funding the system
   *  proxy with that total. Approve `usdcAmount + feeUsdc` to your
   *  integrator. */
  feeUsdc: bigint;
  /** User's relay pubkey. Pass to the integrator's `userInitiateOfframp` /
   *  equivalent so the assigned merchant knows what key to encrypt their
   *  UPI/PIX response against. Comes from the SDK's relay identity store. */
  userPubKey: string;
}

export interface PlaceCashoutResult {
  /** Diamond order id parsed from the tx receipt. */
  orderId: string;
  /** Hash of the placement tx. */
  txHash: string;
}

/** Passed to `deliverUpi`. The widget already encrypted `paymentAddress`
 *  against the merchant's on-chain pubkey; the host just submits the
 *  integrator's `deliverOfframpUpi` / equivalent. */
export interface DeliverUpiContext {
  orderId: string;
  encryptedUpi: string;
}

/** Passed to the optional `reconcile` callback when the order reaches a
 *  terminal Diamond state (status = 3 COMPLETED or 4 CANCELLED). Skip
 *  implementing if your integrator doesn't expose a reconcile selector. */
export interface ReconcileContext {
  orderId: string;
  status: number;
}

export interface CashoutProps {
  // ─── Required ────────────────────────────────────────────────────
  /** USDC token address (used for the "you have X available" affordance). */
  usdcAddress: `0x${string}`;
  /** Diamond address (for status polling + SDK reads). */
  diamondAddress: `0x${string}`;
  /** Wallet abstraction matching the buy widget's CheckoutSigner. */
  signer: CheckoutSigner;
  /** Currencies/circles the user can pick from.
   *
   *  `circleId` is optional per currency:
   *  - Pin a specific merchant circle by setting `circleId` explicitly.
   *  - Leave it off and the widget routes via `@p2pdotme/sdk`'s
   *    `placeOrder.prepare()` (orderType=1, SELL). Routing requires
   *    `subgraphUrl` on these props.
   *  Mix-and-match is fine — any currency without a pinned circleId is
   *  routed; any with one is honored as-is. */
  currencies: CurrencyOption[];
  /** Host callback — submits the integrator-specific tx that places the
   *  SELL on the Diamond. See `PlaceCashoutContext`. */
  placeCashout: (ctx: PlaceCashoutContext) => Promise<PlaceCashoutResult>;
  /** Host callback — submits the integrator's `deliverOfframpUpi` (the
   *  widget passes in the already-encrypted blob). */
  deliverUpi: (ctx: DeliverUpiContext) => Promise<{ txHash: string }>;

  // ─── Optional ────────────────────────────────────────────────────
  /** Host callback — submits the integrator's `reconcile` after the
   *  Diamond hits a terminal status. Skip if your integrator doesn't
   *  need it. Always called best-effort (errors swallowed). */
  reconcile?: (ctx: ReconcileContext) => Promise<{ txHash: string }>;
  chainId?: number;
  rpcUrl?: string;
  /** Required when any selected `CurrencyOption` omits `circleId` — passed
   *  to `@p2pdotme/sdk` for SDK routing. */
  subgraphUrl?: string;
  /** Slippage floor on fiat amount (sell). 0 = no check. */
  fiatAmountLimit?: bigint;
  /** Pre-fill the amount input (USDC, 6-decimals). User can still edit. */
  defaultAmountUsdc?: bigint;
  /** UI mode. */
  mode?: "inline" | "modal";
  open?: boolean;
  /** Optional theming overrides. See `P2PTheme` for the surface. */
  theme?: P2PTheme;

  // ─── Events ──────────────────────────────────────────────────────
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  onCancelled?: (orderId: string) => void;
  /** Fires on placement / encrypt / deliver / retry failures. Always a
   *  `P2PError` (subclass of `Error`) — narrow on `err.code` for branching,
   *  or read `err.userMessage` for jargon-free copy. */
  onError?: (error: Error) => void;
  onClose?: () => void;
}

// ─── Support widget types ──────────────────────────────────────────────
// The support surface (Support, PaymentHistoryWithSupport) lives in the
// same package as Checkout/Cashout/PaymentHistory and reuses CheckoutSigner.
// Only the bits that don't already exist on the checkout surface live here.

// `SupportTheme` is an alias of `P2PTheme` — the support surface honors
// the same `--p2p-*` tokens as the rest of the widgets. The alias is kept
// so hosts that imported `SupportTheme` by name don't break.
export type SupportTheme = P2PTheme;

export type SupportRole = "user" | "merchant" | "circle_admin" | "ops";
export type SupportStatus = "none" | "open" | "resolved";

/**
 * The four operator-set tags written to the Chatwoot conversation's
 * `custom_attributes.p2p_tag` (D-027-v2). Read by the customer surface and
 * mapped to friendly copy via `friendlyP2PTagCopy`; written by the ops
 * surface via the tag dropdown.
 */
export type SupportP2PTag =
  | "awaiting_user"
  | "reviewing"
  | "evidence"
  | "escalated";

/**
 * Chatwoot conversation status as surfaced by the ops `/ops/orders/:id/thread`
 * read. `null` when the order has no conversation yet.
 */
export type SupportChatStatus = "open" | "pending" | "snoozed" | "resolved";

/**
 * Minimal wallet abstraction the support widget accepts. Structurally
 * narrower than `CheckoutSigner` — only `address` + `signMessage`. A
 * `CheckoutSigner` is a valid `SupportSigner` (its `signMessage` is
 * optional but only required for the support handshake).
 */
export interface SupportSigner {
  address: `0x${string}`;
  signMessage?: (message: string) => Promise<string>;
}

export interface SupportProps {
  orderId?: string;
  /**
   * Which surface to render. `"customer"` (default) is the per-order
   * launcher modal that boots Chatwoot. `"ops"` renders `OpsSupportPanel`
   * — the operator-facing read/reply/tag/resolve surface that talks to the
   * bridge's `/ops/*` routes (D-027-v2). `chatEnabled` is honored in
   * customer mode only; ops mode is always live.
   */
  mode?: "customer" | "ops";
  /**
   * Container layout. `"modal"` (default) wraps the surface in the dialog
   * modal. `"inline"` renders it in flow. `"side-rail"` renders a right
   * rail that collapses to inline below the `lg` breakpoint. Primarily for
   * `mode="ops"`; the customer launcher always uses its own modal.
   */
  layout?: "modal" | "inline" | "side-rail";
  /**
   * Optional label for the surface header. Required in customer mode where
   * it names the host app in the privacy notice; optional in ops mode.
   * Defaults to a neutral label when omitted.
   */
  originApp?: string;
  signer: SupportSigner;
  bridgeUrl: string;
  /**
   * Current on-chain dispute state for the order, if known. Drives the
   * launcher label and styling: "Support" (none), "View support" (open),
   * "View resolution" (resolved). Defaults to "none" when omitted.
   */
  disputeStatus?: SupportStatus;
  /**
   * Whether the user already has an open Chatwoot conversation for this
   * order. Only consulted when `disputeStatus` is `"none"` — dispute
   * variants take precedence over the chat-active vs chat-new label
   * differentiation.
   *
   *   - `"active"` → label "Continue support" with a green pip.
   *   - `"new"` (default) → label "Get help".
   */
  chatState?: "active" | "new";
  chatwootBaseUrl?: string;
  chatwootInboxIdentifier?: string;
  /**
   * Toggle for the Chatwoot chat path. Default `false` (v1.1.1-bridge
   * fallback): the launcher opens a static "support request registered"
   * confirmation modal instead of attempting to sign in to the bridge
   * and boot Chatwoot. Flip to `true` only when the bridge + Chatwoot
   * stack is healthy.
   */
  chatEnabled?: boolean;
  theme?: SupportTheme;
  onOpen?: () => void;
  onClose?: () => void;
  /**
   * `mode="ops"` only. Fired after the operator resolves the chat (the
   * bridge `POST /ops/orders/:id/resolve` succeeds). Hosts use this to
   * refresh their own dispute/timeline view.
   */
  onChatResolved?: () => void;
}

export interface SupportSessionChatwoot {
  baseUrl: string;
  websiteToken: string;
  identifier: string;
  identifierHash: string;
}

export interface SupportSession {
  address: `0x${string}`;
  role: SupportRole;
  chatwoot: SupportSessionChatwoot | null;
  /** Persistent bearer token issued by the bridge after sign-in. */
  sessionToken: string;
  expiresAt: number;
}
