// Per-row composition of the smart layout for
// <PaymentHistoryWithSupport actionMode="smart">. Two visual layers:
//
//   A — Status text (always rendered)
//   B — Action / Contact Support
//         · Resume order button (BUY ACCEPTED unpaid + onResumeOrder
//           callback provided)
//         · Contact Support — outline chip with draining doughnut
//           inside the review window, or plain button (red/green dot)
//           after a dispute has been filed
//
// Chat is intentionally gated on the on-chain dispute being raised —
// the chip's click target depends on chain state:
//   · inside review window      → opens ReportProblemStep modal
//   · dispute raised / resolved → opens chat
//   · otherwise                  → not rendered

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Order } from "@p2pdotme/sdk/orders";
import type { Address } from "viem";
import { color, font, weight, S, themeToCssVars } from "../ui/theme";
import type { P2PTheme, SupportSigner } from "../types";
import {
  computeOrderAction,
} from "../core/order-action";
import { ContactSupport } from "./ContactSupport";
import type { RaiseDisputeSigner } from "./ReportProblemStep";

/** Force a re-render once per second ONLY while `active` — i.e. while a
 *  live countdown (the report-problem doughnut + remaining time) is on
 *  screen. Idle rows never arm a timer, which avoids a per-row 1s render
 *  storm across long order histories where most rows are terminal
 *  (completed / cancelled / resolved) and have nothing to animate. The
 *  clock itself is read fresh in render via `Date.now()`, so a row that
 *  crosses into its dispute window reflects it on the next render without
 *  every row polling every second. */
function useCountdownTicker(active: boolean, intervalMs = 1000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

export interface OrderActionProps {
  orderId: string;
  /** Raw SDK Order. State is recomputed every tick from this + Date.now(). */
  order: Order;
  signer: SupportSigner;
  bridgeUrl: string;
  originApp: string;
  /** Required for the on-chain raiseDispute write. Absent → the
   *  Contact Support chip renders disabled inside the review window. */
  txSigner?: RaiseDisputeSigner;
  diamondAddress?: Address;
  /** Optional read RPC used by the report-problem pre-flight simulation
   *  to decode contract reverts. When omitted the embedder's chain
   *  default applies — recommended to point at a stable RPC for prod. */
  rpcUrl?: string;
  /** Chain id for the pre-simulation. Defaults to Base Sepolia. */
  chainId?: number;
  /** Called from the smart layout when the user clicks "Resume order"
   *  on a BUY ACCEPTED row. Absent → Resume button is suppressed. */
  onResumeOrder?: (orderId: string) => void;
  /** Fires the moment the report tx broadcasts. */
  onReportSubmitted?: (orderId: string, txHash: `0x${string}`) => void;
  /** Forwarded to the per-row `ContactSupport`. See `ContactSupportProps.chatEnabled`. */
  chatEnabled?: boolean;
  theme?: P2PTheme;
}

export function OrderAction(props: OrderActionProps) {
  const {
    orderId,
    order,
    signer,
    bridgeUrl,
    originApp,
    txSigner,
    diamondAddress,
    rpcUrl,
    chainId,
    onResumeOrder,
    onReportSubmitted,
    chatEnabled,
    theme,
  } = props;

  const state = computeOrderAction(order, Date.now());
  // Tick only rows that change with time: a live countdown (report-problem
  // chip, "review opens in", "will resolve within") or a dispute-window
  // boundary the row will cross. `state.live` is set by computeOrderAction
  // for exactly those; static/terminal rows never arm a timer.
  useCountdownTicker(state.live === true);

  const handleResume = useCallback(() => {
    onResumeOrder?.(orderId);
  }, [onResumeOrder, orderId]);

  const themeStyle = useMemo(() => themeToCssVars(theme), [theme]);
  const showResume =
    state.action.kind === "resume" && typeof onResumeOrder === "function";

  return (
    <div
      style={{
        ...themeStyle,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
      data-order-action-root
      data-order-id={orderId}
    >
      <span
        data-order-action-status
        style={{
          fontSize: font.sm,
          color: color.textMuted,
          fontWeight: weight.regular,
          // Right-align so the line ends flush with the action column on
          // wide rows; wrap onto multiple lines on narrow rows instead of
          // pushing the column wider than its container.
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {state.statusText}
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
        {showResume ? <ResumeButton onClick={handleResume} /> : null}
        <ContactSupport
          orderId={orderId}
          state={state}
          signer={signer}
          bridgeUrl={bridgeUrl}
          originApp={originApp}
          txSigner={txSigner}
          diamondAddress={diamondAddress}
          rpcUrl={rpcUrl}
          chainId={chainId}
          onReportSubmitted={onReportSubmitted}
          chatEnabled={chatEnabled}
          theme={theme}
        />
      </div>
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
