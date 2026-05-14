/**
 * `@p2pdotme/widgets/cashout` — the USDC-to-fiat (offramp / withdraw) widget
 * and its specific types.
 *
 * Shared types (CheckoutSigner, CurrencyOption, P2PError, P2PTheme,
 * OrderStatus, …) and helpers live on the bare `@p2pdotme/widgets` import.
 */

export { Cashout } from "./widgets/Cashout";
export type {
  CashoutProps,
  CashoutPhase,
  PlaceCashoutContext,
  PlaceCashoutResult,
  DeliverUpiContext,
  ReconcileContext,
} from "./types";
