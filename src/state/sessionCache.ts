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

import { signInWithBridge } from "../api/bridge";
import type { ChatwootSession } from "../chatwoot/sdk";
import type { SupportSigner } from "../types";

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

// Flight guard: collapse concurrent sign-ins for the same
// (bridgeUrl, address, orderId) into one `/auth/sign-in` round-trip. The
// customer twin of `ensureOpsSession` — a panel mount and its own first poll
// (or a 401 retry racing a poll tick) both request a session before the first
// sign-in settles; without this each would call `signInWithBridge` and pop a
// SEPARATE wallet signature prompt. Keyed by the full per-order cache key so
// sign-ins for different orders do NOT collapse into each other.
const inFlight = new Map<string, Promise<SignInResponse | null>>();

/** Test-only: drop any in-flight sign-in promises between cases. */
export function __resetUserFlightForTests(): void {
  inFlight.clear();
}

/**
 * Return a valid per-order user session for the signer. Reads the customer
 * cache first; on a miss, signs in (binding the `orderId` so the bridge
 * resolves the per-side conversation), writes the cache, and returns.
 * Concurrent calls for the same (bridgeUrl, address, orderId) share one
 * in-flight sign-in, so a single wallet prompt covers them all. Returns null
 * when the signer cannot sign and nothing is cached.
 */
export async function ensureUserSession(opts: {
  signer: SupportSigner;
  bridgeUrl: string;
  orderId: string;
}): Promise<SignInResponse | null> {
  const cached = readCachedSession(
    opts.bridgeUrl,
    opts.signer.address,
    opts.orderId,
  );
  if (cached) return cached;

  const key = cacheKey(opts.bridgeUrl, opts.signer.address, opts.orderId);
  const existing = inFlight.get(key);
  if (existing) return existing;

  if (!opts.signer.signMessage) return null;

  const promise = (async () => {
    const fresh = await signInWithBridge({
      signer: opts.signer,
      bridgeUrl: opts.bridgeUrl,
      orderId: opts.orderId,
    });
    writeCachedSession(opts.bridgeUrl, opts.signer.address, fresh, opts.orderId);
    return fresh;
  })();

  // Track the raw promise; clear on settle so a later sign-in can run.
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}
