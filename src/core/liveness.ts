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
 * Pure verify-once decision. `"ok"` means the user is **cleared** — needs no
 * liveness check — because the integrator's gate is off or they're already
 * verified. The order machine uses `=== "ok"` to set `livenessCleared` (which
 * lets a cleared user bypass a screening `liveliness_required` response); it
 * does NOT blanket-gate on `"required"`, since the prompt trigger is the
 * suspect-scoped screening flag, not this read.
 * - no `liveness` config            → "ok" (feature off for this integration)
 * - status not yet read             → "loading"
 * - on-chain gate off               → "ok"  (cleared)
 * - gate on + user already verified → "ok"  (cleared, verify-once)
 * - gate on + user not verified     → "required" (not cleared)
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
 * wizard hands the result back. Keeps the checkout mounted — no full-page
 * navigation. Resolves `null` if the popup is blocked, the user closes it, or
 * it times out before finishing.
 *
 * Transport: the hosted wizard, when it has an opener (a popup), **postMessages**
 * the result to this window — `{ type: "verify:complete", code, state }` on
 * success, `{ type: "verify:error", ... }` otherwise — using the tenant's
 * allowlisted `web_origins` as the `targetOrigin` (so it can only reach an
 * allowlisted host). We verify the sender origin and the `state` we minted. A
 * location-poll of `popup.location` is kept as a fallback for the webview /
 * redirect build of the wizard (which navigates back to `returnOrigin?code`
 * instead of posting); cross-origin reads throw until it lands same-origin, so
 * we swallow those.
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
    let widgetOrigin = "";
    try {
      widgetOrigin = new URL(widgetUrl).origin;
    } catch {
      /* relative/malformed URL — fall back to the poll transport only */
    }
    const started = Date.now();
    let settled = false;
    let timer = 0;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      if (timer) window.clearInterval(timer);
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* cross-origin close guard */
      }
      resolve(value);
    };

    // Primary transport: the wizard postMessages the result to its opener.
    const onMessage = (e: MessageEvent) => {
      if (widgetOrigin && e.origin !== widgetOrigin) return;
      const data = e.data as { type?: string; code?: string; state?: string } | null;
      if (!data || data.state !== expectedState) return;
      if (data.type === "verify:complete" && data.code) finish(data.code);
      else if (data.type === "verify:error") finish(null);
    };
    window.addEventListener("message", onMessage);

    // Fallback: closed/timed-out popup, plus the redirect build's ?code&state.
    timer = window.setInterval(() => {
      try {
        if (popup.closed || Date.now() - started > timeoutMs) {
          finish(null);
          return;
        }
        const href = popup.location.href; // throws until same-origin
        if (href && href.startsWith(returnOrigin)) {
          const u = new URL(href);
          const code = u.searchParams.get("code");
          const state = u.searchParams.get("state");
          if (code && state === expectedState) finish(code);
        }
      } catch {
        /* still on the wizard's origin — keep polling */
      }
    }, 400);
  });
}
