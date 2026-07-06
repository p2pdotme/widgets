/**
 * `@p2pdotme/widgets/checkout` — the buy flow widget + its specific types.
 *
 * Shared types (CheckoutSigner, CurrencyOption, P2PError, P2PTheme,
 * OrderStatus, …) and helpers live on the bare `@p2pdotme/widgets` import.
 */

export { Checkout } from "./widgets/Checkout";
export type {
  CheckoutProps,
  CheckoutPhase,
  PlaceOrderContext,
  PlaceOrderResult,
  PendingOrderSummary,
  LivenessConfig,
} from "./types";
