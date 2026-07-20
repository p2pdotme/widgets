/**
 * Bare-entry exports for `@p2pdotme/widgets`.
 *
 * Widgets themselves live behind subpaths so each can be imported (and
 * tree-shaken) independently:
 *   • `@p2pdotme/widgets/checkout`         → { Checkout }
 *   • `@p2pdotme/widgets/cashout`          → { Cashout }
 *   • `@p2pdotme/widgets/payment-history`  → { PaymentHistory }
 *
 * This module exposes only the SHARED surface — types and helpers usable
 * across widgets — so a host that only renders one widget never pays for
 * the others' bytes.
 */

// ─── Shared error system ───────────────────────────────────────────────
export {
  P2PError,
  classifyError,
  logP2PError,
  registerRevertSelectors,
  lookupRevertSelector,
} from "./core/errors";
export type {
  P2PErrorCode,
  P2PErrorCategory,
  P2PErrorFlow,
  P2PErrorContext,
  P2PErrorInput,
  RevertEntry,
} from "./core/errors";

// ─── On-chain helpers ──────────────────────────────────────────────────
export {
  parseOrderIdFromReceipt,
  fetchUserTxLimit,
  readSmallOrderFixedFee,
  INTEGRATOR_LIMITS_ABI,
  ERC20_READ_ABI,
  DIAMOND_ABI,
  DEFAULT_DIAMOND_ADDRESS,
  USDC_DECIMALS,
  LIVENESS_GATE_ABI,
  fetchLivenessStatus,
} from "./core/contracts";

// ─── Liveness gate ─────────────────────────────────────────────────────
export { computeLivenessGate } from "./core/liveness";
export type { LivenessStatus, LivenessGate, LivenessAttestation } from "./core/liveness";

// ─── Hooks ─────────────────────────────────────────────────────────────
export { useUserTxLimit } from "./hooks/useUserTxLimit";
export type {
  UseUserTxLimitOptions,
  UseUserTxLimitResult,
} from "./hooks/useUserTxLimit";

// ─── Currency / validator helpers ──────────────────────────────────────
export {
  DEFAULT_VALIDATORS,
  DEFAULT_PLACEHOLDERS,
  PAYMENT_METHOD_LABEL,
  FALLBACK_VALIDATOR,
  getValidatorFor,
  getPlaceholderFor,
  getPaymentLabelFor,
} from "./core/currencies";

// ─── Pix (BRL) BR Code ─────────────────────────────────────────────────
export {
  buildStaticPixPayload,
  buildDynamicPixPayload,
  normalizePixKey,
  detectPixKeyType,
  pixKeyToQR,
  crc16,
} from "./core/pix-brcode";
export type { PixKeyType, StaticPixInput, DynamicPixInput } from "./core/pix-brcode";

// ─── Shared types ──────────────────────────────────────────────────────
export { OrderStatus } from "./types";
export type {
  CheckoutSigner,
  CurrencyOption,
  PaymentAddressValidator,
  ScreeningConfig,
  ScreeningOrderDetails,
  ScreeningUserDetails,
  P2PTheme,
} from "./types";
