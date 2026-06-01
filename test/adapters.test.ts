import { describe, it, expect, vi } from "vitest";
import { fromPrivyWallet } from "../src/adapters/privy";
import { fromThirdwebAccount } from "../src/adapters/thirdweb";

describe("fromPrivyWallet", () => {
  it("copies the address through unchanged", async () => {
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      chainId: "eip155:8453",
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
      chainId: "eip155:8453",
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
      chainId: "eip155:84532",
      getEthereumProvider: () => ({
        request: vi.fn(async () => "0xfeed"),
      }),
    };
    const signer = fromPrivyWallet(wallet);
    expect(await signer.signMessage!("m")).toBe("0xfeed");
  });

  it("resolves a numeric chainId from the live CAIP-2 string at sign time (D-027-v3 §4)", async () => {
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      chainId: "eip155:8453",
      getEthereumProvider: vi.fn(async () => ({
        request: vi.fn(async () => "0xdeadbeef"),
      })),
    };
    const signer = fromPrivyWallet(wallet);
    expect(await signer.getChainId!()).toBe(8453);
  });

  it("reads chainId from the LIVE connector on every call (not a cached snapshot)", async () => {
    // Mutating the wallet's chain after the signer is built must be
    // reflected, proving the value is read live rather than captured.
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      chainId: "eip155:8453",
      getEthereumProvider: vi.fn(async () => ({
        request: vi.fn(async () => "0xdeadbeef"),
      })),
    };
    const signer = fromPrivyWallet(wallet);
    expect(await signer.getChainId!()).toBe(8453);
    wallet.chainId = "eip155:84532";
    expect(await signer.getChainId!()).toBe(84532);
  });

  it("throws a clear error when the live wallet exposes no chainId", async () => {
    const wallet = {
      address: "0xABCD000000000000000000000000000000000001",
      getEthereumProvider: vi.fn(async () => ({
        request: vi.fn(async () => "0xdeadbeef"),
      })),
    } as unknown as { address: string; getEthereumProvider: () => unknown };
    const signer = fromPrivyWallet(wallet as never);
    await expect(signer.getChainId!()).rejects.toThrow(/chainId/i);
  });
});

describe("fromThirdwebAccount", () => {
  it("copies the address through unchanged", () => {
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      getChain: () => ({ id: 8453 }),
      signMessage: vi.fn(async () => "0x" + "01".repeat(65)),
    };
    const signer = fromThirdwebAccount(account);
    expect(signer.address).toBe(account.address);
  });

  it("routes signMessage through the account.signMessage({ message }) shape", async () => {
    const signMessage = vi.fn(async () => "0xabc");
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      getChain: () => ({ id: 8453 }),
      signMessage,
    };
    const signer = fromThirdwebAccount(account);
    const sig = await signer.signMessage!("hello world");
    expect(sig).toBe("0xabc");
    expect(signMessage).toHaveBeenCalledWith({ message: "hello world" });
  });

  it("resolves a numeric chainId from the active chain at sign time (D-027-v3 §4)", async () => {
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      getChain: () => ({ id: 84532 }),
      signMessage: vi.fn(async () => "0xabc"),
    };
    const signer = fromThirdwebAccount(account);
    expect(await signer.getChainId!()).toBe(84532);
  });

  it("reads chainId from the LIVE active chain on every call (not a cached snapshot)", async () => {
    let id = 8453;
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      getChain: () => ({ id }),
      signMessage: vi.fn(async () => "0xabc"),
    };
    const signer = fromThirdwebAccount(account);
    expect(await signer.getChainId!()).toBe(8453);
    id = 84532;
    expect(await signer.getChainId!()).toBe(84532);
  });

  it("throws a clear error when the active chain is not resolvable", async () => {
    const account = {
      address: "0xABCD000000000000000000000000000000000002",
      getChain: () => undefined,
      signMessage: vi.fn(async () => "0xabc"),
    } as unknown as {
      address: string;
      getChain: () => undefined;
      signMessage: () => Promise<string>;
    };
    const signer = fromThirdwebAccount(account as never);
    await expect(signer.getChainId!()).rejects.toThrow(/chainId/i);
  });
});
