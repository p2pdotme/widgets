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
        const cached = readCachedSession(bridgeUrl, signer.address, orderId);
        let session = cached;
        if (!session) {
          setPhase({ kind: "signing" });
          session = await signInWithBridge({ signer, bridgeUrl, orderId });
          writeCachedSession(bridgeUrl, signer.address, session, orderId);
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
        await bootChatwoot(session.chatwoot);
        if (cancelled) return;
        openChatwoot();
        // Chatwoot's own widget is now the user-facing surface. Auto-close
        // our modal so it does not sit on top of the chat. The modal stays
        // visible only for signing / error phases.
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
      <div
        style={{
          ...box,
          border: "1px dashed var(--support-color-muted)",
          color: "var(--support-color-muted)",
        }}
      >
        Signing in with your wallet. Approve the message request to continue.
      </div>
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

function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}
