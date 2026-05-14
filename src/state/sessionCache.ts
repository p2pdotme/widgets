// localStorage-backed session cache, per D-024-v2.
//
// Two cache lanes share the same store:
//
// - **Wallet lane** (no orderId): keyed by `bridgeUrl + lowercased address`.
//   Holds the response from a sign-in call that did not carry an `orderId`
//   in the body. `chatwoot` will be null in this response — it's enough
//   to keep the user signed in and let `/auth/me` / `/tickets/me` work
//   without a fresh signature.
//
// - **Per-order lane** (with orderId): keyed by
//   `bridgeUrl + lowercased address + orderId`. Holds the response from a
//   sign-in call bound to a specific order, so `chatwoot` carries the
//   order's circle inbox credentials and `conversationId` points at the
//   per-side thread.
//
// Both lanes refresh on a 60s expiry buffer to dodge clock skew between
// the bridge and the browser.

import type { ChatwootSession } from "../chatwoot/sdk";

export interface SignInResponse {
  ok: true;
  address: string;
  role: "user" | "merchant" | "circle_admin" | "ops";
  circleId?: string;
  chatwoot: ChatwootSession | null;
  sessionToken: string;
  expiresAt: number;
  /** Per-order: returned only when the sign-in body carried an `orderId`. */
  conversationId?: number | null;
}

const CACHE_KEY_PREFIX = "support.p2p.me:session:";
const EXPIRY_BUFFER_MS = 60_000;

export function cacheKey(
  bridgeUrl: string,
  address: string,
  orderId?: string,
): string {
  const trimmedBridge = bridgeUrl.replace(/\/$/, "");
  const base = `${CACHE_KEY_PREFIX}${trimmedBridge}:${address.toLowerCase()}`;
  return orderId ? `${base}:order:${orderId}` : base;
}

export function readCachedSession(
  bridgeUrl: string,
  address: string,
  orderId?: string,
): SignInResponse | null {
  if (typeof window === "undefined") return null;
  const key = cacheKey(bridgeUrl, address, orderId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SignInResponse;
    if (
      !parsed.sessionToken ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt - EXPIRY_BUFFER_MS <= Date.now()
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSession(
  bridgeUrl: string,
  address: string,
  session: SignInResponse,
  orderId?: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(bridgeUrl, address, orderId),
      JSON.stringify(session),
    );
  } catch {
    // Quota exceeded or storage disabled. Cache miss next time is acceptable.
  }
}

export function clearCachedSession(
  bridgeUrl: string,
  address: string,
  orderId?: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cacheKey(bridgeUrl, address, orderId));
  } catch {
    // ignore
  }
}
