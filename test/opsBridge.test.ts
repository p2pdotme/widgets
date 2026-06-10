import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchOpsThread,
  postOpsMessage,
  patchOpsP2pTag,
  resolveOpsChat,
  OpsBridgeError,
} from "../src/api/opsBridge";

const TOKEN = "ops.jwt.token";
const BASE = "https://bridge.local";

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opsBridge client", () => {
  it("fetchOpsThread GETs /ops/orders/:id/thread with bearer and returns the thread", async () => {
    const thread = {
      ok: true,
      status: "open",
      p2pTag: "reviewing",
      conversationId: 42,
      messages: [
        {
          id: 1,
          content: "hi",
          direction: "user",
          createdAt: 1000,
          senderName: null,
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(okResponse(thread));

    const res = await fetchOpsThread({
      bridgeUrl: BASE,
      sessionToken: TOKEN,
      orderId: "0xabc",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/ops/orders/0xabc/thread`);
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(res.status).toBe("open");
    expect(res.p2pTag).toBe("reviewing");
    expect(res.conversationId).toBe(42);
    expect(res.messages).toHaveLength(1);
  });

  it("trims a trailing slash on bridgeUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ ok: true, status: null, p2pTag: null, conversationId: null, messages: [] }),
    );
    await fetchOpsThread({
      bridgeUrl: "https://bridge.local/",
      sessionToken: TOKEN,
      orderId: "7",
    });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bridge.local/ops/orders/7/thread");
  });

  it("postOpsMessage POSTs content and returns the new id", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, id: 99 }));
    const res = await postOpsMessage({
      bridgeUrl: BASE,
      sessionToken: TOKEN,
      orderId: "0xabc",
      content: "hello there",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/ops/orders/0xabc/messages`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(init.body)).toEqual({ content: "hello there" });
    expect(res.id).toBe(99);
  });

  it("patchOpsP2pTag PATCHes the chosen tag", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, p2pTag: "escalated" }));
    const res = await patchOpsP2pTag({
      bridgeUrl: BASE,
      sessionToken: TOKEN,
      orderId: "0xabc",
      tag: "escalated",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/ops/orders/0xabc/p2p-tag`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ tag: "escalated" });
    expect(res.p2pTag).toBe("escalated");
  });

  it("patchOpsP2pTag supports clearing the tag with null", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, p2pTag: null }));
    await patchOpsP2pTag({
      bridgeUrl: BASE,
      sessionToken: TOKEN,
      orderId: "0xabc",
      tag: null,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ tag: null });
  });

  it("resolveOpsChat POSTs /resolve and returns resolved status", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, status: "resolved" }));
    const res = await resolveOpsChat({
      bridgeUrl: BASE,
      sessionToken: TOKEN,
      orderId: "0xabc",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/ops/orders/0xabc/resolve`);
    expect(init.method).toBe("POST");
    expect(res.status).toBe("resolved");
  });

  it("throws OpsBridgeError carrying the HTTP status on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, { ok: false, reason: "expired" }));
    await expect(
      fetchOpsThread({ bridgeUrl: BASE, sessionToken: TOKEN, orderId: "0xabc" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("the typed error is an OpsBridgeError with the bridge reason", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(403, { ok: false, reason: "forbidden" }));
    let caught: unknown;
    try {
      await postOpsMessage({
        bridgeUrl: BASE,
        sessionToken: TOKEN,
        orderId: "0xabc",
        content: "x",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OpsBridgeError);
    expect((caught as OpsBridgeError).status).toBe(403);
    expect((caught as OpsBridgeError).reason).toBe("forbidden");
  });
});
