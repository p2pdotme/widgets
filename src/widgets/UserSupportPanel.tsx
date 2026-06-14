// Customer-facing support chat for a single order. Reads and writes the SAME
// per-order Chatwoot conversation ops sees, proxied through the bridge `/me/*`
// routes (see `src/api/userBridge.ts`). This replaces the website-SDK + HMAC
// identity-merge path: when the bridge `hmacSecret` drifted from the inbox
// `hmac_token`, `setUser` was rejected and the user silently became an
// anonymous visitor in a NEW, separate conversation — never seeing ops
// replies. Proxying through the bridge under the shared admin token removes
// that whole failure class; the gate is on-chain ownership only.
//
// This is `OpsSupportPanel` minus the operator-only controls (no P2P-tag
// dropdown, no Resolve action). It instead renders a read-only
// `P2PTagBanner` so the user sees the operator-set workflow status, and locks
// the composer once ops resolves the chat.
//
// Polls `GET /me/orders/:id/thread` every 7s (one request per poll). Sign-in
// goes through `ensureUserSession`, whose in-flight guard collapses the mount
// + first-poll race into a SINGLE wallet prompt. A sign-in/auth failure pauses
// the poll (so it can't re-prompt the wallet on a loop) and surfaces an
// explicit "Try again"; transient read failures keep polling with a quiet
// "reconnecting" hint; send failures surface a reason instead of vanishing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupportSigner } from "../types";
import {
  fetchUserThread,
  postUserMessage,
  UserBridgeError,
  type UserThread,
  type UserThreadMessage,
} from "../api/userBridge";
import {
  ensureUserSession,
  clearCachedSession,
} from "../state/sessionCache";
import { P2PTagBanner } from "./P2PTagBanner";
import { Spinner, injectKeyframes } from "../ui/components";
import { color, radius, font, weight, S } from "../ui/theme";

const POLL_INTERVAL_MS = 7_000;

// Mirror the bridge cap (`routes/me.ts` MAX_MESSAGE_LENGTH) so an over-long
// paste is caught and explained client-side instead of bouncing as a 400 the
// user never sees.
const MAX_MESSAGE_LENGTH = 4096;

/** Tags a failure originating in sign-in / signature (vs a transient read or
 *  send error), so the panel can branch: auth failures pause the poll and ask
 *  for an explicit retry; everything else keeps polling or shows a send error. */
class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/** True when the error means "we need a (re)signature", not "a request blipped". */
function isAuthFailure(err: unknown): boolean {
  return (
    err instanceof SignInError ||
    (err instanceof UserBridgeError && err.status === 401)
  );
}

/** Friendly, vocabulary-clean copy for a failed send, keyed on the bridge's
 *  `reason`. Avoids protocol-internal terms (no "dispute"/"conversation"). */
function sendFailureMessage(err: unknown): string {
  if (err instanceof UserBridgeError) {
    switch (err.reason) {
      case "conversation_not_ready":
        return "Support isn’t ready yet. Please try again in a moment.";
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

/** An optimistic user message. `id` is a temp negative value (stable React key
 *  + rollback handle); `serverId` is filled with the real Chatwoot message id
 *  once the POST resolves, and is what reconcile matches the polled thread on. */
type OptimisticMessage = UserThreadMessage & { serverId?: number };

export interface UserSupportPanelProps {
  orderId: string;
  signer: SupportSigner;
  bridgeUrl: string;
}

export function UserSupportPanel({
  orderId,
  signer,
  bridgeUrl,
}: UserSupportPanelProps) {
  const [thread, setThread] = useState<UserThread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set when sign-in itself fails (declined signature, bridge sign-in down, or
  // a 401 that survived one retry). Distinct from `loadError`: it pauses the
  // poll and demands an explicit retry rather than auto-re-prompting.
  const [authError, setAuthError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Optimistic messages not yet seen in a poll; reconciled on `serverId`.
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);

  const tempIdRef = useRef(-1);
  const mountedRef = useRef(true);
  // When an auth failure is active the 7s interval must NOT fire another
  // sign-in (it would re-pop the wallet prompt). Gates the poll tick until an
  // explicit `retryAuth`.
  const pausedRef = useRef(false);

  useEffect(injectKeyframes, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Resolve a valid user session for this order, signing in if needed. The
   *  in-flight guard in `ensureUserSession` means concurrent callers share ONE
   *  wallet prompt. Sign-in failures are tagged `SignInError` so callers can
   *  tell them apart from transient request errors. */
  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const session = await ensureUserSession({ signer, bridgeUrl, orderId });
      return session?.sessionToken ?? null;
    } catch (err) {
      throw new SignInError(err instanceof Error ? err.message : String(err));
    }
  }, [signer, bridgeUrl, orderId]);

  /** Run a user call; on 401 invalidate the session and retry once. */
  const withAuth = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T | null> => {
      const token = await getToken();
      if (!token) return null;
      try {
        return await fn(token);
      } catch (err) {
        if (err instanceof UserBridgeError && err.status === 401) {
          clearCachedSession(bridgeUrl, signer.address, orderId);
          const fresh = await getToken();
          if (!fresh) return null;
          return await fn(fresh);
        }
        throw err;
      }
    },
    [getToken, bridgeUrl, signer.address, orderId],
  );

  const loadThread = useCallback(async () => {
    try {
      const next = await withAuth((token) =>
        fetchUserThread({ bridgeUrl, sessionToken: token, orderId }),
      );
      if (!mountedRef.current || !next) return;
      setThread(next);
      setLoadError(null);
      setAuthError(null);
      pausedRef.current = false;
      // Drop a temp message once its real counterpart (matched on the server
      // id stamped after POST) appears in the polled thread. A temp whose POST
      // hasn't resolved yet (no `serverId`) is kept until it does.
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
        // Stop the poll from re-prompting the wallet; require an explicit retry.
        pausedRef.current = true;
        setLoadError(null);
        setAuthError("We couldn’t verify your wallet for support.");
      } else {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [withAuth, bridgeUrl, orderId]);

  // Initial load + 7s poll. Single request per tick; cleanup on unmount. The
  // tick is skipped while paused (auth failure) so it never re-prompts.
  useEffect(() => {
    void loadThread();
    const id = setInterval(() => {
      if (!pausedRef.current) void loadThread();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadThread]);

  /** Explicit user-driven re-auth: clear the paused/error state and try once. */
  const retryAuth = useCallback(() => {
    pausedRef.current = false;
    setAuthError(null);
    setLoadError(null);
    void loadThread();
  }, [loadThread]);

  const status = thread?.status ?? null;
  const isResolved = status === "resolved";

  const messages = useMemo(() => {
    const base = thread?.messages ?? [];
    return [...base, ...optimistic].sort((a, b) => a.createdAt - b.createdAt);
  }, [thread, optimistic]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || isResolved) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      setSendError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }
    setSending(true);
    setSendError(null);
    // Optimistic append: show the message immediately.
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
      const result = await withAuth((token) =>
        postUserMessage({ bridgeUrl, sessionToken: token, orderId, content }),
      );
      // Stamp the real Chatwoot message id so reconcile dedups on id, not
      // content (two identical messages stay two bubbles).
      if (mountedRef.current && result) {
        setOptimistic((prev) =>
          prev.map((m) =>
            m.id === temp.id ? { ...m, serverId: result.id } : m,
          ),
        );
      }
      await loadThread();
    } catch (err) {
      // Roll back the optimistic message on failure and restore the draft, and
      // tell the user WHY — a silently-vanishing bubble reads as "Send did
      // nothing". An auth failure routes to the reconnect path instead.
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
  }, [draft, sending, isResolved, withAuth, bridgeUrl, orderId, loadThread]);

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
      data-user-support-panel
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
      {/* Connection strip: once a thread has loaded, a paused auth failure or a
          transient poll blip is surfaced here instead of silently freezing a
          stale thread that looks live. */}
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

      {/* Header: read-only operator status (tag / resolved notice). */}
      {(thread?.p2pTag || isResolved) && (
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${color.border}` }}>
          <P2PTagBanner tag={thread?.p2pTag ?? null} status={status ?? undefined} />
        </div>
      )}

      {/* Message list */}
      <div
        data-user-message-list
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

      {/* Footer */}
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
        {isResolved ? (
          <div style={{ ...S.faint, color: color.textMuted }}>
            This conversation has been closed by support.
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

/** Sign-in could not complete (declined signature, bridge sign-in down, or an
 *  expired session on a fresh thread). Offers an explicit retry rather than
 *  letting the poll silently re-prompt the wallet. */
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
      data-user-message-direction={message.direction}
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
        {/* Always neutral "Support" for the other side — never the raw Chatwoot
            sender name — so a per-operator identity can't leak to the user
            (identity-masking contract, bridge D-003-v2), even if ops later
            replies under a named agent account. */}
        {isMine ? "You" : "Support"}
      </div>
      {message.content}
    </div>
  );
}
