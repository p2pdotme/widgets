# Contributing

Thanks for taking the time to contribute. This package is small, so the
process is light.

## Local setup

```bash
git clone https://github.com/p2pdotme/widgets.git
cd widgets
npm install
npm run verify
```

`npm run verify` chains `typecheck → typecheck:examples → test → build` and
mirrors what CI runs.

## Project layout

- `src/widgets/` — the three React widgets (`Checkout`, `Cashout`,
  `PaymentHistory`). Each gets a subpath entry barrel in `src/`
  (`src/checkout.ts`, `src/cashout.ts`, `src/payment-history.ts`) which
  tsup builds as a separate package entry.
- `src/core/` — state machines, error system, contract helpers, currency
  metadata. Unit-tested.
- `src/ui/` — primitives + theme.
- `src/hooks/` — public hooks (`useUserTxLimit`).
- `src/types.ts` — public prop types. Treat changes here as API changes.
- `src/index.ts` — public exports. The single source of truth for what
  ships in the package.
- `examples/basic-checkout.tsx` — canonical host integration. Must
  typecheck against the current public types (CI gates this).
- `docs/` — long-form runbooks (post-mortems, smoke-test recipes).

## Making a change

1. Branch from `main`.
2. Run `npm run verify` locally before pushing.
3. Open a PR against `main`. CI will re-run the same checks on Node 18 + 20.
4. Add a `[Unreleased]` entry to `CHANGELOG.md` describing the change.

## Conventions

- **No source comments that explain *what* the code does** — well-named
  identifiers handle that. Reserve comments for *why*: a non-obvious
  invariant, a subtle workaround, a constraint that's not in the code.
- **No dead code or commented-out blocks.** Delete it; git remembers.
- **Public types live in `src/types.ts`.** If you add a prop, update the
  README's API reference table in the same PR.
- **Errors flow through `src/core/errors.ts`.** Don't `throw new Error(...)`
  with a raw string from a catch site — use `toP2PError(err, ctx)` or one
  of the pre-built constructors (`noEligibleMerchantsError`,
  `missingRoutingInputsError`, …). This keeps the host-side `onError`
  surface consistent.
- **Tests use `node:test` + `node --experimental-strip-types`** — no Jest /
  Vitest. Co-locate tests next to the module: `foo.ts` ↔ `foo.test.ts`.

## Publishing (maintainers only)

```bash
npm version <patch|minor|major>
git push --follow-tags
npm publish
```

`prepublishOnly` runs `clean → build` automatically; only `dist/` ships.

## Reporting bugs

Open an issue at
[github.com/p2pdotme/widgets/issues](https://github.com/p2pdotme/widgets/issues).
Include: widget version, peer-dep versions (React, viem, @p2pdotme/sdk),
chain ID, and the structured `[p2p-widget:<flow>] CODE` console log if
there is one.

For security-sensitive reports, see [SECURITY.md](./SECURITY.md).
