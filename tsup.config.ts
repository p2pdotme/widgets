import { defineConfig } from "tsup";

export default defineConfig({
  // One entry per subpath. The `exports` map in package.json routes each
  // entry under a public import path (e.g. `@p2pdotme/widgets/checkout`).
  // The bare `index` entry exposes only shared types + helpers — widgets
  // themselves stay behind their subpaths so hosts pay only for what they
  // import.
  entry: {
    index: "src/index.ts",
    checkout: "src/checkout.ts",
    cashout: "src/cashout.ts",
    "payment-history": "src/payment-history.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // `splitting: true` lets ESM share common chunks (core/* modules used by
  // multiple subpaths) across entries instead of duplicating them. CJS
  // can't share the same way; tsup handles that automatically.
  splitting: true,
  treeshake: true,
  // React, react-dom, viem, and the P2P SDK stay external — they're peer
  // deps (or runtime-resolved via the consumer's package). Bundling them
  // would bloat the package and risk duplicate-React errors.
  external: [
    "react",
    "react-dom",
    "viem",
    "@p2pdotme/sdk",
    "@p2pdotme/sdk/orders",
    "@p2pdotme/sdk/fraud-engine",
  ],
});
