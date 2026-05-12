import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, formatUnits, parseUnits, stringToHex } from "viem";
import { baseSepolia, base } from "viem/chains";
import type { P2POfframpProps, CurrencyOption } from "../types";
import { useOfframpMachine } from "../core/offramp-machine";
import { color, radius, font, weight, shadow, S, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import {
  Spinner,
  PulseDot,
  CenterStatus,
  SuccessIcon,
  XIcon,
  Stepper,
  injectKeyframes,
} from "../ui/components";
import { PaymentAddressInput } from "../ui/PaymentAddressInput";
import { ERC20_READ_ABI, DIAMOND_ABI } from "../core/contracts";

const USDC_DECIMALS = 6;

/**
 * P2POfframp — convert USDC the user holds on Base into local fiat. The
 * widget orchestrates the Diamond-level lifecycle (auto-route circleId,
 * poll status, encrypt UPI, drive UI). Integrator-specific work — USDC
 * approve, the `userInitiateOfframp` / equivalent tx, the
 * `deliverOfframpUpi` tx, optional `reconcile` — flows through the host
 * callbacks (`placeOfframp`, `deliverUpi`, `reconcile`). The widget itself
 * never imports an integrator ABI. See README §"Offramp callback contract"
 * for the host-side recipe.
 */
export function P2POfframp(props: P2POfframpProps) {
  const {
    usdcAddress, diamondAddress, signer, currencies,
    chainId = 84532, rpcUrl, subgraphUrl, fiatAmountLimit,
    placeOfframp, deliverUpi, reconcile,
    defaultAmountUsdc, mode = "modal", open = true, theme,
    onClose, onOrderPlaced, onComplete, onCancelled, onError,
  } = props;
  const themeStyle = themeToCssVars(theme);

  useEffect(injectKeyframes, []);

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyOption>(currencies[0]);
  const [paymentAddress, setPaymentAddress] = useState("");
  const [paymentValid, setPaymentValid] = useState(false);
  const [amountInput, setAmountInput] = useState<string>(
    defaultAmountUsdc ? formatUnits(defaultAmountUsdc, USDC_DECIMALS) : ""
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  // Per-currency on-chain quote — `sellPrice` (fiat-per-USDC, 6-dec) + the
  // small-order fee config. Drives the pre-order fiat breakdown so the user
  // sees their net receivable in fiat before signing. Same pattern as the
  // buy widget's `getPriceConfig` fetch.
  const [sellPrice, setSellPrice] = useState<bigint | null>(null);
  const [smallOrderThreshold, setSmallOrderThreshold] = useState<bigint | null>(null);
  const [smallOrderFixedFee, setSmallOrderFixedFee] = useState<bigint | null>(null);
  const [priceConfigFailed, setPriceConfigFailed] = useState(false);

  useEffect(() => {
    if (!selectedCurrency?.symbol) return;
    let cancelled = false;
    setPriceConfigFailed(false);
    const chain = chainId === 8453 ? base : baseSepolia;
    const pc = createPublicClient({ chain, transport: http(rpcUrl) });
    const currencyHex = stringToHex(selectedCurrency.symbol, { size: 32 });
    (async () => {
      try {
        const [price, threshold, fee] = await Promise.all([
          pc.readContract({ address: diamondAddress, abi: DIAMOND_ABI, functionName: "getPriceConfig", args: [currencyHex] }) as Promise<{ sellPrice: bigint }>,
          pc.readContract({ address: diamondAddress, abi: DIAMOND_ABI, functionName: "getSmallOrderThreshold", args: [currencyHex] }) as Promise<bigint>,
          pc.readContract({ address: diamondAddress, abi: DIAMOND_ABI, functionName: "getSmallOrderFixedFee", args: [currencyHex] }) as Promise<bigint>,
        ]);
        if (cancelled) return;
        setSellPrice(price.sellPrice);
        setSmallOrderThreshold(threshold);
        setSmallOrderFixedFee(fee);
      } catch {
        if (!cancelled) setPriceConfigFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCurrency?.symbol, diamondAddress, chainId, rpcUrl]);

  // Parse the amount input → 6-decimal bigint. Returns null on invalid input
  // (empty / NaN / negative); the "Sell" button disables on null.
  const parsedAmount = useMemo((): bigint | null => {
    const trimmed = amountInput.trim();
    if (!trimmed) return null;
    try {
      const n = parseUnits(trimmed, USDC_DECIMALS);
      if (n <= 0n) return null;
      return n;
    } catch {
      return null;
    }
  }, [amountInput]);

  // Read USDC balance for the "Max" affordance + insufficient-balance hint.
  // Uses the read-only ERC20 ABI fragment — no integrator dependency.
  useEffect(() => {
    const chain = chainId === 8453 ? base : baseSepolia;
    const pc = createPublicClient({ chain, transport: http(rpcUrl) });
    pc.readContract({
      address: usdcAddress, abi: ERC20_READ_ABI,
      functionName: "balanceOf", args: [signer.address],
    }).then((b) => setBalance(b as bigint)).catch(() => {});
  }, [chainId, rpcUrl, usdcAddress, signer.address]);

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

  const { state, submit, retryDeliver, canRetry, reset } = useOfframpMachine({
    usdcAddress, diamondAddress, signer,
    chainId, rpcUrl, subgraphUrl, fiatAmountLimit,
    placeOfframp, deliverUpi, reconcile,
    onOrderPlaced, onComplete, onCancelled, onError,
  });

  const usdcDisplay = state.usdcAmount
    ? formatUnits(state.usdcAmount, USDC_DECIMALS)
    : parsedAmount
      ? formatUnits(parsedAmount, USDC_DECIMALS)
      : null;
  const fiatDisplay = state.fiatAmount ? (Number(state.fiatAmount) / 1e6).toFixed(2) : null;
  // Trim USDC balance to 2 decimals for the affordance text — `formatUnits`
  // produces 6-dec strings which are visually noisy here. The Max button
  // still sets the full-precision value into the input.
  const balanceDisplay = balance !== null
    ? (Number(balance) / 10 ** USDC_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;
  const insufficientBalance = parsedAmount !== null && balance !== null && parsedAmount > balance;

  // Pre-order fiat preview. Mirror the P2POfframp logic — fee deducted from
  // the fiat the user receives.
  const thresholdLabel = smallOrderThreshold !== null
    ? `${Number(smallOrderThreshold) / 1e6} USDC`
    : "10 USDC";
  const preview = (() => {
    if (!parsedAmount || !sellPrice) return null;
    const subtotalFiat = (parsedAmount * sellPrice) / 1_000_000n;
    const feeUsdc =
      smallOrderThreshold !== null && smallOrderFixedFee !== null &&
      parsedAmount <= smallOrderThreshold ? smallOrderFixedFee : 0n;
    const feeFiat = (feeUsdc * sellPrice) / 1_000_000n;
    const netFiat = subtotalFiat > feeFiat ? subtotalFiat - feeFiat : subtotalFiat;
    return {
      subtotal: (Number(subtotalFiat) / 1e6).toFixed(2),
      fee: feeFiat > 0n ? (Number(feeFiat) / 1e6).toFixed(2) : null,
      net: (Number(netFiat) / 1e6).toFixed(2),
      symbol: selectedCurrency.symbol,
    };
  })();
  const isQuotePending = Boolean(parsedAmount && !sellPrice && !priceConfigFailed);

  const canSubmit = paymentValid && parsedAmount !== null && !insufficientBalance && !isQuotePending;

  const stepIndex =
    state.phase === "completed" ? 3 :
    state.phase === "paid" ? 2 :
    state.phase === "accepted" || state.phase === "encrypting" ? 1 :
    0;

  const showTracking =
    ["placed", "accepted", "encrypting", "paid", "completed", "cancelled"].includes(state.phase) ||
    (state.phase === "error" && state.orderId !== null);

  const content = (
    <div style={{ ...themeStyle, fontFamily: "var(--p2p-font, inherit)", color: color.text }}>
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
          <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>P2P Withdraw</span>
        </div>
        {mode === "modal" && onClose && (
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: radius.sm, border: "none",
            background: "transparent", cursor: "pointer", fontSize: 18, color: color.textMuted,
          }}>×</button>
        )}
      </div>

      <div style={{ padding: "24px" }}>

        {/* ─── PRE-ORDER FORM ─────────────────────────────────────── */}
        {state.phase === "form" && (
          <div>
            <p style={S.label}>Amount to withdraw</p>
            <div style={{ position: "relative", marginTop: 6 }}>
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "12px 60px 12px 14px", height: 52,
                  border: `1px solid ${color.border}`, borderRadius: radius.md,
                  background: color.surface, color: color.text,
                  fontSize: font.xxl, fontWeight: weight.semibold, fontVariantNumeric: "tabular-nums",
                  outline: "none",
                }}
                autoFocus
              />
              <span style={{
                position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                color: color.textMuted, fontSize: font.sm, fontWeight: weight.semibold,
                letterSpacing: "0.04em",
              }}>USDC</span>
            </div>
            <div style={{ ...S.rowBetween, marginTop: 6 }}>
              <span style={{ ...S.faint }}>
                {balanceDisplay !== null
                  ? `Balance: ${balanceDisplay} USDC`
                  : "Loading balance…"}
              </span>
              {balance !== null && balance > 0n && (
                <button
                  type="button"
                  onClick={() => setAmountInput(formatUnits(balance, USDC_DECIMALS))}
                  style={{
                    border: "none", background: "transparent", color: color.accent,
                    fontSize: font.sm, fontWeight: weight.semibold, cursor: "pointer", padding: 0,
                  }}
                >Max</button>
              )}
            </div>
            {insufficientBalance && (
              <p style={{ color: color.danger, fontSize: font.sm, marginTop: 4, marginBottom: 0 }}>
                Insufficient USDC balance.
              </p>
            )}

            {/* Currency picker */}
            {currencies.length > 0 && (
              <div style={{ marginTop: 20, marginBottom: 16 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>Receive in</p>
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((o) => !o)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 10, padding: "12px 14px", borderRadius: radius.md,
                      border: `1px solid ${color.border}`, background: color.surface,
                      color: color.text, fontSize: font.base, fontWeight: weight.medium, cursor: "pointer",
                    }}
                  >
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
                              width: "100%", boxSizing: "border-box",
                              display: "flex", alignItems: "center", justifyContent: "space-between",
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
                      <span style={S.label}>Transaction Fee</span>
                      <span style={{ ...S.body, ...S.num, color: color.textMuted }}>− {preview.symbol} {preview.fee}</span>
                    </div>
                    <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                      Waived on orders above {thresholdLabel}.
                    </p>
                  </>
                )}
                <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                  <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>You receive</span>
                  <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                    {preview.symbol} {preview.net}
                  </span>
                </div>
              </div>
            )}

            <PaymentAddressInput
              currency={selectedCurrency}
              value={paymentAddress}
              onChange={setPaymentAddress}
              onValidityChange={setPaymentValid}
            />

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submit(selectedCurrency, paymentAddress.trim(), parsedAmount!)}
              style={{
                ...S.primaryBtn,
                marginTop: 20,
                opacity: canSubmit ? 1 : 0.5,
                cursor: canSubmit ? "pointer" : isQuotePending ? "wait" : "not-allowed",
              }}
            >
              {isQuotePending ? (
                <>
                  <Spinner size={14} />
                  Loading quote…
                </>
              ) : preview ? (
                `Withdraw ${preview.symbol} ${preview.net}`
              ) : (
                "Withdraw"
              )}
            </button>
          </div>
        )}

        {/* ─── PRE-ORDER PROGRESS ─────────────────────────────────── */}
        {state.phase === "placing" && (
          <div style={{ ...S.card, padding: "32px" }}>
            <CenterStatus
              icon={<Spinner />}
              title="Submitting withdrawal…"
              subtitle="Resolving the merchant circle, approving USDC, and placing the SELL on-chain. Confirm any wallet prompts that pop up."
            />
          </div>
        )}

        {/* ─── ORDER TRACKING ─────────────────────────────────────── */}
        {showTracking && (
          <div>
            <Stepper stepIndex={stepIndex} />
            <div style={{ ...S.card, padding: "32px", marginTop: 16 }}>

              {state.phase === "placed" && (
                <CenterStatus
                  icon={<PulseDot />}
                  title="Finding a merchant"
                  subtitle={`Order #${state.orderId}: A P2P merchant will be assigned to receive the USDC and pay you in your local currency. This is a manual swap process and may take 2–3 minutes to complete. We appreciate your patience.`}
                />
              )}

              {(state.phase === "accepted" || state.phase === "encrypting") && (
                <div>
                  <CenterStatus
                    icon={<Spinner />}
                    title="Sending payment details"
                    subtitle="Encrypting your address with the merchant's key."
                  />
                  <div style={{ ...S.cardFlat, padding: 14, marginTop: 16, background: color.surfaceAlt }}>
                    <div style={S.rowBetween}>
                      <span style={S.label}>Order</span>
                      <span style={{ ...S.mono, fontSize: font.sm }}>#{state.orderId}</span>
                    </div>
                    <div style={S.rowBetween}>
                      <span style={S.label}>Amount</span>
                      <span style={{ ...S.mono, fontSize: font.sm }}>{usdcDisplay} USDC</span>
                    </div>
                    <div style={S.rowBetween}>
                      <span style={S.label}>Receive to</span>
                      <span style={{ ...S.mono, fontSize: font.sm }}>{state.paymentAddress}</span>
                    </div>
                  </div>
                </div>
              )}

              {state.phase === "paid" && (
                <CenterStatus
                  icon={<Spinner />}
                  title="Merchant is paying you"
                  subtitle={
                    fiatDisplay && state.currency
                      ? `Watch for ${state.currency.symbol} ${fiatDisplay} arriving via ${state.currency.paymentMethod}.`
                      : "Watch for the fiat to arrive in your account."
                  }
                />
              )}

              {state.phase === "completed" && (
                <div style={{ textAlign: "center" }}>
                  <SuccessIcon />
                  <h1 style={{ ...S.h1, fontSize: font.xxl, marginTop: 8 }}>Withdrawn!</h1>
                  {fiatDisplay && state.currency && (
                    <p style={{ ...S.muted, marginTop: 8 }}>
                      You received <strong>{state.currency.symbol} {fiatDisplay}</strong> for{" "}
                      <strong>{usdcDisplay} USDC</strong>.
                    </p>
                  )}
                  <div style={{ ...S.cardFlat, padding: 14, marginTop: 18, background: color.surfaceAlt, textAlign: "left" as const }}>
                    <div style={S.rowBetween}>
                      <span style={S.label}>Order</span>
                      <span style={{ ...S.mono, fontSize: font.sm }}>#{state.orderId}</span>
                    </div>
                    <div style={S.rowBetween}>
                      <span style={S.label}>Paid to</span>
                      <span style={{ ...S.mono, fontSize: font.sm }}>{state.paymentAddress}</span>
                    </div>
                  </div>
                  {onClose && (
                    <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={onClose}>Done</button>
                  )}
                </div>
              )}

              {state.phase === "cancelled" && (
                <div>
                  <CenterStatus
                    icon={<XIcon />}
                    title="Order cancelled"
                    subtitle="Your USDC was refunded to your wallet automatically. You can try again any time."
                    variant="warning"
                  />
                  {onClose && (
                    <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={onClose}>Close</button>
                  )}
                </div>
              )}

              {state.phase === "error" && state.orderId && (
                <div>
                  <CenterStatus
                    icon={<XIcon />}
                    title="Couldn't deliver payment details"
                    subtitle={state.error ?? "Unknown error"}
                    variant="danger"
                  />
                  <div style={{ ...S.cardFlat, padding: 12, marginTop: 16, fontSize: font.md, color: color.textMuted, background: color.surfaceAlt }}>
                    Your offramp order is still active on-chain (#{state.orderId}).
                    The merchant accepted; we couldn't deliver your encrypted payment
                    address. Retrying re-runs encryption + delivery against the same order.
                  </div>
                  {canRetry && (
                    <button style={{ ...S.primaryBtn, marginTop: 16 }} onClick={() => retryDeliver()}>
                      Retry delivery
                    </button>
                  )}
                  {onClose && (
                    <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={onClose}>
                      Close
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pre-order error — no orderId yet, so the order never placed. */}
        {state.phase === "error" && !state.orderId && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ color: color.danger, marginBottom: 16, display: "flex", justifyContent: "center" }}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 style={{ ...S.h2, fontSize: font.xl, marginBottom: 8 }}>Couldn't place withdrawal</h2>
            <p style={{ ...S.muted, lineHeight: 1.5, maxWidth: 380, margin: "0 auto 20px" }}>
              {state.error}
            </p>
            <button style={S.primaryBtn} onClick={reset}>
              Back to form
            </button>
            {onClose && (
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={onClose}>
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (mode === "modal") return <Modal open={open} onClose={onClose}>{content}</Modal>;
  return <div style={{ ...S.card, overflow: "hidden" }}>{content}</div>;
}
