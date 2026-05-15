// Per-row composition of the smart layout for
// <PaymentHistoryWithSupport actionMode="smart">. Three independent
// layers:
//
//   A — Status text   (always rendered)
//   B — Action button (resume / raise-dispute, suppressed when none)
//   C — Support       (delegates to <Support> with the right
//                      disputeStatus + chatState combination)
//
// `state` and `order` come from the parent's <useOrderStates> call so
// every row shares one batched multicall per refresh tick. This
// component does no chain reads of its own.

import React, { useCallback, useEffect, useState } from "react";
import type { Order } from "@p2pdotme/sdk/orders";
import type { Address } from "viem";
import { color, font, weight, S, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import type { P2PTheme, SupportSigner } from "../types";
import { computeOrderAction, formatRemaining } from "../core/order-action";
import { Support } from "./Support";
import {
  RaiseDisputeStep,
  type RaiseDisputeSigner,
} from "./RaiseDisputeStep";

/** 1s tick to keep countdowns live. One per <OrderAction> instance —
 *  cheap (just setState), reads `Date.now()` at each tick. Stops when
 *  the row is unmounted. */
function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface OrderActionProps {
  orderId: string;
  /** Raw SDK Order. State is recomputed every tick from this + Date.now(). */
  order: Order;
  /** True when the wallet already has an unresolved Chatwoot
   *  conversation for this order (parent reads `/tickets/me`). Drives
   *  the chat-active vs chat-new label split. */
  hasActiveSupportConversation: boolean;

  // ─── Support (chat) plumbing ────────────────────────────────────
  signer: SupportSigner;
  bridgeUrl: string;
  originApp: string;

  // ─── Action plumbing ────────────────────────────────────────────
  /** Required to send `raiseDispute` — the support signer alone can't
   *  sign transactions. When absent, the raise-dispute action button is
   *  rendered as disabled with a tooltip. */
  txSigner?: RaiseDisputeSigner;
  diamondAddress?: Address;
  /** When absent, the Resume action button is suppressed entirely per
   *  the V1 decision (status line still informs the user). */
  onResumeOrder?: (orderId: string) => void;
  /** Fires the moment the dispute tx broadcasts. Embedders typically
   *  use this to bump a refetch on their own ticket store. */
  onDisputeRaised?: (orderId: string, txHash: `0x${string}`) => void;

  theme?: P2PTheme;
}

export function OrderAction(props: OrderActionProps) {
  const {
    orderId,
    order,
    hasActiveSupportConversation,
    signer,
    bridgeUrl,
    originApp,
    txSigner,
    diamondAddress,
    onResumeOrder,
    onDisputeRaised,
    theme,
  } = props;

  const now = useNowTick();
  const state = computeOrderAction(order, now);

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [optimisticDispute, setOptimisticDispute] = useState(false);

  // Override layers when we've optimistically flipped to dispute-open
  // ahead of the chain confirming. Next chain poll either confirms (real
  // state takes over, optimistic flag becomes a no-op) or reverts (we
  // stay locally flipped until the user navigates away; one stale render
  // cycle is acceptable for the rarity of an actual revert).
  const effectiveDisputeState =
    optimisticDispute ? "open" : state.disputeState;
  const effectiveStatusText =
    optimisticDispute && state.disputeState !== "open"
      ? "Dispute under review"
      : state.statusText;
  const effectiveAction = optimisticDispute ? { kind: "none" as const } : state.action;

  const supportDisputeStatus: "none" | "open" | "resolved" =
    effectiveDisputeState;
  const chatState: "active" | "new" =
    hasActiveSupportConversation || effectiveDisputeState !== "none"
      ? "active"
      : "new";

  const handleResume = useCallback(() => {
    onResumeOrder?.(orderId);
  }, [onResumeOrder, orderId]);

  const handleRaiseOpen = useCallback(() => {
    setRaiseOpen(true);
  }, []);

  const handleRaiseClose = useCallback(() => {
    setRaiseOpen(false);
  }, []);

  const handleSubmitted = useCallback(
    (txHash: `0x${string}`) => {
      setOptimisticDispute(true);
      onDisputeRaised?.(orderId, txHash);
    },
    [onDisputeRaised, orderId],
  );

  const themeStyle = themeToCssVars(theme);
  const showResume =
    effectiveAction.kind === "resume" && typeof onResumeOrder === "function";
  const showRaise = effectiveAction.kind === "raise-dispute" && !!txSigner;

  return (
    <div
      style={{ ...themeStyle, display: "flex", flexDirection: "column", gap: 6 }}
      data-order-action-root
      data-order-id={orderId}
    >
      <span
        data-order-action-status
        style={{
          fontSize: font.sm,
          color: color.textMuted,
          fontWeight: weight.regular,
        }}
      >
        {effectiveStatusText}
      </span>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        {showResume ? (
          <ResumeButton onClick={handleResume} />
        ) : null}
        {showRaise && effectiveAction.kind === "raise-dispute" ? (
          <RaiseButton
            remainingMs={effectiveAction.remainingMs}
            onClick={handleRaiseOpen}
          />
        ) : null}
        <Support
          orderId={orderId}
          originApp={originApp}
          signer={signer}
          bridgeUrl={bridgeUrl}
          disputeStatus={supportDisputeStatus}
          chatState={chatState}
          theme={theme}
        />
      </div>
      <Modal open={raiseOpen} onClose={handleRaiseClose}>
        {txSigner ? (
          <RaiseDisputeStep
            orderId={orderId}
            signer={txSigner}
            diamondAddress={diamondAddress}
            onSubmitted={handleSubmitted}
            onClose={handleRaiseClose}
            theme={theme}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ResumeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-order-action-resume
      style={{
        ...S.primaryBtn,
        height: 36,
        padding: "0 12px",
        fontSize: font.md,
        fontWeight: weight.medium,
      }}
    >
      Resume order
    </button>
  );
}

function RaiseButton({
  remainingMs,
  onClick,
}: {
  remainingMs: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-order-action-raise
      style={{
        height: 36,
        padding: "0 12px",
        fontSize: font.md,
        fontWeight: weight.medium,
        borderRadius: "var(--p2p-radius-button, 8px)",
        border: "none",
        background: color.danger,
        color: color.accentText,
        cursor: "pointer",
      }}
    >
      Raise dispute · {formatRemaining(remainingMs)} left
    </button>
  );
}
