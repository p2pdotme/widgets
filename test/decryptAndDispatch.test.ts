import { describe, it, expect, vi } from "vitest";

// Mock the SDK so resolveIdentity()'s direct localStorage access THROWS — the
// exact production condition (corrupt identity JSON, or storage blocked in a
// sandboxed / partitioned iframe) that previously stranded the accepted screen
// on "Decrypting…" forever (the throw was swallowed by the call sites' catch{}).
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
  it("falls back to the Session-changed sentinel when identity resolution throws", async () => {
    const dispatch = vi.fn();
    await decryptAndDispatch("enc-upi-blob", dispatch);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "DECRYPTED_UPI", upi: "Session changed" });
  });
});
