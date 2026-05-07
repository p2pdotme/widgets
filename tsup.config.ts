import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // React, react-dom, viem, and the P2P SDK stay external — they're peer deps
  // (or runtime-resolved via the consumer's package). Bundling them would
  // bloat the package and risk duplicate-React errors.
  external: ["react", "react-dom", "viem", "@p2pdotme/sdk", "@p2pdotme/sdk/orders"],
});
