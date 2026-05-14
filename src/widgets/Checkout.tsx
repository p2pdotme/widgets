import React, { useState, useEffect } from "react";
import { formatUnits } from "viem";
import type { CheckoutProps } from "../types";
import { useOrderMachine } from "../core/order-machine";
import { resolveCurrencyMeta } from "../core/currency-meta";
import { CurrencyRow } from "../ui/CurrencyRow";
import { DEFAULT_DIAMOND_ADDRESS, USDC_DECIMALS } from "../core/contracts";
import { color, radius, font, weight, shadow, S, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import {
  Spinner, PulseDot, CenterStatus, SuccessIcon, XIcon,
  CopyRow, Stepper, CountdownRing, Skeleton, injectKeyframes,
} from "../ui/components";

// Window the user has to pay after a merchant accepts before auto-cancellation.
// Mirrors user-app's 5-minute window.
const AUTO_CANCEL_WINDOW_MS = 5 * 60 * 1000;

export function Checkout(props: CheckoutProps) {
  const {
    orderId: initialOrderId, placeOrder,
    amount, productName, signer, paymentNotice,
    chainId = 84532, diamondAddress = DEFAULT_DIAMOND_ADDRESS, rpcUrl,
    currency: demoCurrency,
    currencies,
    subgraphUrl, usdcAddress, usdcAmount, fiatAmount,
    screening,
    fetchCredit, fetchPendingOrders, onResumeRequest,
    mode = "modal", open = true, demo = false,
    theme,
    onClose, onOrderPlaced, onComplete, onError, onCancel,
  } = props;
  const themeStyle = themeToCssVars(theme);

  useEffect(injectKeyframes, []);

  const [copied, setCopied] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [timerExpired, setTimerExpired] = useState(false);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
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
    fetchCredit, fetchPendingOrders,
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
  // Per-currency UI metadata resolved against the SDK (symbol-native badge,
  // country name, payment-method label, address-field label, compound
  // fields for NGN/VEN). Host's CurrencyOption fields win when present.
  const acceptedMeta = state.currency
    ? resolveCurrencyMeta({ symbol: state.currency })
    : null;

  // Threshold display ("10 USDC", "12.5 USDC", etc.) — used in the fee-waiver
  // hint. Sourced from on-chain config so it tracks any protocol changes.
  const thresholdLabel = state.smallOrderThreshold !== null
    ? `${Number(state.smallOrderThreshold) / 1e6} USDC`
    : "10 USDC";

  // Pre-order fiat breakdown. Fee is charged on top of the fiat the user pays
  // (the user always receives the full `usdcAmount`). Per protocol config:
  // small orders (usdcAmount ≤ smallOrderThreshold) pay `smallOrderFixedFee`
  // USDC, converted to fiat at the same buyPrice. Larger orders pay zero.
  //
  // Credit accounting: when `state.credit > 0`, the user owes fiat only for
  // `chargedUsdc = max(usdcAmount − credit, 0)`. The full quantity / receipt
  // amount stays the same (= `usdcAmount` worth of goods); only the fiat
  // side is netted. Display surfaces both the credit row and the deducted
  // total. Fee logic uses the FULL `usdcAmount` for threshold comparison —
  // protocol fee is charged on the gross order, not the post-credit net.
  const credit = state.credit ?? 0n;
  const chargedUsdc = (() => {
    if (!usdcAmount) return null;
    if (credit >= usdcAmount) return 0n;
    return usdcAmount - credit;
  })();
  const preview = (() => {
    if (!usdcAmount || !state.buyPrice || !selectedCurrency || chargedUsdc === null) return null;
    const chargedFiat = (chargedUsdc * state.buyPrice) / 1_000_000n;
    // Fee follows the DELTA (charged amount), not the gross order:
    //   - credit covers fully (chargedUsdc == 0): no Diamond order, no fee
    //   - chargedUsdc > 0 + chargedUsdc ≤ smallOrderThreshold: fee applies
    //   - chargedUsdc > smallOrderThreshold: waived
    // Mirrors the Diamond's on-chain fee logic, which evaluates the
    // small-order threshold against `order.amount` (= delta when credit
    // is netted on-chain by the integrator).
    const feeUsdc =
      state.smallOrderThreshold !== null &&
      state.smallOrderFixedFee !== null &&
      chargedUsdc > 0n &&
      chargedUsdc <= state.smallOrderThreshold
        ? state.smallOrderFixedFee
        : 0n;
    const feeFiat = (feeUsdc * state.buyPrice) / 1_000_000n;
    const totalFiat = chargedFiat + feeFiat;
    // Subtotal-without-credit: shown when credit > 0 to make the deduction
    // visible. Equals what the user would have paid pre-credit.
    const grossFiat = (usdcAmount * state.buyPrice) / 1_000_000n;
    const creditFiat = (credit * state.buyPrice) / 1_000_000n;
    return {
      subtotal: (Number(chargedFiat) / 1e6).toFixed(2),
      gross: (Number(grossFiat) / 1e6).toFixed(2),
      creditUsdc: credit > 0n ? (Number(credit) / 1e6).toFixed(2) : null,
      creditFiat: credit > 0n ? (Number(creditFiat) / 1e6).toFixed(2) : null,
      fee: feeFiat > 0n ? (Number(feeFiat) / 1e6).toFixed(2) : null,
      total: (Number(totalFiat) / 1e6).toFixed(2),
      symbol: selectedCurrency.symbol,
      creditCoversFully: credit >= usdcAmount,
    };
  })();

  // True while we expect a breakdown but the on-chain price config hasn't
  // arrived OR the fetched config is for a different currency than the
  // user just picked. Gates the "Pay now" button so the user can't fire
  // the order before they've seen what they're paying, and also drives
  // the skeleton placeholders in the breakdown — otherwise the numbers
  // would render with the previous currency's pricing under the newly
  // selected currency's symbol for a frame.
  // Releases when state.currency catches up OR the fetch fails (so a
  // bad RPC doesn't strand the user).
  //
  // Also holds while the credit/pending fetch is in flight (state.gate ===
  // "loading"). Without this, the user would briefly see the un-credited
  // price + Pay button — and could fire the order before the credit
  // adjustment renders. The gate resolves to allow/auto-resume/reject as
  // soon as both fetchers return (or short-circuits to allow when the
  // host didn't wire either callback).
  const isQuotePending = Boolean(
    !demo && usdcAmount && selectedCurrency && (
      (!state.priceConfigFailed && (!preview || state.currency !== selectedCurrency.symbol)) ||
      state.gate === "loading"
    )
  );

  // Post-order breakdown — derived from on-chain `actualFiatAmount` (already
  // includes fee) and `fixedFeePaid` (in USDC, converted to fiat at current
  // buyPrice for display consistency with the pre-order screen).
  //
  // When credit was netted on-chain (the integrator's delta path), the
  // Diamond's `actualUsdtAmount` is just the delta. The user's full intent
  // is the host-passed `usdcAmount` prop. We recover the credit-used by
  // subtracting and surface it as a "Credit applied" row, parallel to the
  // pre-order preview.
  const orderBreakdown = (() => {
    if (state.phase !== "accepted" || !state.fiatAmount || !state.usdcAmount) return null;
    const feeFiat =
      state.fee && state.fee > 0n && state.buyPrice
        ? (state.fee * state.buyPrice) / 1_000_000n
        : 0n;
    const subtotalFiat = state.fiatAmount > feeFiat ? state.fiatAmount - feeFiat : state.fiatAmount;

    // Credit-used reconstruction: intent − delta. Only reliable when the
    // host passed `usdcAmount` AND it's larger than the Diamond delta —
    // otherwise we skip the credit row (e.g. tracking-only resumes where
    // the prop isn't set).
    const intent = usdcAmount ?? 0n;
    const delta = state.usdcAmount;
    const creditUsed = intent > delta ? intent - delta : 0n;
    const creditFiat =
      creditUsed > 0n && state.buyPrice
        ? (creditUsed * state.buyPrice) / 1_000_000n
        : 0n;
    const grossFiat = subtotalFiat + creditFiat;

    return {
      subtotal: (Number(subtotalFiat) / 1e6).toFixed(2),
      fee: feeFiat > 0n ? (Number(feeFiat) / 1e6).toFixed(2) : null,
      total: (Number(state.fiatAmount) / 1e6).toFixed(2),
      symbol: state.currency,
      creditUsdc: creditUsed > 0n ? (Number(creditUsed) / 1e6).toFixed(2) : null,
      creditFiat: creditUsed > 0n ? (Number(creditFiat) / 1e6).toFixed(2) : null,
      gross: creditUsed > 0n ? (Number(grossFiat) / 1e6).toFixed(2) : null,
    };
  })();
  const compoundFields = acceptedMeta?.compoundFields ?? null;
  const compoundParts = state.decryptedUpi && compoundFields ? state.decryptedUpi.split("|") : [];

  const stepIndex = state.phase === "completed" ? 3 : state.phase === "paid" ? 2 : state.phase === "accepted" ? 1 : 0;
  const hasPlaceOrder = Boolean(placeOrder);

  // Narrow the gate union once so the JSX render block doesn't have to
  // re-check `state.gate !== "loading"` on every property access. `rejection`
  // is null when the gate is loading or allowing; `Conflict` otherwise.
  const rejection =
    state.gate !== "loading" && state.gate.kind === "reject" ? state.gate.conflict : null;

  const content = (
    <div style={{ ...themeStyle, fontFamily: "var(--p2p-font, inherit)", color: color.text }}>
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
        {/* CREDIT GATE REJECTION — credit > 0 + a pending order with a
            different intended amount blocks new placement. The host can
            wire `onResumeRequest` to navigate the user to that order
            (typically re-opens the widget with `orderId={pendingOrderId}`).
            Hidden in tracking-only mode (initialOrderId set) since the
            host is already driving a specific order. */}
        {state.phase === "checkout" && hasPlaceOrder && rejection && (
          <div>
            <CenterStatus
              icon={<PulseDot />}
              title="Finish your pending order first"
              subtitle={
                usdcAmount
                  ? `You have a pending order for ${formatUnits(rejection.usdcAmount, USDC_DECIMALS)} USDC. Complete or cancel it before placing this ${formatUnits(usdcAmount, USDC_DECIMALS)} USDC order.`
                  : `You have a pending order for ${formatUnits(rejection.usdcAmount, USDC_DECIMALS)} USDC. Complete or cancel it before placing another.`
              }
            />
            <div style={{ ...S.cardFlat, padding: 14, marginTop: 16, background: color.surfaceAlt }}>
              <div style={S.rowBetween}>
                <span style={S.label}>Pending order</span>
                <span style={{ ...S.mono, fontSize: font.sm }}>#{rejection.orderId}</span>
              </div>
              <div style={{ ...S.rowBetween, marginTop: 6 }}>
                <span style={S.label}>Amount</span>
                <span style={{ ...S.body, ...S.num }}>
                  {formatUnits(rejection.usdcAmount, USDC_DECIMALS)} USDC
                </span>
              </div>
            </div>
            {onResumeRequest && (
              <button
                style={{ ...S.primaryBtn, marginTop: 20 }}
                onClick={() => onResumeRequest(rejection.orderId)}
              >
                Resume that order
              </button>
            )}
            {onClose && (
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={onClose}>
                Close
              </button>
            )}
          </div>
        )}

        {/* PRE-ORDER: client provides placeOrder callback */}
        {state.phase === "checkout" && hasPlaceOrder && !rejection && (
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
            {currencies && currencies.length > 0 && selectedCurrency && (() => {
              const selectedMeta = resolveCurrencyMeta(selectedCurrency);
              return (
              <div style={{ marginBottom: 16 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>Pay with</p>
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((o) => !o)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 10, padding: "10px 14px", borderRadius: radius.md,
                      border: `1px solid ${color.border}`, background: color.surface,
                      color: color.text, fontSize: font.base, fontWeight: weight.medium, cursor: "pointer",
                    }}>
                    <CurrencyRow meta={selectedMeta} />
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
                        const meta = resolveCurrencyMeta(c);
                        return (
                          <button key={c.symbol} type="button"
                            onClick={() => { setSelectedCurrency(c); setDropdownOpen(false); }}
                            style={{
                              width: "100%", boxSizing: "border-box",
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: 10, padding: "10px 14px", border: "none",
                              background: active ? color.accentSoft : "transparent",
                              color: color.text, cursor: "pointer", textAlign: "left",
                            }}>
                            <CurrencyRow meta={meta} />
                            {active && (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color.accent}
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
              );
            })()}
            {/* Pre-order breakdown. Renders when there's a fee, when credit
                is being applied, or while the quote is still loading. The
                credit row replaces the subtotal display ("Order: gross —
                Credit: −X = Subtotal: chargedFiat") so the user sees both
                the gross order they're getting and the deduction. */}
            {(isQuotePending || (preview && (preview.fee || preview.creditUsdc))) && (
              <div style={{ marginBottom: 16, padding: "14px 16px", background: color.surfaceAlt, borderRadius: radius.md, border: `1px solid ${color.border}` }}>
                {isQuotePending ? (
                  <div style={S.rowBetween}>
                    <span style={S.label}>Subtotal</span>
                    <Skeleton width={84} />
                  </div>
                ) : preview!.creditUsdc ? (
                  <>
                    <div style={S.rowBetween}>
                      <span style={S.label}>Order</span>
                      <span style={{ ...S.body, ...S.num }}>{preview!.symbol} {preview!.gross}</span>
                    </div>
                    <div style={{ ...S.rowBetween, marginTop: 8 }}>
                      <span style={S.label}>
                        Credit applied
                        <span style={{ ...S.faint, marginLeft: 6 }}>({preview!.creditUsdc} USDC)</span>
                      </span>
                      <span style={{ ...S.body, ...S.num, color: color.accent }}>
                        −{preview!.symbol} {preview!.creditFiat}
                      </span>
                    </div>
                    <div style={{ ...S.rowBetween, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
                      <span style={S.label}>Subtotal</span>
                      <span style={{ ...S.body, ...S.num }}>{preview!.symbol} {preview!.subtotal}</span>
                    </div>
                  </>
                ) : (
                  <div style={S.rowBetween}>
                    <span style={S.label}>Subtotal</span>
                    <span style={{ ...S.body, ...S.num }}>{preview!.symbol} {preview!.subtotal}</span>
                  </div>
                )}
                {!isQuotePending && preview!.fee && (
                  <>
                    <div style={{ ...S.rowBetween, marginTop: 8 }}>
                      <span style={S.label}>Transaction Fee</span>
                      <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{preview!.symbol} {preview!.fee}</span>
                    </div>
                    <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                      Waived on orders above {thresholdLabel}.
                    </p>
                  </>
                )}
                <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                  <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>You pay</span>
                  {isQuotePending
                    ? <Skeleton width={100} height={16} />
                    : <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                        {preview!.creditCoversFully
                          ? "Free (credit covers)"
                          : `${preview!.symbol} ${preview!.total}`}
                      </span>}
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
            <button
              style={{ ...S.primaryBtn, opacity: isQuotePending ? 0.6 : 1, cursor: isQuotePending ? "wait" : "pointer" }}
              onClick={handlePlaceOrder}
              disabled={isQuotePending}
            >
              {isQuotePending ? (
                <>
                  <Spinner size={14} />
                  Loading quote…
                </>
              ) : preview?.creditCoversFully ? (
                "Redeem credit"
              ) : preview ? (
                `Pay ${preview.symbol} ${preview.total}`
              ) : (
                "Pay now"
              )}
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
                  {/* Hero row: prominent circular countdown + "Pay exactly" */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                    {acceptedDeadline !== null && (
                      <CountdownRing
                        deadline={acceptedDeadline}
                        totalMs={AUTO_CANCEL_WINDOW_MS}
                        onExpire={() => setTimerExpired(true)}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ ...S.label, marginBottom: 2 }}>Pay exactly</p>
                      <h1 style={{ ...S.h1, fontSize: font.xxl, ...S.num, lineHeight: 1.1 }}>
                        {state.currency} {fiatDisplay}
                      </h1>
                      <p style={{ ...S.muted, marginTop: 4, marginBottom: 0 }}>
                        for {productName ?? (usdcDisplay ? `${usdcDisplay} USDC` : "your order")}
                      </p>
                      {orderBreakdown && (
                        <button
                          type="button"
                          onClick={() => setBreakdownExpanded((v) => !v)}
                          style={{
                            background: "none", border: "none", padding: 0, marginTop: 6,
                            color: color.accent, fontSize: font.sm, fontWeight: weight.medium,
                            cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
                          }}
                          aria-expanded={breakdownExpanded}
                        >
                          <span style={{ display: "inline-block", transform: breakdownExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
                          {breakdownExpanded ? "Hide breakdown" : "View breakdown"}
                        </button>
                      )}
                    </div>
                  </div>

                  {breakdownExpanded && orderBreakdown && (
                    <div style={{ ...S.cardFlat, padding: "14px 16px", marginBottom: 16, background: color.surfaceAlt }}>
                      {orderBreakdown.creditUsdc ? (
                        <>
                          <div style={S.rowBetween}>
                            <span style={S.label}>Order</span>
                            <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.gross}</span>
                          </div>
                          <div style={{ ...S.rowBetween, marginTop: 8 }}>
                            <span style={S.label}>
                              Credit applied
                              <span style={{ ...S.faint, marginLeft: 6 }}>({orderBreakdown.creditUsdc} USDC)</span>
                            </span>
                            <span style={{ ...S.body, ...S.num, color: color.accent }}>
                              −{orderBreakdown.symbol} {orderBreakdown.creditFiat}
                            </span>
                          </div>
                          <div style={{ ...S.rowBetween, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
                            <span style={S.label}>Subtotal</span>
                            <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.subtotal}</span>
                          </div>
                        </>
                      ) : (
                        <div style={S.rowBetween}>
                          <span style={S.label}>Subtotal</span>
                          <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.subtotal}</span>
                        </div>
                      )}
                      {orderBreakdown.fee && (
                        <>
                          <div style={{ ...S.rowBetween, marginTop: 8 }}>
                            <span style={S.label}>Transaction Fee</span>
                            <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{orderBreakdown.symbol} {orderBreakdown.fee}</span>
                          </div>
                          <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                            Waived on orders above {thresholdLabel}.
                          </p>
                        </>
                      )}
                      <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                        <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>Total paid</span>
                        <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                          {orderBreakdown.symbol} {orderBreakdown.total}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Action pill + body — pill matches user-app's
                      "Pay via PIX and confirm" language; the body
                      explains the action. A separate heading saying
                      "Complete your payment & confirm" would just
                      restate the pill. */}
                  {acceptedMeta && (
                    <div style={{ marginBottom: 8 }}>
                      <span style={{
                        display: "inline-block", padding: "4px 10px", borderRadius: radius.pill,
                        background: color.accentSoft, color: color.accent,
                        fontSize: font.sm, fontWeight: weight.semibold, letterSpacing: "0.02em",
                      }}>
                        Pay via {acceptedMeta.paymentMethod} and confirm
                      </span>
                    </div>
                  )}
                  <p style={{ ...S.muted, marginBottom: 14, lineHeight: 1.45 }}>
                    Transfer the amount to the {acceptedMeta?.paymentAddressLabel ?? "payment address"} below and click <strong>I have paid</strong> to continue.
                  </p>

                  <div style={{ ...S.cardFlat, padding: "20px", background: color.surfaceAlt }}>
                    <div style={S.rowBetween}>
                      <span style={S.label}>{acceptedMeta?.paymentMethod ?? "Payment"}</span>
                      <span style={S.faint}>Order #{state.orderId}</span>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {compoundFields ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {compoundFields.map((field, i) => (
                            <div key={field.key}>
                              <p style={{ ...S.label, marginBottom: 4 }}>{field.label}</p>
                              <CopyRow value={compoundParts[i] ?? "…"} copied={copied === field.key} onCopy={() => copy(compoundParts[i], field.key)} />
                            </div>
                          ))}
                        </div>
                      ) : state.decryptedUpi ? (
                        <CopyRow value={state.decryptedUpi} copied={copied === "upi"} onCopy={() => copy(state.decryptedUpi!, "upi")} />
                      ) : (
                        <p style={S.muted}>Decrypting payment details…</p>
                      )}
                    </div>
                    {/* QR is INR-only — mirrors user-app behavior. Mercado
                        Pago / PIX QRs require PSP-generated payloads that
                        the widget can't synthesize from the bare address. */}
                    {state.decryptedUpi && state.currency === "INR" && (
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
                  <h1 style={{ ...S.h1, fontSize: font.xxl }}>
                    {state.creditOnly ? "Credit redeemed" : "Payment complete"}
                  </h1>
                  {state.creditOnly ? (
                    <p style={{ ...S.muted, marginTop: 8 }}>
                      Order fulfilled from your existing credit. No fiat was charged.
                    </p>
                  ) : (
                    usdcDisplay && <p style={{ ...S.muted, marginTop: 8 }}>{usdcDisplay} USDC delivered.</p>
                  )}
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
