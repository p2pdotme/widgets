# Changelog

All notable changes to `@p2pdotme/widgets` are documented here.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. While
the package is `0.x`, minor releases may introduce additive prop changes;
patch releases stay backward-compatible.

## [Unreleased]

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
