/**
 * English (default / fallback) message catalog for @p2pdotme/widgets.
 * Other locales must mirror this shape.
 */
export const en = {
  common: {
    copy: "Copy",
    copied: "Copied",
    close: "Close",
    cancel: "Cancel",
    continue: "Continue",
    done: "Done",
    tryAgain: "Try again",
    retry: "Retry",
    send: "Send",
    sending: "Sending…",
    loadingQuote: "Loading quote…",
    rateUnavailable: "Rate unavailable",
    demo: "DEMO",
    you: "You",
    support: "Support",
    payment: "Payment",
    paymentId: "Payment ID",
    paymentAddressFallback: "payment address",
    paymentAppFallback: "payment",
    yourOrder: "your order",
    alpha: "Alpha",
    orderHash: "Order #{orderId}",
    amount: "Amount",
    order: "Order",
    usdcSuffix: "{amount} USDC",
    left: "left",
    expired: "expired",
  },

  stepper: {
    matching: "Matching",
    payment: "Payment",
    complete: "Complete",
  },

  checkout: {
    title: "P2P Checkout",
    orderSummary: "Order Summary",
    payWith: "Pay with",
    subtotal: "Subtotal",
    order: "Order",
    creditApplied: "Credit applied",
    creditAppliedUsdc: "({creditUsdc} USDC)",
    transactionFee: "Transaction Fee",
    waivedAbove: "Waived on orders above {thresholdLabel}.",
    youPay: "You pay",
    freeCreditCovers: "Free (credit covers)",
    payNow: "Pay now",
    payAmount: "Pay {symbol} {total}",
    redeemCredit: "Redeem credit",
    amountTooSmall: "Amount too small",
    rateUnavailable: "Rate unavailable",
    tooSmallBody:
      "This amount is too small to process{feeClause}. Please use a larger amount.",
    tooSmallFeeClause: " — it doesn't cover the {feeFiatLabel} transaction fee",
    tooSmallInline:
      "This amount is too small to process — it doesn't cover the transaction fee. Please use a larger amount.",
    rateLoadFailed:
      "Couldn't load the exchange rate to price this order. Please refresh and try again.",
    rateStillLoading:
      "Still loading the exchange rate — please wait a moment and try again.",
    livenessIncomplete:
      "Verification was not completed. Please try again.",
    localCurrencyHint:
      "You'll pay in your local currency to complete this order.",

    livenessTitle: "Quick human check",
    livenessSubtitle:
      "To keep things fair, verify you're a real person. It takes a few seconds and you only do it once.",
    verifyHuman: "Verify I'm human",
    verifying: "Verifying…",

    pendingTitle: "Finish your pending order first",
    pendingSubtitle:
      "Please complete or cancel your pending order before creating another one.",
    pendingOrder: "Pending order",
    resumeThatOrder: "Resume that order",

    placingTitle: "Placing order…",
    placingSubtitle: "Waiting for your transaction to confirm.",

    matchingTitle: "Matching your order",
    matchingSubtitle:
      "Order #{orderId}: We're matching your cash payment with someone who will deliver USDC for this checkout. This typically takes 2-3 minutes.",

    payExactly: "Pay exactly",
    forProduct: "for {productName}",
    forUsdc: "for {usdc} USDC",
    forYourOrder: "for your order",
    viewBreakdown: "View breakdown",
    hideBreakdown: "Hide breakdown",
    totalPaid: "Total paid",
    payViaAndConfirm: "Pay via {paymentMethod} and confirm",

    step1SendAmount: "Send {currency} {fiat}",
    step1SendPayment: "Send the payment",
    step1Subtitle:
      "To the {paymentAddressLabel} below, from any {paymentMethod} app.",
    decrypting: "Decrypting payment details…",

    copyPixCode: "Copy Pix code (Copia e Cola)",
    pixCodeCopied: "Pix code copied",
    qrScanLead: "Scan with camera app to copy the {label} — ",
    qrNotPayable: "Not a Payable QR",

    backFromAppNudge:
      "Back from your {paymentMethod} app? If you sent {currency} {fiat}, confirm below — the order won't settle until you do.",
    backFromAppNudgeNoAmount:
      "Back from your {paymentMethod} app? If you've sent the payment, confirm below — the order won't settle until you do.",
    confirmTitle: "Confirm you've paid",
    confirmSubtitle:
      "We can't see your bank transfer — your order stays open until you tap below.",
    windowClosedTitle: "This payment window closed",
    iveSent: "I've sent {currency} {fiat}",
    iveMadePayment: "I've made the payment",
    confirming: "Confirming…",
    paymentWindowClosed: "Payment window closed",
    confirmWithin:
      "Confirm within {countdown} or the order auto-cancels.",
    alreadySentDontResend: "Already sent the money? Don't send it again.",
    windowExpiredBody:
      "This order can no longer be confirmed on-chain. Contact support with the order number below and it'll be resolved.",
    cancelOrder: "Cancel order",
    cancelConfirm: "Cancel this order?",
    yesCancel: "Yes, cancel",
    cancelling: "Cancelling…",
    keepOrder: "Keep order",
    stickyBackConfirm:
      "Back from your {paymentMethod} app? Confirm to settle your order.",
    stickyStep2: "Step 2 · Confirm once you've paid",

    verifyingTitle: "Verifying your payment",
    verifyingSubtitle: "Confirming receipt. Usually under a minute.",
    paymentComplete: "Payment complete",
    creditRedeemed: "Credit redeemed",
    creditOnlyBody:
      "Order fulfilled from your existing credit. No fiat was charged.",
    usdcDelivered: "{usdc} USDC delivered.",
    orderCancelled: "Order cancelled",
    notCharged: "You were not charged.",
  },

  cashout: {
    title: "P2P Withdraw",
    youllReceive: "You'll receive",
    amountToWithdraw: "Amount to withdraw",
    placeholderAmount: "0.00",
    balance: "Balance: {balance} USDC",
    loadingBalance: "Loading balance…",
    max: "Max",
    insufficientBalance: "Insufficient USDC balance.",
    receiveIn: "Receive in",
    youReceive: "You receive",
    youSell: "You sell",
    for: "For",
    serviceFee: "Service fee",
    feePlusUsdc: "+ {fee} USDC",
    waivedAbove: "Waived on orders above {thresholdLabel}.",
    totalCharged: "Total charged",
    withdraw: "Withdraw",
    withdrawAmount: "Withdraw {symbol} {receive}",
    payoutTooSmall: "Payout too small",
    payoutTooSmallBody:
      "This payout is too small to withdraw. Please use a larger amount.",
    rateLoadFailed:
      "Couldn't load the exchange rate for this payout. Please try again.",

    submittingTitle: "Submitting withdrawal…",
    submittingSubtitle:
      "Setting up your withdrawal. Confirm any wallet prompts that pop up.",

    matchingTitle: "Matching your order",
    matchingSubtitle:
      "Order #{orderId}: We're matching your {usdc} USDC withdrawal with someone who will pay{currencyClause} into your {paymentMethod}. This typically takes 2-3 minutes.",

    sendingDetailsTitle: "Sending payment details",
    sendingDetailsSubtitle: "Securely sharing your payout details.",
    receiveTo: "Receive to",

    paymentInProgress: "Payment in progress",
    watchForArrival:
      "Watch for {symbol} {fiat} arriving via {paymentMethod}.",
    watchForFiat: "Watch for the fiat to arrive in your account.",

    withdrawn: "Withdrawn!",
    receivedFor:
      "You received {symbol} {fiat} for {usdc} USDC.",
    paidTo: "Paid to",

    orderCancelled: "Order cancelled",
    cancelledSubtitle:
      "The order was cancelled and your funds were returned. You can try again any time.",

    deliverFailedTitle: "Couldn't deliver payment details",
    deliverFailedBody:
      "Your offramp order is still active on-chain (#{orderId}). The merchant accepted; we couldn't deliver your encrypted payment address. Retrying re-runs encryption + delivery against the same order.",
    retryDelivery: "Retry delivery",

    placeFailedTitle: "Couldn't place withdrawal",
    backToForm: "Back to form",
  },

  history: {
    pendingOrders: "Pending orders",
    orderHistory: "Order history",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    loadingTitle: "Loading orders",
    loadingSubtitle: "Querying the subgraph…",
    fetchFailed: "Failed to fetch orders",
    noPending: "No pending orders.",
    noOrders: "No orders yet.",
    pending: "Pending",
    past: "Past",
    resume: "Resume",
    justNow: "just now",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",

    statusMatching: "Matching",
    statusAwaitingPayment: "Awaiting payment",
    statusVerifying: "Verifying",
    statusCompleted: "Completed",
    statusCancelled: "Cancelled",
    disputeInSupport: "In support",
    disputeResolved: "Support resolved",
  },

  orderAction: {
    resumeOrder: "Resume order",
    underReview: "Under review",
    resolved: "Resolved",
    placedMatching: "Placed · matching",
    placedStale:
      "Placed · still matching, this is taking longer than usual",
    acceptedAwaitingPayment: "Accepted · awaiting your payment",
    acceptedProcessing: "Accepted · processing payment",
    paidProcessing: "Paid · processing payment",
    paidTakingLonger:
      "Paid · processing payment · taking longer than usual",
    paidWillResolveWithin:
      "Paid · processing payment · will resolve within {remaining}",
    paymentReceivedConfirm: "Payment received · confirm to complete",
    completed: "Completed",
    completedReviewClosed: "Completed · review window closed",
    cancelled: "Cancelled",
    cancelledContactSupport:
      "Cancelled · contact support to recover funds",
    cancelledReviewClosed: "Cancelled · review window closed",
    reviewOpensIn: "{label} · review opens in {remaining}",
    statusUnavailable: "Status unavailable",
    remainingSeconds: "{n}s",
    remainingMinutes: "{n}m",
    remainingHoursMinutes: "{h}h {m}m",
    remainingDaysHours: "{d}d {h}h",
  },

  support: {
    getHelp: "Get help",
    viewReport: "View report",
    viewResolution: "View resolution",
    continueSupport: "Continue support",
    openSupportAria: "Open support",
    closeSupportAria: "Close support",
    orderSupportAria: "Order support",
    title: "Support",
    orderLabel: "Order {shortId}",
    openedFrom:
      "Opened from {originApp}. No names or wallet addresses are shared with the other side.",
    defaultOriginApp: "this app",

    signingTitle: "Signing in",
    signingBody:
      "Approve the message request in your wallet to open support for this order.",
    loadingChatTitle: "Loading chat",
    loadingChatBody: "Connecting to the Payment Support Team...",

    unavailableTitle: "Support not available yet",
    unavailableBody:
      "Your order needs to be accepted before a support thread can open. Try again in a moment, or come back once your order moves to Accepted.",

    registeredTitle: "Support request registered",
    registeredBody:
      "Your support request is on its way to the support team. Any stuck funds will be refunded once it's resolved. Check back here in a little while to see the updated status.",

    errUserRejectedTitle: "Authorization cancelled",
    errUserRejectedBody:
      "You declined the sign-in prompt. Tap Retry to sign in and open support.",
    errNetworkTitle: "Connection issue",
    errNetworkBody:
      "We couldn't reach the support service. Check your connection and try again.",
    errAuthTitle: "Sign-in failed",
    errAuthBody:
      "We couldn't verify your wallet. Try again, or reconnect your wallet if the issue persists.",
    errChatwootTitle: "Chat couldn't load",
    errChatwootBody:
      "The support chat widget didn't load. Refresh the page or try again.",
    errUnknownTitle: "Something went wrong",
    errUnknownBody: "We couldn't open support. Try again in a moment.",

    activeSupport: "Active support",
    activeSupportAria: "Active support conversation",
    activeSupportTitle:
      "You have an active support conversation on this order",
  },

  report: {
    contactSupport: "Contact Support",
    contactSupportCountdown: "Contact Support · {remaining}",
    confirmTitle: "Contact Support",
    confirmIntro: "Before you continue, please note:",
    confirmBullet1:
      "You must have already paid the order. The review needs your payment receipt details.",
    confirmBullet2:
      "The support team will review both sides. Resolution typically takes 24 to 72 hours.",
    confirmBullet3:
      "Reports filed in bad faith may result in reputation penalties. Only file a report if your paid order has not been completed.",

    formTitle: "Confirm transaction details",
    formBody:
      "Order #{shortId}. Enter the last 4 digits of the transaction id you used for payment. This helps the support team match your payment against the other side's records. Submitting opens the support thread for this order.",
    last4Label: "Last 4 digits",
    last4Aria: "last 4 digits of transaction id",
    last4Error: "Enter the last 4 digits of the transaction id.",
    submit: "Submit",
    submitting: "Submitting…",

    submittedTitle: "Support request registered",
    submittedBody:
      "Your support request is on its way to the support team. Any stuck funds will be refunded once it's resolved. Check back here in a little while to see the updated status.",

    errorTitle: "Could not submit report",
    unknownError: "Unknown error.",

    revertNotAuthorized:
      "Only the wallet that placed the order can contact support for it.",
    revertDisputeTimeNotReached:
      "Support isn't available yet — please wait a few minutes and try again.",
    revertDisputeTimeExpired:
      "The review window for this order has closed.",
    revertInvalidOrderStatus:
      "This order isn't in a state where a report can be filed yet. Wait for it to expire or be completed.",
    revertCannotRaiseTwice:
      "A report has already been filed on this order.",
    revertAlreadySettled:
      "This order's report has already been resolved.",
    revertInvalidOrderType:
      "Reports aren't supported for this order type.",
  },

  userSupport: {
    reconnectHint: "Your support session needs to reconnect.",
    reconnecting: "Reconnecting…",
    reconnect: "Reconnect",
    loadingConversation: "Loading conversation…",
    empty:
      "No messages yet. Send a message and the support team will reply here.",
    loadFailed: "Couldn't load the conversation. Retrying…",
    closedBySupport: "This conversation has been closed by support.",
    messageAria: "Message",
    placeholder: "Write a message…",
    authFailed: "We couldn't verify your wallet for support.",
    sendConversationNotReady:
      "Support isn't ready yet. Please try again in a moment.",
    sendTooLong: "Message is too long (max {max} characters).",
    sendEmpty: "Please write a message first.",
    sendUnavailable:
      "Support is temporarily unavailable. Please try again shortly.",
    sendFailed: "Your message couldn't be sent. Please try again.",
  },

  opsSupport: {
    p2pTag: "P2P tag",
    p2pTagAria: "P2P tag",
    clearTag: "Clear",
    tagAwaitingUser: "Awaiting user",
    tagReviewing: "Reviewing",
    tagEvidence: "Evidence",
    tagEscalated: "Escalated",
    noConversation: "No conversation",
    statusOpen: "open",
    statusPending: "pending",
    statusSnoozed: "snoozed",
    statusResolved: "resolved",
    loadingConversation: "Loading conversation…",
    noMessages: "No messages yet.",
    loadFailed: "Couldn't load the conversation. Retrying…",
    resolvedFooter:
      "This conversation is resolved. Set the status back to open to reply.",
    replyAria: "Reply",
    replyPlaceholder: "Write a reply…",
    resolveChat: "Resolve chat",
    resolveTitle: "Resolve this chat?",
    resolveBody:
      "The user's input is locked and they see a \"chat closed\" notice. Set the status back to open to reply again.",
    resolve: "Resolve",
    resolving: "Resolving…",
    customer: "Customer",
    orderLabel: "Order {shortId}",
  },

  p2pTag: {
    chatClosedBySupport: "Chat closed by support",
    awaitingUser: "Awaiting your reply",
    reviewing: "Our team is reviewing",
    evidence: "We need a bit more info",
  },

  paymentAddress: {
    encryptedHint:
      "Encrypted and shared securely once your order is accepted.",
    required: "{label} required",
    labelUpi: "UPI handle",
    labelPix: "PIX key",
    labelIban: "IBAN",
    labelBankAccount: "Bank account",
    labelPayNow: "PayNow ID",
    labelClabe: "CLABE",
    labelFallback: "Payment address",
    placeholderInr: "name@upi",
    placeholderBrl: "PIX key (CPF, email, phone, or random)",
    placeholderEur: "IBAN (e.g. DE89370400440532013000)",
    placeholderUsd: "Bank account number",
    placeholderSgd: "PayNow ID",
    placeholderMxn: "18-digit CLABE",
    placeholderFallback: "Payment address",
    errUpi: "UPI handle must look like name@bank (e.g. example@upi)",
    errPixRequired:
      "PIX key required (CPF, CNPJ, email, phone, or random key)",
    errPixInvalid: "Invalid PIX key",
    errIban: "IBAN format: CC## + alphanumerics (no spaces)",
    errUsd: "Account number required (digits only)",
    errSgd: "PayNow ID required (NRIC, mobile, or UEN)",
    errMxn: "CLABE must be 18 digits",
    errFallback: "Payment address required",
    errCpf: "CPF key must be 11 digits, got {n}: {raw}",
    errCnpj: "CNPJ key must be 14 digits, got {n}: {raw}",
    errPhone:
      "Phone key should resolve to +55 + area code + number, got: {raw}",
    errEmail: "Invalid email key: {raw}",
    errEvp: "Invalid random/EVP key, expected UUID format: {raw}",
  },

  currency: {
    UPI_ID: "UPI ID",
    PIX_ID: "PIX ID",
    ALIAS_ID: "Alias",
    CLABE_ID: "CLABE",
    PHONE_NUMBER: "phone number",
    ACCOUNT_NUMBER: "account number",
    PAGO_MOVIL_DETAILS: "Pago Movil details",
    PHONE_NUMBER_FIELD: "Phone number",
    ACCOUNT_NUMBER_FIELD: "Account number",
    ACCOUNT_NUMBER_LABEL: "Account number",
    BANK_NAME_LABEL: "Bank name",
    BANK_LABEL: "Bank",
    RIF_LABEL: "RIF",
    paymentFallback: "Payment",
  },

  errors: {
    walletRejected:
      "Transaction was rejected in your wallet. Approve it to continue.",
    walletInsufficient:
      "Your wallet doesn't have enough funds for this transaction (including gas).",
    revertUnknown:
      "The transaction reverted on-chain for an unrecognized reason. Please try again or contact support.",
    revertNamedFallback:
      "The transaction reverted on-chain ({name}).",
    networkTimeout:
      "The network is slow to respond. Please try again in a moment.",
    networkUnreachable:
      "Couldn't reach the network. Check your connection and try again.",
    unknown: "Something went wrong. Please try again.",

    noMerchants:
      "No eligible P2P merchants were found to fulfill this transaction.",
    missingRouting:
      "This widget is missing required setup to find a merchant. Please contact the site owner.",
    encryptionPreflight:
      "Couldn't initialize secure messaging. Reload the page — if it keeps failing, contact support.",
    encryptionFailed:
      "Couldn't encrypt your payment details. Try again — if it persists, contact support.",
    orderBadStatus:
      "This order has moved on and can't be retried from here. Refresh to see its current state.",
    screeningApi:
      "Fraud screening is temporarily unavailable. Your order can still proceed.",
    screeningRestricted:
      "We saw unusual activity - pls wait for sometime as a minor update",
    screeningRejected:
      "This order cannot be processed. Please contact support if you believe this is in error.",
    livenessRequired:
      "Quick human check required before you can continue.",

    b2bProxyMismatch:
      "This payment route is misconfigured. Please contact support — the on-chain integrator address does not match what's registered.",
    b2bIntegratorInactive:
      "This payment route is currently unavailable. Please try again later — the integrator has been deactivated on-chain.",
    b2bRejectedOrder:
      "The merchant integrator rejected this order. You may have hit a per-tx, per-user, or daily limit.",
    b2bCallerNotContract:
      "The transaction was sent from an unsupported address. This should never happen during normal checkout — please report it.",
    b2bProxyBadState:
      "On-chain proxy is in a bad state. Please contact support.",
    b2bProxyOwnerZero:
      "On-chain proxy is uninitialised. Please contact support.",
    b2bProxyImplLocked:
      "This integrator was registered with a different proxy template and cannot be updated in place.",
    notEnoughMerchants:
      "No eligible P2P merchants were found to fulfill this transaction.",
    exchangeNotOperational:
      "The P2P exchange is temporarily disabled. Please try again later.",
    userBlacklisted:
      "This wallet has been blocked from placing orders. Contact support if you believe this is a mistake.",
    zeroReputation:
      "Your account doesn't yet have the reputation required to place this order.",
    orderExpired: "This order has expired. Please start a new one.",
    invalidAddress: "An on-chain address was rejected as invalid.",
    invalidAmount: "The order amount was rejected as invalid on-chain.",
    currencyNotSupported:
      "This currency isn't currently supported on-chain.",
    usdtTransferFailed:
      "USDC transfer failed — please confirm your wallet has the balance + allowance and try again.",
    dailyBuyLimit: "You've hit today's buy-order limit. Try again tomorrow.",
    monthlyBuyLimit:
      "You've hit this month's buy-order limit. Try again next month.",
    dailyPlacementLimit:
      "You've placed too many orders today. Please try again later.",
    buyAmountLimit:
      "The buy amount exceeds the protocol's per-order limit.",
    sellAmountLimit:
      "The sell amount exceeds the protocol's per-order limit.",
    dailyVolume: "You've hit today's volume limit. Try again tomorrow.",
    yearlyVolume: "You've hit this year's volume limit.",
    upiAlreadySent:
      "Payment details were already submitted for this order.",
    invalidOrderUpi:
      "Your payment address could not be accepted by the protocol.",
    orderAlreadyCancelled: "This order was already cancelled.",
  },
} as const;

export type Messages = {
  -readonly [K in keyof typeof en]: {
    -readonly [P in keyof (typeof en)[K]]: string;
  };
};
