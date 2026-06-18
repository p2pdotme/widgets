import { describe, it, expect, vi } from "vitest";

// Mock the SDK so resolveIdentity()'s direct localStorage access THROWS — the
// exact production condition (corrupt identity JSON, or storage blocked in a
// sandboxed / partitioned iframe) that must surface decryptError rather than
// hang the accepted screen on "Decrypting…". Regression test for the throw path
// that the poll-loop / resume `catch {}` blocks would otherwise swallow.
vi.mock("@p2pdotme/sdk/orders", () => ({
  createLocalStorageRelayStore: () => ({
    get: () => {
      throw new Error("SecurityError: localStorage is blocked");
    },
    set: async () => {},
  }),
  createRelayIdentity: () => ({}),
  createOrders: () => ({}),
  // Would only be reached if resolveIdentity() succeeded; it won't here.
  decryptPaymentAddress: async () => ({ isOk: () => true, value: "x@y" }),
}));

import { decryptAndDispatch } from "../src/core/order-machine";

describe("decryptAndDispatch — throw path", () => {
  it("dispatches DECRYPT_FAILED when identity resolution throws (no silent hang)", async () => {
    const dispatch = vi.fn();
    await decryptAndDispatch("enc-upi-blob", dispatch);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "DECRYPT_FAILED",
      message: "Couldn't load payment details",
    });
  });
});
