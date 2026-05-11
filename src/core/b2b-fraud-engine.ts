import {
  encryptPayload,
  getSignedHeaders,
  type FraudEngineSigner,
} from "@p2pdotme/sdk/fraud-engine";
import type {
  CheckoutSigner,
  PlaceOrderResult,
  ScreeningConfig,
} from "../types";

interface ProcessArgs {
  signer: CheckoutSigner;
  screening: ScreeningConfig;
  placeOrder: () => Promise<PlaceOrderResult>;
}

export async function processB2BBuyOrder(
  args: ProcessArgs,
): Promise<PlaceOrderResult> {
  const fraudSigner = toFraudEngineSigner(args.signer);
  if (!fraudSigner) {
    console.warn(
      "[p2p-widget] screening configured but signer.signMessage is missing; placing order without fraud-engine logging",
    );
    return args.placeOrder();
  }

  let activityLogId: number | null = null;
  try {
    activityLogId = await postB2BActivityLog(fraudSigner, args.screening);
  } catch (err) {
    // Fail-open: a fraud-engine outage must not block a buy.
    console.warn("[p2p-widget] B2B fraud-engine log failed", err);
  }

  const result = await args.placeOrder();

  if (activityLogId !== null) {
    void linkOrder(
      fraudSigner,
      args.screening,
      activityLogId,
      result.orderId,
    ).catch((err) =>
      console.warn(
        "[p2p-widget] B2B link-order failed (order is placed regardless)",
        err,
      ),
    );
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
): Promise<number> {
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
  });

  const encrypted = await encryptPayload(payload, aad, screening.encryptionKey);
  const headers = await getSignedHeaders(signer, "activity-log");

  const url = `${trimSlash(screening.apiUrl)}/activity-logs/b2b-buy-order`;
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
    throw new Error(`B2B activity-log returned ${res.status}`);
  }
  const data = (await res.json()) as { activity_log_id: number | null };
  if (data.activity_log_id == null) {
    throw new Error("B2B activity-log returned without activity_log_id");
  }
  return data.activity_log_id;
}

async function linkOrder(
  signer: FraudEngineSigner,
  screening: ScreeningConfig,
  activityLogId: number,
  orderId: string,
): Promise<void> {
  const headers = await getSignedHeaders(signer, "link-order");
  const url = `${trimSlash(screening.apiUrl)}/activity-logs/link-order`;
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
    throw new Error(`link-order returned ${res.status}`);
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
