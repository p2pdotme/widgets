import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cacheKey,
  readCachedSession,
  writeCachedSession,
  clearCachedSession,
  ensureUserSession,
  __resetUserFlightForTests,
  type SignInResponse,
} from "../src/state/sessionCache";
import type { SupportSigner } from "../src/types";

const ADDR = "0x0000000000000000000000000000000000000001";
const BASE = "https://bridge.local";
const ORDER = "227";

function session(over: Partial<SignInResponse> = {}): SignInResponse {
  return {
    ok: true,
    address: ADDR,
    role: "user",
    chatwoot: null,
    sessionToken: "user.session.jwt",
    // Comfortably outside the 60s expiry buffer so the cache reads as valid.
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    ...over,
  };
}

const signer: SupportSigner = {
  address: ADDR,
  signMessage: async () => "0xsig",
  getChainId: async () => 84532,
};

function mockSignIn(fresh: SignInResponse, counter?: { n: number }) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (counter && String(url).endsWith("/auth/sign-in")) counter.n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => fresh,
      text: async () => JSON.stringify(fresh),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetUserFlightForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureUserSession", () => {
  it("returns the cached per-order session without signing when valid", async () => {
    writeCachedSession(BASE, ADDR, session(), ORDER);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const got = await ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER });
    expect(got?.sessionToken).toBe("user.session.jwt");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signs in with the orderId bound and writes the per-order cache on a miss", async () => {
    const fresh = session({ sessionToken: "fresh.user.jwt" });
    let signInBody: { orderId?: string } = {};
    globalThis.fetch = vi.fn(async (_url: string, init: { body: string }) => {
      signInBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => fresh,
        text: async () => JSON.stringify(fresh),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const got = await ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER });
    expect(got?.sessionToken).toBe("fresh.user.jwt");
    expect(signInBody.orderId).toBe(ORDER);
    expect(window.localStorage.getItem(cacheKey(BASE, ADDR, ORDER))).toBeTruthy();
  });

  // The W1 fix: a panel mount racing its own first poll must not pop two prompts.
  it("flight-guards concurrent calls into exactly ONE /auth/sign-in", async () => {
    const counter = { n: 0 };
    mockSignIn(session({ sessionToken: "guarded.user.jwt" }), counter);

    const [a, b, c] = await Promise.all([
      ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER }),
      ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER }),
      ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER }),
    ]);
    expect(counter.n).toBe(1);
    expect(a?.sessionToken).toBe("guarded.user.jwt");
    expect(b?.sessionToken).toBe("guarded.user.jwt");
    expect(c?.sessionToken).toBe("guarded.user.jwt");
  });

  it("does NOT collapse sign-ins for different orders", async () => {
    const counter = { n: 0 };
    mockSignIn(session(), counter);
    await Promise.all([
      ensureUserSession({ signer, bridgeUrl: BASE, orderId: "1" }),
      ensureUserSession({ signer, bridgeUrl: BASE, orderId: "2" }),
    ]);
    expect(counter.n).toBe(2);
  });

  it("returns null when the signer cannot sign and no session is cached", async () => {
    const noSign: SupportSigner = { address: ADDR };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const got = await ensureUserSession({ signer: noSign, bridgeUrl: BASE, orderId: ORDER });
    expect(got).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the flight guard after settle so a later sign-in can run again", async () => {
    const counter = { n: 0 };
    mockSignIn(session(), counter);
    await ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER });
    // A valid session is now cached; clear it to force a second sign-in.
    clearCachedSession(BASE, ADDR, ORDER);
    await ensureUserSession({ signer, bridgeUrl: BASE, orderId: ORDER });
    expect(counter.n).toBe(2);
  });
});
