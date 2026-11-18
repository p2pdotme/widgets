// Confirm → on-chain `appealDispute(orderId)` for a raised dispute on the
// 3-tier ladder. One call serves both cases:
//
//   mode="appeal"   : a tier-1/2 decision went against the user and its
//                     appeal window is open — drops the decision and moves
//                     the dispute to the next tier.
//   mode="escalate" : the current tier missed its decision deadline —
//                     moves the dispute up without a decision.
//
// Only `order.user` may call it (NotDisputeUser). Like ReportProblemStep
// it pre-simulates so a doomed call surfaces a decoded reason instead of
// costing gas.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { DIAMOND_ABI, resolveDiamondAddress } from "../core/contracts";
import {
  DISPUTE_TIER_LABEL,
  formatRemaining,
  type DisputeTier,
} from "../core/order-action";
import { color, themeToCssVars } from "../ui/theme";
import type { SupportTheme } from "../types";
import {
  Button,
  extractRevert,
  paragraphStyle,
  rowStyle,
  titleStyle,
  type RaiseDisputeSigner,
} from "./ReportProblemStep";

export interface AppealDisputeStepProps {
  orderId: string;
  signer: RaiseDisputeSigner;
  mode: "appeal" | "escalate";
  /** Tier the dispute moves to. */
  nextTier: DisputeTier;
  /** Time left in the appeal window (mode="appeal"), shown in the copy. */
  remainingMs?: number;
  diamondAddress?: Address;
  rpcUrl?: string;
  /** Defaults to Base Sepolia. */
  chainId?: number;
  /** Fires the moment the tx is broadcast. */
  onSubmitted?: (txHash: `0x${string}`) => void;
  /** Outcome of the broadcast tx, if the host waits for its receipt
   *  (ContactSupport does). Absent → the sent view says only "sent". */
  txStatus?: "pending" | "confirmed" | "failed" | "unconfirmed";
  /** True from the confirm click until broadcast or failure. A host can
   *  use it to block dismissing the modal mid-send. */
  onBusyChange?: (busy: boolean) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
  theme?: SupportTheme;
}

const APPEAL_REVERT_MESSAGES: Record<string, string> = {
  NotDisputeUser:
    "Only the wallet that placed the order can appeal this dispute.",
  NotDisputeParty:
    "Only the wallet that placed the order can appeal this dispute.",
  DisputeNotRaised: "There is no open dispute on this order.",
  DisputeAlreadySettled: "This dispute has already been settled.",
  DisputeAppealWindowClosed:
    "The appeal window for this decision has closed.",
  DisputeAppealNotDue:
    "The current reviewer still has time to decide. You can escalate once that deadline passes.",
  DisputeAtFinalTier: "This dispute is already at the final review.",
};

type Phase =
  | { kind: "confirm" }
  | { kind: "submitting" }
  | { kind: "submitted" }
  | { kind: "error"; reason: string };

export function AppealDisputeStep(props: AppealDisputeStepProps) {
  const {
    orderId,
    signer,
    mode,
    nextTier,
    remainingMs,
    rpcUrl,
    chainId = 84532,
    onSubmitted,
    onError,
    onClose,
    theme,
    txStatus,
    onBusyChange,
  } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  // Each phase swaps the focused control out (or disables it), which
  // drops focus to <body>; hand it to the new heading instead.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [phase.kind, txStatus]);
  const next = DISPUTE_TIER_LABEL[nextTier];

  const handleConfirm = useCallback(async () => {
    setPhase({ kind: "submitting" });
    onBusyChange?.(true);
    const fail = (err: unknown) => {
      onBusyChange?.(false);
      const info = extractRevert(err, APPEAL_REVERT_MESSAGES);
      setPhase({ kind: "error", reason: info.message });
      onError?.(err instanceof Error ? err : new Error(info.message));
    };
    let diamondAddress: Address;
    try {
      // Resolved here, not in render: it throws for an unregistered chain.
      diamondAddress = resolveDiamondAddress(chainId, props.diamondAddress);
      const chain = chainId === 8453 ? base : baseSepolia;
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
      });
      await publicClient.simulateContract({
        address: diamondAddress,
        abi: DIAMOND_ABI,
        functionName: "appealDispute",
        args: [BigInt(orderId)],
        account: signer.address,
      });
    } catch (err) {
      fail(err);
      return;
    }
    try {
      const data: Hex = encodeFunctionData({
        abi: DIAMOND_ABI,
        functionName: "appealDispute",
        args: [BigInt(orderId)],
      });
      const { hash } = await signer.sendTransaction({
        to: diamondAddress,
        data,
      });
      onSubmitted?.(hash);
      onBusyChange?.(false);
      setPhase({ kind: "submitted" });
    } catch (err) {
      fail(err);
    }
  }, [orderId, signer, props.diamondAddress, rpcUrl, chainId, onSubmitted, onError, onBusyChange]);

  const title = mode === "appeal" ? "Appeal this decision" : "Escalate dispute";

  return (
    <div
      style={{
        ...themeToCssVars(theme),
        background: color.surface,
        color: color.text,
        padding: 24,
        fontFamily: "var(--p2p-font, inherit)",
      }}
      data-appeal-dispute-root
    >
      {phase.kind === "confirm" || phase.kind === "submitting" ? (
        <div>
          <h3 id="appeal-dispute-title" ref={headingRef} tabIndex={-1} style={{ ...titleStyle, outline: "none" }}>
            {title}
          </h3>
          <p style={paragraphStyle}>
            {mode === "appeal"
              ? `The reviewer decided against you. Appealing drops that decision and sends the dispute to ${next} for a fresh review.`
              : `The reviewer did not decide in time. Escalating moves the dispute to ${next}.`}
            {" "}This can't be undone.
          </p>
          {mode === "appeal" && remainingMs !== undefined ? (
            <p style={paragraphStyle}>
              Time left to appeal: {formatRemaining(remainingMs)}. If you do
              nothing, the decision stands.
            </p>
          ) : null}
          <div style={rowStyle}>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={phase.kind === "submitting"}
              data-action="cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={phase.kind === "submitting"}
              data-action="confirm"
            >
              {phase.kind === "submitting"
                ? "Submitting…"
                : mode === "appeal"
                  ? "Appeal"
                  : "Escalate"}
            </Button>
          </div>
        </div>
      ) : phase.kind === "submitted" && txStatus === "failed" ? (
        <div>
          <h3 id="appeal-dispute-title" ref={headingRef} tabIndex={-1} style={{ ...titleStyle, outline: "none" }}>
            {mode === "appeal" ? "Appeal failed" : "Escalation failed"}
          </h3>
          <p style={paragraphStyle}>
            The transaction was sent but failed on chain, so nothing changed.
            {mode === "appeal"
              ? " If the appeal window is still open you can try again."
              : " You can try again."}
          </p>
          <div style={rowStyle}>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : phase.kind === "submitted" && txStatus === "unconfirmed" ? (
        <div>
          <h3 id="appeal-dispute-title" ref={headingRef} tabIndex={-1} style={{ ...titleStyle, outline: "none" }}>
            {mode === "appeal" ? "Couldn't confirm the appeal" : "Couldn't confirm the escalation"}
          </h3>
          <p style={paragraphStyle}>
            The transaction went through, but the dispute still shows its old
            stage. The network may be slow to update. Check back in a few
            minutes; if it still hasn't moved, you can try again.
          </p>
          <div style={rowStyle}>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : phase.kind === "submitted" ? (
        <div>
          <h3 id="appeal-dispute-title" ref={headingRef} tabIndex={-1} style={{ ...titleStyle, outline: "none" }}>
            {txStatus === "confirmed"
              ? mode === "appeal" ? "Appeal confirmed" : "Dispute escalated"
              : mode === "appeal" ? "Appeal sent" : "Escalation sent"}
          </h3>
          <p style={paragraphStyle}>
            {txStatus === "pending"
              ? `Waiting for the network to confirm it. Once it does, the dispute moves to ${next}.`
              : txStatus === "confirmed"
                ? `The dispute is now with ${next}. Check back here for the updated status.`
                : `The dispute is moving to ${next}. Check back here for the updated status.`}
          </p>
          <div style={rowStyle}>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <h3 id="appeal-dispute-title" ref={headingRef} tabIndex={-1} style={{ ...titleStyle, outline: "none" }}>
            Could not send {mode === "appeal" ? "appeal" : "escalation"}
          </h3>
          <p style={paragraphStyle}>{phase.reason}</p>
          <div style={rowStyle}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => setPhase({ kind: "confirm" })}
            >
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
