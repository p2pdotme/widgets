// sessionStorage-backed ops session cache (D-027-v2).
//
// Distinct from the customer cache in `sessionCache.ts` in three ways:
//
//  1. **Store**: `window.sessionStorage` (tab-scoped) rather than
//     localStorage. An ops JWT carries elevated scope and should not
//     outlive the tab.
//  2. **Key**: `@P2PME-OPS:BRIDGE_SESSION:<addr lc>` — keyed by address
//     ONLY (not by bridgeUrl or orderId). One operator identity per tab.
//  3. **Isolation**: never touches the customer localStorage lane, so the
//     two caches can coexist without cross-pollination.
//
// `ensureOpsSession` flight-guards concurrent callers (review item #18):
// the panel mounts and polls may both request a session before the first
// sign-in settles. A module-level promise map collapses concurrent
// requests for the same address into one `/auth/sign-in` round-trip.

import { signInWithBridge } from "../api/bridge";
import type { SignInResponse } from "./sessionCache";
import type { SupportSigner } from "../types";

const OPS_CACHE_PREFIX = "@P2PME-OPS:BRIDGE_SESSION:";
const EXPIRY_BUFFER_MS = 60_000;

export function opsCacheKey(address: string): string {
  return `${OPS_CACHE_PREFIX}${address.toLowerCase()}`;
}

export function readOpsSession(address: string): SignInResponse | null {
  if (typeof window === "undefined") return null;
  const key = opsCacheKey(address);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SignInResponse;
    // Review item #17: validate expiresAt is a NUMBER before the arithmetic
    // comparison — a string would coerce and silently pass `> Date.now()`.
    if (
      !parsed.sessionToken ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt - EXPIRY_BUFFER_MS <= Date.now()
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeOpsSession(
  address: string,
  session: SignInResponse,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(opsCacheKey(address), JSON.stringify(session));
  } catch {
    // Quota exceeded or storage disabled. Cache miss next time is acceptable.
  }
}

export function clearOpsSession(address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(opsCacheKey(address));
  } catch {
    // ignore
  }
}

// Flight guard: collapse concurrent sign-ins for the same address.
const inFlight = new Map<string, Promise<SignInResponse | null>>();

/** Test-only: drop any in-flight sign-in promises between cases. */
export function __resetOpsFlightForTests(): void {
  inFlight.clear();
}

/**
 * Return a valid ops session for the signer. Reads the ops cache first;
 * on a miss, signs in (the bridge resolves the role to "ops" or
 * "circle_admin"), writes the ops cache, and returns. Concurrent calls for
 * the same address share one in-flight sign-in.
 */
export async function ensureOpsSession(opts: {
  signer: SupportSigner;
  bridgeUrl: string;
}): Promise<SignInResponse | null> {
  const cached = readOpsSession(opts.signer.address);
  if (cached) return cached;

  const key = opts.signer.address.toLowerCase();
  const existing = inFlight.get(key);
  if (existing) return existing;

  if (!opts.signer.signMessage) return null;

  const promise = (async () => {
    const fresh = await signInWithBridge({
      signer: opts.signer,
      bridgeUrl: opts.bridgeUrl,
    });
    writeOpsSession(opts.signer.address, fresh);
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
