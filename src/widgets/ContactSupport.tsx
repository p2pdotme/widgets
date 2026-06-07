// Per-row "Contact Support" affordance for the smart layout. One
// button per row; presentation varies with chain state:
//
//   - inside the dispute window, no dispute filed:
//       outline chip with a *draining* doughnut + remaining countdown.
//       Click → ReportProblemStep modal (confirmation + 4-digit form +
//       on-chain raiseDispute).
//
//   - dispute raised:
//       button with red dot. Click → chat (existing Chatwoot boot).
//
//   - dispute resolved:
//       button with green dot. Click → chat (read-only thread).
//
//   - otherwise (placed / accepted / pre-window / post-window / etc.):
//       not rendered. Chat is gated on the dispute being on chain
//       (per the protocol design); pre-window users wait, post-window
//       users have missed the window.
//
// Optimistic flip on broadcast: once `signer.sendTransaction` returns
// a hash for the dispute call, the row's local state flips to
// `dispute-raised` immediately and the click target switches from
// "open report flow" to "open chat".

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { color, font, weight, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import { signInWithBridge } from "../api/bridge";
import {
  bootChatwoot,
  openChatwoot,
} from "../chatwoot/sdk";
import {
  readCachedSession,
  writeCachedSession,
  clearCachedSession,
  type SignInResponse,
} from "../state/sessionCache";
import { Spinner, injectKeyframes } from "../ui/components";
import {
  ReportProblemStep,
  type RaiseDisputeSigner,
} from "./ReportProblemStep";
import type { OrderActionState } from "../core/order-action";
import { formatRemaining } from "../core/order-action";
import type { P2PTheme, SupportSigner } from "../types";
import type { Address } from "viem";

export interface ContactSupportProps {
  orderId: string;
  /** Pre-computed action state from computeOrderAction. Drives chip
   *  presence and the click-target choice. */
  state: OrderActionState;
  /** Window bounds in ms-since-placement, used to render the doughnut
   *  fill fraction. When `state.action.kind !== "report-problem"` the
   *  doughnut is not rendered and these are ignored. */
  windowOpenMs?: number;
  windowCloseMs?: number;
  elapsedMs?: number;

  signer: SupportSigner;
  bridgeUrl: string;
  originApp: string;

  txSigner?: RaiseDisputeSigner;
  diamondAddress?: Address;
  /** Read RPC for the report-problem pre-flight simulation. */
  rpcUrl?: string;
  /** Chain id for the report-problem pre-flight simulation. */
  chainId?: number;

  onReportSubmitted?: (orderId: string, txHash: `0x${string}`) => void;
  /** Toggle for the Chatwoot chat path. When `false` (the v1.1.1-bridge
   *  default), every click that would have opened chat instead opens a
   *  static "support request registered, check back here later" modal.
   *  The on-chain raiseDispute flow (in-window with `txSigner`) is
   *  unaffected — that path is the actual recovery mechanism. Default
   *  `false`. Embedders flip to `true` only when their Chatwoot inbox is
   *  reachable through the bridge. */
  chatEnabled?: boolean;
  theme?: P2PTheme;
}

type Modal_State =
  | { kind: "closed" }
  | { kind: "report" }
  | { kind: "registered" }
  | { kind: "chat-signing" }
  | { kind: "chat-loading" }
  | { kind: "chat-error"; reason: string };

export function ContactSupport(props: ContactSupportProps) {
  const {
    orderId,
    state,
    windowOpenMs,
    windowCloseMs,
    elapsedMs,
    signer,
    bridgeUrl,
    originApp,
    txSigner,
    diamondAddress,
    rpcUrl,
    chainId,
    onReportSubmitted,
    chatEnabled = false,
    theme,
  } = props;

  // Local optimistic flip: when the dispute tx broadcasts we treat the
  // row as `dispute-raised` immediately so the next click opens chat
  // instead of re-offering the report flow.
  const [optimisticDispute, setOptimisticDispute] = useState(false);
  const [modalState, setModalState] = useState<Modal_State>({
    kind: "closed",
  });
  const [chatAttempt, setChatAttempt] = useState(0);

  useEffect(injectKeyframes, []);

  const effectiveDispute: "none" | "open" | "resolved" =
    optimisticDispute ? "open" : state.disputeState;
  const inWindow =
    state.action.kind === "report-problem" && !optimisticDispute;

  // Chip presence: in-window OR a dispute already exists (raised /
  // resolved). All other states render nothing.
  const shouldRender =
    inWindow ||
    effectiveDispute === "open" ||
    effectiveDispute === "resolved";

  const handleClick = useCallback(() => {
    // In-window with a tx signer → open the on-chain report flow. The
    // raiseDispute call is the actual recovery path; this stays live
    // regardless of `chatEnabled`.
    if (inWindow && txSigner) {
      setModalState({ kind: "report" });
      return;
    }
    // Outside the on-chain window (or with no txSigner) the row would
    // normally open chat. When `chatEnabled` is off (v1.1.1-bridge
    // default) we short-circuit to a static "support request registered"
    // modal — the bridge / Chatwoot stack is the unstable piece we're
    // temporarily routing around. When `chatEnabled` is on, the original
    // chat flow runs.
    if (!chatEnabled) {
      setModalState({ kind: "registered" });
      return;
    }
    setModalState({ kind: "chat-signing" });
    setChatAttempt((a) => a + 1);
  }, [inWindow, txSigner, chatEnabled]);

  const handleReportSubmitted = useCallback(
    (txHash: `0x${string}`) => {
      setOptimisticDispute(true);
      onReportSubmitted?.(orderId, txHash);
      // Optimistic-flip rollback: wait for the receipt off the public
      // RPC. If it reverts, clear the local flag so the chip falls
      // back to the real chain state (which still says no dispute is
      // raised). The user sees the report-flow CTA again and can retry.
      // We deliberately don't surface a toast here — the next chain
      // poll will reflect truth either way.
      (async () => {
        try {
          const chain = chainId === 8453 ? base : baseSepolia;
          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
          });
          const receipt = await (publicClient as any).waitForTransactionReceipt({
            hash: txHash,
            timeout: 60_000,
          });
          if (receipt?.status !== "success") {
            setOptimisticDispute(false);
          }
        } catch {
          // RPC timeout / hash not found — clear so the optimistic flip
          // doesn't strand the row on an unresolvable state.
          setOptimisticDispute(false);
        }
      })();
    },
    [onReportSubmitted, orderId, rpcUrl, chainId],
  );

  const closeModal = useCallback(() => {
    setModalState({ kind: "closed" });
  }, []);

  // Chat-open effect: signs in against the bridge, boots Chatwoot's
  // iframe, then auto-dismisses our modal (Chatwoot is now the
  // foreground surface).
  //
  // Keyed SOLELY on `chatAttempt` (incremented by handleClick/retryChat).
  // This effect reacts to a user-intent signal, not to prop changes, so:
  //  - it must NOT depend on `modalState.kind` (the effect SETS it to
  //    "chat-loading" mid-flight; depending on it would cancel the in-flight
  //    async before openChatwoot() and strand the loader forever); and
  //  - it must NOT depend on `signer`/`signer.address`/`bridgeUrl`/`orderId`:
  //    an in-place wallet switch or a fresh inline signer object would
  //    otherwise re-fire the whole sign-in + boot and pop the chat open with
  //    no click. Those are read fresh from the closure each time chatAttempt
  //    advances (on every click/retry), which is the current value.
  useEffect(() => {
    if (chatAttempt === 0) return;
    let cancelled = false;
    (async () => {
      try {
        let session: SignInResponse | null = readCachedSession(
          bridgeUrl,
          signer.address,
          orderId,
        );
        if (!session) {
          session = await signInWithBridge({
            signer,
            bridgeUrl,
            orderId,
          });
          if (session.chatwoot) {
            writeCachedSession(bridgeUrl, signer.address, session, orderId);
          }
        }
        if (cancelled) return;
        if (!session.chatwoot) {
          // Bridge says no chatwoot session yet (typically post-dispute
          // before the listener has seeded the conversation). User can
          // retry.
          setModalState({
            kind: "chat-error",
            reason: "Support is not ready yet. Try again in a moment.",
          });
          return;
        }
        setModalState({ kind: "chat-loading" });
        await bootChatwoot(session.chatwoot);
        if (cancelled) return;
        openChatwoot();
        setModalState({ kind: "closed" });
      } catch (err) {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message : String(err);
        setModalState({ kind: "chat-error", reason });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // keyed only on chatAttempt (the click/retry signal); see note above.
  }, [chatAttempt]);

  const retryChat = useCallback(() => {
    if (orderId) clearCachedSession(bridgeUrl, signer.address, orderId);
    setChatAttempt((a) => a + 1);
    setModalState({ kind: "chat-signing" });
  }, [bridgeUrl, signer.address, orderId]);

  const themeStyle = useMemo(() => themeToCssVars(theme), [theme]);

  if (!shouldRender) return null;

  return (
    <div style={themeStyle} data-contact-support-root>
      {inWindow && state.action.kind === "report-problem" ? (
        <ReportChip
          remainingMs={state.action.remainingMs}
          filled={computeRingFilled({
            elapsedMs,
            windowOpenMs,
            windowCloseMs,
          })}
          onClick={handleClick}
        />
      ) : (
        <PlainButton
          variant={effectiveDispute}
          onClick={handleClick}
        />
      )}
      <Modal
        open={modalState.kind !== "closed"}
        onClose={closeModal}
        themeStyle={themeStyle}
        ariaLabelledBy={
          modalState.kind === "report"
            ? "report-problem-title"
            : modalState.kind === "registered"
              ? "support-registered-title"
              : modalState.kind === "chat-error"
                ? "contact-support-chat-error-title"
                : modalState.kind === "chat-signing" ||
                    modalState.kind === "chat-loading"
                  ? "contact-support-chat-loading-title"
                  : undefined
        }
        ariaLabel="Contact Support"
      >
        {modalState.kind === "report" && txSigner ? (
          <ReportProblemStep
            orderId={orderId}
            signer={txSigner}
            diamondAddress={diamondAddress}
            rpcUrl={rpcUrl}
            chainId={chainId}
            onSubmitted={handleReportSubmitted}
            onClose={closeModal}
            theme={theme}
          />
        ) : modalState.kind === "registered" ? (
          <RegisteredView onClose={closeModal} />
        ) : modalState.kind === "chat-signing" ||
          modalState.kind === "chat-loading" ? (
          <ChatLoadingView phase={modalState.kind} />
        ) : modalState.kind === "chat-error" ? (
          <ChatErrorView
            reason={modalState.reason}
            onRetry={retryChat}
            onClose={closeModal}
          />
        ) : null}
      </Modal>
    </div>
  );
}

// ─── Visual atoms ──────────────────────────────────────────────────────

interface ReportChipProps {
  remainingMs: number;
  filled: number;
  onClick: () => void;
}

function ReportChip({
  remainingMs,
  filled,
  onClick,
}: ReportChipProps) {
  return (
    <button
      type="button"
      data-contact-support-chip
      aria-label="Contact Support"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        height: 28,
        borderRadius: 999,
        border: `1px solid ${color.border}`,
        background: "transparent",
        color: color.text,
        fontSize: font.sm,
        fontWeight: weight.regular,
        fontFamily: "var(--p2p-font, inherit)",
        cursor: "pointer",
      }}
    >
      <Doughnut filled={filled} />
      <span>Contact Support · {formatRemaining(remainingMs)}</span>
    </button>
  );
}

function PlainButton({
  variant,
  onClick,
}: {
  variant: "none" | "open" | "resolved";
  onClick: () => void;
}) {
  const dotColor =
    variant === "open"
      ? color.danger
      : variant === "resolved"
        ? color.success
        : null;
  return (
    <button
      type="button"
      data-contact-support-button
      aria-label="Contact Support"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        height: 36,
        borderRadius: "var(--p2p-radius-button, 8px)",
        border: `1px solid ${color.border}`,
        background: "transparent",
        color: color.text,
        fontSize: font.md,
        fontWeight: weight.medium,
        fontFamily: "var(--p2p-font, inherit)",
        cursor: "pointer",
      }}
    >
      {dotColor ? (
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
      ) : null}
      Contact Support
    </button>
  );
}

/** Drains from full ring at window-open (filled=1.0) to empty at
 *  window-close (filled=0.0). Stroke colour ramps as the ring drains. */
function Doughnut({ filled }: { filled: number }) {
  const clamped = Math.max(0, Math.min(1, filled));
  const stroke =
    clamped > 0.5
      ? color.textMuted
      : clamped > 0.1
        ? color.warning
        : color.danger;
  // SVG: 14x14 viewBox, circle r=5, stroke-width=2 → outer 12, inner 8.
  // Circumference = 2π * 5 ≈ 31.42. Use strokeDasharray to render the
  // arc length proportional to `filled`.
  const r = 5;
  const c = 2 * Math.PI * r;
  const visible = c * clamped;
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <circle
        cx={7}
        cy={7}
        r={r}
        fill="none"
        stroke={color.border}
        strokeWidth={2}
      />
      <circle
        cx={7}
        cy={7}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={`${visible} ${c}`}
        // start the dash at 12 o'clock and run clockwise
        transform="rotate(-90 7 7)"
        strokeLinecap="butt"
      />
    </svg>
  );
}

function ChatLoadingView({
  phase,
}: {
  phase: "chat-signing" | "chat-loading";
}) {
  return (
    <div
      aria-busy="true"
      style={{
        padding: 24,
        background: color.surface,
        color: color.text,
        fontFamily: "var(--p2p-font, inherit)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Spinner />
        <div>
          <h3
            id="contact-support-chat-loading-title"
            style={{ margin: 0, fontSize: 16, color: color.text }}
          >
            {phase === "chat-signing" ? "Signing in" : "Loading chat"}
          </h3>
          <p
            style={{
              margin: "4px 0 0 0",
              color: color.textMuted,
              fontSize: 12,
            }}
          >
            {phase === "chat-signing"
              ? "Approve the message request to open support."
              : "Connecting to the support thread..."}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatErrorView({
  reason,
  onRetry,
  onClose,
}: {
  reason: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        padding: 24,
        background: color.surface,
        color: color.text,
        fontFamily: "var(--p2p-font, inherit)",
      }}
    >
      <h3
        id="contact-support-chat-error-title"
        style={{ margin: 0, fontSize: 16, color: color.text }}
      >
        Could not open support
      </h3>
      <p
        style={{
          color: color.textMuted,
          fontSize: 13,
          lineHeight: 1.5,
          marginTop: 8,
        }}
      >
        {reason}
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            background: "transparent",
            color: color.text,
            border: `1px solid ${color.border}`,
            borderRadius: "var(--p2p-radius-button, 8px)",
            cursor: "pointer",
          }}
        >
          Close
        </button>
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            background: color.accent,
            color: color.accentText,
            border: "none",
            borderRadius: "var(--p2p-radius-button, 8px)",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

/** Static "support request registered" confirmation rendered when the
 *  chat path is disabled (`chatEnabled=false`). Used both for orders that
 *  already have an open/resolved dispute on chain AND for in-window rows
 *  without a `txSigner`. Pure visual — no async work, no chain calls. */
function RegisteredView({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        padding: 24,
        background: color.surface,
        color: color.text,
        fontFamily: "var(--p2p-font, inherit)",
      }}
    >
      <h3
        id="support-registered-title"
        style={{ margin: 0, fontSize: 18, color: color.text }}
      >
        Support request registered
      </h3>
      <p
        style={{
          color: color.textMuted,
          fontSize: 13,
          lineHeight: 1.5,
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        Your support request is on its way to the support team. Any stuck
        funds will be refunded once it's resolved. Check back here in a
        little while to see the updated status.
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            background: color.accent,
            color: color.accentText,
            border: "none",
            borderRadius: "var(--p2p-radius-button, 8px)",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** Doughnut fill maps to fraction of window remaining (drains to zero). */
function computeRingFilled(input: {
  elapsedMs?: number;
  windowOpenMs?: number;
  windowCloseMs?: number;
}): number {
  const { elapsedMs, windowOpenMs, windowCloseMs } = input;
  if (
    elapsedMs === undefined ||
    windowOpenMs === undefined ||
    windowCloseMs === undefined
  ) {
    return 1;
  }
  if (windowCloseMs <= windowOpenMs) return 1;
  const remainingMs = Math.max(0, windowCloseMs - elapsedMs);
  return Math.max(
    0,
    Math.min(1, remainingMs / (windowCloseMs - windowOpenMs)),
  );
}
