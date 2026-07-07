import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, formatUnits, parseUnits, stringToHex } from "viem";
import { baseSepolia, base } from "viem/chains";
import type { CashoutProps, CurrencyOption } from "../types";
import { useOfframpMachine } from "../core/offramp-machine";
import { resolveSellAmount, usdcToFiat } from "../core/price-math";
import { color, radius, font, weight, shadow, S, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import {
  Spinner,
  PulseDot,
  CenterStatus,
  SuccessIcon,
  XIcon,
  Stepper,
  Skeleton,
  injectKeyframes,
} from "../ui/components";
import { PaymentAddressInput } from "../ui/PaymentAddressInput";
import { CurrencyRow } from "../ui/CurrencyRow";
import { ERC20_READ_ABI, DIAMOND_ABI, readSmallOrderFixedFee } from "../core/contracts";
import { resolveCurrencyMeta } from "../core/currency-meta";

const USDC_DECIMALS = 6;

/**
 * Cashout — convert USDC the user holds on Base into local fiat. The widget
 * orchestrates the Diamond-level lifecycle (auto-route circleId, poll
 * status, encrypt the user's payment address, drive UI). Integrator-specific
 * work — USDC approve, the place-cashout tx, the deliver-payment tx,
 * optional `reconcile` — flows through the host callbacks (`placeCashout`,
 * `deliverUpi`, `reconcile`). The widget itself never imports an integrator
 * ABI. See README §"Cashout callback contract" for the host-side recipe.
 *
 * Internal naming: the protocol-level concept is "offramp" (the on-chain
 * SELL order). The widget surface uses the friendlier "cashout" term, but
 * internal modules — `useOfframpMachine`, `offramp-machine.ts` — keep the
 * protocol term to stay accurate to what the Diamond does.
 */
export function Cashout(props: CashoutProps) {
  const {
    usdcAddress, diamondAddress, signer, currencies,
    chainId = 84532, rpcUrl, subgraphUrl, fiatAmountLimit,
    placeCashout, deliverUpi, reconcile, fetchAvailableOfframp,
    defaultAmountUsdc, fiatPayoutAmount, mode = "modal", open = true, theme,
    onClose, onOrderPlaced, onComplete, onCancelled, onError,
  } = props;
  const themeStyle = themeToCssVars(theme);

  useEffect(injectKeyframes, []);

  // Fiat-denominated withdrawal: the integrator fixes the fiat the user
  // receives; we derive the USDC principal to sell from the on-chain sellPrice.
  // Hides the amount input. `fiatPayoutAmount` wins over `defaultAmountUsdc`.
  const fiatMode = fiatPayoutAmount !== undefined;
  useEffect(() => {
    if (fiatPayoutAmount !== undefined && defaultAmountUsdc !== undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        "[p2p-widget] <Cashout> received both `fiatPayoutAmount` and `defaultAmountUsdc` — using `fiatPayoutAmount`.",
      );
    }
  }, [fiatPayoutAmount, defaultAmountUsdc]);

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
  // small-order fee config (USDC-denominated). Matches the user-app-client
  // model: the user receives `principal × sellPrice` in fiat (the Diamond
  // does NOT deduct the fee from `actualFiatAmount` for SELL), and is
  // charged `principal + fee` in USDC (the Diamond pulls `actualUsdtAmount
  // = amount + fee` at setSellOrderUpi). We track the currency that the
  // quote actually came from in `priceCurrency` so the breakdown can show
  // skeletons during a switch instead of flashing the previous currency's
  // pricing.
  const [sellPrice, setSellPrice] = useState<bigint | null>(null);
  const [smallOrderThreshold, setSmallOrderThreshold] = useState<bigint | null>(null);
  const [smallOrderFixedFee, setSmallOrderFixedFee] = useState<bigint | null>(null);
  const [priceCurrency, setPriceCurrency] = useState<string | null>(null);
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
          // SELL keeps the full configured fee on V22; the typed read
          // falls back to the deprecated unified selector for pre-V22
          // Diamonds. See `readSmallOrderFixedFee`.
          readSmallOrderFixedFee(pc, diamondAddress, currencyHex, "sell"),
        ]);
        if (cancelled) return;
        setSellPrice(price.sellPrice);
        setSmallOrderThreshold(threshold);
        setSmallOrderFixedFee(fee);
        setPriceCurrency(selectedCurrency.symbol);
      } catch {
        if (!cancelled) setPriceConfigFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCurrency?.symbol, diamondAddress, chainId, rpcUrl]);

  // Fiat mode: resolve the target payout → USDC principal + fee (pure, tested).
  // "none" in plain USDC-input mode. Gated so a just-switched currency's stale
  // rate can't misconvert (priceReadyForCurrency).
  const sell = useMemo(
    () =>
      resolveSellAmount({
        fiatPayoutAmount,
        sellPrice,
        priceReadyForCurrency: priceCurrency === selectedCurrency.symbol && sellPrice !== null,
        priceConfigFailed,
        threshold: smallOrderThreshold,
        fixedFee: smallOrderFixedFee,
      }),
    [fiatPayoutAmount, sellPrice, priceCurrency, selectedCurrency.symbol, priceConfigFailed, smallOrderThreshold, smallOrderFixedFee],
  );

  // The USDC principal to sell. In fiat mode it's the resolved principal (null
  // until the rate lands / when blocked). Otherwise it's parsed from the amount
  // input (null on empty / NaN / negative). The "Withdraw" button disables on null.
  const parsedAmount = useMemo((): bigint | null => {
    if (fiatMode) return sell.status === "ready" ? sell.principal : null;
    const trimmed = amountInput.trim();
    if (!trimmed) return null;
    try {
      const n = parseUnits(trimmed, USDC_DECIMALS);
      if (n <= 0n) return null;
      return n;
    } catch {
      return null;
    }
  }, [fiatMode, sell, amountInput]);

  // Source the cashout-able amount for the "Max" affordance + insufficient
  // hint. Default: the user's on-chain USDC balance (read-only ERC20 ABI, no
  // integrator dependency). Allocation-funded offramps (e.g. TradeStars) pass
  // `fetchAvailableOfframp` so the amount comes from the user's per-user-proxy
  // allocation instead of their wallet balance.
  useEffect(() => {
    let cancelled = false;
    if (fetchAvailableOfframp) {
      fetchAvailableOfframp(signer.address)
        .then((b) => { if (!cancelled) setBalance(b); })
        .catch(() => {});
      return () => { cancelled = true; };
    }
    const chain = chainId === 8453 ? base : baseSepolia;
    const pc = createPublicClient({ chain, transport: http(rpcUrl) });
    pc.readContract({
      address: usdcAddress, abi: ERC20_READ_ABI,
      functionName: "balanceOf", args: [signer.address],
    }).then((b) => { if (!cancelled) setBalance(b as bigint); }).catch(() => {});
    return () => { cancelled = true; };
  }, [chainId, rpcUrl, usdcAddress, signer.address, fetchAvailableOfframp]);

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

  const { state, submit, retryDeliver, canRetry, retryPlace, canRetryPlace, reset } = useOfframpMachine({
    usdcAddress, diamondAddress, signer,
    chainId, rpcUrl, subgraphUrl, fiatAmountLimit,
    placeCashout, deliverUpi, reconcile,
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

  // Small-order fee applies when principal is at or below the threshold.
  // Same rule as `libOrderProcessorFacet.isOrderSmall` on chain. The fee
  // is in USDC (6-dec). When the quote hasn't loaded yet (initial render
  // or mid-currency-switch), we conservatively treat fee as 0 — the
  // balance check would re-tighten once the real fee is in.
  const feeUsdc = (() => {
    if (fiatMode) return sell.status === "ready" ? sell.feeUsdc : 0n;
    if (parsedAmount === null || smallOrderThreshold === null || smallOrderFixedFee === null) return 0n;
    return parsedAmount <= smallOrderThreshold ? smallOrderFixedFee : 0n;
  })();
  const totalCharge = parsedAmount !== null ? parsedAmount + feeUsdc : null;
  // Validation: balance must cover principal + fee. Same predicate
  // user-app-client uses (`sell/index.tsx` line 70-78).
  const insufficientBalance = totalCharge !== null && balance !== null && totalCharge > balance;

  // Pre-order preview. The fiat side is unchanged (`principal × sellPrice`)
  // — Diamond never deducts the fee from `actualFiatAmount` on SELL. The
  // USDC side surfaces the fee as a separate line so the user knows their
  // wallet is debited `principal + fee`, matching the on-chain charge.
  const thresholdLabel = smallOrderThreshold !== null
    ? `${Number(smallOrderThreshold) / 1e6} USDC`
    : "10 USDC";
  const preview = (() => {
    if (!parsedAmount || !sellPrice) return null;
    const subtotalFiat = usdcToFiat(parsedAmount, sellPrice);
    return {
      receive: (Number(subtotalFiat) / 1e6).toFixed(2),
      fee: feeUsdc > 0n ? formatUnits(feeUsdc, USDC_DECIMALS) : null,
      totalCharge: (Number((totalCharge ?? 0n)) / 10 ** USDC_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 6 }),
      principal: formatUnits(parsedAmount, USDC_DECIMALS),
      symbol: selectedCurrency.symbol,
    };
  })();
  // Rate still loading for the selected currency (initial load OR mid-switch).
  const ratePending = !priceConfigFailed && (!sellPrice || priceCurrency !== selectedCurrency.symbol);
  // Pending gates the Withdraw button + drives the breakdown skeleton. Fiat mode
  // uses the resolver's status (the principal depends on the rate); USDC-input
  // mode holds while the quote for the entered amount loads.
  const isQuotePending = Boolean(fiatMode ? sell.status === "pending" : (parsedAmount && ratePending));
  // Fiat mode couldn't price the payout: rate read failed, or the payout is
  // dust / fee-dominated (fee ≥ principal).
  const fiatRateUnavailable = fiatMode && sell.status === "unavailable";
  const fiatTooSmall = fiatMode && sell.status === "too-small";

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
            {fiatMode ? (
              // Fiat-denominated: the payout is integrator-fixed — show it as
              // the headline, no editable amount input.
              <div style={{ marginBottom: 2 }}>
                <p style={{ ...S.label, marginBottom: 2 }}>You'll receive</p>
                <h1 style={{ ...S.h1, fontSize: font.display, ...S.num, margin: 0 }}>
                  {selectedCurrency.symbol} {(Number(fiatPayoutAmount) / 1e6).toFixed(2)}
                </h1>
              </div>
            ) : (
              <>
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
              </>
            )}
            <div style={{ ...S.rowBetween, marginTop: 6 }}>
              <span style={{ ...S.faint }}>
                {balanceDisplay !== null
                  ? `Balance: ${balanceDisplay} USDC`
                  : "Loading balance…"}
              </span>
              {!fiatMode && balance !== null && balance > 0n && (
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
                      gap: 10, padding: "10px 14px", borderRadius: radius.md,
                      border: `1px solid ${color.border}`, background: color.surface,
                      color: color.text, cursor: "pointer",
                    }}
                  >
                    <CurrencyRow meta={resolveCurrencyMeta(selectedCurrency)} />
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
            )}

            {/* On-chain SELL: fiat side gets the full `principal × sellPrice`
                (Diamond does NOT deduct from actualFiatAmount). USDC side
                gets `principal + fee` pulled at setSellOrderUpi. So this
                card shows what the user receives + how much their wallet
                is debited, both lines stable across the currency-switch
                skeleton transition. */}
            {(isQuotePending || preview) && (
              <div style={{ marginBottom: 16, padding: "14px 16px", background: color.surfaceAlt, borderRadius: radius.md, border: `1px solid ${color.border}` }}>
                {/* In fiat mode the payout is the headline above, so the card
                    leads with the USDC side (what the wallet is debited). */}
                {!fiatMode && (
                  <div style={S.rowBetween}>
                    <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>You receive</span>
                    {isQuotePending
                      ? <Skeleton width={110} height={16} />
                      : <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>{preview!.symbol} {preview!.receive}</span>}
                  </div>
                )}
                <div style={{ ...S.rowBetween, marginTop: fiatMode ? 0 : 8 }}>
                  <span style={S.label}>{fiatMode ? "You sell" : "For"}</span>
                  {isQuotePending
                    ? <Skeleton width={70} />
                    : <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{preview!.principal} USDC</span>}
                </div>
                {!isQuotePending && preview!.fee && (
                  <>
                    <div style={{ ...S.rowBetween, marginTop: 8 }}>
                      <span style={S.label}>Service fee</span>
                      <span style={{ ...S.body, ...S.num, color: color.textMuted }}>+ {preview!.fee} USDC</span>
                    </div>
                    <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                      Waived on orders above {thresholdLabel}.
                    </p>
                  </>
                )}
                {!isQuotePending && preview!.fee && (
                  <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                    <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>Total charged</span>
                    <span style={{ ...S.body, fontWeight: weight.semibold, ...S.num }}>{preview!.totalCharge} USDC</span>
                  </div>
                )}
              </div>
            )}

            <PaymentAddressInput
              currency={selectedCurrency}
              value={paymentAddress}
              onChange={setPaymentAddress}
              onValidityChange={setPaymentValid}
            />

            {/* Fiat-mode couldn't price the payout — rate read failed, or the
                target is below one micro-USDC of sell value. */}
            {(fiatRateUnavailable || fiatTooSmall) && (
              <div style={{ marginTop: 12, padding: "12px 14px", background: color.dangerSoft, border: `1px solid ${color.danger}22`, borderRadius: radius.md }}>
                <span style={{ color: color.danger, fontSize: font.md, lineHeight: 1.5 }}>
                  {fiatTooSmall
                    ? "This payout is too small to withdraw. Please use a larger amount."
                    : "Couldn't load the exchange rate for this payout. Please try again."}
                </span>
              </div>
            )}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submit(selectedCurrency, paymentAddress.trim(), parsedAmount!, feeUsdc)}
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
              ) : fiatTooSmall ? (
                "Payout too small"
              ) : fiatRateUnavailable ? (
                "Rate unavailable"
              ) : preview ? (
                `Withdraw ${preview.symbol} ${preview.receive}`
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
              subtitle="Setting up your withdrawal. Confirm any wallet prompts that pop up."
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
                  title="Matching your order"
                  subtitle={`Order #${state.orderId}: We're matching your ${usdcDisplay ?? ""} USDC withdrawal with someone who will pay${state.currency ? ` ${state.currency.symbol}` : ""} into your ${state.currency?.paymentMethod ?? "account"}. This typically takes 2-3 minutes.`}
                />
              )}

              {(state.phase === "accepted" || state.phase === "encrypting") && (
                <div>
                  <CenterStatus
                    icon={<Spinner />}
                    title="Sending payment details"
                    subtitle="Securely sharing your payout details."
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
                  title="Payment in progress"
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
                    subtitle="The order was cancelled and your funds were returned. You can try again any time."
                    variant="warning"
                  />
                  {canRetryPlace && (
                    <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={() => retryPlace()}>
                      Try again
                    </button>
                  )}
                  {onClose && (
                    <button
                      style={canRetryPlace
                        ? { ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }
                        : { ...S.primaryBtn, marginTop: 20 }}
                      onClick={onClose}
                    >Close</button>
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

  if (mode === "modal") return <Modal open={open} onClose={onClose} themeStyle={themeStyle}>{content}</Modal>;
  return <div style={{ ...S.card, overflow: "hidden" }}>{content}</div>;
}
