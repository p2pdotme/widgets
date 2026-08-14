import type { P2PError, P2PErrorCode } from "../core/errors";
import type { Translator } from "./t";

const CODE_KEYS: Partial<Record<P2PErrorCode, string>> = {
  WALLET_USER_REJECTED: "errors.walletRejected",
  WALLET_INSUFFICIENT_FUNDS: "errors.walletInsufficient",
  REVERT_UNKNOWN: "errors.revertUnknown",
  NETWORK_TIMEOUT: "errors.networkTimeout",
  NETWORK_RPC_UNREACHABLE: "errors.networkUnreachable",
  ROUTING_NO_MERCHANTS: "errors.noMerchants",
  ROUTING_MISSING_INPUTS: "errors.missingRouting",
  ENCRYPTION_PREFLIGHT_FAILED: "errors.encryptionPreflight",
  ENCRYPTION_FAILED: "errors.encryptionFailed",
  ORDER_BAD_STATUS: "errors.orderBadStatus",
  SCREENING_API_ERROR: "errors.screeningApi",
  SCREENING_REJECTED: "errors.screeningRejected",
  SCREENING_LIVENESS_REQUIRED: "errors.livenessRequired",
  UNKNOWN: "errors.unknown",
};

const REVERT_KEYS: Record<string, string> = {
  B2BProxyAddressMismatch: "errors.b2bProxyMismatch",
  B2BIntegratorInactive: "errors.b2bIntegratorInactive",
  B2BIntegratorRejectedOrder: "errors.b2bRejectedOrder",
  B2BCallerNotContract: "errors.b2bCallerNotContract",
  B2BProxyIntegratorReadFailed: "errors.b2bProxyBadState",
  B2BProxyOwnerReadFailed: "errors.b2bProxyBadState",
  B2BProxyOwnerZero: "errors.b2bProxyOwnerZero",
  B2BProxyImplLocked: "errors.b2bProxyImplLocked",
  NotEnoughEligibleMerchants: "errors.notEnoughMerchants",
  ExchangeNotOperational: "errors.exchangeNotOperational",
  UserIsBlacklisted: "errors.userBlacklisted",
  ZeroReputationPoints: "errors.zeroReputation",
  OrderExpired: "errors.orderExpired",
  InvalidAddress: "errors.invalidAddress",
  InvalidAmount: "errors.invalidAmount",
  CurrencyNotSupported: "errors.currencyNotSupported",
  UsdtTransferFailed: "errors.usdtTransferFailed",
  DailyBuyOrderLimitExceeded: "errors.dailyBuyLimit",
  MonthlyBuyOrderLimitExceeded: "errors.monthlyBuyLimit",
  DailyBuyOrderPlacementLimitExceeded: "errors.dailyPlacementLimit",
  BuyOrderAmountExceedsLimit: "errors.buyAmountLimit",
  SellOrderAmountExceedsLimit: "errors.sellAmountLimit",
  DailyVolumeLimitExceeded: "errors.dailyVolume",
  UserYearlyVolumeLimitExceeded: "errors.yearlyVolume",
  UpiAlreadySent: "errors.upiAlreadySent",
  InvalidOrderUpi: "errors.invalidOrderUpi",
  OrderAlreadyCancelled: "errors.orderAlreadyCancelled",
};

/**
 * Localize a P2PError for UI display. Falls back to `err.userMessage` (English)
 * when no catalog key matches — keeps host-registered custom revert copy intact.
 */
export function translateError(err: P2PError, t: Translator): string {
  if (err.i18nKey) return t(err.i18nKey);

  if (err.code === "REVERT_KNOWN" && err.revertName) {
    const key = REVERT_KEYS[err.revertName];
    if (key) return t(key);
    return t("errors.revertNamedFallback", { name: err.revertName });
  }

  // Screening sometimes surfaces the "restricted" soft message.
  if (
    err.code === "SCREENING_REJECTED" &&
    /unusual activity|pls wait/i.test(err.userMessage)
  ) {
    return t("errors.screeningRestricted");
  }

  const key = CODE_KEYS[err.code];
  if (key) return t(key);

  return err.userMessage;
}
