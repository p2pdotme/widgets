# Liveness gate (anti-sybil) for `<Checkout>`

A one-time "verify you're a real human" check that the **widget runs for you**.
It exists to stop sybil/bot spam on integrators where per-wallet limits aren't
enough (a bot just spins up fresh wallets to reset them). Built for LotPot, but
it works for any integrator that opts in — and is invisible to every integration
that doesn't.

## How it works

When you pass a `liveness` config, before showing **Pay** the widget:

1. reads `livenessRequired()` on the integrator. If it's `false` (or the
   integrator doesn't implement the gate, or you didn't pass `liveness`) →
   **nothing changes**, the normal flow runs.
2. reads `livenessVerified(userWallet)`. If `true` → the user already verified
   (**they only ever do it once**) → normal flow.
3. otherwise shows a **"Quick human check"** screen. The user taps **Verify I'm
   human** → a hosted liveness wizard opens in a popup → they do a quick selfie
   liveness check → the widget submits the attestation on-chain
   (`submitLivenessAttestation`) → the gate clears → checkout continues.

The popup keeps your page mounted (no full-page redirect). Verification is
recorded **on-chain** (`livenessVerified[wallet]`), so it persists across
sessions and devices — verify once, never again.

> One human = one verified wallet (the simple-kyc nullifier is single-use per
> person). A normal one-wallet user verifies once and is done; a bot farm can't
> verify thousands of wallets. That's the anti-sybil property — and the reason a
> single person can't verify a second wallet on the same integrator.

## Enabling it (host)

Bump `@p2pdotme/widgets` and add one prop:

```tsx
import { Checkout } from "@p2pdotme/widgets/checkout";

<Checkout
  /* …all your existing props (signer, placeOrder, currencies, …) … */
  liveness={{
    integratorAddress: "0xYOUR_LOTPOT_V2",                          // the integrator to gate
    proxyUrl: "https://liveness-proxy-production.up.railway.app",   // simple-kyc liveness proxy
    tenant: "lotpot",                                              // your simple-kyc tenant slug
  }}
/>
```

That's the whole frontend change. The gate is **dynamic**: it only activates
when the integrator owner turns it on-chain (`setLivenessRequired(true)`), so you
can ship this prop now and flip the gate on/off server-side with no redeploy.

Requirements already satisfied by `<Checkout>`:
- the `signer` you already pass is used to submit the attestation tx (gasless if
  it's an embedded/sponsored wallet; otherwise the user pays a small gas fee);
- `chainId` / `rpcUrl` are reused for the on-chain reads.

The user's browser must allow the verification **popup** (it's opened on a user
click, so it normally isn't blocked).

## Prerequisites (one-time, ops)

**On-chain** (integrator owner): deploy the liveness-enabled integrator, then
`setLivenessAttestor(0x6cC780E44f9Ac850e6D6B8f52A5663286F1A2978)` (the liveness
service signer) and `setLivenessRequired(true)`.

**simple-kyc** (give this to the simple-kyc team):
- Create a **liveness tenant** bound to the integrator:
  `slug = lotpot`, `chain_id = 8453` (Base mainnet),
  `contract_address = <LotPot V2 address>`, `limit_usdc = 20` (placeholder — not
  enforced on-chain), `redirect_uris = https://lotpot.fun/en/play`,
  `web_origins = https://lotpot.fun`.
- Add `https://lotpot.fun` to the **liveness-proxy** `ALLOWED_ORIGINS` (CORS).

`tenant` / `integratorAddress` in the `liveness` prop must match the tenant's
slug / `contract_address`, and the page you embed `<Checkout>` on must be one of
the tenant's `redirect_uris`.

## Two-integrator migration (credit exemption)

When you cut over from an OLD integrator to a NEW one and run **both live for a
window** — routing users with redeemable credit to the OLD integrator and
everyone else to the NEW one — liveness should apply to the NEW integrator only.
Users still redeeming credit on the OLD integrator (which has no liveness gate)
must never see the verify step.

Set `exemptWhenCreditPositive: true` and point `integratorAddress` at the NEW
integrator:

```tsx
<Checkout
  /* … */
  fetchCredit={readCreditOnOldIntegrator}        // > 0 → routed to OLD
  fetchPendingOrders={readPendingOrders}
  liveness={{
    integratorAddress: "0xNEW_INTEGRATOR",        // the one that enforces liveness
    proxyUrl: "https://liveness-proxy-production.up.railway.app",
    tenant: "lotpot",
    exemptWhenCreditPositive: true,               // credit>0 users skip the gate
  }}
/>
```

Behavior:
- **credit > 0** (routed to OLD) → **exempt**: no on-chain liveness read, no
  verify prompt, and a screening-triggered `liveliness_required` is honored as
  already-cleared (they proceed).
- **credit == 0** (routed to NEW) → **gated normally** against
  `integratorAddress`.
- **credit still loading** → the Pay button holds rather than deciding on stale
  zero-credit, so a NEW-integrator user is never briefly exempted.

Requires the credit gate wired (`fetchCredit` **and** `fetchPendingOrders`) —
`exemptWhenCreditPositive` reuses the same credit read. Without it, credit reads
as `0n` and **every** user is gated (safe default). Once the OLD integrator is
fully drained you can drop the flag (post-migration everyone has zero credit, so
it's a no-op either way).

## Backward compatibility

- No `liveness` prop → feature off (default; every existing integration is
  untouched).
- `liveness` set but the integrator doesn't implement the gate, or the read
  fails → treated as off (fail-open; the integrator's own `validateOrder` is the
  authoritative backstop).
- Gate on but user already verified → no prompt.
- `exemptWhenCreditPositive` defaults to `false` → no change unless you opt in.
