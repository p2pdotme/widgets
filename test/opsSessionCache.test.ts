import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  opsCacheKey,
  readOpsSession,
  writeOpsSession,
  clearOpsSession,
  ensureOpsSession,
  __resetOpsFlightForTests,
} from "../src/state/opsSessionCache";
import type { SignInResponse } from "../src/state/sessionCache";
import type { SupportSigner } from "../src/types";

const ADDR = "0x0000000000000000000000000000000000000001";
const BASE = "https://bridge.local";

function session(over: Partial<SignInResponse> = {}): SignInResponse {
  return {
    ok: true,
    address: ADDR,
    role: "ops",
    chatwoot: null,
    sessionToken: "ops.session.jwt",
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetOpsFlightForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opsSessionCache", () => {
  it("keys by lowercased address only, in the @P2PME-OPS namespace", () => {
    expect(opsCacheKey("0xAbCdEf0000000000000000000000000000000000")).toBe(
      "@P2PME-OPS:BRIDGE_SESSION:0xabcdef0000000000000000000000000000000000",
    );
  });

  it("writes to sessionStorage, NOT localStorage", () => {
    writeOpsSession(ADDR, session());
    expect(window.sessionStorage.getItem(opsCacheKey(ADDR))).toBeTruthy();
    expect(window.localStorage.getItem(opsCacheKey(ADDR))).toBeNull();
  });

  it("reads back a valid session", () => {
    writeOpsSession(ADDR, session());
    const got = readOpsSession(ADDR);
    expect(got?.sessionToken).toBe("ops.session.jwt");
  });

  it("rejects and evicts a session whose expiresAt is not a number", () => {
    window.sessionStorage.setItem(
      opsCacheKey(ADDR),
      JSON.stringify({ ...session(), expiresAt: "soon" }),
    );
    expect(readOpsSession(ADDR)).toBeNull();
    expect(window.sessionStorage.getItem(opsCacheKey(ADDR))).toBeNull();
  });

  it("rejects and evicts an expired session (inside the buffer)", () => {
    writeOpsSession(ADDR, session({ expiresAt: Date.now() + 1000 }));
    expect(readOpsSession(ADDR)).toBeNull();
    expect(window.sessionStorage.getItem(opsCacheKey(ADDR))).toBeNull();
  });

  it("clearOpsSession removes the entry", () => {
    writeOpsSession(ADDR, session());
    clearOpsSession(ADDR);
    expect(readOpsSession(ADDR)).toBeNull();
  });

  describe("ensureOpsSession", () => {
    const signer: SupportSigner = {
      address: ADDR,
      signMessage: async () => "0xsig",
    };

    it("returns the cached session without signing when valid", async () => {
      writeOpsSession(ADDR, session());
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const got = await ensureOpsSession({ signer, bridgeUrl: BASE });
      expect(got?.sessionToken).toBe("ops.session.jwt");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("signs in and writes the ops cache when no valid session exists", async () => {
      const fresh = session({ sessionToken: "fresh.ops.jwt" });
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => fresh,
        text: async () => JSON.stringify(fresh),
      })) as unknown as typeof fetch;

      const got = await ensureOpsSession({ signer, bridgeUrl: BASE });
      expect(got?.sessionToken).toBe("fresh.ops.jwt");
      // written to ops (sessionStorage), not customer (localStorage)
      expect(window.sessionStorage.getItem(opsCacheKey(ADDR))).toBeTruthy();
      expect(
        window.localStorage.getItem(
          `support.p2p.me:session:${BASE}:${ADDR.toLowerCase()}`,
        ),
      ).toBeNull();
    });

    it("flight-guards concurrent calls into exactly ONE /auth/sign-in", async () => {
      const fresh = session({ sessionToken: "guarded.ops.jwt" });
      let signInCalls = 0;
      globalThis.fetch = vi.fn(async (url: string) => {
        if (String(url).endsWith("/auth/sign-in")) signInCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => fresh,
          text: async () => JSON.stringify(fresh),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const [a, b, c] = await Promise.all([
        ensureOpsSession({ signer, bridgeUrl: BASE }),
        ensureOpsSession({ signer, bridgeUrl: BASE }),
        ensureOpsSession({ signer, bridgeUrl: BASE }),
      ]);
      expect(signInCalls).toBe(1);
      expect(a?.sessionToken).toBe("guarded.ops.jwt");
      expect(b?.sessionToken).toBe("guarded.ops.jwt");
      expect(c?.sessionToken).toBe("guarded.ops.jwt");
    });

    it("returns null when the signer cannot sign and no session is cached", async () => {
      const noSign: SupportSigner = { address: ADDR };
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const got = await ensureOpsSession({ signer: noSign, bridgeUrl: BASE });
      expect(got).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("clears the flight guard after settle so a later sign-in can run again", async () => {
      const fresh = session({ sessionToken: "again.ops.jwt" });
      let signInCalls = 0;
      globalThis.fetch = vi.fn(async (url: string) => {
        if (String(url).endsWith("/auth/sign-in")) signInCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => fresh,
          text: async () => JSON.stringify(fresh),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      await ensureOpsSession({ signer, bridgeUrl: BASE });
      // a valid session is now cached; clear it to force a second sign-in
      clearOpsSession(ADDR);
      await ensureOpsSession({ signer, bridgeUrl: BASE });
      expect(signInCalls).toBe(2);
    });
  });

  it("ops cache and customer cache stay isolated (no cross-pollution)", () => {
    // Write an ops session via sessionStorage.
    writeOpsSession(ADDR, session({ sessionToken: "ops-only" }));
    // The customer localStorage key must remain empty.
    expect(
      window.localStorage.getItem(
        `support.p2p.me:session:${BASE}:${ADDR.toLowerCase()}`,
      ),
    ).toBeNull();
    // And reading the ops cache must not be satisfied by any localStorage write.
    window.localStorage.setItem(
      `support.p2p.me:session:${BASE}:${ADDR.toLowerCase()}`,
      JSON.stringify(session({ sessionToken: "customer-only" })),
    );
    expect(readOpsSession(ADDR)?.sessionToken).toBe("ops-only");
  });
});
