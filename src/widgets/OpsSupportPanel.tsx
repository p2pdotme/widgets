// Operator-facing support surface (D-027-v2). Read the user-side thread,
// reply, set the P2P tag, and resolve the conversation. Mounted by
// `<Support mode="ops">`. Talks only to the bridge `/ops/*` routes via
// `src/api/opsBridge.ts`; the ops session is managed by
// `src/state/opsSessionCache.ts` (sessionStorage, tab-scoped).
//
// Three regions:
//   - Header: status pill (Chatwoot conv status) + P2P tag dropdown.
//   - Message list: scrollable, oldest-first, optimistic append on send.
//   - Footer: reply textarea (Cmd/Ctrl+Enter to send) + Send + Resolve chat.
//
// Polls `GET /ops/orders/:id/thread` every 7s (one request per poll). On a
// 401 from any call the ops session is cleared and re-ensured.
//
// This surface is operator-facing, so status / tag labels are fine. We
// still avoid leaking raw protocol jargon in free copy.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupportSigner, SupportP2PTag, SupportChatStatus } from "../types";
import {
  fetchOpsThread,
  postOpsMessage,
  patchOpsP2pTag,
  resolveOpsChat,
  OpsBridgeError,
  type OpsThread,
  type OpsThreadMessage,
} from "../api/opsBridge";
import {
  ensureOpsSession,
  clearOpsSession,
} from "../state/opsSessionCache";
import { Modal } from "../ui/Modal";
import { Spinner, injectKeyframes } from "../ui/components";
import { color, radius, font, weight, S } from "../ui/theme";

const POLL_INTERVAL_MS = 7_000;

/** An optimistic ops reply. `id` is a temp negative value (stable React key
 *  + rollback handle); `serverId` is filled with the real Chatwoot message id
 *  once the POST resolves, and is what reconcile matches the polled thread on. */
type OptimisticMessage = OpsThreadMessage & { serverId?: number };

const TAG_OPTIONS: Array<{ value: SupportP2PTag; label: string }> = [
  { value: "awaiting_user", label: "Awaiting user" },
  { value: "reviewing", label: "Reviewing" },
  { value: "evidence", label: "Evidence" },
  { value: "escalated", label: "Escalated" },
];

const STATUS_STYLE: Record<SupportChatStatus, { bg: string; fg: string }> = {
  open: { bg: color.successSoft, fg: color.success },
  pending: { bg: color.warningSoft, fg: color.warning },
  snoozed: { bg: color.surfaceAlt, fg: color.textMuted },
  resolved: { bg: color.surfaceAlt, fg: color.textMuted },
};

export interface OpsSupportPanelProps {
  orderId: string;
  signer: SupportSigner;
  bridgeUrl: string;
  onChatResolved?: () => void;
}

export function OpsSupportPanel({
  orderId,
  signer,
  bridgeUrl,
  onChatResolved,
}: OpsSupportPanelProps) {
  const [thread, setThread] = useState<OpsThread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Optimistic messages not yet seen in a poll. The React key stays the temp
  // negative `id` (stable across the POST so the bubble never remounts); once
  // the POST returns we stamp `serverId` with the real Chatwoot message id and
  // reconcile on that. Reconciling on id (not content) keeps two identical
  // replies as two bubbles instead of collapsing them into one.
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  // Optimistic tag override so the dropdown reflects the choice immediately.
  const [tagOverride, setTagOverride] = useState<
    SupportP2PTag | null | undefined
  >(undefined);

  const tempIdRef = useRef(-1);
  const mountedRef = useRef(true);

  useEffect(injectKeyframes, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Resolve a valid ops session, signing in if needed. */
  const getToken = useCallback(async (): Promise<string | null> => {
    const session = await ensureOpsSession({ signer, bridgeUrl });
    return session?.sessionToken ?? null;
  }, [signer, bridgeUrl]);

  /** Run an ops call; on 401 invalidate the session and retry once. */
  const withAuth = useCallback(
    async <T,>(
      fn: (token: string) => Promise<T>,
    ): Promise<T | null> => {
      const token = await getToken();
      if (!token) return null;
      try {
        return await fn(token);
      } catch (err) {
        if (err instanceof OpsBridgeError && err.status === 401) {
          clearOpsSession(signer.address);
          const fresh = await getToken();
          if (!fresh) return null;
          return await fn(fresh);
        }
        throw err;
      }
    },
    [getToken, signer.address],
  );

  const loadThread = useCallback(async () => {
    try {
      const next = await withAuth((token) =>
        fetchOpsThread({ bridgeUrl, sessionToken: token, orderId }),
      );
      if (!mountedRef.current || !next) return;
      setThread(next);
      setLoadError(null);
      // Reconcile optimism: drop a temp message once its real counterpart
      // (matched on the server id stamped after POST) appears in the polled
      // thread. A temp whose POST hasn't resolved yet (no `serverId`) is
      // kept until it does. The tag override is owned by handleTagChange
      // (set on click, cleared after its own confirmed write), so the poll
      // does not touch it — otherwise a concurrent operator's tag would be
      // masked by a stale local override that never clears.
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
  const effectiveTag =
    tagOverride !== undefined ? tagOverride : thread?.p2pTag ?? null;

  const messages = useMemo(() => {
    const base = thread?.messages ?? [];
    return [...base, ...optimistic].sort((a, b) => a.createdAt - b.createdAt);
  }, [thread, optimistic]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || isResolved) return;
    setSending(true);
    // Optimistic append (review item #19): show the reply immediately.
    const temp: OpsThreadMessage = {
      id: tempIdRef.current--,
      content,
      direction: "ops",
      createdAt: Date.now(),
      senderName: "You",
    };
    setOptimistic((prev) => [...prev, temp]);
    setDraft("");
    try {
      const result = await withAuth((token) =>
        postOpsMessage({ bridgeUrl, sessionToken: token, orderId, content }),
      );
      // Stamp the real Chatwoot message id onto the temp bubble so reconcile
      // dedups on id, not content (two identical replies stay two bubbles).
      if (mountedRef.current && result) {
        setOptimistic((prev) =>
          prev.map((m) =>
            m.id === temp.id ? { ...m, serverId: result.id } : m,
          ),
        );
      }
      // Pull the canonical thread so the real message replaces the temp one.
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

  const handleTagChange = useCallback(
    async (raw: string) => {
      const tag = (raw === "" ? null : (raw as SupportP2PTag));
      const prev = effectiveTag;
      setTagOverride(tag); // optimistic
      try {
        await withAuth((token) =>
          patchOpsP2pTag({ bridgeUrl, sessionToken: token, orderId, tag }),
        );
        // Write landed: pull the canonical thread and hand the dropdown
        // back to server truth. Clearing unconditionally (not on value
        // match) means a concurrent operator's different tag is shown,
        // not masked indefinitely by our optimistic override.
        await loadThread();
        if (mountedRef.current) setTagOverride(undefined);
      } catch {
        if (mountedRef.current) setTagOverride(prev);
      }
    },
    [effectiveTag, withAuth, bridgeUrl, orderId, loadThread],
  );

  const handleResolve = useCallback(async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await withAuth((token) =>
        resolveOpsChat({ bridgeUrl, sessionToken: token, orderId }),
      );
      if (mountedRef.current) {
        setConfirmResolve(false);
        // Optimistically reflect resolved; the next poll confirms.
        setThread((t) => (t ? { ...t, status: "resolved" } : t));
      }
      onChatResolved?.();
    } catch {
      // keep the confirm modal open on failure
    } finally {
      if (mountedRef.current) setResolving(false);
    }
  }, [resolving, withAuth, bridgeUrl, orderId, onChatResolved]);

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
      data-ops-support-panel
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
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          borderBottom: `1px solid ${color.border}`,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <StatusPill status={status} />
          <span style={{ ...S.faint, fontFamily: "ui-monospace, monospace" }}>
            Order {shortenId(orderId)}
          </span>
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: font.sm,
            color: color.textMuted,
          }}
        >
          <span>P2P tag</span>
          <select
            aria-label="P2P tag"
            value={effectiveTag ?? ""}
            disabled={isResolved}
            onChange={(e) => void handleTagChange(e.target.value)}
            style={{
              height: 30,
              padding: "0 8px",
              borderRadius: radius.md,
              border: `1px solid ${color.border}`,
              background: color.surface,
              color: color.text,
              fontSize: font.md,
              cursor: isResolved ? "not-allowed" : "pointer",
            }}
          >
            <option value="">Clear</option>
            {TAG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Message list */}
      <div
        data-ops-message-list
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
          <div style={{ ...S.muted, margin: "auto" }}>No messages yet.</div>
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
        {isResolved && (
          <div style={{ ...S.faint, color: color.textMuted }}>
            This conversation is resolved. Set the status back to open to reply.
          </div>
        )}
        <textarea
          aria-label="Reply"
          placeholder="Write a reply…"
          value={draft}
          disabled={isResolved}
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
            background: isResolved ? color.surfaceAlt : color.surface,
            color: color.text,
            fontSize: font.base,
            fontFamily: "inherit",
            lineHeight: 1.4,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button
            type="button"
            onClick={() => setConfirmResolve(true)}
            disabled={isResolved}
            style={{
              ...S.secondaryBtn,
              height: 38,
              padding: "0 14px",
              fontSize: font.md,
              opacity: isResolved ? 0.6 : 1,
              cursor: isResolved ? "not-allowed" : "pointer",
            }}
          >
            Resolve chat
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isResolved || sending || draft.trim().length === 0}
            style={{
              ...S.primaryBtn,
              width: "auto",
              height: 38,
              padding: "0 18px",
              fontSize: font.md,
              opacity: isResolved || draft.trim().length === 0 ? 0.6 : 1,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {/* Resolve confirm */}
      <Modal
        open={confirmResolve}
        onClose={() => setConfirmResolve(false)}
        ariaLabelledBy="ops-resolve-title"
      >
        <div style={{ padding: 24, color: color.text }}>
          <h2
            id="ops-resolve-title"
            style={{ ...S.h2, fontSize: font.lg, marginBottom: 8 }}
          >
            Resolve this chat?
          </h2>
          <p style={{ ...S.muted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
            The user’s input is locked and they see a “chat closed” notice.
            Set the status back to open to reply again.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setConfirmResolve(false)}
              style={{ ...S.secondaryBtn, height: 40, padding: "0 16px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleResolve()}
              disabled={resolving}
              style={{ ...S.primaryBtn, width: "auto", height: 40, padding: "0 18px" }}
            >
              {resolving ? "Resolving…" : "Resolve"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatusPill({ status }: { status: SupportChatStatus | null }) {
  if (!status) {
    return (
      <span
        data-ops-status="none"
        style={pillStyle(color.surfaceAlt, color.textMuted)}
      >
        No conversation
      </span>
    );
  }
  const s = STATUS_STYLE[status];
  return (
    <span data-ops-status={status} style={pillStyle(s.bg, s.fg)}>
      {status}
    </span>
  );
}

function pillStyle(bg: string, fg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 10px",
    borderRadius: radius.pill,
    background: bg,
    color: fg,
    fontSize: font.sm,
    fontWeight: weight.semibold,
    textTransform: "capitalize",
    whiteSpace: "nowrap",
  };
}

function MessageBubble({ message }: { message: OpsThreadMessage }) {
  const isOps = message.direction === "ops";
  return (
    <div
      data-ops-message-direction={message.direction}
      style={{
        alignSelf: isOps ? "flex-end" : "flex-start",
        maxWidth: "78%",
        padding: "8px 12px",
        borderRadius: radius.lg,
        background: isOps ? color.accentSoft : color.surface,
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
        {message.senderName ?? (isOps ? "Support" : "Customer")}
      </div>
      {message.content}
    </div>
  );
}

function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
