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

import React, { useCallback, useEffect, useState } from "react";
import type { Order } from "@p2pdotme/sdk/orders";
import type { Address } from "viem";
import { color, font, weight, S, themeToCssVars } from "../ui/theme";
import type { P2PTheme, SupportSigner } from "../types";
import {
  computeOrderAction,
} from "../core/order-action";
import { ContactSupport } from "./ContactSupport";
import type { RaiseDisputeSigner } from "./ReportProblemStep";

/** 1s tick to keep countdowns + doughnut fill live. One per
 *  <OrderAction> instance; cheap (just setState), reads `Date.now()`
 *  at each tick. */
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
  signer: SupportSigner;
  bridgeUrl: string;
  originApp: string;
  /** Required for the on-chain raiseDispute write. Absent → the
   *  Contact Support chip renders disabled inside the review window. */
  txSigner?: RaiseDisputeSigner;
  diamondAddress?: Address;
  /** Called from the smart layout when the user clicks "Resume order"
   *  on a BUY ACCEPTED row. Absent → Resume button is suppressed. */
  onResumeOrder?: (orderId: string) => void;
  /** Fires the moment the report tx broadcasts. */
  onReportSubmitted?: (orderId: string, txHash: `0x${string}`) => void;
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
    onResumeOrder,
    onReportSubmitted,
    theme,
  } = props;

  const now = useNowTick();
  const state = computeOrderAction(order, now);

  const handleResume = useCallback(() => {
    onResumeOrder?.(orderId);
  }, [onResumeOrder, orderId]);

  const themeStyle = themeToCssVars(theme);
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
          onReportSubmitted={onReportSubmitted}
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
