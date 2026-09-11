// Customer-facing GENERAL support chat — a support thread with no order behind
// it. A wallet with a question but no trade to point at gets one continuous
// thread, proxied through the bridge `/tickets/*` routes (see
// `src/api/generalBridge.ts`). Authorization is the wallet session alone.
//
// This is `UserSupportPanel` (the dispute panel) with two deliberate
// differences:
//   1. It authenticates with a WALLET-lane session (no orderId) and addresses
//      the thread by a ticket id it opens on mount, rather than by an order.
//   2. It does NOT lock the composer when the thread is resolved. A general
//      thread is one-per-wallet and reopenable: sending a reply reopens it on
//      the bridge, so the user is never stranded. The dispute panel stays
//      locked-on-resolve (a dispute settles on chain, closed for good) — that
//      separation is why this is a separate component, not a prop.
//
// Polls `GET /tickets/:id/thread` every 7s. Sign-in + open collapse into a
// single wallet prompt via `ensureWalletSession`'s in-flight guard.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupportSigner } from "../types";
import {
  openGeneralTicket,
  fetchGeneralThread,
  postGeneralMessage,
  UserBridgeError,
  type GeneralThread,
  type UserThreadMessage,
} from "../api/generalBridge";
import { ensureWalletSession, clearCachedSession } from "../state/sessionCache";
import { Spinner, injectKeyframes } from "../ui/components";
import { color, radius, font, weight, S } from "../ui/theme";

const POLL_INTERVAL_MS = 7_000;
const MAX_MESSAGE_LENGTH = 4096;

class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

function isAuthFailure(err: unknown): boolean {
  return (
    err instanceof SignInError ||
    (err instanceof UserBridgeError && err.status === 401)
  );
}

function sendFailureMessage(err: unknown): string {
  if (err instanceof UserBridgeError) {
    switch (err.reason) {
      case "content_too_long":
        return `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`;
      case "empty_content":
        return "Please write a message first.";
      case "chatwoot_disabled":
      case "chatwoot_unreachable":
        return "Support is temporarily unavailable. Please try again shortly.";
    }
  }
  return "Your message couldn’t be sent. Please try again.";
}

type OptimisticMessage = UserThreadMessage & { serverId?: number };

export interface GeneralSupportPanelProps {
  signer: SupportSigner;
  bridgeUrl: string;
  /** Routing hint stamped on the thread so the right currency team sees it. */
  currency?: string;
  /** Language hint so ops know which language to reply in. */
  locale?: string;
}

export function GeneralSupportPanel({
  signer,
  bridgeUrl,
  currency,
  locale,
}: GeneralSupportPanelProps) {
  const [thread, setThread] = useState<GeneralThread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);

  const tempIdRef = useRef(-1);
  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  // The wallet's one general ticket id, resolved once via POST /tickets and
  // reused for every read/write. An in-flight guard stops the mount + first
  // poll opening two.
  const ticketIdRef = useRef<number | null>(null);
  const openInFlightRef = useRef<Promise<number> | null>(null);

  useEffect(injectKeyframes, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const session = await ensureWalletSession({ signer, bridgeUrl });
      return session?.sessionToken ?? null;
    } catch (err) {
      throw new SignInError(err instanceof Error ? err.message : String(err));
    }
  }, [signer, bridgeUrl]);

  const withAuth = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T | null> => {
      const token = await getToken();
      if (!token) return null;
      try {
        return await fn(token);
      } catch (err) {
        if (err instanceof UserBridgeError && err.status === 401) {
          clearCachedSession(bridgeUrl, signer.address);
          const fresh = await getToken();
          if (!fresh) return null;
          return await fn(fresh);
        }
        throw err;
      }
    },
    [getToken, bridgeUrl, signer.address],
  );

  // Resolve the wallet's ticket id, opening it once. Shared across concurrent
  // callers so a mount and its first poll open a single thread.
  const ensureTicket = useCallback(
    async (token: string): Promise<number> => {
      if (ticketIdRef.current !== null) return ticketIdRef.current;
      if (openInFlightRef.current) return openInFlightRef.current;
      const pass = (async () => {
        const opened = await openGeneralTicket({
          bridgeUrl,
          sessionToken: token,
          currency,
          locale,
        });
        ticketIdRef.current = opened.ticketId;
        return opened.ticketId;
      })().finally(() => {
        openInFlightRef.current = null;
      });
      openInFlightRef.current = pass;
      return pass;
    },
    [bridgeUrl, currency, locale],
  );

  const loadThread = useCallback(async () => {
    try {
      const next = await withAuth(async (token) => {
        const ticketId = await ensureTicket(token);
        return fetchGeneralThread({ bridgeUrl, sessionToken: token, ticketId });
      });
      if (!mountedRef.current || !next) return;
      setThread(next);
      setLoadError(null);
      setAuthError(null);
      pausedRef.current = false;
      setOptimistic((prev) =>
        prev.filter(
          (t) =>
            t.serverId === undefined ||
            !next.messages.some((m) => m.id === t.serverId),
        ),
      );
    } catch (err) {
      if (!mountedRef.current) return;
      if (isAuthFailure(err)) {
        pausedRef.current = true;
        setLoadError(null);
        setAuthError("We couldn’t verify your wallet for support.");
      } else {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [withAuth, ensureTicket, bridgeUrl]);

  useEffect(() => {
    void loadThread();
    const id = setInterval(() => {
      if (!pausedRef.current) void loadThread();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadThread]);

  const retryAuth = useCallback(() => {
    pausedRef.current = false;
    setAuthError(null);
    setLoadError(null);
    void loadThread();
  }, [loadThread]);

  const status = thread?.status ?? null;
  // Unlike the dispute panel, resolved does NOT lock the composer — a reply
  // reopens the thread. We only surface a gentle hint.
  const isResolved = status === "resolved";

  const messages = useMemo(() => {
    const base = thread?.messages ?? [];
    return [...base, ...optimistic].sort((a, b) => a.createdAt - b.createdAt);
  }, [thread, optimistic]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      setSendError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }
    setSending(true);
    setSendError(null);
    const temp: UserThreadMessage = {
      id: tempIdRef.current--,
      content,
      direction: "user",
      createdAt: Date.now(),
      senderName: "You",
    };
    setOptimistic((prev) => [...prev, temp]);
    setDraft("");
    try {
      await withAuth(async (token) => {
        const ticketId = await ensureTicket(token);
        return postGeneralMessage({
          bridgeUrl,
          sessionToken: token,
          ticketId,
          content,
        });
      });
      // The general reply route returns no message id, so reconcile by dropping
      // the temp on the next poll that contains a matching user message. Reload
      // immediately so a reopened thread shows as open again without waiting.
      await loadThread();
      if (mountedRef.current) {
        setOptimistic((prev) => prev.filter((m) => m.id !== temp.id));
      }
    } catch (err) {
      if (mountedRef.current) {
        setOptimistic((prev) => prev.filter((m) => m.id !== temp.id));
        setDraft(content);
        if (isAuthFailure(err)) {
          pausedRef.current = true;
          setAuthError("We couldn’t verify your wallet for support.");
        } else {
          setSendError(sendFailureMessage(err));
        }
      }
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [draft, sending, withAuth, ensureTicket, bridgeUrl, loadThread]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      data-general-support-panel
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        fontFamily: "var(--p2p-font, inherit)",
        color: color.text,
        background: color.surface,
      }}
    >
      {thread !== null && (authError || loadError) && (
        <div
          role="status"
          style={{
            padding: "8px 16px",
            borderBottom: `1px solid ${color.border}`,
            background: color.surfaceAlt,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            ...S.faint,
            color: color.textMuted,
          }}
        >
          <span>
            {authError
              ? "Your support session needs to reconnect."
              : "Reconnecting…"}
          </span>
          {authError && (
            <button
              type="button"
              onClick={retryAuth}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                color: color.accent,
                cursor: "pointer",
                fontSize: font.sm,
                fontWeight: weight.medium,
              }}
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      <div
        data-general-message-list
        style={{
          flex: 1,
          minHeight: 120,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: color.surfaceAlt,
        }}
      >
        {thread === null && authError ? (
          <AuthErrorView message={authError} onRetry={retryAuth} />
        ) : thread === null && loadError === null ? (
          <div
            role="status"
            style={{ display: "flex", alignItems: "center", gap: 10, color: color.textMuted }}
          >
            <Spinner size={18} />
            <span style={{ ...S.muted }}>Loading conversation…</span>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ ...S.muted, margin: "auto", textAlign: "center" }}>
            No messages yet. Send a message and the support team will reply here.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        {loadError && thread === null && !authError && (
          <div style={{ ...S.faint, color: color.danger }}>
            Couldn’t load the conversation. Retrying…
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: `1px solid ${color.border}`,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: color.surface,
        }}
      >
        {/* A resolved general thread stays writable — a message reopens it. */}
        {isResolved && (
          <div style={{ ...S.faint, color: color.textMuted }}>
            This conversation was closed. Send a message to reopen it.
          </div>
        )}
        {sendError && (
          <div role="alert" style={{ ...S.faint, color: color.danger }}>
            {sendError}
          </div>
        )}
        <textarea
          aria-label="Message"
          placeholder="Write a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH}
          style={{
            resize: "vertical",
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: radius.md,
            border: `1px solid ${color.border}`,
            background: color.surface,
            color: color.text,
            fontSize: font.base,
            fontFamily: "inherit",
            lineHeight: 1.4,
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || draft.trim().length === 0}
            style={{
              ...S.primaryBtn,
              width: "auto",
              height: 38,
              padding: "0 18px",
              fontSize: font.md,
              opacity: draft.trim().length === 0 ? 0.6 : 1,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        margin: "auto",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        maxWidth: 320,
      }}
    >
      <div style={{ ...S.muted, color: color.text }}>{message}</div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          ...S.primaryBtn,
          width: "auto",
          height: 36,
          padding: "0 18px",
          fontSize: font.md,
        }}
      >
        Try again
      </button>
    </div>
  );
}

function MessageBubble({ message }: { message: UserThreadMessage }) {
  const isMine = message.direction === "user";
  return (
    <div
      data-general-message-direction={message.direction}
      style={{
        alignSelf: isMine ? "flex-end" : "flex-start",
        maxWidth: "78%",
        padding: "8px 12px",
        borderRadius: radius.lg,
        background: isMine ? color.accentSoft : color.surface,
        border: `1px solid ${color.border}`,
        color: color.text,
        fontSize: font.base,
        lineHeight: 1.4,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      <div
        style={{
          ...S.faint,
          marginBottom: 2,
          fontWeight: weight.medium,
          color: color.textMuted,
        }}
      >
        {/* Neutral "Support" for the other side — never the raw Chatwoot sender
            name — matching the identity-masking contract of the dispute panel. */}
        {isMine ? "You" : "Support"}
      </div>
      {message.content}
    </div>
  );
}
