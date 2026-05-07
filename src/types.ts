export interface CheckoutSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
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
export interface CurrencyOption {
  symbol: string;
  flag: string;
  paymentMethod: string;
  circleId: bigint;
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

  // UI
  mode?: "inline" | "modal";
  open?: boolean;
  demo?: boolean;

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

  // ─── Events ──────────────────────────────────────────────────────
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  onCancelled?: (orderId: string) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}
