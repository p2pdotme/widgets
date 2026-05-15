/**
 * `@p2pdotme/widgets/support` — Support widget surface that pairs with
 * the bridge service in `p2pdotme/support`.
 *
 * - `Support` — per-order support launcher modal.
 * - `PaymentHistoryWithSupport` — composes `PaymentHistory` with a Support
 *   launcher per row plus an "Active support" indicator decoration.
 * - `fromPrivyWallet` / `fromThirdwebAccount` — duck-typed adapters that
 *   wrap a Privy `ConnectedWallet` or Thirdweb `Account` into a
 *   `SupportSigner` without taking a peer dependency on either library.
 *
 * Shared types (`CheckoutSigner`, `P2PTheme`, …) live on the bare
 * `@p2pdotme/widgets` import. Support-specific types here.
 */

export { Support } from "./widgets/Support";
export {
  PaymentHistoryWithSupport,
  type PaymentHistoryWithSupportProps,
} from "./widgets/PaymentHistoryWithSupport";
export { OrderAction, type OrderActionProps } from "./widgets/OrderAction";
export {
  RaiseDisputeStep,
  type RaiseDisputeStepProps,
  type RaiseDisputeSigner,
} from "./widgets/RaiseDisputeStep";
export {
  computeOrderAction,
  formatRemaining,
  type OrderActionState,
  type ActionVariant,
  type DisputeState,
} from "./core/order-action";
export {
  useOrderStates,
  MULTICALL3_ADDRESS,
  type UseOrderStatesOpts,
  type UseOrderStatesResult,
  type OrderStateRow,
} from "./hooks/useOrderStates";
export {
  fromPrivyWallet,
  type PrivyWalletLike,
  type EthereumProviderLike,
} from "./adapters/privy";
export {
  fromThirdwebAccount,
  type ThirdwebAccountLike,
} from "./adapters/thirdweb";
export { DEFAULT_THEME, themeToCssVars } from "./ui/support-theme";
export type {
  SupportProps,
  SupportTheme,
  SupportSigner,
  SupportRole,
  SupportStatus,
  SupportSession,
  SupportSessionChatwoot,
} from "./types";
