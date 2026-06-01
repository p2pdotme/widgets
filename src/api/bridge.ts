// Typed HTTP layer over the bridge. Used by `Support` (per-order sign-in)
// and `OrderHistoryWithSupport` (silent refresh + ticket list). All calls
// trim a trailing slash on `bridgeUrl` so consumers can pass either form.

import type { SignInResponse } from "../state/sessionCache";
import type { SupportSigner } from "../types";

const SIGN_IN_PURPOSE = "support.p2p.me:sign-in";

function trim(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Build the bridge sign-in message. MUST match the bridge's `buildSignMessage`
 * exactly (D-027-v3 §4): `${purpose}:${address.toLowerCase()}:${chainId}:${timestamp}`.
 * `chainId` is bound into the signed string (not merely sent as a sidecar)
 * so a signature cannot be replayed against a verifier on another chain.
 */
export function buildSignMessage(
  address: string,
  chainId: number,
  timestamp: number,
): string {
  return `${SIGN_IN_PURPOSE}:${address.toLowerCase()}:${chainId}:${timestamp}`;
}

export async function signInWithBridge(opts: {
  signer: SupportSigner;
  bridgeUrl: string;
  /** When present, the bridge resolves the per-order Chatwoot session and
   * returns the per-side conversationId. Per D-029. */
  orderId?: string;
}): Promise<SignInResponse> {
  if (!opts.signer.signMessage) {
    throw new Error("signer.signMessage is required to open support");
  }
  // HARD CUTOVER (D-027-v3 §4): chainId is MANDATORY on the support sign-in
  // path. Resolve it live from the connected wallet at sign time — no cached
  // prop, no Base Sepolia fallback. If it cannot be resolved to a finite
  // integer, throw so the signature is never produced against a guessed
  // chain (which the bridge's ERC-1271/6492 verifier would 401 anyway).
  if (!opts.signer.getChainId) {
    throw new Error(
      "support sign-in requires a chainId from the connected wallet",
    );
  }
  const resolved = await opts.signer.getChainId();
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new Error(
      "support sign-in requires a chainId from the connected wallet",
    );
  }
  const chainId = resolved;
  const timestamp = Date.now();
  const message = buildSignMessage(opts.signer.address, chainId, timestamp);
  const signature = await opts.signer.signMessage(message);
  const res = await fetch(`${trim(opts.bridgeUrl)}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: opts.signer.address,
      chainId,
      timestamp,
      signature,
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`sign-in failed (${res.status}): ${text}`);
  }
  return (await res.json()) as SignInResponse;
}

export interface AuthMeResponse {
  sub: string;
  role: "user" | "merchant" | "circle_admin" | "ops";
  circle_id?: string;
}

/** Returns null when the bearer is expired or rejected. Throws on network
 * or 5xx so callers can surface real failures. */
export async function fetchAuthMe(opts: {
  bridgeUrl: string;
  sessionToken: string;
}): Promise<AuthMeResponse | null> {
  const res = await fetch(`${trim(opts.bridgeUrl)}/auth/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${opts.sessionToken}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`auth/me failed (${res.status})`);
  }
  return (await res.json()) as AuthMeResponse;
}

export interface TicketSummary {
  conversationId: number;
  orderId: string | null;
  status: string;
  updatedAt: number | null;
}

export async function fetchTicketsMe(opts: {
  bridgeUrl: string;
  sessionToken: string;
}): Promise<TicketSummary[]> {
  const res = await fetch(`${trim(opts.bridgeUrl)}/tickets/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${opts.sessionToken}` },
  });
  if (!res.ok) {
    if (res.status === 503) return [];
    throw new Error(`tickets/me failed (${res.status})`);
  }
  const body = (await res.json()) as { items?: TicketSummary[] };
  return body.items ?? [];
}
