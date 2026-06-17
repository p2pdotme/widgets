import { describe, it, expect } from "vitest";
import { reducer, INITIAL } from "../src/core/order-machine";

describe("order-machine reducer — DECRYPT_FAILED path", () => {
  it("DECRYPT_FAILED sets decryptError and leaves decryptedUpi null", () => {
    // Start from a state where an order has been accepted (decryptedUpi still null,
    // as if decryption was attempted and failed).
    const accepted = reducer(INITIAL, {
      type: "ACCEPTED",
      fiatAmount: 1_000_000n,
      usdcAmount: 1_000_000n,
      currency: "INR",
      fee: 0n,
      actualUsdcAmount: 1_000_000n,
      acceptedTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    });
    expect(accepted.decryptedUpi).toBeNull();
    expect(accepted.decryptError).toBeNull();

    const failed = reducer(accepted, {
      type: "DECRYPT_FAILED",
      message: "Couldn't load payment details",
    });

    expect(failed.decryptError).toBeTruthy();
    expect(failed.decryptError).toBe("Couldn't load payment details");
    expect(failed.decryptedUpi).toBeNull();
  });

  it("DECRYPTED_UPI clears decryptError and sets decryptedUpi", () => {
    // Start from a failed state, then succeed — ensures DECRYPTED_UPI resets the error.
    const withError = reducer(INITIAL, {
      type: "DECRYPT_FAILED",
      message: "Couldn't load payment details",
    });
    expect(withError.decryptError).toBeTruthy();

    const recovered = reducer(withError, {
      type: "DECRYPTED_UPI",
      upi: "merchant@okhdfc",
    });
    expect(recovered.decryptedUpi).toBe("merchant@okhdfc");
    expect(recovered.decryptError).toBeNull();
  });

  it("INITIAL state has both decryptedUpi and decryptError as null", () => {
    expect(INITIAL.decryptedUpi).toBeNull();
    expect(INITIAL.decryptError).toBeNull();
  });
});
