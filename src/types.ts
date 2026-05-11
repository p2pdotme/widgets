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
// `fiatAmount` on `P2PCheckoutProps`.
export interface CurrencyOption {
  symbol: string;
  flag: string;
  paymentMethod: string;
  circleId?: bigint;
  /** Optional preferred payment-channel config id forwarded to the router. */
  paymentChannelConfigId?: bigint;
  /** Optional override for offramp payment-address validation. */
  validatePaymentAddress?: PaymentAddressValidator;
  /** Optional placeholder for the offramp address input. */
  paymentAddressPlaceholder?: string;
}

export interface PlaceOrderContext {
  currency?: CurrencyOption;
}

export interface P2PCheckoutProps {
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

  // Events
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
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

// ─── Offramp ───────────────────────────────────────────────────────

export type OfframpPhase =
  /** Pre-order screen: collect currency + payment address. */
  | "form"
  /** Auto-sweeping NFT from proxy → user EOA before sell-back. */
  | "sweeping"
  /** Sending the userInitiateSellBack tx. */
  | "placing"
  /** Sell order placed; waiting for a merchant to accept. */
  | "placed"
  /** Merchant accepted; about to encrypt + deliver UPI. */
  | "accepted"
  /** Merchant accepted; encrypting UPI and submitting deliverOfframpUpi. */
  | "encrypting"
  /** Encrypted UPI submitted; Diamond pulled USDC; merchant paying user fiat. */
  | "paid"
  /** Merchant confirmed fiat sent; reconciling integrator state. */
  | "completed"
  /** Order cancelled (timeout / dispute / merchant didn't pay). USDC refunded. */
  | "cancelled"
  | "error";

export interface P2POfframpProps {
  // ─── Required ────────────────────────────────────────────────────
  /** MarketplaceCheckoutIntegrator address (must have offrampEnabled = true). */
  integratorAddress: `0x${string}`;
  /** SimpleNFTMarketplace-style client. Must implement IMarketplaceClient. */
  marketplaceAddress: `0x${string}`;
  /** Token to sell back. The connected wallet (or its proxy) must own it. */
  tokenId: bigint;
  /** Wallet abstraction matching the buy widget's CheckoutSigner. */
  signer: CheckoutSigner;
  /** Currencies/circles the user can pick from. */
  currencies: CurrencyOption[];
  /** Diamond address (for status polling + getNextOrderId). */
  diamondAddress: `0x${string}`;
  /** USDC token address. */
  usdcAddress: `0x${string}`;

  // ─── Optional ────────────────────────────────────────────────────
  chainId?: number;
  rpcUrl?: string;
  /** Subgraph URL for SDK reads. Empty string if not used. */
  subgraphUrl?: string;
  /** Slippage floor on fiat amount (sell). 0 = no check. */
  fiatAmountLimit?: bigint;
  /** UI mode. */
  mode?: "inline" | "modal";
  open?: boolean;
  /** Optional theming overrides. See `P2PTheme` for the surface. */
  theme?: P2PTheme;

  // ─── Events ──────────────────────────────────────────────────────
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  onCancelled?: (orderId: string) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}
