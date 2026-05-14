import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bootChatwoot,
  __resetChatwootForTests,
  type ChatwootSession,
} from "../src/chatwoot/sdk";

function makeSession(overrides: Partial<ChatwootSession> = {}): ChatwootSession {
  return {
    baseUrl: "https://chatwoot.test",
    websiteToken: "ws_one",
    identifier: "0x0000000000000000000000000000000000000001",
    identifierHash: "hash_one",
    ...overrides,
  };
}

function stubSDK() {
  const run = vi.fn((_opts: { websiteToken: string; baseUrl: string }) => {
    (window as any).$chatwoot = {
      setUser: vi.fn(),
      toggle: vi.fn(),
      reset: vi.fn(),
    };
  });
  (window as any).chatwootSDK = { run };
  return run;
}

beforeEach(() => {
  __resetChatwootForTests();
  delete (window as any).chatwootSDK;
  delete (window as any).$chatwoot;
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bootChatwoot", () => {
  it("calls chatwootSDK.run with the session websiteToken on first boot", async () => {
    const run = stubSDK();
    await bootChatwoot(makeSession());
    expect(run).toHaveBeenCalledWith({
      websiteToken: "ws_one",
      baseUrl: "https://chatwoot.test",
    });
    expect((window as any).$chatwoot.setUser).toHaveBeenCalledWith(
      "0x0000000000000000000000000000000000000001",
      { identifier_hash: "hash_one", name: "Customer" },
    );
  });

  it("is a no-op when called twice with the same session", async () => {
    const run = stubSDK();
    const session = makeSession();
    await bootChatwoot(session);
    await bootChatwoot(session);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("re-runs the SDK with a fresh websiteToken when the inbox changes", async () => {
    const run = stubSDK();
    await bootChatwoot(makeSession({ websiteToken: "ws_one" }));
    await bootChatwoot(
      makeSession({
        websiteToken: "ws_two",
        identifierHash: "hash_two",
      }),
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({
      websiteToken: "ws_two",
      baseUrl: "https://chatwoot.test",
    });
  });

  it("tears down the existing iframe when the inbox changes", async () => {
    stubSDK();
    await bootChatwoot(makeSession());
    const iframe = document.createElement("iframe");
    iframe.id = "chatwoot_live_chat_widget";
    document.body.appendChild(iframe);
    expect(document.getElementById("chatwoot_live_chat_widget")).not.toBeNull();
    await bootChatwoot(
      makeSession({ websiteToken: "ws_two", identifierHash: "hash_two" }),
    );
    expect(document.getElementById("chatwoot_live_chat_widget")).toBeNull();
  });

  it("calls reset() on the current instance before rebooting", async () => {
    stubSDK();
    await bootChatwoot(makeSession());
    const reset = (window as any).$chatwoot.reset as ReturnType<typeof vi.fn>;
    await bootChatwoot(
      makeSession({ websiteToken: "ws_two", identifierHash: "hash_two" }),
    );
    expect(reset).toHaveBeenCalled();
  });
});

describe("bootChatwoot cw_conversation cookie", () => {
  function clearCookie() {
    document.cookie = "cw_conversation=; path=/; max-age=0";
  }

  beforeEach(() => clearCookie());
  afterEach(() => clearCookie());

  it("sets cw_conversation cookie before run() when the session carries one", async () => {
    const run = vi.fn((_opts: { websiteToken: string; baseUrl: string }) => {
      // Assert cookie is already present when run() executes, matching the
      // real SDK behaviour of building the iframe URL inside run().
      expect(document.cookie).toContain("cw_conversation=jwt_alpha");
      (window as any).$chatwoot = {
        setUser: vi.fn(),
        toggle: vi.fn(),
        reset: vi.fn(),
      };
    });
    (window as any).chatwootSDK = { run };
    await bootChatwoot(makeSession({ cwConversation: "jwt_alpha" }));
    expect(run).toHaveBeenCalledOnce();
  });

  it("reboots the SDK and swaps cookie when only cwConversation changes", async () => {
    const run = stubSDK();
    await bootChatwoot(makeSession({ cwConversation: "jwt_order_180" }));
    expect(document.cookie).toContain("cw_conversation=jwt_order_180");
    await bootChatwoot(makeSession({ cwConversation: "jwt_order_169" }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(document.cookie).toContain("cw_conversation=jwt_order_169");
  });

  it("clears stale cookie when the new session has no cwConversation", async () => {
    const run = stubSDK();
    await bootChatwoot(makeSession({ cwConversation: "jwt_order_180" }));
    expect(document.cookie).toContain("cw_conversation=jwt_order_180");
    await bootChatwoot(makeSession({ cwConversation: undefined }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(document.cookie).not.toContain("jwt_order_180");
  });

  it("is a no-op when cwConversation matches the active boot", async () => {
    const run = stubSDK();
    const session = makeSession({ cwConversation: "jwt_order_180" });
    await bootChatwoot(session);
    await bootChatwoot(session);
    expect(run).toHaveBeenCalledOnce();
  });
});
