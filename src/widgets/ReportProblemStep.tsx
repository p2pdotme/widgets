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
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  DIAMOND_ABI,
  resolveDiamondAddress,
} from "../core/contracts";
import { color, radius, themeToCssVars, type P2PTheme } from "../ui/theme";
import type { SupportTheme } from "../types";
import { useT, type Translator } from "../i18n";

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
  /** RPC endpoint used to pre-simulate the on-chain `raiseDispute`
   *  before sending. Catches contract reverts with their custom error
   *  name (eg `DisputeTimeNotReached`) so the user never pays gas on a
   *  doomed call. Defaults to viem's chain default for `chainId`. */
  rpcUrl?: string;
  /** Chain id for the pre-simulation client. Defaults to Base Sepolia. */
  chainId?: number;
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

/** Map known custom-error names to catalog keys. */
const REVERT_KEYS: Record<string, string> = {
  NotAuthorized: "report.revertNotAuthorized",
  DisputeTimeNotReached: "report.revertDisputeTimeNotReached",
  DisputeTimeExpired: "report.revertDisputeTimeExpired",
  InvalidOrderStatusToRaiseDispute: "report.revertInvalidOrderStatus",
  CannotRaiseDisputeTwice: "report.revertCannotRaiseTwice",
  DisputeAlreadySettled: "report.revertAlreadySettled",
  InvalidOrderType: "report.revertInvalidOrderType",
};

interface RevertInfo {
  errorName?: string;
  message: string;
}

/** Inspect a viem error chain for a decoded custom-error name + friendly
 *  message. Uses viem's `BaseError.walk` when possible (the canonical
 *  way to find a `ContractFunctionRevertedError` inside a wrapped
 *  `TransactionExecutionError` / `ContractFunctionExecutionError`),
 *  and falls back to a manual property probe for non-viem shapes
 *  (eg test fixtures, wallet-side errors that don't subclass BaseError).
 */
function extractRevert(err: unknown, t: Translator): RevertInfo {
  let name: string | undefined;
  // 1. Preferred: viem's BaseError.walk. Resolves through nested
  //    `cause` chains regardless of depth.
  if (err instanceof BaseError) {
    const revert = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | undefined;
    if (revert?.data?.errorName) name = revert.data.errorName;
  }
  // 2. Fallback: manually walk `.cause` for plain objects (tests, raw
  //    wallet errors). Covers the case where the embedder's wallet
  //    wraps a viem error into a non-BaseError before re-throwing.
  if (!name) {
    let probe: unknown = err;
    for (let i = 0; i < 8 && probe; i++) {
      const data = (probe as { data?: { errorName?: string } }).data;
      if (data?.errorName) {
        name = data.errorName;
        break;
      }
      probe = (probe as { cause?: unknown }).cause;
    }
  }
  if (name && REVERT_KEYS[name]) {
    return { errorName: name, message: t(REVERT_KEYS[name]) };
  }
  // No decoded name — surface the friendliest message we can find.
  const e = err as {
    shortMessage?: string;
    message?: string;
    cause?: { shortMessage?: string };
  };
  const fallback =
    e.shortMessage ?? e.cause?.shortMessage ?? e.message ?? t("report.unknownError");
  return { errorName: name, message: fallback };
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
    rpcUrl,
    chainId = 84532,
    onSubmitted,
    onError,
    onClose,
    theme,
  } = props;
  // Throws with a clear message if the host targeted an unknown chain
  // without passing `diamondAddress` — better than silently calling
  // a non-existent contract on mainnet.
  const diamondAddress = resolveDiamondAddress(chainId, props.diamondAddress);
  const t = useT();
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
      setInputError(t("report.last4Error"));
      return;
    }
    setPhase({ kind: "submitting" });

    // Pre-flight simulation against a public client. Catches the
    // diamond's custom-error reverts (DisputeTimeNotReached etc.) with
    // their decoded names so the user never spends gas on a doomed call
    // and we can show a meaningful explanation instead of the wallet's
    // generic "Execution reverted for an unknown reason".
    try {
      const chain = chainId === 8453 ? base : baseSepolia;
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
      });
      await publicClient.simulateContract({
        address: diamondAddress,
        abi: DIAMOND_ABI,
        functionName: "raiseDispute",
        args: [BigInt(orderId), BigInt(redactInput)],
        account: signer.address,
      });
    } catch (err) {
      const info = extractRevert(err, t);
      setPhase({ kind: "error", reason: info.message });
      onError?.(err instanceof Error ? err : new Error(info.message));
      return;
    }

    // Simulation passed — actually send the tx via the embedder's
    // wallet. Decoded reverts are unlikely at this point but the same
    // extractRevert path catches anything the wallet surfaces.
    try {
      const data: Hex = encodeFunctionData({
        abi: DIAMOND_ABI,
        functionName: "raiseDispute",
        args: [BigInt(orderId), BigInt(redactInput)],
      });
      const { hash } = await signer.sendTransaction({
        to: diamondAddress,
        data,
      });
      onSubmitted?.(hash);
      setPhase({ kind: "submitted", txHash: hash });
    } catch (err) {
      const info = extractRevert(err, t);
      setPhase({ kind: "error", reason: info.message });
      onError?.(err instanceof Error ? err : new Error(info.message));
    }
  }, [
    orderId,
    redactInput,
    signer,
    diamondAddress,
    rpcUrl,
    chainId,
    onSubmitted,
    onError,
    t,
  ]);

  const handleRetry = useCallback(() => {
    setPhase({ kind: "form" });
  }, []);

  return (
    // The modal portal renders outside the widget root, so theme CSS vars
    // applied on an ancestor don't reach inside. We set them locally AND
    // pin the background + text colour to the same tokens so dark-theme
    // hosts (eg the demo merchant-app) don't show white text on a
    // default-white modal surface.
    <div
      style={{
        ...cssVars,
        background: color.surface,
        color: color.text,
        padding: 24,
        fontFamily: "var(--p2p-font, inherit)",
      }}
      data-report-problem-root
    >
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
  const t = useT();
  return (
    <div>
      <h3 id="report-problem-title" style={titleStyle}>
        {t("report.confirmTitle")}
      </h3>
      <p style={paragraphStyle}>{t("report.confirmIntro")}</p>
      <ul style={listStyle}>
        <li>{t("report.confirmBullet1")}</li>
        <li>{t("report.confirmBullet2")}</li>
        <li>{t("report.confirmBullet3")}</li>
      </ul>
      <div style={rowStyle}>
        <Button variant="ghost" onClick={onCancel} data-action="cancel">
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={onContinue} data-action="continue">
          {t("common.continue")}
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
  const t = useT();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3 id="report-problem-title" style={titleStyle}>
        {t("report.formTitle")}
      </h3>
      <p style={paragraphStyle}>
        {t("report.formBody", { shortId: shortenId(orderId) })}
      </p>
      <label style={labelStyle}>
        <span>{t("report.last4Label")}</span>
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
          aria-describedby={inputError ? "report-redact-error" : undefined}
          aria-label={t("report.last4Aria")}
          style={inputStyle}
        />
      </label>
      {inputError ? (
        <p id="report-redact-error" role="alert" style={errorTextStyle}>
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
          {t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          type="submit"
          disabled={submitting}
          data-action="submit"
        >
          {submitting ? t("report.submitting") : t("report.submit")}
        </Button>
      </div>
    </form>
  );
}

interface SubmittedViewProps {
  txHash: `0x${string}`;
  onClose?: () => void;
}

function SubmittedView({ txHash: _txHash, onClose }: SubmittedViewProps) {
  const t = useT();
  return (
    <div>
      <h3 id="report-problem-title" style={titleStyle}>
        {t("report.submittedTitle")}
      </h3>
      <p style={paragraphStyle}>{t("report.submittedBody")}</p>
      <div style={rowStyle}>
        <Button variant="primary" onClick={onClose}>
          {t("common.close")}
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
  const t = useT();
  return (
    <div>
      <h3 id="report-problem-title" style={titleStyle}>
        {t("report.errorTitle")}
      </h3>
      <p style={paragraphStyle}>{reason}</p>
      <div style={rowStyle}>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={onRetry}>
          {t("common.tryAgain")}
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
