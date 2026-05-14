import { useCallback, useEffect, useState } from "react";
import type { SupportProps } from "../types";
import { themeToCssVars } from "../ui/support-theme";
import { bootChatwoot, openChatwoot } from "../chatwoot/sdk";
import { signInWithBridge } from "../api/bridge";
import {
  readCachedSession,
  writeCachedSession,
  type SignInResponse,
} from "../state/sessionCache";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "loading-chat" }
  | { kind: "ready"; session: SignInResponse }
  | { kind: "error"; reason: string };

export function Support(props: SupportProps) {
  const {
    orderId,
    originApp,
    signer,
    bridgeUrl,
    theme,
    onOpen,
    onClose,
    disputeStatus = "none",
  } = props;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const launcherLabel =
    disputeStatus === "open"
      ? "View support"
      : disputeStatus === "resolved"
        ? "View resolution"
        : "Support";

  const handleOpen = useCallback(() => {
    setOpen(true);
    onOpen?.();
  }, [onOpen]);

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      setPhase({ kind: "idle" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Always show the signing loader immediately so the click is
        // never a flash of nothing. If we skip straight to a cached
        // chatwoot:null and silently close, the user perceives the
        // button as broken.
        setPhase({ kind: "signing" });
        let session = readCachedSession(bridgeUrl, signer.address, orderId);
        if (!session) {
          session = await signInWithBridge({ signer, bridgeUrl, orderId });
          // Only cache when chatwoot resolved. A null chatwoot session
          // means the order isn't bound to a circle yet (pre-acceptance)
          // — that's transient state we don't want to cache for 7 days.
          if (session.chatwoot) {
            writeCachedSession(bridgeUrl, signer.address, session, orderId);
          }
        }
        if (cancelled) return;
        if (!session.chatwoot) {
          // Order not yet bound to a circle (pre-acceptance on chain) or
          // bridge can't resolve an inbox. Nothing to show — silently
          // close the modal so the click is a no-op rather than a wall
          // of explainer text. The Support button stays clickable; the
          // user can retry once the order is accepted.
          if (typeof console !== "undefined") {
            console.info(
              "[support] no chatwoot session for this order; closing modal",
            );
          }
          setOpen(false);
          onClose?.();
          return;
        }
        setPhase({ kind: "loading-chat" });
        await bootChatwoot(session.chatwoot);
        if (cancelled) return;
        openChatwoot();
        // Chatwoot's own widget is now the user-facing surface. Auto-close
        // our modal so it does not sit on top of the chat. The modal stays
        // visible only for signing / loading-chat / error phases.
        setOpen(false);
        onClose?.();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setPhase({ kind: "error", reason: message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, signer, bridgeUrl, orderId, onClose]);

  const cssVars = themeToCssVars(theme);

  return (
    <div style={cssVars} data-support-root>
      <button
        type="button"
        onClick={handleOpen}
        data-support-launcher
        aria-label="Open support"
        style={{
          background: "var(--support-color-primary)",
          color: "var(--support-color-bg)",
          border: "none",
          borderRadius: "var(--support-radius)",
          padding: "8px 14px",
          fontFamily: "var(--support-font)",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        {launcherLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Support ticket"
          data-support-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            fontFamily: "var(--support-font)",
          }}
          onClick={handleClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--support-color-bg)",
              color: "var(--support-color-text)",
              borderRadius: "var(--support-radius)",
              padding: 24,
              width: "min(480px, 92vw)",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>
                Support
                {orderId ? (
                  <>
                    {" "}
                    <span
                      style={{
                        color: "var(--support-color-muted)",
                        fontWeight: 400,
                        marginLeft: 8,
                        fontSize: 14,
                      }}
                    >
                      Order {shortenId(orderId)}
                    </span>
                  </>
                ) : null}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close support"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "var(--support-color-muted)",
                }}
              >
                ×
              </button>
            </div>

            <p
              style={{
                color: "var(--support-color-muted)",
                fontSize: 13,
                lineHeight: 1.5,
                marginTop: 0,
              }}
            >
              Opened from <code>{originApp}</code>. Counterparties are labelled
              as Order Fulfillment Partner and Fulfillment Partner Manager. No
              names, wallet addresses, or protocol role names are shown.
            </p>

            <PhaseView phase={phase} />
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseView({ phase }: { phase: Phase }) {
  const box: React.CSSProperties = {
    marginTop: 16,
    padding: 16,
    borderRadius: "var(--support-radius)",
    fontSize: 13,
  };

  if (phase.kind === "signing") {
    return (
      <Loader
        title="Signing in"
        body="Approve the message request to open support for this order."
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

  if (phase.kind === "ready") {
    return (
      <div
        style={{
          ...box,
          background: "rgba(0,0,0,0.05)",
          color: "var(--support-color-text)",
        }}
      >
        Support chat opened. Close this dialog to keep chatting with the
        Payment Support Team.
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div
        style={{
          ...box,
          border: "1px solid var(--support-color-muted)",
          color: "var(--support-color-text)",
        }}
      >
        Could not open support: {phase.reason}
      </div>
    );
  }

  return null;
}

function Loader({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 24,
        borderRadius: "var(--support-radius)",
        border: "1px solid var(--support-color-muted)",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <Spinner />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--support-color-text)",
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--support-color-muted)",
            lineHeight: 1.4,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  const id = "support-spinner-keyframes";
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent =
      "@keyframes support-spin { to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "2px solid var(--support-color-muted)",
        borderTopColor: "transparent",
        animation: "support-spin 0.8s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}
