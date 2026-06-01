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
  OpsSupportPanel,
  type OpsSupportPanelProps,
} from "./widgets/OpsSupportPanel";
export {
  P2PTagBanner,
  type P2PTagBannerProps,
} from "./widgets/P2PTagBanner";
export { friendlyP2PTagCopy } from "./core/p2p-tag";
export {
  PaymentHistoryWithSupport,
  type PaymentHistoryWithSupportProps,
} from "./widgets/PaymentHistoryWithSupport";
export { OrderAction, type OrderActionProps } from "./widgets/OrderAction";
export {
  ContactSupport,
  type ContactSupportProps,
} from "./widgets/ContactSupport";
export {
  ReportProblemStep,
  type ReportProblemStepProps,
  type RaiseDisputeSigner,
} from "./widgets/ReportProblemStep";
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
  SupportP2PTag,
  SupportChatStatus,
} from "./types";
