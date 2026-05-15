// Two-step contact-support flow: confirmation → 4-digit redact form →
// submit. User-facing label is "Contact Support"; under the hood this
// is the on-chain `raiseDispute(orderId, redactTransId)` call which
// makes the support thread accessible (chat is gated on the dispute
// being on chain per the protocol's design).
//
// Optimistic flip on broadcast: once `signer.sendTransaction` returns a
// hash (before the receipt confirms), `onSubmitted(hash)` fires so the
// parent (<OrderAction>) can immediately swap the row's status to
// `Under review`. On revert / error the parent reconciles via the next
// chain poll.

import React, { useCallback, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { DIAMOND_ABI, DEFAULT_DIAMOND_ADDRESS } from "../core/contracts";
import { color, radius, themeToCssVars, type P2PTheme } from "../ui/theme";
import type { SupportTheme } from "../types";

export interface RaiseDisputeSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
}

export interface ReportProblemStepProps {
  orderId: string;
  signer: RaiseDisputeSigner;
  diamondAddress?: Address;
  /** Fires the moment the tx is broadcast (hash known, receipt pending).
   *  Consumers should optimistically flip the row to a `dispute open`
   *  state and rely on the chain refetch to reconcile on revert. */
  onSubmitted?: (txHash: `0x${string}`) => void;
  /** Fires on a non-recoverable error (signature rejected, RPC down,
   *  etc.). The component re-enables the form so the user can retry. */
  onError?: (err: Error) => void;
  /** Dismiss request — the parent controls open/close. */
  onClose?: () => void;
  theme?: SupportTheme;
}

type Phase =
  | { kind: "confirm" }
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "submitted"; txHash: `0x${string}` }
  | { kind: "error"; reason: string };

const REDACT_PATTERN = /^\d{4}$/;

export function ReportProblemStep(props: ReportProblemStepProps) {
  const {
    orderId,
    signer,
    diamondAddress = DEFAULT_DIAMOND_ADDRESS,
    onSubmitted,
    onError,
    onClose,
    theme,
  } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const [redactInput, setRedactInput] = useState<string>("");
  const [inputError, setInputError] = useState<string | null>(null);

  const cssVars = themeToCssVars(theme);

  const handleContinue = useCallback(() => {
    setPhase({ kind: "form" });
  }, []);

  const handleSubmit = useCallback(async () => {
    setInputError(null);
    if (!REDACT_PATTERN.test(redactInput)) {
      setInputError("Enter the last 4 digits of the transaction id.");
      return;
    }
    setPhase({ kind: "submitting" });
    try {
      const data = encodeFunctionData({
        abi: DIAMOND_ABI,
        functionName: "raiseDispute" as unknown as never,
        args: [BigInt(orderId), BigInt(redactInput)] as unknown as never,
      });
      const { hash } = await signer.sendTransaction({
        to: diamondAddress,
        data,
      });
      // Optimistic flip: fire onSubmitted on broadcast. Parent owns
      // the rollback path if the tx reverts.
      onSubmitted?.(hash);
      setPhase({ kind: "submitted", txHash: hash });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setPhase({ kind: "error", reason });
      onError?.(err instanceof Error ? err : new Error(reason));
    }
  }, [orderId, redactInput, signer, diamondAddress, onSubmitted, onError]);

  const handleRetry = useCallback(() => {
    setPhase({ kind: "form" });
  }, []);

  return (
    <div style={cssVars} data-report-problem-root>
      {phase.kind === "confirm" ? (
        <ConfirmView onCancel={onClose} onContinue={handleContinue} />
      ) : phase.kind === "form" || phase.kind === "submitting" ? (
        <FormView
          orderId={orderId}
          value={redactInput}
          onChange={(v) => {
            setRedactInput(v);
            if (inputError) setInputError(null);
          }}
          inputError={inputError}
          submitting={phase.kind === "submitting"}
          onSubmit={handleSubmit}
          onCancel={onClose}
        />
      ) : phase.kind === "submitted" ? (
        <SubmittedView txHash={phase.txHash} onClose={onClose} />
      ) : (
        <ErrorView reason={phase.reason} onRetry={handleRetry} onClose={onClose} />
      )}
    </div>
  );
}

// ─── Sub-views ─────────────────────────────────────────────────────────

interface ConfirmViewProps {
  onCancel?: () => void;
  onContinue: () => void;
}

function ConfirmView({ onCancel, onContinue }: ConfirmViewProps) {
  return (
    <div>
      <h3 style={titleStyle}>Contact Support</h3>
      <p style={paragraphStyle}>Before you continue, please note:</p>
      <ul style={listStyle}>
        <li>
          You must have already paid the order. The review needs your
          payment receipt details.
        </li>
        <li>
          A mediator will review both sides. Resolution typically takes
          24 to 72 hours.
        </li>
        <li>
          Reports filed in bad faith may result in reputation penalties.
          Only file a report if the merchant has not completed the order
          after you paid.
        </li>
      </ul>
      <div style={rowStyle}>
        <Button variant="ghost" onClick={onCancel} data-action="cancel">
          Cancel
        </Button>
        <Button variant="primary" onClick={onContinue} data-action="continue">
          Continue
        </Button>
      </div>
    </div>
  );
}

interface FormViewProps {
  orderId: string;
  value: string;
  onChange: (v: string) => void;
  inputError: string | null;
  submitting: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
}

function FormView({
  orderId,
  value,
  onChange,
  inputError,
  submitting,
  onSubmit,
  onCancel,
}: FormViewProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3 style={titleStyle}>Confirm transaction details</h3>
      <p style={paragraphStyle}>
        Order #{shortenId(orderId)}. Enter the last 4 digits of the
        transaction id you used to pay the merchant. This helps the
        mediator match your payment against the merchant's records.
        Submitting opens the support thread for this order.
      </p>
      <label style={labelStyle}>
        <span>Last 4 digits</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          value={value}
          onChange={(e) =>
            onChange(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          disabled={submitting}
          aria-invalid={inputError ? "true" : "false"}
          aria-label="last 4 digits of transaction id"
          style={inputStyle}
        />
      </label>
      {inputError ? (
        <p role="alert" style={errorTextStyle}>
          {inputError}
        </p>
      ) : null}
      <div style={rowStyle}>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
          data-action="cancel"
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          type="submit"
          disabled={submitting}
          data-action="submit"
        >
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}

interface SubmittedViewProps {
  txHash: `0x${string}`;
  onClose?: () => void;
}

function SubmittedView({ txHash, onClose }: SubmittedViewProps) {
  return (
    <div>
      <h3 style={titleStyle}>Report submitted</h3>
      <p style={paragraphStyle}>
        Your report is on chain. A mediator will reach out via support
        chat shortly.
      </p>
      <p style={{ ...paragraphStyle, fontFamily: "monospace", fontSize: 11 }}>
        Tx: {shortenId(txHash)}
      </p>
      <div style={rowStyle}>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

interface ErrorViewProps {
  reason: string;
  onRetry: () => void;
  onClose?: () => void;
}

function ErrorView({ reason, onRetry, onClose }: ErrorViewProps) {
  return (
    <div>
      <h3 style={titleStyle}>Could not submit report</h3>
      <p style={paragraphStyle}>{reason}</p>
      <div style={rowStyle}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

// ─── Shared styles + Button ────────────────────────────────────────────

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  color: "var(--p2p-color-fg, #0a0b0d)",
};

const paragraphStyle: React.CSSProperties = {
  color: "var(--p2p-color-muted, #6b6b6b)",
  fontSize: 13,
  lineHeight: 1.5,
  marginTop: 8,
  marginBottom: 0,
};

const listStyle: React.CSSProperties = {
  color: "var(--p2p-color-muted, #6b6b6b)",
  fontSize: 13,
  lineHeight: 1.5,
  marginTop: 12,
  marginBottom: 0,
  paddingLeft: 18,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 16,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "var(--p2p-color-fg, #0a0b0d)",
  marginTop: 16,
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 16,
  borderRadius: "var(--p2p-radius-button, 8px)",
  border: "1px solid var(--p2p-color-muted, #6b6b6b)",
  background: "var(--p2p-color-bg, #ffffff)",
  color: "var(--p2p-color-fg, #0a0b0d)",
  fontFamily: "monospace",
  letterSpacing: 2,
};

const errorTextStyle: React.CSSProperties = {
  color: "var(--p2p-color-danger, #d12f2f)",
  fontSize: 12,
  marginTop: 6,
  marginBottom: 0,
};

interface ButtonProps {
  variant: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  ["data-action"]?: string;
}

function Button({
  variant,
  type = "button",
  onClick,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const base: React.CSSProperties = {
    padding: "8px 14px",
    fontSize: 14,
    borderRadius: "var(--p2p-radius-button, 8px)",
    fontFamily: "var(--p2p-font, inherit)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    border: "none",
  };
  const variantStyle: React.CSSProperties =
    variant === "primary"
      ? {
          background: "var(--p2p-color-accent, #7c3aed)",
          color: "var(--p2p-color-bg, #ffffff)",
        }
      : variant === "danger"
        ? {
            background: "var(--p2p-color-danger, #d12f2f)",
            color: "var(--p2p-color-bg, #ffffff)",
          }
        : {
            background: "transparent",
            color: "var(--p2p-color-fg, #0a0b0d)",
            border: "1px solid var(--p2p-color-muted, #6b6b6b)",
          };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variantStyle }}
      {...rest}
    >
      {children}
    </button>
  );
}

function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
