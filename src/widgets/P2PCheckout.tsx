import React, { useState, useEffect } from "react";
import { formatUnits } from "viem";
import type { P2PCheckoutProps } from "../types";
import { useOrderMachine } from "../core/order-machine";
import { CURRENCIES } from "../core/config";
import { DEFAULT_DIAMOND_ADDRESS, USDC_DECIMALS } from "../core/contracts";
import { color, radius, font, weight, shadow, S } from "../ui/theme";
import { Modal } from "../ui/Modal";
import {
  Spinner, PulseDot, CenterStatus, SuccessIcon, XIcon,
  CopyRow, Stepper, CountdownPill, injectKeyframes,
} from "../ui/components";

// Window the user has to pay after a merchant accepts before auto-cancellation.
// Mirrors user-app's 5-minute window.
const AUTO_CANCEL_WINDOW_MS = 5 * 60 * 1000;

export function P2PCheckout(props: P2PCheckoutProps) {
  const {
    orderId: initialOrderId, placeOrder,
    amount, productName, signer, paymentNotice,
    chainId = 84532, diamondAddress = DEFAULT_DIAMOND_ADDRESS, rpcUrl,
    currency: demoCurrency,
    currencies,
    subgraphUrl, usdcAddress, usdcAmount, fiatAmount,
    screening,
    mode = "modal", open = true, demo = false,
    onClose, onOrderPlaced, onComplete, onError, onCancel,
  } = props;

  useEffect(injectKeyframes, []);

  const [copied, setCopied] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [timerExpired, setTimerExpired] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(currencies?.[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close the dropdown when the user clicks outside it
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [dropdownOpen]);

  const { state, handlePlaceOrder, markPaid, cancelOrder } = useOrderMachine({
    orderId: initialOrderId, placeOrder,
    signer, chainId, diamondAddress, rpcUrl, demo,
    demoCurrency, selectedCurrency,
    subgraphUrl, usdcAddress, usdcAmount, fiatAmount,
    screening,
    onOrderPlaced, onComplete, onError, onCancel,
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  };

  const handleMarkPaid = async () => {
    setIsMarkingPaid(true);
    await markPaid();
    setIsMarkingPaid(false);
  };

  const handleCancelConfirm = async () => {
    setIsCancelling(true);
    await cancelOrder();
    setIsCancelling(false);
    // Close the confirm panel on success; on failure the inline error stays
    // visible underneath so the user can decide whether to retry.
  };

  const acceptedDeadline =
    state.acceptedTimestamp !== null
      ? Number(state.acceptedTimestamp) * 1000 + AUTO_CANCEL_WINDOW_MS
      : null;

  const usdcDisplay = state.usdcAmount ? formatUnits(state.usdcAmount, USDC_DECIMALS) : null;
  const fiatDisplay = state.fiatAmount ? (Number(state.fiatAmount) / 1e6).toFixed(2) : null;
  const currencyConfig = CURRENCIES.find((c) => c.symbol === state.currency);

  // Threshold display ("10 USDC", "12.5 USDC", etc.) — used in the fee-waiver
  // hint. Sourced from on-chain config so it tracks any protocol changes.
  const thresholdLabel = state.smallOrderThreshold !== null
    ? `${Number(state.smallOrderThreshold) / 1e6} USDC`
    : "10 USDC";

  // Pre-order fiat breakdown. Fee is charged on top of the fiat the user pays
  // (the user always receives the full `usdcAmount`). Per protocol config:
  // small orders (usdcAmount ≤ smallOrderThreshold) pay `smallOrderFixedFee`
  // USDC, converted to fiat at the same buyPrice. Larger orders pay zero.
  const preview = (() => {
    if (!usdcAmount || !state.buyPrice || !selectedCurrency) return null;
    const subtotalFiat = (usdcAmount * state.buyPrice) / 1_000_000n;
    const feeUsdc =
      state.smallOrderThreshold !== null &&
      state.smallOrderFixedFee !== null &&
      usdcAmount <= state.smallOrderThreshold
        ? state.smallOrderFixedFee
        : 0n;
    const feeFiat = (feeUsdc * state.buyPrice) / 1_000_000n;
    const totalFiat = subtotalFiat + feeFiat;
    return {
      subtotal: (Number(subtotalFiat) / 1e6).toFixed(2),
      fee: feeFiat > 0n ? (Number(feeFiat) / 1e6).toFixed(2) : null,
      total: (Number(totalFiat) / 1e6).toFixed(2),
      symbol: selectedCurrency.symbol,
    };
  })();

  // Post-order breakdown — derived from on-chain `actualFiatAmount` (already
  // includes fee) and `fixedFeePaid` (in USDC, converted to fiat at current
  // buyPrice for display consistency with the pre-order screen).
  const orderBreakdown = (() => {
    if (state.phase !== "accepted" || !state.fiatAmount || !state.usdcAmount) return null;
    const feeFiat =
      state.fee && state.fee > 0n && state.buyPrice
        ? (state.fee * state.buyPrice) / 1_000_000n
        : 0n;
    const subtotalFiat = state.fiatAmount > feeFiat ? state.fiatAmount - feeFiat : state.fiatAmount;
    return {
      subtotal: (Number(subtotalFiat) / 1e6).toFixed(2),
      fee: feeFiat > 0n ? (Number(feeFiat) / 1e6).toFixed(2) : null,
      total: (Number(state.fiatAmount) / 1e6).toFixed(2),
      symbol: state.currency,
    };
  })();
  const isCompound = currencyConfig && currencyConfig.compoundFields;
  const compoundParts = state.decryptedUpi && isCompound ? state.decryptedUpi.split("|") : [];

  const stepIndex = state.phase === "completed" ? 3 : state.phase === "paid" ? 2 : state.phase === "accepted" ? 1 : 0;
  const hasPlaceOrder = Boolean(placeOrder);

  const content = (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", color: color.text }}>
      {/* Header */}
      <div style={{
        padding: "16px 24px", borderBottom: `1px solid ${color.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: color.accent,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: weight.bold, fontSize: 14,
          }}>P</div>
          <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>P2P Checkout</span>
          {demo && <span style={{
            padding: "2px 8px", borderRadius: radius.pill,
            background: color.accentSoft, color: color.accent,
            fontSize: font.xs, fontWeight: weight.semibold,
          }}>DEMO</span>}
        </div>
        {mode === "modal" && onClose && (
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: radius.sm, border: "none",
            background: "transparent", cursor: "pointer", fontSize: 18, color: color.textMuted,
          }}>×</button>
        )}
      </div>

      <div style={{ padding: "24px" }}>
        {/* PRE-ORDER: client provides placeOrder callback */}
        {state.phase === "checkout" && hasPlaceOrder && (
          <div>
            <p style={S.label}>Order Summary</p>
            {amount && <h1 style={{ ...S.h1, marginTop: 4, fontSize: font.display }}><span style={S.num}>{amount}</span></h1>}
            {productName && (
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 48, height: 48, background: color.accentSoft, borderRadius: radius.md,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
                }}>🎟️</div>
                <p style={{ ...S.body, fontWeight: weight.medium, margin: 0 }}>{productName}</p>
              </div>
            )}
            {(amount || productName) && <div style={S.divider} />}
            {currencies && currencies.length > 0 && selectedCurrency && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>Pay with</p>
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((o) => !o)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 10, padding: "12px 14px", borderRadius: radius.md,
                      border: `1px solid ${color.border}`, background: color.surface,
                      color: color.text, fontSize: font.base, fontWeight: weight.medium, cursor: "pointer",
                    }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{selectedCurrency.flag}</span>
                      <span>{selectedCurrency.paymentMethod}</span>
                      <span style={{ fontSize: font.sm, color: color.textMuted, fontWeight: weight.medium }}>
                        {selectedCurrency.symbol}
                      </span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: color.textMuted, transform: dropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {dropdownOpen && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 10,
                      background: color.surface, border: `1px solid ${color.border}`,
                      borderRadius: radius.md, boxShadow: shadow.pop, overflow: "hidden",
                    }}>
                      {currencies.map((c) => {
                        const active = selectedCurrency.symbol === c.symbol;
                        return (
                          <button key={c.symbol} type="button"
                            onClick={() => { setSelectedCurrency(c); setDropdownOpen(false); }}
                            style={{
                              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: 10, padding: "12px 14px", border: "none",
                              background: active ? color.accentSoft : "transparent",
                              color: color.text, fontSize: font.base, fontWeight: weight.medium,
                              cursor: "pointer", textAlign: "left",
                            }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 18 }}>{c.flag}</span>
                              <span>{c.paymentMethod}</span>
                              <span style={{ fontSize: font.sm, color: color.textMuted, fontWeight: weight.medium }}>
                                {c.symbol}
                              </span>
                            </span>
                            {active && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color.accent}
                                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            {preview && (
              <div style={{ marginBottom: 16, padding: "14px 16px", background: color.surfaceAlt, borderRadius: radius.md, border: `1px solid ${color.border}` }}>
                <div style={S.rowBetween}>
                  <span style={S.label}>Subtotal</span>
                  <span style={{ ...S.body, ...S.num }}>{preview.symbol} {preview.subtotal}</span>
                </div>
                {preview.fee && (
                  <>
                    <div style={{ ...S.rowBetween, marginTop: 8 }}>
                      <span style={S.label}>Additional fee</span>
                      <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{preview.symbol} {preview.fee}</span>
                    </div>
                    <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                      Waived on orders above {thresholdLabel}.
                    </p>
                  </>
                )}
                <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                  <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>Total</span>
                  <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                    {preview.symbol} {preview.total}
                  </span>
                </div>
              </div>
            )}
            {paymentNotice && (
              <div style={{ marginBottom: 12, padding: "12px 14px", background: color.warningSoft, border: `1px solid ${color.warning}33`, borderRadius: radius.md, fontSize: font.md, color: color.text, lineHeight: 1.5 }}>
                {paymentNotice}
              </div>
            )}
            {state.error && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: color.dangerSoft, border: `1px solid ${color.danger}22`, borderRadius: radius.md }}>
                <span style={{ color: color.danger, fontSize: font.md }}>{state.error}</span>
              </div>
            )}
            <button style={S.primaryBtn} onClick={handlePlaceOrder}>
              {preview ? `Pay ${preview.symbol} ${preview.total}` : "Pay now"}
            </button>
            <p style={{ ...S.faint, textAlign: "center", marginTop: 12 }}>You'll pay fiat to a verified P2P merchant.</p>
          </div>
        )}

        {state.phase === "placing" && (
          <CenterStatus icon={<Spinner />} title="Placing order…" subtitle="Waiting for your transaction to confirm." />
        )}

        {/* ORDER TRACKING — the P2P protocol flow */}
        {(["placed", "accepted", "paid", "completed", "cancelled"].includes(state.phase) ||
          (state.phase === "error" && state.orderId)) && (
          <div>
            <Stepper stepIndex={stepIndex} />
            <div style={{ ...S.card, padding: "32px", marginTop: 16 }}>

              {state.phase === "placed" && (
                <CenterStatus icon={<PulseDot />} title="Finding a merchant"
                  subtitle={`Order #${state.orderId}: A P2P merchant will be assigned to accept your cash deposit and send USDC on your behalf to fulfill this checkout. Please note that this is a manual swap process and may take 2–3 minutes to complete. We appreciate your patience.`} />
              )}

              {state.phase === "accepted" && (
                <div>
                  {acceptedDeadline !== null && (
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                      <CountdownPill
                        deadline={acceptedDeadline}
                        onExpire={() => setTimerExpired(true)}
                      />
                    </div>
                  )}
                  <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <p style={S.label}>Pay exactly</p>
                    <h1 style={{ ...S.h1, fontSize: font.hero, marginTop: 6, ...S.num }}>{state.currency} {fiatDisplay}</h1>
                    <p style={{ ...S.muted, marginTop: 4 }}>
                      for {productName ?? (usdcDisplay ? `${usdcDisplay} USDC` : "your order")}
                    </p>
                  </div>

                  {orderBreakdown && (
                    <div style={{ ...S.cardFlat, padding: "14px 16px", marginBottom: 16, background: color.surfaceAlt }}>
                      <div style={S.rowBetween}>
                        <span style={S.label}>Subtotal</span>
                        <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.subtotal}</span>
                      </div>
                      {orderBreakdown.fee && (
                        <>
                          <div style={{ ...S.rowBetween, marginTop: 8 }}>
                            <span style={S.label}>Additional fee</span>
                            <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{orderBreakdown.symbol} {orderBreakdown.fee}</span>
                          </div>
                          <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                            Waived on orders above {thresholdLabel}.
                          </p>
                        </>
                      )}
                      <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                        <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>Total</span>
                        <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                          {orderBreakdown.symbol} {orderBreakdown.total}
                        </span>
                      </div>
                    </div>
                  )}

                  <div style={{ ...S.cardFlat, padding: "20px", background: color.surfaceAlt }}>
                    <div style={S.rowBetween}>
                      <span style={S.label}>{currencyConfig?.paymentMethod ?? "Payment"}</span>
                      <span style={S.faint}>Order #{state.orderId}</span>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {isCompound && currencyConfig?.compoundFields ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {currencyConfig.compoundFields.map((field: string, i: number) => (
                            <div key={field}>
                              <p style={{ ...S.label, marginBottom: 4 }}>{field}</p>
                              <CopyRow value={compoundParts[i] ?? "…"} copied={copied === field} onCopy={() => copy(compoundParts[i], field)} />
                            </div>
                          ))}
                        </div>
                      ) : state.decryptedUpi ? (
                        <CopyRow value={state.decryptedUpi} copied={copied === "upi"} onCopy={() => copy(state.decryptedUpi!, "upi")} />
                      ) : (
                        <p style={S.muted}>Decrypting payment details…</p>
                      )}
                    </div>
                    {state.decryptedUpi && currencyConfig?.hasQR && state.currency === "INR" && (
                      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                        <div style={{ padding: 12, background: "#fff", borderRadius: radius.md, border: `1px solid ${color.border}` }}>
                          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(
                            `upi://pay?pa=${state.decryptedUpi}&am=${fiatDisplay}&cu=INR&tr=${state.orderId}`
                          )}`} alt="QR" style={{ width: 180, height: 180, display: "block" }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {state.error && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: color.dangerSoft, borderRadius: radius.md, color: color.danger, fontSize: font.md }}>{state.error}</div>
                  )}

                  <button
                    style={{ ...S.primaryBtn, marginTop: 20, opacity: isMarkingPaid || timerExpired ? 0.5 : 1, cursor: timerExpired ? "not-allowed" : "pointer" }}
                    onClick={handleMarkPaid}
                    disabled={isMarkingPaid || timerExpired || isCancelling}
                  >
                    {timerExpired ? "Payment window expired" : isMarkingPaid ? "Confirming…" : "I've paid"}
                  </button>

                  {!showCancelConfirm ? (
                    <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={() => setShowCancelConfirm(true)} disabled={isCancelling}>Cancel order</button>
                  ) : (
                    <div style={{ marginTop: 12, padding: 14, borderRadius: radius.md, background: color.dangerSoft, border: `1px solid ${color.danger}22` }}>
                      <p style={{ fontSize: font.md, color: color.danger, marginTop: 0 }}>Cancel this order?</p>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          style={{ ...S.secondaryBtn, flex: 1, height: 38, borderColor: color.danger, color: color.danger, opacity: isCancelling ? 0.6 : 1, cursor: isCancelling ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                          onClick={handleCancelConfirm}
                          disabled={isCancelling}
                        >
                          {isCancelling && <Spinner size={14} />}
                          {isCancelling ? "Cancelling…" : "Yes, cancel"}
                        </button>
                        <button
                          style={{ ...S.secondaryBtn, flex: 1, height: 38 }}
                          onClick={() => setShowCancelConfirm(false)}
                          disabled={isCancelling}
                        >
                          Keep order
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {state.phase === "paid" && (
                <CenterStatus icon={<Spinner />} title="Verifying your payment" subtitle="The merchant is confirming. Usually under a minute." />
              )}

              {state.phase === "completed" && (
                <div style={{ textAlign: "center" }}>
                  <SuccessIcon />
                  <h1 style={{ ...S.h1, fontSize: font.xxl }}>Payment complete</h1>
                  {usdcDisplay && <p style={{ ...S.muted, marginTop: 8 }}>{usdcDisplay} USDC delivered.</p>}
                  {onClose && <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={onClose}>Done</button>}
                </div>
              )}

              {state.phase === "cancelled" && (
                <div style={{ textAlign: "center" }}>
                  <CenterStatus icon={<XIcon />} title="Order cancelled" subtitle="You were not charged." variant="danger" />
                  {onClose && <button style={{ ...S.primaryBtn, marginTop: 8 }} onClick={onClose}>Done</button>}
                </div>
              )}
            </div>
          </div>
        )}

        {state.phase === "error" && !state.orderId && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ color: color.danger, marginBottom: 16 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 style={S.h2}>{state.error}</h2>
            {hasPlaceOrder && <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={handlePlaceOrder}>Try again</button>}
          </div>
        )}
      </div>
    </div>
  );

  if (mode === "modal") return <Modal open={open} onClose={onClose}>{content}</Modal>;
  return <div style={{ ...S.card, overflow: "hidden" }}>{content}</div>;
}
