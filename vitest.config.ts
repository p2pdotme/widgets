import { defineConfig } from "vitest/config";

// Vitest runs the widget tests (jsdom). The core-only tests stay on
// node:test via the `test` script in package.json so this config never
// sees them.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
