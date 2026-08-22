import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import jsQR from "jsqr";
import { QrCode } from "../src/ui/QrCode";
import { buildStaticPixPayload } from "../src/core/pix-brcode";
import { qrcodegen } from "../src/vendor/qrcodegen";

// Parse the rendered SVG back into its module set and canvas size, from the
// markup alone. Keeping this independent of the component's internals is what
// lets the fidelity assertions below catch rendering bugs.
function parseRendered(container: HTMLElement): {
  dark: Set<string>;
  dim: number;
} {
  const svg = container.querySelector("svg");
  expect(svg, "expected an inline svg").not.toBeNull();
  const viewBox = svg!.getAttribute("viewBox");
  expect(viewBox).toBeTruthy();
  const [, , w, h] = viewBox!.split(" ").map(Number);
  expect(w).toBe(h);
  const d = svg!.querySelector("path")?.getAttribute("d");
  expect(d).toBeTruthy();
  const dark = new Set<string>();
  for (const m of d!.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    dark.add(`${m[1]},${m[2]}`);
  }
  expect(dark.size).toBeGreaterThan(0);
  return { dark, dim: w };
}

// Rasterize the parsed modules and hand them to an independent decoder. This
// proves the image as drawn, so encoder damage and rendering damage both
// fail here. Asserting the exact decoded string (not just non-null) is
// load-bearing: a corrupted encoder can still emit a decodable wrong QR.
function decodeRendered(container: HTMLElement): string {
  const { dark, dim: w } = parseRendered(container);
  const scale = 4;
  const size = w * scale;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = dark.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`) ? 0 : 255;
      const i = (y * size + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  const decoded = jsQR(rgba, size, size);
  expect(decoded, "decoder could not read the rendered QR").not.toBeNull();
  return decoded!.data;
}

describe("QrCode", () => {
  it("renders a scannable QR for a UPI intent payload", () => {
    const payload = "upi://pay?pa=merchant@icici&am=830.00&cu=INR&tr=4211";
    const { container } = render(<QrCode data={payload} size={180} />);
    expect(decodeRendered(container)).toBe(payload);
  });

  it("renders a scannable QR for a real Pix BR Code", () => {
    const payload = buildStaticPixPayload({
      pixKey: "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6",
      merchantName: "polycule.news top-up",
      merchantCity: "BRASIL",
      amount: 83.5,
      txid: "4211",
    });
    const { container } = render(<QrCode data={payload} size={180} />);
    expect(decodeRendered(container)).toBe(payload);
  });

  it("renders a scannable QR for a copy-page link with fragment params", () => {
    const payload = `https://copy.p2p.cool/#${new URLSearchParams({
      v: "0001234567890123456789",
      l: "CBU",
    }).toString()}`;
    const { container } = render(<QrCode data={payload} size={180} />);
    expect(decodeRendered(container)).toBe(payload);
  });

  it("renders exactly the encoder's matrix at ECC M inside a 4-module quiet zone", () => {
    // Fidelity against the encoder: the independent decode above proves the
    // encoder output is a correct QR, this proves the SVG draws that output
    // faithfully. Together they pin orientation, offset, quiet zone, and the
    // ECC level, none of which a decoder alone can see (jsQR forgives
    // mirrored matrices and missing margins that real camera scans do not).
    const payload = "upi://pay?pa=merchant@icici&am=830.00&cu=INR&tr=4211";
    const { container } = render(<QrCode data={payload} size={180} />);
    const { dark, dim } = parseRendered(container);
    const qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.MEDIUM);
    expect(dim).toBe(qr.size + 8);
    const expected = new Set<string>();
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) expected.add(`${x + 4},${y + 4}`);
      }
    }
    expect(dark).toEqual(expected);
  });

  it("re-encodes when data changes", () => {
    const first = "upi://pay?pa=first@bank&am=1.00&cu=INR&tr=1";
    const second = "upi://pay?pa=second@bank&am=2.00&cu=INR&tr=2";
    const { container, rerender } = render(<QrCode data={first} size={180} />);
    expect(decodeRendered(container)).toBe(first);
    rerender(<QrCode data={second} size={180} />);
    expect(decodeRendered(container)).toBe(second);
  });

  it("renders locally, with no img element and no third-party host", () => {
    const { container } = render(<QrCode data="upi://pay?pa=x@y" size={180} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("qrserver");
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("180");
    expect(svg.getAttribute("height")).toBe("180");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("QR");
  });
});
