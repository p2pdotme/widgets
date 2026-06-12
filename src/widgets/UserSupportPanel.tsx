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
// Polls `GET /me/orders/:id/thread` every 7s (one request per poll). On a 401
// the user session is cleared and re-signed-in.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupportSigner } from "../types";
import {
  fetchUserThread,
  postUserMessage,
  UserBridgeError,
  type UserThread,
  type UserThreadMessage,
} from "../api/userBridge";
import { signInWithBridge } from "../api/bridge";
import {
  readCachedSession,
  writeCachedSession,
  clearCachedSession,
} from "../state/sessionCache";
import { P2PTagBanner } from "./P2PTagBanner";
import { Spinner, injectKeyframes } from "../ui/components";
import { color, radius, font, weight, S } from "../ui/theme";

const POLL_INTERVAL_MS = 7_000;

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
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Optimistic messages not yet seen in a poll; reconciled on `serverId`.
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);

  const tempIdRef = useRef(-1);
  const mountedRef = useRef(true);

  useEffect(injectKeyframes, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Resolve a valid user session for this order, signing in if needed. */
  const getToken = useCallback(async (): Promise<string | null> => {
    const cached = readCachedSession(bridgeUrl, signer.address, orderId);
    if (cached) return cached.sessionToken;
    const session = await signInWithBridge({ signer, bridgeUrl, orderId });
    writeCachedSession(bridgeUrl, signer.address, session, orderId);
    return session.sessionToken;
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
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [withAuth, bridgeUrl, orderId]);

  // Initial load + 7s poll. Single request per tick; cleanup on unmount.
  useEffect(() => {
    void loadThread();
    const id = setInterval(() => void loadThread(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
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
    setSending(true);
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
    } catch {
      // Roll back the optimistic message on failure and restore the draft.
      if (mountedRef.current) {
        setOptimistic((prev) => prev.filter((m) => m.id !== temp.id));
        setDraft(content);
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
        {thread === null && loadError === null ? (
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
        {loadError && thread === null && (
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
            <textarea
              aria-label="Message"
              placeholder="Write a message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
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
        {isMine ? "You" : message.senderName ?? "Support"}
      </div>
      {message.content}
    </div>
  );
}
