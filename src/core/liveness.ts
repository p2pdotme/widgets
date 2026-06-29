/**
 * Opt-in liveness gate. When the host passes a `liveness` config and the
 * integrator has the gate enabled on-chain (`livenessRequired()`), the widget
 * makes a non-verified user complete a one-time simple-kyc liveness check
 * before placing an order. It stays integrator-agnostic: no config, a read that
 * reverts (integrator without the gate), or an already-verified user all resolve
 * to "ok" so every other integration is unaffected.
 *
 * The pure decision (`computeLivenessGate`) is unit-tested; the browser flow
 * (`createLivenessSession` / `openVerifyPopup` / `redeemLivenessAttestation`)
 * is exercised by the order machine.
 */

/** On-chain liveness state for a user on a given integrator. */
export interface LivenessStatus {
  /** `livenessRequired()` on the integrator. */
  required: boolean;
  /** `livenessVerified(user)` on the integrator. */
  verified: boolean;
}

/** Gate decision. "loading" until the on-chain read resolves. */
export type LivenessGate = "loading" | "ok" | "required";

/**
 * Pure gate decision.
 * - no `liveness` config            → "ok" (feature off for this integration)
 * - status not yet read             → "loading"
 * - on-chain gate off               → "ok"
 * - gate on + user already verified → "ok" (verify-once)
 * - gate on + user not verified     → "required"
 */
export function computeLivenessGate(
  status: LivenessStatus | null,
  hasConfig: boolean,
): LivenessGate {
  if (!hasConfig) return "ok";
  if (status === null) return "loading";
  if (!status.required) return "ok";
  return status.verified ? "ok" : "required";
}

/** The on-chain attestation handed back by the liveness proxy, ready for
 *  `submitLivenessAttestation(bytes32,uint256,uint256,bytes)`. */
export interface LivenessAttestation {
  nullifier: `0x${string}`;
  limit: bigint;
  expiry: bigint;
  signature: `0x${string}`;
}

/**
 * Create a hosted liveness session via the proxy (which injects the
 * service's X-API-Key server-side) and return the wizard URL.
 */
export async function createLivenessSession(
  proxyUrl: string,
  body: { wallet_pubkey: string; redirect_uri: string; tenant: string; state: string },
): Promise<{ widget_url: string }> {
  const res = await fetch(`${proxyUrl}/v1/widget/public-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`liveness session failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/** Redeem the one-time `code` for the on-chain attestation (PII dropped by the proxy). */
export async function redeemLivenessAttestation(
  proxyUrl: string,
  code: string,
): Promise<LivenessAttestation> {
  const res = await fetch(`${proxyUrl}/v1/widget/attestation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(`liveness attestation failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const j = await res.json();
  return {
    nullifier: j.nullifier,
    limit: BigInt(j.limit),
    expiry: BigInt(j.expiry),
    signature: j.signature,
  };
}

/**
 * Open the hosted wizard in a popup and resolve the one-time `code` once the
 * wizard redirects back to our own origin (`?code&state`). Keeps the checkout
 * mounted — no full-page navigation. Resolves `null` if the popup is blocked or
 * the user closes it before finishing.
 *
 * Cross-origin reads of `popup.location` throw while the wizard is on its own
 * origin; we swallow those and only read once it lands back on `returnOrigin`.
 */
export function openVerifyPopup(
  widgetUrl: string,
  returnOrigin: string,
  expectedState: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const popup = window.open(widgetUrl, "p2p-liveness", "width=480,height=760");
    if (!popup) {
      resolve(null); // blocked
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      try {
        if (popup.closed || Date.now() - started > timeoutMs) {
          window.clearInterval(timer);
          if (!popup.closed) popup.close();
          resolve(null);
          return;
        }
        const href = popup.location.href; // throws until same-origin
        if (href && href.startsWith(returnOrigin)) {
          const u = new URL(href);
          const code = u.searchParams.get("code");
          const state = u.searchParams.get("state");
          if (code && state === expectedState) {
            window.clearInterval(timer);
            popup.close();
            resolve(code);
          }
        }
      } catch {
        /* still on the wizard's origin — keep polling */
      }
    }, 400);
  });
}
