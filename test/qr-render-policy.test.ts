import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("QR rendering policy", () => {
  it("no source file sends QR payloads to a third-party image service", () => {
    const src = join(process.cwd(), "src");
    const offenders = walk(src).filter(
      (f) =>
        /\.(ts|tsx)$/.test(f) &&
        readFileSync(f, "utf8").includes("api.qrserver.com"),
    );
    expect(offenders).toEqual([]);
  });

  it("the checkout paying screen renders its QR through QrCode with the untouched payload", () => {
    // Source-level pin, deliberately exact. Checkout has no component test
    // harness yet (tracked as a repo issue), so until one exists this is
    // what keeps the paying screen's QR call site from being dropped or fed
    // a mangled payload without a test noticing.
    const checkout = readFileSync(
      join(process.cwd(), "src", "widgets", "Checkout.tsx"),
      "utf8",
    );
    expect(checkout).toContain("<QrCode data={qrData} size={180} />");
  });
});
