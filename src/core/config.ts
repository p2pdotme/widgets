// CURRENCIES + CurrencyConfig were removed. The widget now resolves all
// per-currency UI metadata from `@p2pdotme/sdk/country` via
// `src/core/currency-meta.ts` — single source of truth shared with the
// p2p.me consumer user-app, so payment-method strings, country names,
// and Alpha flags stay in lockstep across products. Hosts that need
// custom metadata pass it through CurrencyOption (which wins over the
// SDK defaults).

export const DEMO_FIAT_RATE: Record<string, number> = {
  INR: 83, IDR: 15800, BRL: 5, ARS: 900, MEX: 17, VEN: 36, NGN: 1500,
};
