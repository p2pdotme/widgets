import { describe, it, expect } from "vitest";
import { paymentAddressView, showInrQr, payableAddressShown } from "../src/widgets/Checkout";
import { DECRYPT_FAILED_SENTINEL } from "../src/core/order-machine";

// Covers the accepted-screen decrypt-failure rendering decision without a full
// Checkout render: the sentinel must surface an error, never a copyable/QR-able
// address, and the INR QR must require a real "@" VPA (so the sentinel can't be
// QR-encoded as a fake payee).
describe("paymentAddressView", () => {
  it("decrypt-failure sentinel -> error, and error wins over compound", () => {
    expect(paymentAddressView(DECRYPT_FAILED_SENTINEL, false)).toBe("error");
    expect(paymentAddressView(DECRYPT_FAILED_SENTINEL, true)).toBe("error");
  });
  it("compound currency -> compound", () => {
    expect(paymentAddressView("acct|bank", true)).toBe("compound");
  });
  it("resolved VPA -> address", () => {
    expect(paymentAddressView("merchant@okhdfc", false)).toBe("address");
  });
  it("not yet decrypted -> decrypting", () => {
    expect(paymentAddressView(null, false)).toBe("decrypting");
  });
});

describe("showInrQr", () => {
  it("true only for a real VPA on INR with a known amount", () => {
    expect(showInrQr("merchant@okhdfc", "INR", true)).toBe(true);
  });
  it("false for the failure sentinel (no @)", () => {
    expect(showInrQr(DECRYPT_FAILED_SENTINEL, "INR", true)).toBe(false);
  });
  it("false for non-INR / missing amount / null", () => {
    expect(showInrQr("merchant@okhdfc", "BRL", true)).toBe(false);
    expect(showInrQr("merchant@okhdfc", "INR", false)).toBe(false);
    expect(showInrQr(null, "INR", true)).toBe(false);
  });
});

describe("payableAddressShown (drives the 'I've paid' enable)", () => {
  it("true once a payable address/compound is shown", () => {
    expect(payableAddressShown("address")).toBe(true);
    expect(payableAddressShown("compound")).toBe(true);
  });
  it("false while decrypting or on a decrypt failure (I've paid disabled)", () => {
    expect(payableAddressShown("decrypting")).toBe(false);
    expect(payableAddressShown("error")).toBe(false);
  });
});
