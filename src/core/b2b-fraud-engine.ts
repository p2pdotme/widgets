import {
  encryptPayload,
  getFingerprint,
  getSignedHeaders,
  type FraudEngineSigner,
} from "@p2pdotme/sdk/fraud-engine";
import type {
  CheckoutSigner,
  PlaceOrderResult,
  ScreeningConfig,
} from "../types";
import {
  classifyError,
  logP2PError,
  screeningApiError,
  screeningRejectedError,
  type P2PErrorContext,
} from "./errors";

interface B2BScreeningResponse {
  activity_log_id: number | null;
  approved?: boolean;
  reason?: string | null;
  message?: string | null;
  restricted_until?: string | null;
}

interface ProcessArgs {
  signer: CheckoutSigner;
  screening: ScreeningConfig;
  placeOrder: () => Promise<PlaceOrderResult>;
}

export async function processB2BBuyOrder(
  args: ProcessArgs,
): Promise<PlaceOrderResult> {
  const ctx: P2PErrorContext = {
    flow: "screening",
    user: args.signer?.address,
  };
  const fraudSigner = toFraudEngineSigner(args.signer);
  if (!fraudSigner) {
    console.warn(
      "[p2p-widget:screening] screening configured but signer.signMessage is missing; placing order without fraud-engine logging",
    );
    return args.placeOrder();
  }

  // Fire-and-await fingerprint log first, with a short timeout.
  // Doing this before the activity log ensures the backend cluster
  // gate sees the most up-to-date wallet→fingerprint mapping for
  // this device/domain. Failures are fail-open: a missing
  // fingerprint must never block a buy.
  try {
    await postFingerprintLog(fraudSigner, args.screening);
  } catch (err) {
    logP2PError(classifyError(err, ctx));
  }

  // Fail-open semantics: transport-level errors (network, 5xx,
  // signing) get logged and the order proceeds. Explicit
  // `approved=false` from the backend, however, is a hard reject —
  // we MUST NOT call placeOrder in that case.
  let screeningResponse: B2BScreeningResponse | null = null;
  try {
    screeningResponse = await postB2BActivityLog(fraudSigner, args.screening);
  } catch (err) {
    logP2PError(classifyError(err, ctx));
  }

  if (screeningResponse && screeningResponse.approved === false) {
    throw screeningRejectedError(screeningResponse, ctx);
  }

  const activityLogId = screeningResponse?.activity_log_id ?? null;
  const result = await args.placeOrder();

  if (activityLogId !== null) {
    void linkOrder(
      fraudSigner,
      args.screening,
      activityLogId,
      result.orderId,
    ).catch((err) => logP2PError(classifyError(err, { ...ctx, orderId: result.orderId })));
  }

  return result;
}

function toFraudEngineSigner(s: CheckoutSigner): FraudEngineSigner | null {
  if (!s.signMessage) return null;
  return {
    address: s.address,
    signerAddress: s.signerAddress ?? s.address,
    signMessage: s.signMessage,
  };
}

async function postB2BActivityLog(
  signer: FraudEngineSigner,
  screening: ScreeningConfig,
): Promise<B2BScreeningResponse> {
  const userAddress = signer.address.toLowerCase();
  const timestamp = Date.now();
  const aad = `b2b_buy_order|${userAddress}|${timestamp}`;

  const od = screening.orderDetails ?? {};
  const ud = screening.userDetails ?? {};
  const payload = JSON.stringify({
    user_details: {
      currency: ud.currency,
      country: ud.country,
      language: ud.language,
      login_method: ud.loginMethod,
      login_email: ud.loginEmail,
      login_phone: ud.loginPhone,
    },
    transaction_details: {
      crypto_amount: od.cryptoAmount,
      fiat_amount: od.fiatAmount,
      currency: od.currency,
      recipient_address: od.recipientAddress,
      fee: od.fee,
      amount_after_fee: od.amountAfterFee,
      payment_method: od.paymentMethod,
      estimated_processing_time: od.estimatedProcessingTime,
      order_timestamp: timestamp,
      order_source: screening.orderSource,
    },
    device_details: getMinimalDeviceDetails(),
    // Used by the backend B2B cluster gate to scope rejection to
    // the originating product domain. Ecosystem wallets shared
    // across products are not blocked across the whole ecosystem.
    domain: getDomain(),
  });

  const encrypted = await encryptPayload(payload, aad, screening.encryptionKey);
  const headers = await getSignedHeaders(signer, "activity-log");

  const endpoint = "/activity-logs/b2b-buy-order";
  const url = `${trimSlash(screening.apiUrl)}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      user_address: userAddress,
      timestamp,
      encrypted_payload: encrypted,
    }),
  });
  if (!res.ok) {
    throw screeningApiError(res.status, endpoint, {
      flow: "screening",
      user: userAddress,
    });
  }
  const data = (await res.json()) as B2BScreeningResponse;
  // Reject responses legitimately omit activity_log_id only when the
  // backend short-circuited before persisting (shouldn't happen, but
  // defensively allow null on approved=false). For approved!=false
  // we still require activity_log_id so the post-tx /link-order call
  // has something to bind to.
  if (data.approved !== false && data.activity_log_id == null) {
    throw screeningApiError(200, `${endpoint} (missing activity_log_id)`, {
      flow: "screening",
      user: userAddress,
    });
  }
  return data;
}

async function linkOrder(
  signer: FraudEngineSigner,
  screening: ScreeningConfig,
  activityLogId: number,
  orderId: string,
): Promise<void> {
  const headers = await getSignedHeaders(signer, "link-order");
  const endpoint = "/activity-logs/link-order";
  const url = `${trimSlash(screening.apiUrl)}${endpoint}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      activity_log_id: activityLogId,
      order_id: orderId,
      user_address: signer.address.toLowerCase(),
    }),
  });
  if (!res.ok) {
    throw screeningApiError(res.status, endpoint, {
      flow: "screening",
      user: signer.address,
      orderId,
    });
  }
}

function getMinimalDeviceDetails(): Record<string, unknown> {
  if (typeof navigator === "undefined") return {};
  const screenObj = typeof screen !== "undefined" ? screen : null;
  const tz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  return {
    user_agent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: Array.from(navigator.languages ?? []),
    screen_width: screenObj?.width ?? 0,
    screen_height: screenObj?.height ?? 0,
    device_pixel_ratio:
      typeof window !== "undefined" ? window.devicePixelRatio : 1,
    timezone: tz,
    timezone_offset: new Date().getTimezoneOffset(),
    cookies_enabled: navigator.cookieEnabled,
    do_not_track: navigator.doNotTrack ?? null,
    online: navigator.onLine,
    touch_support: typeof window !== "undefined" && "ontouchstart" in window,
    max_touch_points: navigator.maxTouchPoints ?? 0,
    vendor: navigator.vendor ?? "",
    app_version: navigator.appVersion,
    color_depth: screenObj?.colorDepth ?? 0,
    pixel_depth: screenObj?.pixelDepth ?? 0,
  };
}

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Embedding hostname for B2B contexts. Stripped to hostname so
 * scheme/port don't fragment clusters. Empty string in non-browser
 * envs (SSR, jsdom missing window) — the backend treats empty as
 * "unknown" and skips cluster filtering.
 */
function getDomain(): string {
  if (typeof window !== "undefined" && window.location) {
    return window.location.hostname || "";
  }
  return "";
}

/**
 * POST /fingerprint-log. Fire-before-order so the backend cluster
 * gate sees the freshest wallet→fingerprint mapping for this device.
 * Short timeout + fail-open: a missing fingerprint must not block
 * the buy.
 */
async function postFingerprintLog(
  signer: FraudEngineSigner,
  screening: ScreeningConfig,
): Promise<void> {
  const fingerprintResult = await getFingerprint(3000);
  if (!fingerprintResult) {
    return;
  }
  const userAddress = signer.address.toLowerCase();
  const timestamp = Date.now();
  const aad = `fingerprint|${userAddress}|${timestamp}`;
  const payload = JSON.stringify({
    fingerprint_id: fingerprintResult.visitorId,
    is_b2b: true,
    domain: getDomain(),
  });
  const encrypted = await encryptPayload(payload, aad, screening.encryptionKey);
  const headers = await getSignedHeaders(signer, "fingerprint-log");

  const endpoint = "/fingerprint-log";
  const url = `${trimSlash(screening.apiUrl)}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      user_address: userAddress,
      timestamp,
      encrypted_payload: encrypted,
    }),
  });
  if (!res.ok) {
    throw screeningApiError(res.status, endpoint, {
      flow: "screening",
      user: userAddress,
    });
  }
}
