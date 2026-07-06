# Liveness gate (anti-sybil) for `<Checkout>`

A one-time "verify you're a real human" check that the **widget runs for you**.
It exists to stop sybil/bot spam on integrators where per-wallet limits aren't
enough (a bot just spins up fresh wallets to reset them). Built for LotPot, but
it works for any integrator that opts in — and is invisible to every integration
that doesn't.

## How it works

The **fraud engine decides who needs to verify** — the check is scoped to
flagged (suspect) wallets, not thrown at everyone. It rides on the `screening`
integration (see [Fraud screening](./fraud-screening.md)), so wire that too.

1. On mount the widget does a **verify-once read** of `livenessVerified(userWallet)`
   on the integrator. If the user is already verified (or the gate is off) they
   are **cleared** and never see a prompt — they only ever verify once.
2. On **Pay**, the screening call runs. If the fraud engine returns
   `liveliness_required: true` (the wallet is in a sybil/fingerprint cluster or
   has rapid cancellations) **and** the user isn't cleared, the order is held and
   a **"Quick human check"** screen appears. Cleared users and non-flagged users
   pass straight through — no prompt.
3. The user taps **Verify I'm human** → a hosted liveness wizard opens in a popup
   → quick selfie liveness check → the widget submits the attestation on-chain
   (`submitLivenessAttestation`) → they're cleared → they tap Pay again and
   checkout continues.

The popup keeps your page mounted (no full-page redirect). Verification is
recorded **on-chain** (`livenessVerified[wallet]`), so it persists across
sessions and devices — verify once, never again.

> The widget does **not** blanket-gate on `livenessRequired()`. The integrator
> (V2 `LivenessGate`, "suspect-only" mode) enforces on-chain only against
> fraud-engine-flagged wallets, so gating every non-verified user client-side
> would over-prompt. The on-chain `validateOrder` is the authoritative backstop;
> the widget prompt is the friendly pre-check driven by the same suspect signal.

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

That's the whole frontend change (in addition to wiring `screening`). The gate is
**dynamic**: a wallet is only prompted once the fraud engine flags it as a
suspect (`setLivenessSuspect` on V2) and the integrator owner has armed the gate
(`setLivenessRequired(true)`), so you can ship this prop now and turn enforcement
on/off server-side with no redeploy.

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

## Two-integrator migration

When you cut over from an OLD integrator to a NEW one and run **both live for a
window** — routing users with redeemable credit to the OLD integrator and
everyone else to the NEW one — liveness applies to the **NEW** integrator only
(the OLD one has no `LivenessGate`). You **don't** need to tell the widget which
integrator an order routes to: because the prompt is driven by the fraud engine's
**suspect** flag (not a blanket read), it naturally targets the right wallets.
Just point `integratorAddress` at the NEW integrator:

```tsx
<Checkout
  /* … */
  screening={{ /* … fraud-engine config … */ }}   // required — drives the trigger
  liveness={{
    integratorAddress: "0xNEW_INTEGRATOR",         // the one that enforces liveness
    proxyUrl: "https://liveness-proxy-production.up.railway.app",
    tenant: "lotpot",
  }}
/>
```

Why no credit-based exemption is needed:
- A **fresh sybil** has no OLD-integrator credit → routes to NEW → the fraud
  engine flags the cluster → prompted + enforced on-chain.
- A **legitimate OLD-credit user** isn't in a sybil cluster → never flagged →
  never prompted, regardless of which integrator they route to.
- The only over-prompt is a wallet that is **both** flagged **and** holds OLD
  credit — a near-empty set; asking a flagged wallet to prove personhood is
  reasonable, and it still transacts on the gate-less OLD integrator.

Enforcement note: the fraud engine flags suspects on-chain (`setLivenessSuspect`
on V2) and V2's `validateOrder` reverts flagged-unverified orders — the
authoritative backstop. A flagged user who still holds OLD credit could transact
on the gate-less OLD integrator up to that credit; this is bounded and drains
out, and is a contract/router decision, not a widget one.

## Backward compatibility

- No `liveness` prop → feature off (default; every existing integration is
  untouched).
- The widget never blanket-gates on `livenessRequired()`; the prompt is only
  ever triggered by the fraud engine's `liveliness_required`. No `screening` →
  no liveness prompt.
- `liveness` set but the integrator's gate is off, the user is already verified,
  or the read fails → treated as **cleared** (the on-chain `validateOrder` is the
  authoritative backstop).
