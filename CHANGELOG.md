# Changelog

All notable changes to `@p2pdotme/widgets` are documented here.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. While
the package is `0.x`, minor releases may introduce additive prop changes;
patch releases stay backward-compatible.

## [1.2.1] — 2026-06-07

### Fixed — Support widget (`<ContactSupport>` / `<OrderAction>`)

- `ContactSupport`: the chat-open effect listed `modalState.kind` in its
  own deps and set it mid-flight, cancelling the in-flight async before
  `openChatwoot` — so the "Loading chat" overlay never dismissed (chat
  opened underneath). The effect is now keyed solely on `chatAttempt`, so
  neither a self-set state nor a prop change re-fires it.
- `OrderAction`: `useNowTick` armed an unconditional 1s `setInterval` in
  every row forever (a per-second render storm across order history). The
  ticker now arms only for time-live rows via a new `OrderActionState.live`
  flag; static / terminal rows never tick. `themeToCssVars` is memoized.

### Changed — Checkout concurrency gate: one in-flight order at a time

- The `<Checkout>` (onramp) pending-order gate now blocks a new placement
  whenever **any** order is pending, regardless of amount or credit. The
  user lands on the "Finish your pending order first" screen and must
  complete or cancel the pending order (with a **Resume that order**
  affordance when `onResumeRequest` is wired) before placing another.
- Removed the previous same-amount **auto-resume** and the credit-gated
  different-amount allowance. Credit still drives the pre-order breakdown
  but no longer affects the block / allow decision. Stale legacy retail
  orders are still filtered out (`keepOnlyB2BPending`) so a "pending
  forever" order can't permanently lock the user out. No public API
  change; internal `computeGateDecision` no longer takes a `credit` arg.

### Changed — Screening rejection copy

- The `user_restricted` screening rejection now surfaces a generic
  "We saw unusual activity — please wait for some time as a minor update"
  message instead of disclosing the repeated-cancellation reason and an
  exact retry countdown. `restrictedUntil` is still carried on the error
  context; the internal `formatRestrictionTime` helper was removed.

## [1.2.0] — 2026-06-06

### Added — Offramp v2 (allocation-funded cashout)

- Opt-in, backward-compatible support for the TradeStars offramp v2
  (per-user-proxy allocation). New `CashoutProps.fetchAvailableOfframp`
  sources the Max / insufficient-amount affordance from an integrator
  allocation instead of the wallet's `balanceOf`.
- Retry-from-cancelled: the offramp machine retains `feeUsdc` and exposes
  `retryPlace` / `canRetryPlace`; the cancelled screen gains a Try-again
  button that re-places a fresh SELL for the same amount.
- `<PaymentHistory>` gains optional `resolveExtraAddresses`, which merges
  the user's per-user-proxy offramp orders (`order.user`) with the EOA's,
  de-duped and re-sorted, bypassing the B2B intersection.

### Changed — chainId-bound multi-signer support sign-in

- Support sign-in (`<Support>` / bridge) is now multi-signer aware
  (EOA + ERC-1271 + ERC-6492). The signed message and `POST /auth/sign-in`
  body bind the wallet's `chainId`
  (`${purpose}:${address}:${chainId}:${timestamp}`) so an ERC-1271
  signature can't be replayed across chains.
- `SupportSigner` gains a `getChainId` resolver; the chainId is resolved
  **live** from the connected wallet at sign time (Privy parses its CAIP-2
  id; Thirdweb reads the active chain). It is **mandatory** — sign-in
  throws before signing/POSTing if it can't be resolved (no default).
  Privy + Thirdweb adapters carry it through.
- **Lockstep / breaking:** must ship together with the companion bridge
  multi-signer release, or sign-in 401s on a message-format mismatch.

## [1.1.2] — 2026-05-27

### Added — B2B order filtering (`<PaymentHistory>`)

- New `b2bOnly`, `integrators`, and `integratorNames` props. In B2B mode
  the canonical order list is intersected with the connected user's
  `b2Borders` subgraph set, so only genuine B2B orders (placed through an
  integrator gateway) render. `integrators` further restricts the list to
  an address allow-list (case-insensitive, implies `b2bOnly`), and rows
  are tagged with their integrator label when the visible list spans more
  than one.
- New `core/b2b-orders` module — `fetchB2BMap` (the `b2Borders`
  user→integrator lookup) plus the pure `filterPendingToB2B` /
  `keepOnlyB2BPending` helpers — shared by the widget and the checkout gate.

### Added — Screening hard-reject + device fingerprint

- The opt-in B2B fraud screening flow now honours a backend
  `approved: false` response as a **hard reject**: the order is not placed
  and a `screeningRejectedError` is passed to `onError`.
- A `POST /fingerprint-log` fires before the order is placed — fail-open
  with a short timeout, so a missing fingerprint never blocks a buy — so
  the backend cluster gate sees the freshest wallet→device mapping.
- The activity-log payload now includes the originating `domain`, letting
  the backend scope a rejection to the product domain (ecosystem wallets
  are shared across apps).
- New exported errors: `screeningRejectedError`, `screeningApiError`.

### Changed

- Checkout concurrency gate narrows the host's pending-order list to the
  user's B2B orders (via `keepOnlyB2BPending`) before deciding whether to
  block a new placement. Legacy retail orders — including ones stuck
  "pending" from before auto-cancellation existed — no longer gate. Falls
  back to the prior behaviour if the subgraph lookup can't run.

### Notes
- All additions are non-breaking; existing consumers see no behavioural
  change unless they opt into `b2bOnly` / `integrators` or `screening`.
- typecheck + examples typecheck + tests + ESM/CJS/dts build all clean
  (`npm run verify`).

## [1.1.0] — 2026-05-15

### Added — Smart per-row action layout (`<PaymentHistoryWithSupport>`)

Three-layer per-row layout driven by a pure state machine over the
order's on-chain status, dispute lifecycle, and dispute window:

- **A** — informational status line, always rendered (e.g. `Paid · dispute opens in 8m`).
- **B** — action button: `Resume order` / `Raise dispute · <countdown>` / hidden when not actionable.
- **C** — support launcher: dispute-open / dispute-resolved / chat-active / chat-new.

Opt out by passing `actionMode="chat"` on `<PaymentHistoryWithSupport>` —
the prior single-launcher layout is preserved verbatim under that flag.
Default is `"smart"`.

New exports (`@p2pdotme/widgets/support` unless noted):

- `OrderAction` — composes the three layers per row; 1 Hz tick while any
  countdown is under 60s, optimistic flip when a dispute broadcasts.
- `RaiseDisputeStep` — confirm → form → submitting → done/error state
  machine; encodes `raiseDispute(orderId, redactTransId)`, fires
  `onSubmitted` on tx broadcast (hash known, receipt pending) so the
  parent can optimistically flip the row.
- `useOrderStates` — multicall3-batched on-chain reads with a sub-tick
  cadence under 60s, shipped as a standalone hook for embedders without
  a `PaymentHistory` feed.
- `computeOrderAction` / `formatRemaining` — pure logic (no UI), exposed
  under `@p2pdotme/widgets` for hosts building bespoke layouts.

New props:

- `<PaymentHistoryWithSupport>` — `actionMode: "smart" | "chat"` (default `"smart"`),
  and `support.txSigner` (`CheckoutSigner` shape) required for the
  Raise-dispute action.
- `<Support>` — `chatState: "active" | "new"` drives the launcher label
  ("Continue support" + green pip vs "Get help") when `disputeStatus="none"`.

Dispute windows match the on-chain enforcement in
`OrderProcessorFacet.raiseDispute`: BUY/PAID is disputable
[15 min, 24 h] after `placedAt`; SELL or PAY/COMPLETED is disputable
[30 min, 7 d] after `placedAt`. Dispute lifecycle short-circuits status
flow — a raised or settled dispute is always the most relevant state.

### Changed
- `<Support>` launcher label adapts to `chatState` when no dispute is
  open: `"Get help"` (new thread) → `"Continue support"` (active thread)
  with a green status dot.

### Notes
- 125 tests pass (70 node:test on pure logic, 55 vitest on UI surface);
  typecheck + examples typecheck + ESM/CJS/dts build all clean.
- All additions are non-breaking — existing 1.0.0 consumers see the
  new smart layout automatically; pass `actionMode="chat"` to keep the
  prior behavior verbatim.

## [1.0.0] — 2026-05-14

### Changed — BREAKING

This release renames the package and restructures it into subpath exports.
There has been no prior npm publish under the old name, so existing
consumers are unaffected; for internal staging that hit a pre-release
build, the migration is:

- **Package name** `@p2pdotme/checkout-widget` → **`@p2pdotme/widgets`**.
- **Widget components**
  - `P2PCheckout` → `Checkout`
  - `P2POfframp` → `Cashout`
  - `P2POrderHistory` → `PaymentHistory`
- **Subpath exports** — widgets no longer live on the bare entry:
  - `import { Checkout }       from "@p2pdotme/widgets/checkout"`
  - `import { Cashout }        from "@p2pdotme/widgets/cashout"`
  - `import { PaymentHistory } from "@p2pdotme/widgets/payment-history"`
  - Bare `@p2pdotme/widgets` exposes only shared types + helpers.
- **Types**
  - `P2PCheckoutProps` → `CheckoutProps`
  - `P2POfframpProps` → `CashoutProps`
  - `P2POrderHistoryProps` → `PaymentHistoryProps`
  - `OfframpPhase` → `CashoutPhase`
  - `PlaceOfframpContext` → `PlaceCashoutContext`
  - `PlaceOfframpResult` → `PlaceCashoutResult`
- **Callback prop** `placeOfframp` → `placeCashout` on `CashoutProps`.

`P2PError`, `P2PTheme`, `CheckoutSigner`, `CurrencyOption`, `OrderStatus`,
`DeliverUpiContext`, `ReconcileContext` keep their names — the `P2P`
prefix on error/theme distinguishes them from native `Error` / generic
`Theme`, and the UPI/Reconcile types mirror on-chain selector names.

### Added
- **Unified error system** — a single `P2PError` class (subclass of `Error`)
  is now passed to every `onError` callback, with a stable `code`, a
  jargon-free `userMessage`, structured `context`, optional `revertSelector`
  / `revertName` / `hint`, and the original `cause` preserved end-to-end.
- **Revert selector registry** — the eight B2B Gateway custom errors and
  25+ Diamond order-flow selectors are decoded by name out of the box.
  `registerRevertSelectors({...})` lets hosts extend the registry at runtime
  so integrator-specific custom errors get friendly messages and structured
  log lines instead of "Execution reverted for an unknown reason".
- **Public exports**: `P2PError`, `classifyError`, `logP2PError`,
  `registerRevertSelectors`, `lookupRevertSelector`, and the
  `P2PErrorCode` / `P2PErrorCategory` / `P2PErrorFlow` / `P2PErrorContext`
  type unions.
- README §"Error handling" + §"Subpath exports" sections document the
  codes, branching pattern, registry extension recipe, and the layout.
- CI workflow (`.github/workflows/ci.yml`) runs typecheck + examples
  typecheck + tests + build on Node 18 and Node 20.
- `npm run verify` script chains all of the above locally.

### Changed
- **Support widget — production-ready UX pass.**
  - **Theming unified with `P2PTheme`.** `SupportTheme` is now a type
    alias of `P2PTheme`; the modal honors the same `--p2p-*` tokens as
    `<Checkout>` / `<Cashout>` / `<PaymentHistory>`. The old
    `SupportTheme` shape (`colorPrimary` / `colorBg` / `colorText` /
    `colorMuted` / `radius` / `font`) and `--support-*` CSS variables
    are removed. Hosts that already pass a `P2PTheme` (e.g.
    `theme={CHECKOUT_THEME}`) now actually see the support modal pick
    up dark mode / accent / radii without any change on their end.
  - **No more silent close on `chatwoot: null`.** When the bridge returns
    a session without an inbox binding (order pre-acceptance, or a
    circle whose inbox hasn't been provisioned in
    `CHATWOOT_INBOX_BY_CIRCLE`), the modal now renders an actionable
    "Support not available yet" state with a Retry button instead of
    silently closing. Same wallet-lane silent refresh is preserved on
    `<PaymentHistoryWithSupport>` (used for the "Active support" pip).
  - **Error classification + Retry on every failure.** Errors are
    bucketed into `userRejected` (EIP-1193 4001 + "user rejected" /
    "user denied" / "user cancelled" / wagmi-style names),
    `auth` (4xx from `/auth/sign-in`), `network` (5xx + `Failed to
    fetch` / fetch failures), `chatwoot` (SDK boot failure), and
    `unknown`. Each renders a friendly title + body, the raw cause as
    monospace muted detail for debugging, and Retry + Close buttons.
  - **Accessibility.** `role="dialog"` + `aria-modal` now live on the
    content card (not the backdrop), `aria-busy` is set during the
    signing / loading-chat phases, focus returns to the launcher on
    close, and Escape closes (via the shared `<Modal>` portal).
  - **Launcher polish.** The launcher uses the shared secondary-button
    style so it sits flush next to `PaymentHistory`'s Resume button,
    with a small dispute-status dot (red for open, green for resolved)
    instead of relying on label alone.
- `@p2pdotme/sdk` bumped from `^1.1.3` to `^1.1.6` (patch).
- `examples/basic-checkout.tsx` rewritten against the renamed prop shape
  — uses the three host callbacks (`placeCashout` / `deliverUpi` /
  `reconcile`) and a viem private-key signer (Privy / wagmi recipes
  still live in the README).
- tsup config switched to multi-entry with `splitting: true`. Shared
  internals get a single hashed chunk both ESM entries point at.

### Removed
- `src/core/place-error.ts` — its diagnostic logger is now subsumed by the
  unified `src/core/errors.ts`. (Internal module — not previously exported.)

## [0.1.0] — initial public release

- `<Checkout>` buy widget — currency picker, on-chain quote, fiat
  breakdown, "Pay now", merchant-pubkey-encrypted payment delivery,
  status polling, mark-paid, cancel, auto-cancel countdown.
- `<Cashout>` USDC-to-fiat widget — integrator-agnostic Diamond
  orchestration plus three host callbacks (place / deliver / reconcile).
- `<PaymentHistory>` subgraph-backed list with optimistic terminal
  updates and resume-into-tracking.
- Credit accounting (`fetchCredit` / `fetchPendingOrders` hooks).
- B2B fraud-engine screening (opt-in via `screening` prop).
- CSS-variables theming + `theme` prop.
- SDK-sourced currency metadata.
