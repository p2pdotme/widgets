import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupportProps, SupportStatus } from "../types";
import { color, radius, font, weight, S, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import { Spinner, injectKeyframes } from "../ui/components";
import { bootChatwoot, openChatwoot } from "../chatwoot/sdk";
import { signInWithBridge } from "../api/bridge";
import {
  readCachedSession,
  writeCachedSession,
  clearCachedSession,
  type SignInResponse,
} from "../state/sessionCache";
import { OpsSupportPanel } from "./OpsSupportPanel";

type ErrorKind = "userRejected" | "network" | "auth" | "chatwoot" | "unknown";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "loading-chat" }
  /** Bridge returned `chatwoot: null` — the order isn't bound to a Chatwoot
   *  inbox yet. Most often this is pre-acceptance (no merchant has accepted
   *  the order, so it has no circleId on chain), occasionally a circle
   *  whose inbox has not been provisioned in the bridge config. Both
   *  resolve over time once the order moves to ACCEPTED in a configured
   *  circle. We render an actionable "not available yet" state with Retry
   *  instead of silently closing. */
  | { kind: "unavailable" }
  /** v1.1.1-bridge fallback: chat is disabled, we skipped the bridge
   *  entirely and surfaced a static "support request registered"
   *  confirmation. No retry, no async work. */
  | { kind: "registered" }
  | { kind: "error"; errorKind: ErrorKind; reason: string };

/** Map any thrown error into a typed bucket the UI knows how to copy for.
 *  EIP-1193 4001 covers Privy / Thirdweb / wagmi / window.ethereum user
 *  rejections; the regexes catch wallet providers that throw with messages
 *  but no numeric code. */
function classifyError(err: unknown): { kind: ErrorKind; reason: string } {
  const raw = err instanceof Error ? err : new Error(String(err));
  const msg = raw.message || String(err);
  const code = (err as { code?: number } | null | undefined)?.code;
  if (
    code === 4001 ||
    /user (rejected|denied|cancell?ed)/i.test(msg) ||
    /rejected the request/i.test(msg)
  ) {
    return { kind: "userRejected", reason: msg };
  }
  // signInWithBridge throws `sign-in failed (NNN): body`. Treat 4xx as
  // auth (signature didn't verify, replay, etc.) and 5xx as network.
  const sxx = msg.match(/sign-in failed \((\d{3})\)/i);
  if (sxx) {
    const status = Number(sxx[1]);
    return {
      kind: status >= 500 ? "network" : "auth",
      reason: msg,
    };
  }
  if (
    /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)
  ) {
    return { kind: "network", reason: msg };
  }
  if (/chatwoot/i.test(msg)) {
    return { kind: "chatwoot", reason: msg };
  }
  return { kind: "unknown", reason: msg };
}

export function Support(props: SupportProps) {
  // Ops surface (D-027-v2). Always-live operator panel; `chatEnabled` is a
  // customer-mode-only gate and does not apply here. The customer launcher
  // path below is untouched when `mode` is absent or "customer".
  if (props.mode === "ops") {
    return <OpsSupport {...props} />;
  }
  return <CustomerSupport {...props} />;
}

/** Operator surface wrapper. Honors the `layout` prop:
 *  - "modal"      → wrapped in the dialog `<Modal>` (default for ops).
 *  - "inline"     → rendered in flow.
 *  - "side-rail"  → fixed-width right rail that collapses to inline below lg.
 */
function OpsSupport(props: SupportProps) {
  const {
    orderId,
    signer,
    bridgeUrl,
    theme,
    onClose,
    onChatResolved,
    layout = "modal",
  } = props;
  const themeStyle = useMemo(() => themeToCssVars(theme), [theme]);
  const [open, setOpen] = useState(true);

  useEffect(injectKeyframes, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  if (!orderId) {
    // Ops surface is per-order; without an orderId there is nothing to load.
    return null;
  }

  const panel = (
    <OpsSupportPanel
      orderId={orderId}
      signer={signer}
      bridgeUrl={bridgeUrl}
      onChatResolved={onChatResolved}
    />
  );

  if (layout === "modal") {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        ariaLabel="Order support"
        themeStyle={themeStyle}
      >
        <div style={{ height: "70vh", maxHeight: 640, display: "flex" }}>
          {panel}
        </div>
      </Modal>
    );
  }

  if (layout === "side-rail") {
    return (
      <div
        style={themeStyle}
        data-support-root
        className="p2p-support-side-rail"
      >
        <div
          style={{
            height: "100%",
            border: `1px solid ${color.border}`,
            borderRadius: radius.lg,
            overflow: "hidden",
            background: color.surface,
          }}
        >
          {panel}
        </div>
      </div>
    );
  }

  // inline
  return (
    <div style={themeStyle} data-support-root>
      <div
        style={{
          height: "100%",
          minHeight: 360,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          overflow: "hidden",
          background: color.surface,
        }}
      >
        {panel}
      </div>
    </div>
  );
}

function CustomerSupport(props: SupportProps) {
  const {
    orderId,
    originApp,
    signer,
    bridgeUrl,
    theme,
    onOpen,
    onClose,
    disputeStatus = "none",
    chatState = "new",
    chatEnabled = false,
  } = props;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Incrementing this counter retriggers the sign-in / boot effect. Used
  // both for the initial open and for the Retry button on the unavailable
  // and error states.
  const [attempt, setAttempt] = useState(0);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  useEffect(injectKeyframes, []);

  const launcherLabel =
    disputeStatus === "open"
      ? "View report"
      : disputeStatus === "resolved"
        ? "View resolution"
        : chatState === "active"
          ? "Continue support"
          : "Get help";

  const handleOpen = useCallback(() => {
    setOpen(true);
    setAttempt((a) => a + 1);
    onOpen?.();
  }, [onOpen]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setPhase({ kind: "idle" });
    onClose?.();
    // Return focus to the launcher so keyboard users don't lose their place.
    queueMicrotask(() => launcherRef.current?.focus());
  }, [onClose]);

  const handleRetry = useCallback(() => {
    // The per-order cache is only ever written when chatwoot was non-null,
    // so a retry from "unavailable" never has cache to clear. Clearing it
    // anyway is a no-op defensive guard against future changes that might
    // start caching the null-chatwoot response.
    if (orderId) clearCachedSession(bridgeUrl, signer.address, orderId);
    setAttempt((a) => a + 1);
  }, [bridgeUrl, signer.address, orderId]);

  useEffect(() => {
    if (!open || attempt === 0) return;
    // v1.1.1-bridge fallback: skip the bridge sign-in + Chatwoot boot
    // entirely. The launcher acts as a "registered" confirmation only —
    // the actual recovery path is the on-chain raiseDispute call wired
    // by the per-row `ContactSupport` chip, not this standalone widget.
    if (!chatEnabled) {
      setPhase({ kind: "registered" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setPhase({ kind: "signing" });
        let session: SignInResponse | null = readCachedSession(
          bridgeUrl,
          signer.address,
          orderId,
        );
        if (!session) {
          session = await signInWithBridge({ signer, bridgeUrl, orderId });
          if (session.chatwoot) {
            writeCachedSession(bridgeUrl, signer.address, session, orderId);
          }
        }
        if (cancelled) return;
        if (!session.chatwoot) {
          setPhase({ kind: "unavailable" });
          return;
        }
        setPhase({ kind: "loading-chat" });
        await bootChatwoot(session.chatwoot);
        if (cancelled) return;
        openChatwoot();
        // Chatwoot's iframe is now the active UI surface; close our modal
        // so it doesn't sit on top of the chat. The launcher stays
        // clickable so the user can re-open this flow later.
        setOpen(false);
        setPhase({ kind: "idle" });
        onClose?.();
      } catch (err) {
        if (cancelled) return;
        const c = classifyError(err);
        setPhase({ kind: "error", errorKind: c.kind, reason: c.reason });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, attempt, signer, bridgeUrl, orderId, onClose, chatEnabled]);

  const themeStyle = useMemo(() => themeToCssVars(theme), [theme]);

  return (
    <div style={themeStyle} data-support-root>
      <LauncherButton
        ref={launcherRef}
        label={launcherLabel}
        disputeStatus={disputeStatus}
        chatState={chatState}
        onClick={handleOpen}
      />
      <Modal
        open={open}
        onClose={handleClose}
        ariaLabelledBy="p2p-support-title"
        themeStyle={themeStyle}
      >
        <DialogContent
          orderId={orderId}
          originApp={originApp ?? "this app"}
          phase={phase}
          onClose={handleClose}
          onRetry={handleRetry}
        />
      </Modal>
    </div>
  );
}

interface LauncherButtonProps {
  label: string;
  disputeStatus: SupportStatus;
  chatState: "active" | "new";
  onClick: () => void;
}

const LauncherButton = forwardRef<HTMLButtonElement, LauncherButtonProps>(
  function LauncherButton({ label, disputeStatus, chatState, onClick }, ref) {
    // Match PaymentHistory's per-row Resume button so the two sit next to
    // each other without a stylistic clash. The leading dot conveys the
    // chat surface's state: warning (dispute open), success (dispute
    // resolved or an active non-dispute chat).
    const dotColor =
      disputeStatus === "open"
        ? color.danger
        : disputeStatus === "resolved"
          ? color.success
          : chatState === "active"
            ? color.success
            : null;
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        data-support-launcher
        aria-label="Open support"
        style={{
          ...S.secondaryBtn,
          height: 36,
          padding: "0 12px",
          fontSize: font.md,
          fontWeight: weight.medium,
        }}
      >
        {dotColor && (
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dotColor,
            }}
          />
        )}
        {label}
      </button>
    );
  },
);

interface DialogContentProps {
  orderId?: string;
  originApp: string;
  phase: Phase;
  onClose: () => void;
  onRetry: () => void;
}

function DialogContent({
  orderId,
  originApp,
  phase,
  onClose,
  onRetry,
}: DialogContentProps) {
  const busy = phase.kind === "signing" || phase.kind === "loading-chat";
  return (
    <div
      aria-busy={busy || undefined}
      data-support-modal
      style={{
        padding: 24,
        boxSizing: "border-box",
        fontFamily: "var(--p2p-font, inherit)",
        color: color.text,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 12,
        }}
      >
        <h2
          id="p2p-support-title"
          style={{ ...S.h2, fontSize: font.lg, color: color.text }}
        >
          Support
          {orderId ? (
            <>
              {" "}
              <span
                style={{
                  ...S.muted,
                  fontWeight: weight.regular,
                  marginLeft: 8,
                  fontSize: font.base,
                }}
              >
                Order {shortenId(orderId)}
              </span>
            </>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close support"
          style={{
            ...S.ghostBtn,
            width: 32,
            height: 32,
            padding: 0,
            fontSize: 20,
            color: color.textMuted,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      <p style={{ ...S.muted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        Opened from{" "}
        <code style={{ ...S.mono, color: color.text }}>{originApp}</code>. No
        names or wallet addresses are shared with the other side.
      </p>

      <PhaseView phase={phase} onRetry={onRetry} onClose={onClose} />
    </div>
  );
}

function PhaseView({
  phase,
  onRetry,
  onClose,
}: {
  phase: Phase;
  onRetry: () => void;
  onClose: () => void;
}) {
  if (phase.kind === "signing") {
    return (
      <Loader
        title="Signing in"
        body="Approve the message request in your wallet to open support for this order."
      />
    );
  }
  if (phase.kind === "loading-chat") {
    return (
      <Loader
        title="Loading chat"
        body="Connecting to the Payment Support Team..."
      />
    );
  }
  if (phase.kind === "unavailable") {
    return (
      <StatusBlock
        title="Support not available yet"
        body="Your order needs to be accepted before a support thread can open. Try again in a moment, or come back once your order moves to Accepted."
        primaryLabel="Retry"
        onPrimary={onRetry}
        onSecondary={onClose}
      />
    );
  }
  if (phase.kind === "registered") {
    return (
      <StatusBlock
        title="Support request registered"
        body="Your support request is on its way to the support team. Any stuck funds will be refunded once it's resolved. Check back here in a little while to see the updated status."
        primaryLabel="Close"
        onPrimary={onClose}
      />
    );
  }
  if (phase.kind === "error") {
    const copy = errorCopy(phase.errorKind);
    return (
      <StatusBlock
        title={copy.title}
        body={copy.body}
        detail={phase.reason}
        primaryLabel="Retry"
        onPrimary={onRetry}
        onSecondary={onClose}
        variant="danger"
      />
    );
  }
  return null;
}

function errorCopy(kind: ErrorKind): { title: string; body: string } {
  switch (kind) {
    case "userRejected":
      return {
        title: "Authorization cancelled",
        body: "You declined the sign-in prompt. Tap Retry to sign in and open support.",
      };
    case "network":
      return {
        title: "Connection issue",
        body: "We couldn't reach the support service. Check your connection and try again.",
      };
    case "auth":
      return {
        title: "Sign-in failed",
        body: "We couldn't verify your wallet. Try again, or reconnect your wallet if the issue persists.",
      };
    case "chatwoot":
      return {
        title: "Chat couldn't load",
        body: "The support chat widget didn't load. Refresh the page or try again.",
      };
    default:
      return {
        title: "Something went wrong",
        body: "We couldn't open support. Try again in a moment.",
      };
  }
}

function Loader({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 4,
        padding: 20,
        borderRadius: radius.lg,
        border: `1px solid ${color.border}`,
        background: color.surfaceAlt,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <Spinner size={22} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: font.base,
            fontWeight: weight.medium,
            color: color.text,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div style={{ ...S.muted, lineHeight: 1.4 }}>{body}</div>
      </div>
    </div>
  );
}

function StatusBlock({
  title,
  body,
  detail,
  primaryLabel,
  onPrimary,
  onSecondary,
  variant,
}: {
  title: string;
  body: string;
  detail?: string;
  primaryLabel: string;
  onPrimary: () => void;
  /** Optional secondary action. Omit when the primary action *is* the
   *  only thing the user needs (e.g. the v1.1.1-bridge "registered"
   *  confirmation, where both primary and secondary would both be
   *  "Close"). When omitted, only the primary button renders. */
  onSecondary?: () => void;
  variant?: "danger";
}) {
  const titleColor = variant === "danger" ? color.danger : color.text;
  return (
    <div
      style={{
        marginTop: 4,
        padding: 20,
        borderRadius: radius.lg,
        border: `1px solid ${color.border}`,
        background: color.surfaceAlt,
      }}
    >
      <div
        style={{
          fontSize: font.lg,
          fontWeight: weight.semibold,
          color: titleColor,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ ...S.body, color: color.textMuted, lineHeight: 1.5 }}>
        {body}
      </div>
      {detail && (
        <div
          style={{
            ...S.faint,
            marginTop: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            wordBreak: "break-word",
          }}
        >
          {detail}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onPrimary}
          style={{
            ...S.primaryBtn,
            width: "auto",
            flex: "1 1 140px",
            height: 40,
            fontSize: font.base,
          }}
        >
          {primaryLabel}
        </button>
        {onSecondary ? (
          <button
            type="button"
            onClick={onSecondary}
            style={{
              ...S.secondaryBtn,
              width: "auto",
              flex: "1 1 140px",
              height: 40,
              fontSize: font.base,
            }}
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}

function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}
