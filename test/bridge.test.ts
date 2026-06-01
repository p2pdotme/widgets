import { describe, it, expect, vi } from "vitest";
import { buildSignMessage, signInWithBridge } from "../src/api/bridge";
import type { SupportSigner } from "../src/types";

describe("buildSignMessage (shared sign-in contract, D-027-v3 §4)", () => {
  it("matches the byte-identical cross-repo GOLDEN VECTOR", () => {
    // This exact expected string is asserted in BOTH the bridge
    // (packages/bridge) and widget suites. If either side drifts, the
    // ERC-1271/6492 verifier recomputes a different digest and the
    // sign-in 401s. Do not change without changing the bridge in lockstep.
    const purpose = "support.p2p.me:sign-in";
    const address = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"; // mixed case
    const chainId = 8453;
    const timestamp = 1700000000000;
    const expected =
      "support.p2p.me:sign-in:0xabcdef0123456789abcdef0123456789abcdef01:8453:1700000000000";
    expect(buildSignMessage(address, chainId, timestamp)).toBe(expected);
    // Self-document the purpose constant so a rename trips this test too.
    expect(expected.startsWith(`${purpose}:`)).toBe(true);
  });

  it("lower-cases the address and renders chainId as an unpadded decimal", () => {
    expect(
      buildSignMessage(
        "0xABCDEF0123456789ABCDEF0123456789ABCDEF01",
        84532,
        1700000000001,
      ),
    ).toBe(
      "support.p2p.me:sign-in:0xabcdef0123456789abcdef0123456789abcdef01:84532:1700000000001",
    );
  });
});

describe("signInWithBridge chainId binding (hard cutover)", () => {
  const address = "0x0000000000000000000000000000000000000001" as const;

  function okFetch() {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        address,
        role: "user",
        chatwoot: null,
        sessionToken: "stub.jwt",
        expiresAt: Date.now() + 60_000,
      }),
      text: async () => "{}",
    })) as unknown as typeof fetch;
  }

  it("binds the live connector chainId into BOTH the signed message and the POST body", async () => {
    globalThis.fetch = okFetch();
    const signSpy = vi.fn(async (_m: string) => "0xsig");
    const signer: SupportSigner = {
      address,
      signMessage: signSpy,
      getChainId: async () => 8453,
    };
    await signInWithBridge({ signer, bridgeUrl: "https://bridge.local/" });

    const msg = signSpy.mock.calls[0]![0];
    expect(msg).toMatch(/^support\.p2p\.me:sign-in:0x0+1:8453:\d+$/);

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://bridge.local/auth/sign-in");
    const body = JSON.parse(init.body);
    expect(body.chainId).toBe(8453);
    expect(typeof body.chainId).toBe("number");
    expect(body.address).toBe(address);
    expect(body.signature).toBe("0xsig");
    expect(typeof body.timestamp).toBe("number");
    // POST body chainId must equal the connector's chain id, and must be
    // the same value bound into the signed string.
    expect(msg).toContain(`:${body.chainId}:${body.timestamp}`);
  });

  it("carries orderId into the body when supplied", async () => {
    globalThis.fetch = okFetch();
    const signer: SupportSigner = {
      address,
      signMessage: async () => "0xsig",
      getChainId: async () => 84532,
    };
    await signInWithBridge({
      signer,
      bridgeUrl: "https://bridge.local",
      orderId: "0xabc",
    });
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.orderId).toBe("0xabc");
    expect(body.chainId).toBe(84532);
  });

  it("THROWS (does not default) when the connector exposes no chainId", async () => {
    globalThis.fetch = okFetch();
    const signer: SupportSigner = {
      address,
      signMessage: async () => "0xsig",
      // no getChainId resolver and no chainId value
    };
    await expect(
      signInWithBridge({ signer, bridgeUrl: "https://bridge.local" }),
    ).rejects.toThrow(/support sign-in requires a chainId/i);
    // Never reached the network — the throw is pre-fetch.
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it("THROWS when the resolver itself yields a non-numeric chainId", async () => {
    globalThis.fetch = okFetch();
    const signer: SupportSigner = {
      address,
      signMessage: async () => "0xsig",
      getChainId: async () => NaN as unknown as number,
    };
    await expect(
      signInWithBridge({ signer, bridgeUrl: "https://bridge.local" }),
    ).rejects.toThrow(/chainId/i);
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});
