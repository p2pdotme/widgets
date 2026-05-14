import { describe, it, expect, vi } from "vitest";
import { fromPrivyWallet } from "../src/adapters/privy";
import { fromThirdwebAccount } from "../src/adapters/thirdweb";

describe("fromPrivyWallet", () => {
  it("copies the address through unchanged", async () => {
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      getEthereumProvider: vi.fn(async () => ({
        request: vi.fn(async () => "0xdeadbeef"),
      })),
    };
    const signer = fromPrivyWallet(wallet);
    expect(signer.address).toBe(wallet.address);
  });

  it("routes signMessage through personal_sign with [message, address]", async () => {
    const request = vi.fn(async () => "0xdeadbeef");
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      getEthereumProvider: vi.fn(async () => ({ request })),
    };
    const signer = fromPrivyWallet(wallet);
    const sig = await signer.signMessage!("hello world");
    expect(sig).toBe("0xdeadbeef");
    expect(request).toHaveBeenCalledWith({
      method: "personal_sign",
      params: ["hello world", wallet.address],
    });
  });

  it("accepts a synchronously-returned provider", async () => {
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      getEthereumProvider: () => ({
        request: vi.fn(async () => "0xfeed"),
      }),
    };
    const signer = fromPrivyWallet(wallet);
    expect(await signer.signMessage!("m")).toBe("0xfeed");
  });
});

describe("fromThirdwebAccount", () => {
  it("copies the address through unchanged", () => {
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      signMessage: vi.fn(async () => "0x" + "01".repeat(65)),
    };
    const signer = fromThirdwebAccount(account);
    expect(signer.address).toBe(account.address);
  });

  it("routes signMessage through the account.signMessage({ message }) shape", async () => {
    const signMessage = vi.fn(async () => "0xabc");
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      signMessage,
    };
    const signer = fromThirdwebAccount(account);
    const sig = await signer.signMessage!("hello world");
    expect(sig).toBe("0xabc");
    expect(signMessage).toHaveBeenCalledWith({ message: "hello world" });
  });
});
