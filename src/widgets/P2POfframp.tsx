import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, formatUnits } from "viem";
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
import { MARKETPLACE_CLIENT_ABI } from "../core/contracts";

const USDC_DECIMALS = 6;

export function P2POfframp(props: P2POfframpProps) {
  const {
    integratorAddress, marketplaceAddress, tokenId, signer, currencies,
    diamondAddress, usdcAddress, chainId = 84532, rpcUrl,
    fiatAmountLimit, mode = "modal", open = true,
    theme,
    onClose, onOrderPlaced, onComplete, onCancelled, onError,
  } = props;
  const themeStyle = themeToCssVars(theme);

  useEffect(injectKeyframes, []);

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyOption>(currencies[0]);
  const [paymentAddress, setPaymentAddress] = useState("");
  const [paymentValid, setPaymentValid] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [tokenPrice, setTokenPrice] = useState<bigint | null>(null);
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);

  // Read the original token price upfront so the form shows "you'll receive X USDC".
  useEffect(() => {
    const chain = chainId === 8453 ? base : baseSepolia;
    const pc = createPublicClient({ chain, transport: http(rpcUrl) });
    pc.readContract({
      address: marketplaceAddress, abi: MARKETPLACE_CLIENT_ABI as any,
      functionName: "tokenPrice", args: [tokenId],
    }).then((p) => setTokenPrice(p as bigint)).catch(() => {});
  }, [chainId, rpcUrl, marketplaceAddress, tokenId]);

  // Close dropdown on outside click.
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

  const { state, placeSell, retryDeliver, canRetry } = useOfframpMachine({
    integratorAddress, marketplaceAddress, tokenId, signer,
    diamondAddress, usdcAddress, chainId, rpcUrl, fiatAmountLimit,
    onOrderPlaced, onComplete, onCancelled, onError,
  });

  const usdcDisplay = state.usdcAmount
    ? formatUnits(state.usdcAmount, USDC_DECIMALS)
    : tokenPrice
      ? formatUnits(tokenPrice, USDC_DECIMALS)
      : null;
  const fiatDisplay = state.fiatAmount ? (Number(state.fiatAmount) / 1e6).toFixed(2) : null;

  // Stepper indices: 0 placed, 1 accepted/encrypting, 2 paid, 3 completed.
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
      {/* Header — mirrors P2PCheckout */}
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
          <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>P2P Sell-back</span>
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
            <p style={S.label}>You'll receive</p>
            <h1 style={{ ...S.h1, marginTop: 4, fontSize: font.display }}>
              <span style={S.num}>{usdcDisplay ?? "—"}</span>
              <span style={{ ...S.muted, marginLeft: 8, fontSize: font.lg, fontWeight: weight.medium }}>USDC</span>
            </h1>
            <p style={{ ...S.muted, marginTop: 6 }}>
              Token #{tokenId.toString()} from this marketplace.{" "}
              {tokenPrice ? "We'll burn it and place a sell order at its original price." : ""}
            </p>

            <div style={S.divider} />

            {/* Currency picker — same shape as P2PCheckout's */}
            {currencies.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>Receive in</p>
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((o) => !o)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
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

            {/* Payment-address input — currency-aware validation */}
            <PaymentAddressInput
              currency={selectedCurrency}
              value={paymentAddress}
              onChange={setPaymentAddress}
              onValidityChange={setPaymentValid}
              autoFocus
            />

            <button
              type="button"
              disabled={!paymentValid}
              onClick={() => placeSell(selectedCurrency, paymentAddress.trim())}
              style={{
                ...S.primaryBtn,
                marginTop: 20,
                opacity: paymentValid ? 1 : 0.5,
                cursor: paymentValid ? "pointer" : "not-allowed",
              }}
            >
              Sell back
            </button>
          </div>
        )}

        {/* ─── PRE-ORDER PROGRESS (sweeping/placing) ──────────────── */}
        {(state.phase === "sweeping" || state.phase === "placing") && (
          <div style={{ ...S.card, padding: "32px" }}>
            <CenterStatus
              icon={<Spinner />}
              title={state.phase === "sweeping" ? "Recovering NFT…" : "Placing sell order…"}
              subtitle={
                state.phase === "sweeping"
                  ? "Moving from your proxy to your wallet first."
                  : "Burning the NFT and submitting the sell order on-chain."
              }
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
                  subtitle={`Order #${state.orderId}. A merchant will accept shortly.`}
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
                  <h1 style={{ ...S.h1, fontSize: font.xxl, marginTop: 8 }}>Sold!</h1>
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
                    subtitle="USDC stays in the integrator's pool. The NFT was burned — contact support if you need a replacement."
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
                    Your sell order is still active on-chain (#{state.orderId}).
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

        {/* Pre-order error (no orderId yet — placement itself failed) */}
        {state.phase === "error" && !state.orderId && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ color: color.danger, marginBottom: 16 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 style={S.h2}>{state.error}</h2>
            <button style={{ ...S.primaryBtn, marginTop: 20 }}
              onClick={() => placeSell(selectedCurrency, paymentAddress.trim())}
              disabled={!paymentValid}>
              Try again
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
