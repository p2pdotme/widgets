import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
  cleanup,
} from "@testing-library/react";
import { Support } from "../src/widgets/Support";
import { opsCacheKey } from "../src/state/opsSessionCache";
import type { SupportSigner } from "../src/types";
import type { SignInResponse } from "../src/state/sessionCache";

const ADDR = "0x0000000000000000000000000000000000000001";
const BASE = "https://bridge.local";
const ORDER = "0xabc123";

const signer: SupportSigner = {
  address: ADDR,
  signMessage: async () => "0xsig",
  getChainId: async () => 84532,
};

function opsSession(): SignInResponse {
  return {
    ok: true,
    address: ADDR,
    role: "ops",
    chatwoot: null,
    sessionToken: "ops.session.jwt",
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
}

function threadBody(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: "open",
    p2pTag: null,
    conversationId: 7,
    messages: [
      {
        id: 1,
        content: "I never got my payment",
        direction: "user",
        createdAt: 1000,
        senderName: "Customer",
      },
    ],
    ...over,
  };
}

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route a mocked fetch by URL+method so a single mock serves the panel's
 *  poll + writes. `thread` is returned for every GET .../thread. */
function routedFetch(handlers: {
  thread?: () => unknown;
  message?: () => unknown;
  tag?: () => unknown;
  resolve?: () => unknown;
  onCall?: (url: string, init: any) => void;
}) {
  return vi.fn(async (url: string, init?: any) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    handlers.onCall?.(u, init);
    if (u.endsWith("/thread") && method === "GET") {
      return jsonRes(handlers.thread ? handlers.thread() : threadBody());
    }
    if (u.endsWith("/messages") && method === "POST") {
      return jsonRes(handlers.message ? handlers.message() : { ok: true, id: 50 });
    }
    if (u.endsWith("/p2p-tag") && method === "PATCH") {
      const tag = JSON.parse(init.body).tag;
      return jsonRes(handlers.tag ? handlers.tag() : { ok: true, p2pTag: tag });
    }
    if (u.endsWith("/resolve") && method === "POST") {
      return jsonRes(handlers.resolve ? handlers.resolve() : { ok: true, status: "resolved" });
    }
    if (u.endsWith("/auth/sign-in")) {
      return jsonRes(opsSession());
    }
    return jsonRes({ ok: false, reason: "unhandled" }, 500);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Pre-seed a valid ops session so ensureOpsSession skips signing.
  window.sessionStorage.setItem(opsCacheKey(ADDR), JSON.stringify(opsSession()));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("<Support mode=\"ops\">", () => {
  it("mounts the ops panel and reads the thread via GET /ops/orders/:id/thread", async () => {
    const fetchMock = routedFetch({});
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );

    await waitFor(() => {
      const threadCall = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith("/thread") && (i?.method ?? "GET") === "GET",
      );
      expect(threadCall).toBeTruthy();
      expect(String(threadCall![0])).toBe(`${BASE}/ops/orders/${ORDER}/thread`);
    });
    // The user message from the thread is rendered.
    await waitFor(() =>
      expect(screen.getByText(/never got my payment/i)).toBeInTheDocument(),
    );
  });

  it("renders the Chatwoot status pill from the thread", async () => {
    globalThis.fetch = routedFetch({
      thread: () => threadBody({ status: "pending" }),
    }) as unknown as typeof fetch;
    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/pending/i)).toBeInTheDocument(),
    );
  });

  it("sends a reply via POST /ops/orders/:id/messages and shows it optimistically", async () => {
    let postBody: any = null;
    const fetchMock = routedFetch({
      onCall: (u, init) => {
        if (u.endsWith("/messages")) postBody = JSON.parse(init.body);
      },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/never got my payment/i)).toBeInTheDocument(),
    );

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "We are looking into it" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // Optimistic: the reply appears immediately, before/independent of poll.
    await waitFor(() =>
      expect(screen.getByText(/we are looking into it/i)).toBeInTheDocument(),
    );
    await waitFor(() => expect(postBody).toEqual({ content: "We are looking into it" }));
  });

  it("reconciles the optimistic reply against the polled thread (no duplicate)", async () => {
    // First thread read: just the user message. After the POST, the reload
    // returns the thread WITH the ops reply — the temp optimistic copy must
    // be deduped so the reply shows exactly once.
    let postDone = false;
    globalThis.fetch = vi.fn(async (url: string, init?: any) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (u.endsWith("/messages") && method === "POST") {
        postDone = true;
        return jsonRes({ ok: true, id: 2 });
      }
      if (u.endsWith("/thread")) {
        return jsonRes(
          postDone
            ? threadBody({
                messages: [
                  ...threadBody().messages,
                  {
                    id: 2,
                    content: "On it now",
                    direction: "ops",
                    createdAt: 2000,
                    senderName: "Support Team",
                  },
                ],
              })
            : threadBody(),
        );
      }
      if (u.endsWith("/auth/sign-in")) return jsonRes(opsSession());
      return jsonRes({ ok: false }, 500);
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    await screen.findByText(/never got my payment/i);

    const textarea = screen.getByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "On it now" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // After reconcile, exactly one "On it now" bubble exists.
    await waitFor(() =>
      expect(screen.getAllByText(/on it now/i)).toHaveLength(1),
    );
  });

  it("keeps two identical replies as two bubbles (dedup by id, not content)", async () => {
    // Two ops replies with the same text. The bridge returns distinct ids
    // (51, 52). With id-based reconcile, polling that surfaces ONLY the
    // first (id 51) must drop exactly one optimistic copy — leaving the
    // second (id 52, not yet polled) intact. Content-based dedup would
    // have collapsed both into one.
    let postCount = 0;
    let firstReplyLanded = false;
    globalThis.fetch = vi.fn(async (url: string, init?: any) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (u.endsWith("/messages") && method === "POST") {
        postCount += 1;
        // First send → id 51, second → id 52.
        return jsonRes({ ok: true, id: postCount === 1 ? 51 : 52 });
      }
      if (u.endsWith("/thread")) {
        // The polled thread only ever surfaces the FIRST reply (id 51).
        return jsonRes(
          firstReplyLanded
            ? threadBody({
                messages: [
                  ...threadBody().messages,
                  {
                    id: 51,
                    content: "Thanks for your patience",
                    direction: "ops",
                    createdAt: 2000,
                    senderName: "Support Team",
                  },
                ],
              })
            : threadBody(),
        );
      }
      if (u.endsWith("/auth/sign-in")) return jsonRes(opsSession());
      return jsonRes({ ok: false }, 500);
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    const textarea = await screen.findByRole("textbox", { name: /reply/i });

    // Send the same text twice.
    fireEvent.change(textarea, { target: { value: "Thanks for your patience" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(postCount).toBe(1));
    // From here the polled thread carries the real id-51 message.
    firstReplyLanded = true;
    fireEvent.change(textarea, { target: { value: "Thanks for your patience" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(postCount).toBe(2));

    // Both bubbles survive: id-51 (now real, from the poll) + id-52 (still
    // optimistic, never polled). Content dedup would have shown only one.
    await waitFor(() =>
      expect(screen.getAllByText(/thanks for your patience/i)).toHaveLength(2),
    );
  });

  it("submits the reply on Cmd/Ctrl+Enter", async () => {
    let messagePosted = false;
    globalThis.fetch = routedFetch({
      onCall: (u) => {
        if (u.endsWith("/messages")) messagePosted = true;
      },
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    const textarea = await screen.findByRole("textbox", { name: /reply/i });
    fireEvent.change(textarea, { target: { value: "quick reply" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    await waitFor(() => expect(messagePosted).toBe(true));
  });

  it("changing the P2P tag dropdown PATCHes /ops/orders/:id/p2p-tag", async () => {
    let patchBody: any = null;
    globalThis.fetch = routedFetch({
      onCall: (u, init) => {
        if (u.endsWith("/p2p-tag")) patchBody = JSON.parse(init.body);
      },
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    const select = await screen.findByRole("combobox", { name: /tag/i });
    fireEvent.change(select, { target: { value: "escalated" } });
    await waitFor(() => expect(patchBody).toEqual({ tag: "escalated" }));
  });

  it("selecting 'Clear' on the tag dropdown PATCHes tag:null", async () => {
    let patchBody: any = null;
    globalThis.fetch = routedFetch({
      thread: () => threadBody({ p2pTag: "reviewing" }),
      onCall: (u, init) => {
        if (u.endsWith("/p2p-tag")) patchBody = JSON.parse(init.body);
      },
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    const select = await screen.findByRole("combobox", { name: /tag/i });
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(patchBody).toEqual({ tag: null }));
  });

  it("resolve flow: confirm modal → POST /ops/orders/:id/resolve → onChatResolved", async () => {
    let resolved = false;
    globalThis.fetch = routedFetch({
      onCall: (u) => {
        if (u.endsWith("/resolve")) resolved = true;
      },
    }) as unknown as typeof fetch;
    const onChatResolved = vi.fn();

    render(
      <Support
        mode="ops"
        orderId={ORDER}
        signer={signer}
        bridgeUrl={BASE}
        layout="inline"
        onChatResolved={onChatResolved}
      />,
    );
    await screen.findByRole("textbox", { name: /reply/i });

    fireEvent.click(screen.getByRole("button", { name: /resolve chat/i }));
    // A confirm modal/dialog appears.
    const dialog = await screen.findByRole("dialog");
    // Confirm inside the dialog.
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve/i }));

    await waitFor(() => expect(resolved).toBe(true));
    await waitFor(() => expect(onChatResolved).toHaveBeenCalledOnce());
  });

  it("locks the reply input and tag dropdown when the conversation is resolved", async () => {
    globalThis.fetch = routedFetch({
      thread: () => threadBody({ status: "resolved", p2pTag: "reviewing" }),
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    const textarea = await screen.findByRole("textbox", { name: /reply/i });
    await waitFor(() => expect(textarea).toBeDisabled());
    expect(screen.getByRole("combobox", { name: /tag/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resolve chat/i })).toBeDisabled();
  });

  it("renders an empty-state when the thread has no messages", async () => {
    globalThis.fetch = routedFetch({
      thread: () => threadBody({ messages: [] }),
    }) as unknown as typeof fetch;
    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument(),
    );
  });

  it("renders nothing in ops mode when orderId is missing", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { container } = render(
      <Support mode="ops" signer={signer} bridgeUrl={BASE} layout="inline" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("polls GET /ops/orders/:id/thread on an interval", async () => {
    vi.useFakeTimers();
    const fetchMock = routedFetch({});
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );

    const threadCount = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/thread")).length;

    // Drain the initial mount fetch inside act (fake timers + async).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const before = threadCount();
    expect(before).toBeGreaterThanOrEqual(1);

    // Advance past one 7s poll tick, inside act so the poll's async setState
    // settles within an act scope.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7100);
    });
    expect(threadCount()).toBeGreaterThan(before);
  });

  it("on a 401 from the thread poll, clears the ops session and re-signs in", async () => {
    let threadCalls = 0;
    let signInCalls = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: any) => {
      const u = String(url);
      if (u.endsWith("/thread")) {
        threadCalls += 1;
        if (threadCalls === 1) return jsonRes({ ok: false, reason: "expired" }, 401);
        return jsonRes(threadBody());
      }
      if (u.endsWith("/auth/sign-in")) {
        signInCalls += 1;
        return jsonRes(opsSession());
      }
      return jsonRes({ ok: false }, 500);
    }) as unknown as typeof fetch;

    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="inline" />,
    );

    // The 401 invalidates the cached ops session and forces a fresh sign-in.
    await waitFor(() => expect(signInCalls).toBeGreaterThanOrEqual(1));
    // After re-sign-in the retried thread read renders the user message.
    await waitFor(() =>
      expect(screen.getByText(/never got my payment/i)).toBeInTheDocument(),
    );
  });

  it("customer mode is unchanged: mode defaults to customer and ignores ops props", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    render(
      <Support originApp="merchant-demo" signer={signer} bridgeUrl={BASE} />,
    );
    // Customer launcher present; no ops thread fetch on mount.
    expect(screen.getByRole("button", { name: /open support/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ops mode wraps in a Modal when layout=modal", async () => {
    globalThis.fetch = routedFetch({}) as unknown as typeof fetch;
    render(
      <Support mode="ops" orderId={ORDER} signer={signer} bridgeUrl={BASE} layout="modal" />,
    );
    // Modal owns role=dialog.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Let the initial thread load settle so the async state update happens
    // inside RTL's act() rather than after the assertion.
    await waitFor(() =>
      expect(screen.getByText(/never got my payment/i)).toBeInTheDocument(),
    );
  });
});
