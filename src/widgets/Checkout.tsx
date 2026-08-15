import React, { useState, useEffect } from "react";
import { formatUnits } from "viem";
import type { CheckoutProps } from "../types";
import { useOrderMachine } from "../core/order-machine";
import { usdcToFiat } from "../core/price-math";
import { resolveCurrencyMeta } from "../core/currency-meta";
import { buildStaticPixPayload, normalizePixKey, detectPixKeyType } from "../core/pix-brcode";
import { CurrencyRow } from "../ui/CurrencyRow";
import { DEFAULT_DIAMOND_ADDRESS, USDC_DECIMALS } from "../core/contracts";
import { color, radius, font, weight, shadow, S, themeToCssVars } from "../ui/theme";
import { Modal } from "../ui/Modal";
import {
  Spinner, PulseDot, CenterStatus, SuccessIcon, XIcon,
  CopyRow, Stepper, CountdownRing, Skeleton, injectKeyframes,
  StepHeader, useCountdown, formatCountdown, P2PMark,
} from "../ui/components";
import { I18nBoundary, useT, useI18n, translateError } from "../i18n";
import type { Translator } from "../i18n";
import { P2PError } from "../core/errors";

// Window the user has to pay after a merchant accepts before auto-cancellation.
// Mirrors user-app's 5-minute window.
const AUTO_CANCEL_WINDOW_MS = 5 * 60 * 1000;

// How long the user has to be away from the tab before we treat the return as
// "came back from their banking app" and escalate the confirm CTA. Paying
// takes tens of seconds at minimum, so a short hop out (clicking devtools, an
// alt-tab misfire) shouldn't trigger the nudge.
const AWAY_MIN_MS = 2500;

// Non-INR rails can't produce a scannable "pay" QR from a bare payout id, so
// the accepted-phase QR instead links to this static page with the id in the
// URL fragment. The payer scans it on a second device (phone) and taps once to
// copy the id into their banking app — replacing a Telegram hand-off / manual
// typing. Source: github.com/p2pdotme/p2p-copy (Netlify site p2p-copy, served
// on the custom domain below).
const COPY_PAGE_URL = "https://copy.p2p.cool";

function displayError(err: unknown, t: Translator): string | null {
  if (err == null) return null;
  if (err instanceof P2PError) return translateError(err, t);
  if (typeof err === "string") return err;
  return null;
}

// Builds a spec-correct Pix BR Code payload for the decrypted PIX key so the
// accepted-phase QR is scan-to-pay in any bank/Pix app — not just a "scan to
// copy" fallback. Key type isn't collected separately from the merchant, so
// it's detected from the key's shape (same detection the BRL validator uses)
// before normalizing. Returns null if the key fails to normalize (shouldn't
// happen for a key that already passed the BRL validator, but the accepted
// key came from a merchant elsewhere in the system, not this session's own
// input) so the caller can fall back to the copy-page QR instead of throwing.
//
// This protocol has no merchant-profile system — a "merchant" is just a
// wallet address holding a Pix key, with no registered display name or
// city anywhere in the SDK. Tags 59/60 are mandatory non-empty fields per
// spec (an empty value can make some bank apps' parsers reject the QR
// outright), so we fall back to the host's `productName` for tag 59 (the
// only payer-facing label this widget already has) and a neutral "BRASIL"
// for tag 60 rather than inventing a brand identity. Hosts that
// want their real registered legal name/city shown should pass
// `pixMerchantName`/`pixMerchantCity` explicitly.
//
// `amount`, when provided, is embedded so the payer's bank app can
// auto-fill the exact fiat total instead of requiring manual entry.
function buildBrlQrPayload(
  pixKey: string,
  orderId: string | null,
  amount: string | null,
  merchantName?: string,
  merchantCity?: string,
  fallbackName?: string,
): string | null {
  try {
    const keyType = detectPixKeyType(pixKey);
    const normalized = normalizePixKey(pixKey, keyType);
    return buildStaticPixPayload({
      pixKey: normalized,
      merchantName: merchantName ?? fallbackName ?? "PIX",
      merchantCity: merchantCity ?? "BRASIL",
      txid: orderId ?? undefined,
      amount: amount !== null ? Number(amount) : undefined,
    });
  } catch {
    return null;
  }
}

export function Checkout(props: CheckoutProps) {
  return (
    <I18nBoundary locale={props.locale}>
      <CheckoutInner {...props} />
    </I18nBoundary>
  );
}

function CheckoutInner(props: CheckoutProps) {
  const {
    orderId: initialOrderId, placeOrder,
    amount, productName, signer, paymentNotice,
    pixMerchantName, pixMerchantCity,
    chainId = 84532, diamondAddress = DEFAULT_DIAMOND_ADDRESS, rpcUrl,
    currency: demoCurrency,
    currencies,
    subgraphUrl, usdcAddress, usdcAmount, fiatAmount, fiatChargeAmount,
    screening,
    fetchCredit, fetchPendingOrders, onResumeRequest,
    liveness,
    mode = "modal", open = true, demo = false,
    theme,
    onClose, onOrderPlaced, onComplete, onError, onCancel,
  } = props;
  const themeStyle = themeToCssVars(theme);
  const t = useT();
  const { locale, localeTag } = useI18n();

  useEffect(injectKeyframes, []);

  const [copied, setCopied] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [timerExpired, setTimerExpired] = useState(false);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
  // The single biggest drop-off in the onramp is users who pay from their
  // banking app and never come back to tap "I've paid" — the order sits
  // unconfirmed until it auto-cancels. `paymentIntent` records that the user
  // has *started* paying (copied the payout id, opened their payment app, or
  // backgrounded the tab); `returnedFromPayment` records that they came back
  // afterwards, which is the exact moment to escalate the confirm CTA.
  const [paymentIntent, setPaymentIntent] = useState(false);
  const [returnedFromPayment, setReturnedFromPayment] = useState(false);
  // False whenever the in-flow confirm CTA is scrolled out of the modal's
  // scrollport — the only time the slim pinned bar is worth showing. Starts
  // true so the bar never flashes on mount before the observer reports.
  const [ctaOnScreen, setCtaOnScreen] = useState(true);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
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

  const {
    state, handlePlaceOrder, markPaid, cancelOrder, startLivenessVerification,
    resolvedUsdcAmount, amountStatus, gate,
  } = useOrderMachine({
    orderId: initialOrderId, placeOrder,
    signer, chainId, diamondAddress, rpcUrl, demo,
    demoCurrency, selectedCurrency,
    subgraphUrl, usdcAddress, usdcAmount, fiatAmount, fiatChargeAmount,
    screening,
    fetchCredit, fetchPendingOrders, liveness,
    onOrderPlaced, onComplete, onError, onCancel,
  });

  // Leaving the tab during the accepted phase means one thing in practice:
  // the user has gone to their bank / UPI / Pix app to send the money. Coming
  // back is when they need to be told they still owe us a confirmation, so
  // that's what arms the nudge. `visibilitychange` covers mobile app-switches
  // and tab-switches; window blur/focus covers desktop window-switches, which
  // don't hide the document.
  useEffect(() => {
    if (state.phase !== "accepted") return;
    let awayAt: number | null = null;
    const leave = () => {
      if (awayAt === null) awayAt = Date.now();
      setPaymentIntent(true);
    };
    const back = () => {
      if (awayAt === null) return;
      const away = Date.now() - awayAt;
      awayAt = null;
      if (away >= AWAY_MIN_MS) setReturnedFromPayment(true);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : back());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [state.phase]);

  // Watch whether the in-flow confirm CTA is inside the modal's scrollport.
  // The scroll container is the Modal's dialog element (`overflow: auto`), and
  // in inline mode there may be none — a null root falls back to the viewport,
  // which is the right answer there. Guarded for environments without
  // IntersectionObserver (jsdom, older browsers): the bar simply stays
  // collapsed and the in-flow CTA does all the work.
  useEffect(() => {
    if (state.phase !== "accepted" || timerExpired) { setCtaOnScreen(true); return; }
    const el = confirmRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    let root: HTMLElement | null = el.parentElement;
    while (root) {
      const overflowY = getComputedStyle(root).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      root = root.parentElement;
    }

    const io = new IntersectionObserver(
      ([entry]) => setCtaOnScreen(entry.isIntersecting),
      { root, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state.phase, timerExpired]);

  // Bring the confirm CTA into view on return — it sits below a 180px QR and
  // is otherwise off-screen on a phone.
  useEffect(() => {
    if (!returnedFromPayment) return;
    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    confirmRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [returnedFromPayment]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setPaymentIntent(true);
    setTimeout(() => setCopied(null), 1400);
  };

  const handleMarkPaid = async () => {
    setIsMarkingPaid(true);
    // Stop nagging the moment they act — if the write fails, the inline error
    // underneath carries the message instead.
    setReturnedFromPayment(false);
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
  // Same tick as the hero CountdownRing, reused as text under the CTA so the
  // deadline reads as a deadline *to confirm*, not just a deadline to pay.
  const acceptedRemaining = useCountdown(state.phase === "accepted" ? acceptedDeadline : null);

  // The slim pinned bar exists only to recover a CTA that has scrolled away.
  // Suppressed once the window closes, since `paidBuyOrder` reverts past it —
  // the expired panel in the flow below is what that user needs instead.
  const showConfirmBar = !ctaOnScreen && !timerExpired;

  const usdcDisplay = state.usdcAmount ? formatUnits(state.usdcAmount, USDC_DECIMALS) : null;
  const fiatDisplay = state.fiatAmount ? (Number(state.fiatAmount) / 1e6).toFixed(2) : null;
  // Per-currency UI metadata resolved against the SDK (symbol-native badge,
  // country name, payment-method label, address-field label, compound
  // fields for NGN/VEN). Host's CurrencyOption fields win when present.
  const acceptedMeta = state.currency
    ? resolveCurrencyMeta({ symbol: state.currency }, locale)
    : null;

  // Threshold display ("10 USDC", "12.5 USDC", etc.) — used in the fee-waiver
  // hint. Sourced from on-chain config so it tracks any protocol changes.
  const thresholdLabel = state.smallOrderThreshold !== null
    ? t("common.usdcSuffix", { amount: Number(state.smallOrderThreshold) / 1e6 })
    : t("common.usdcSuffix", { amount: 10 });

  // Protocol fee in fiat (and USDC), used in the "amount too small" message
  // when a fiat-mode total can't cover it. Null until the price config loads.
  const feeFiatLabel =
    state.smallOrderFixedFee !== null && state.buyPrice && selectedCurrency
      ? `${selectedCurrency.symbol} ${(Number(usdcToFiat(state.smallOrderFixedFee, state.buyPrice)) / 1e6).toFixed(2)}`
      : state.smallOrderFixedFee !== null
        ? `${formatUnits(state.smallOrderFixedFee, USDC_DECIMALS)} USDC`
        : null;

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
  // Effective order amount — the host's `usdcAmount`, or the value the widget
  // converted from `fiatChargeAmount`. All breakdown/gating math derives from
  // this so both input modes render identically.
  const orderUsdc = resolvedUsdcAmount;
  const chargedUsdc = (() => {
    if (!orderUsdc) return null;
    if (credit >= orderUsdc) return 0n;
    return orderUsdc - credit;
  })();
  const preview = (() => {
    if (!orderUsdc || !state.buyPrice || !selectedCurrency || chargedUsdc === null) return null;
    const chargedFiat = usdcToFiat(chargedUsdc, state.buyPrice);
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
    const feeFiat = usdcToFiat(feeUsdc, state.buyPrice);
    const totalFiat = chargedFiat + feeFiat;
    // Subtotal-without-credit: shown when credit > 0 to make the deduction
    // visible. Equals what the user would have paid pre-credit.
    const grossFiat = usdcToFiat(orderUsdc, state.buyPrice);
    const creditFiat = usdcToFiat(credit, state.buyPrice);
    return {
      subtotal: (Number(chargedFiat) / 1e6).toFixed(2),
      gross: (Number(grossFiat) / 1e6).toFixed(2),
      creditUsdc: credit > 0n ? (Number(credit) / 1e6).toFixed(2) : null,
      creditFiat: credit > 0n ? (Number(creditFiat) / 1e6).toFixed(2) : null,
      fee: feeFiat > 0n ? (Number(feeFiat) / 1e6).toFixed(2) : null,
      total: (Number(totalFiat) / 1e6).toFixed(2),
      symbol: selectedCurrency.symbol,
      creditCoversFully: credit >= orderUsdc,
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
  // Also holds while the credit/pending fetch is in flight (`gate ===
  // "loading"`). Without this, the user would briefly see the un-credited
  // price + Pay button — and could fire the order before the credit
  // adjustment renders. The derived gate resolves to allow/reject from the
  // current resolved amount as soon as the fetch returns (or is allow when the
  // host didn't wire either callback).
  // True when the host expressed a placement amount either way. In fiat mode
  // `usdcAmount` is absent but `fiatChargeAmount` drives the same flow.
  const hasAmountIntent = Boolean(usdcAmount || fiatChargeAmount);
  // Fiat all-in couldn't resolve to a placeable amount: the entered total
  // doesn't cover the fee ("too-small"), or the rate read failed
  // ("unavailable"). Surface a blocking message instead of the Pay button.
  const amountBlocked = amountStatus === "too-small" || amountStatus === "unavailable";
  const isQuotePending = Boolean(
    !demo && hasAmountIntent && selectedCurrency && !amountBlocked && (
      // Fiat mode: hold while the rate the conversion needs is still loading.
      amountStatus === "pending" ||
      (!state.priceConfigFailed && (!preview || state.currency !== selectedCurrency.symbol)) ||
      gate === "loading" ||
      state.livenessGate === "loading"
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
        ? usdcToFiat(state.fee, state.buyPrice)
        : 0n;
    const subtotalFiat = state.fiatAmount > feeFiat ? state.fiatAmount - feeFiat : state.fiatAmount;

    // Credit-used reconstruction: intent − delta. Only reliable when the
    // host passed `usdcAmount` AND it's larger than the Diamond delta —
    // otherwise we skip the credit row (e.g. tracking-only resumes where
    // the prop isn't set).
    const intent = orderUsdc ?? 0n;
    const delta = state.usdcAmount;
    const creditUsed = intent > delta ? intent - delta : 0n;
    const creditFiat =
      creditUsed > 0n && state.buyPrice
        ? usdcToFiat(creditUsed, state.buyPrice)
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
  // re-check `gate !== "loading"` on every property access. `rejection`
  // is null when the gate is loading or allowing; `Conflict` otherwise.
  const rejection =
    gate !== "loading" && gate.kind === "reject" ? gate.conflict : null;

  // Liveness gate takes precedence over the pending-order gate and the form:
  // a verified-human check is required, or a verification is in flight.
  const livenessBlock = state.livenessGate === "required" || state.livenessGate === "verifying";

  const content = (
    <div style={{ ...themeStyle, fontFamily: "var(--p2p-font, inherit)", color: color.text }}>
      {/* Header */}
      <div style={{
        padding: "16px 24px", borderBottom: `1px solid ${color.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <P2PMark size={28} />
          <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>{t("checkout.title")}</span>
          {demo && <span style={{
            padding: "2px 8px", borderRadius: radius.pill,
            background: color.accentSoft, color: color.accent,
            fontSize: font.xs, fontWeight: weight.semibold,
          }}>{t("common.demo")}</span>}
        </div>
        {mode === "modal" && onClose && (
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: radius.sm, border: "none",
            background: "transparent", cursor: "pointer", fontSize: 18, color: color.textMuted,
          }}>×</button>
        )}
      </div>

      <div style={{ padding: "24px" }}>
        {/* LIVENESS GATE — a one-time "verify you're human" check for
            integrators that enable it on-chain (anti-sybil). Takes precedence
            over the pending-order gate and the pre-order form. Absent for every
            integration that doesn't pass a `liveness` config. */}
        {state.phase === "checkout" && hasPlaceOrder && livenessBlock && (
          <div>
            <CenterStatus
              icon={<PulseDot />}
              title={t("checkout.livenessTitle")}
              subtitle={t("checkout.livenessSubtitle")}
            />
            {state.livenessError && (
              <div style={{ ...S.cardFlat, padding: 12, marginTop: 16, background: color.surfaceAlt, fontSize: font.sm }}>
                {displayError(state.livenessError, t)}
              </div>
            )}
            <button
              style={{ ...S.primaryBtn, marginTop: 20 }}
              disabled={state.livenessGate === "verifying"}
              onClick={() => { void startLivenessVerification(); }}
            >
              {state.livenessGate === "verifying" ? t("checkout.verifying") : t("checkout.verifyHuman")}
            </button>
            {onClose && (
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={onClose}>
                {t("common.close")}
              </button>
            )}
          </div>
        )}

        {/* PENDING-ORDER GATE — any in-flight order blocks a new placement
            (regardless of amount or credit). The host can wire
            `onResumeRequest` to navigate the user to that order (typically
            re-opens the widget with `orderId={pendingOrderId}`). Hidden in
            tracking-only mode (initialOrderId set) since the host is already
            driving a specific order. */}
        {state.phase === "checkout" && hasPlaceOrder && rejection && !livenessBlock && (
          <div>
            <CenterStatus
              icon={<PulseDot />}
              title={t("checkout.pendingTitle")}
              subtitle={t("checkout.pendingSubtitle")}
            />
            <div style={{ ...S.cardFlat, padding: 14, marginTop: 16, background: color.surfaceAlt }}>
              <div style={S.rowBetween}>
                <span style={S.label}>{t("checkout.pendingOrder")}</span>
                <span style={{ ...S.mono, fontSize: font.sm }}>#{rejection.orderId}</span>
              </div>
              <div style={{ ...S.rowBetween, marginTop: 6 }}>
                <span style={S.label}>{t("common.amount")}</span>
                <span style={{ ...S.body, ...S.num }}>
                  {t("common.usdcSuffix", { amount: formatUnits(rejection.usdcAmount, USDC_DECIMALS) })}
                </span>
              </div>
            </div>
            {onResumeRequest && (
              <button
                style={{ ...S.primaryBtn, marginTop: 20 }}
                onClick={() => onResumeRequest(rejection.orderId)}
              >
                {t("checkout.resumeThatOrder")}
              </button>
            )}
            {onClose && (
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={onClose}>
                {t("common.close")}
              </button>
            )}
          </div>
        )}

        {/* PRE-ORDER: client provides placeOrder callback */}
        {state.phase === "checkout" && hasPlaceOrder && !rejection && !livenessBlock && (
          <div>
            <p style={S.label}>{t("checkout.orderSummary")}</p>
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
              const selectedMeta = resolveCurrencyMeta(selectedCurrency, locale);
              return (
              <div style={{ marginBottom: 16 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>{t("checkout.payWith")}</p>
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
                        const meta = resolveCurrencyMeta(c, locale);
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
                    <span style={S.label}>{t("checkout.subtotal")}</span>
                    <Skeleton width={84} />
                  </div>
                ) : preview!.creditUsdc ? (
                  <>
                    <div style={S.rowBetween}>
                      <span style={S.label}>{t("checkout.order")}</span>
                      <span style={{ ...S.body, ...S.num }}>{preview!.symbol} {preview!.gross}</span>
                    </div>
                    <div style={{ ...S.rowBetween, marginTop: 8 }}>
                      <span style={S.label}>
                        {t("checkout.creditApplied")}
                        <span style={{ ...S.faint, marginLeft: 6 }}>{t("checkout.creditAppliedUsdc", { creditUsdc: preview!.creditUsdc })}</span>
                      </span>
                      <span style={{ ...S.body, ...S.num, color: color.accent }}>
                        −{preview!.symbol} {preview!.creditFiat}
                      </span>
                    </div>
                    <div style={{ ...S.rowBetween, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
                      <span style={S.label}>{t("checkout.subtotal")}</span>
                      <span style={{ ...S.body, ...S.num }}>{preview!.symbol} {preview!.subtotal}</span>
                    </div>
                  </>
                ) : (
                  <div style={S.rowBetween}>
                    <span style={S.label}>{t("checkout.subtotal")}</span>
                    <span style={{ ...S.body, ...S.num }}>{preview!.symbol} {preview!.subtotal}</span>
                  </div>
                )}
                {!isQuotePending && preview!.fee && (
                  <>
                    <div style={{ ...S.rowBetween, marginTop: 8 }}>
                      <span style={S.label}>{t("checkout.transactionFee")}</span>
                      <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{preview!.symbol} {preview!.fee}</span>
                    </div>
                    <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                      {t("checkout.waivedAbove", { thresholdLabel })}
                    </p>
                  </>
                )}
                <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                  <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>{t("checkout.youPay")}</span>
                  {isQuotePending
                    ? <Skeleton width={100} height={16} />
                    : <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                        {preview!.creditCoversFully
                          ? t("checkout.freeCreditCovers")
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
            {/* Fiat all-in mode couldn't price the order — the entered total
                is below the protocol fee, or the rate read failed. Blocks
                placement with a clear reason instead of a broken button. */}
            {amountBlocked && (
              <div style={{ marginBottom: 12, padding: "12px 14px", background: color.dangerSoft, border: `1px solid color-mix(in srgb, ${color.danger} 25%, transparent)`, borderRadius: radius.md }}>
                <span style={{ color: color.danger, fontSize: font.md, lineHeight: 1.5 }}>
                  {amountStatus === "too-small"
                    ? t("checkout.tooSmallBody", {
                        feeClause: feeFiatLabel
                          ? t("checkout.tooSmallFeeClause", { feeFiatLabel })
                          : "",
                      })
                    : t("checkout.rateLoadFailed")}
                </span>
              </div>
            )}
            {state.error && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: color.dangerSoft, border: `1px solid color-mix(in srgb, ${color.danger} 25%, transparent)`, borderRadius: radius.md }}>
                <span style={{ color: color.danger, fontSize: font.md }}>{displayError(state.error, t)}</span>
              </div>
            )}
            <button
              style={{ ...S.primaryBtn, opacity: (isQuotePending || amountBlocked) ? 0.6 : 1, cursor: amountBlocked ? "not-allowed" : isQuotePending ? "wait" : "pointer" }}
              onClick={handlePlaceOrder}
              disabled={isQuotePending || amountBlocked}
            >
              {isQuotePending ? (
                <>
                  <Spinner size={14} />
                  {t("common.loadingQuote")}
                </>
              ) : amountStatus === "too-small" ? (
                t("checkout.amountTooSmall")
              ) : amountStatus === "unavailable" ? (
                t("checkout.rateUnavailable")
              ) : preview?.creditCoversFully ? (
                t("checkout.redeemCredit")
              ) : preview ? (
                t("checkout.payAmount", { symbol: preview.symbol, total: preview.total })
              ) : (
                t("checkout.payNow")
              )}
            </button>
            <p style={{ ...S.faint, textAlign: "center", marginTop: 12 }}>{t("checkout.localCurrencyHint")}</p>
          </div>
        )}

        {state.phase === "placing" && (
          <CenterStatus icon={<Spinner />} title={t("checkout.placingTitle")} subtitle={t("checkout.placingSubtitle")} />
        )}

        {/* ORDER TRACKING — the P2P protocol flow */}
        {(["placed", "accepted", "paid", "completed", "cancelled"].includes(state.phase) ||
          (state.phase === "error" && state.orderId)) && (
          <div>
            <Stepper stepIndex={stepIndex} />
            <div style={{ ...S.card, padding: "32px", marginTop: 16 }}>

              {state.phase === "placed" && (
                <CenterStatus icon={<PulseDot />} title={t("checkout.matchingTitle")}
                  subtitle={t("checkout.matchingSubtitle", { orderId: state.orderId })} />
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
                      <p style={{ ...S.label, marginBottom: 2 }}>{t("checkout.payExactly")}</p>
                      <h1 style={{ ...S.h1, fontSize: font.xxl, ...S.num, lineHeight: 1.1 }}>
                        {state.currency} {fiatDisplay}
                      </h1>
                      <p style={{ ...S.muted, marginTop: 4, marginBottom: 0 }}>
                        {productName
                          ? t("checkout.forProduct", { productName })
                          : usdcDisplay
                            ? t("checkout.forUsdc", { usdc: usdcDisplay })
                            : t("checkout.forYourOrder")}
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
                          {breakdownExpanded ? t("checkout.hideBreakdown") : t("checkout.viewBreakdown")}
                        </button>
                      )}
                    </div>
                  </div>

                  {breakdownExpanded && orderBreakdown && (
                    <div style={{ ...S.cardFlat, padding: "14px 16px", marginBottom: 16, background: color.surfaceAlt }}>
                      {orderBreakdown.creditUsdc ? (
                        <>
                          <div style={S.rowBetween}>
                            <span style={S.label}>{t("checkout.order")}</span>
                            <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.gross}</span>
                          </div>
                          <div style={{ ...S.rowBetween, marginTop: 8 }}>
                            <span style={S.label}>
                              {t("checkout.creditApplied")}
                              <span style={{ ...S.faint, marginLeft: 6 }}>{t("checkout.creditAppliedUsdc", { creditUsdc: orderBreakdown.creditUsdc })}</span>
                            </span>
                            <span style={{ ...S.body, ...S.num, color: color.accent }}>
                              −{orderBreakdown.symbol} {orderBreakdown.creditFiat}
                            </span>
                          </div>
                          <div style={{ ...S.rowBetween, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
                            <span style={S.label}>{t("checkout.subtotal")}</span>
                            <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.subtotal}</span>
                          </div>
                        </>
                      ) : (
                        <div style={S.rowBetween}>
                          <span style={S.label}>{t("checkout.subtotal")}</span>
                          <span style={{ ...S.body, ...S.num }}>{orderBreakdown.symbol} {orderBreakdown.subtotal}</span>
                        </div>
                      )}
                      {orderBreakdown.fee && (
                        <>
                          <div style={{ ...S.rowBetween, marginTop: 8 }}>
                            <span style={S.label}>{t("checkout.transactionFee")}</span>
                            <span style={{ ...S.body, ...S.num, color: color.textMuted }}>{orderBreakdown.symbol} {orderBreakdown.fee}</span>
                          </div>
                          <p style={{ ...S.faint, margin: "4px 0 0", lineHeight: 1.4 }}>
                            {t("checkout.waivedAbove", { thresholdLabel })}
                          </p>
                        </>
                      )}
                      <div style={{ ...S.rowBetween, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}` }}>
                        <span style={{ ...S.label, color: color.text, fontWeight: weight.semibold }}>{t("checkout.totalPaid")}</span>
                        <span style={{ ...S.body, fontWeight: weight.bold, ...S.num }}>
                          {orderBreakdown.symbol} {orderBreakdown.total}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Action pill — matches user-app's "Pay via PIX and
                      confirm" language, and doubles as the headline for the
                      numbered two-step structure below it. */}
                  {acceptedMeta && (
                    <div style={{ marginBottom: 10 }}>
                      <span style={{
                        display: "inline-block", padding: "4px 10px", borderRadius: radius.pill,
                        background: color.accentSoft, color: color.accent,
                        fontSize: font.sm, fontWeight: weight.semibold, letterSpacing: "0.02em",
                      }}>
                        {t("checkout.payViaAndConfirm", { paymentMethod: acceptedMeta.paymentMethod })}
                      </span>
                    </div>
                  )}

                  {/* STEP 1 — pay. Numbered so the QR stops reading as the
                      whole job; step 2 lives in the sticky footer below. */}
                  <div style={{ marginBottom: 10 }}>
                    <StepHeader
                      n={1}
                      done={paymentIntent}
                      title={fiatDisplay ? t("checkout.step1SendAmount", { currency: state.currency, fiat: fiatDisplay }) : t("checkout.step1SendPayment")}
                      subtitle={t("checkout.step1Subtitle", {
                        paymentAddressLabel: acceptedMeta?.paymentAddressLabel ?? t("common.paymentAddressFallback"),
                        paymentMethod: acceptedMeta?.paymentMethod ?? t("common.paymentAppFallback"),
                      })}
                    />
                  </div>

                  <div style={{ ...S.cardFlat, padding: "20px", background: color.surfaceAlt }}>
                    <div style={S.rowBetween}>
                      <span style={S.label}>{acceptedMeta?.paymentMethod ?? t("common.payment")}</span>
                      <span style={S.faint}>{t("common.orderHash", { orderId: state.orderId })}</span>
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
                        <p style={S.muted}>{t("checkout.decrypting")}</p>
                      )}
                    </div>
                    {/* INR gets a real payable QR (upi://pay deep link — any UPI
                        app can act on it directly). BRL gets a real payable
                        Pix BR Code (EMV QRCPS-MPM, CRC16-sealed — any bank/Pix
                        app can scan-to-pay it directly). Other rails (CBU-alias
                        / ARS, etc.) don't have an equivalent deep-link or
                        checksummed-payload scheme the widget can synthesize
                        from a bare payout id, so those still render a QR that
                        just encodes the PLAIN payout id as text (same value as
                        the CopyRow above) — scan it with any QR reader to
                        read/copy the id into your banking app, rather than
                        "scan to pay". */}
                    {state.decryptedUpi && !compoundFields && (() => {
                      const brlPayload =
                        state.currency === "BRL"
                          ? buildBrlQrPayload(state.decryptedUpi, state.orderId, fiatDisplay, pixMerchantName, pixMerchantCity, productName)
                          : null;
                      const qrData =
                        state.currency === "INR"
                          ? `upi://pay?pa=${state.decryptedUpi}&am=${fiatDisplay}&cu=INR&tr=${state.orderId}`
                          : brlPayload ??
                            `${COPY_PAGE_URL}/#${new URLSearchParams({ v: state.decryptedUpi!, l: acceptedMeta?.paymentAddressLabel ?? t("common.paymentId") }).toString()}`;
                      const isPayableQr = state.currency === "INR" || brlPayload !== null;
                      // NOTE: no tap-to-open UPI deep link here. A tappable
                      // `upi://pay` affordance was tried and pulled: on a real
                      // handset the app opened and parsed the payload fine, but
                      // the transfer was declined after PIN entry. Until that's
                      // traced to a cause we can rule out, sending users into
                      // their UPI app only to fail at the last step is worse
                      // than not offering it. The QR below is unaffected — it
                      // is scanned from a second device and predates this.
                      //
                      // BRL is a different mechanism, not a deep link: every
                      // Pix app accepts a pasted BR Code ("Copia e Cola"), so
                      // the payload is offered for copy. That also doubles as a
                      // strong "I'm paying now" signal.
                      const qrImg = (
                        <div style={{ padding: 12, background: "#fff", borderRadius: radius.md, border: `1px solid ${color.border}` }}>
                          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(qrData)}`} alt="QR" style={{ width: 180, height: 180, display: "block" }} />
                        </div>
                      );
                      return (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 16 }}>
                          {qrImg}
                          {brlPayload && (
                            <button
                              type="button"
                              onClick={() => copy(brlPayload, "pix-code")}
                              style={{ ...S.secondaryBtn, width: "100%", marginTop: 12, borderColor: color.accent, color: color.accent }}
                            >
                              {copied === "pix-code" ? t("checkout.pixCodeCopied") : t("checkout.copyPixCode")}
                            </button>
                          )}
                          {!isPayableQr && (() => {
                            const label = acceptedMeta?.paymentAddressLabel ?? t("common.paymentAppFallback");
                            const cap = { lead: t("checkout.qrScanLead", { label }), strong: t("checkout.qrNotPayable") };
                            return (
                              <p style={{ ...S.faint, color: color.textMuted, textAlign: "center", marginTop: 8 }}>
                                {cap.lead}<strong style={{ color: color.text }}>{cap.strong}</strong>
                              </p>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>

                  {state.error && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: color.dangerSoft, borderRadius: radius.md, color: color.danger, fontSize: font.md }}>{displayError(state.error, t)}</div>
                  )}

                  {/* STEP 2 — confirm. Deliberately in normal flow: an
                      always-pinned block this tall (nudge + header + button +
                      countdown + cancel ≈ 250px) covered ~40% of a phone
                      scrollport and hid the QR behind it. The slim bar below
                      takes over the "never lose the CTA" job, and only while
                      this block is actually off-screen. */}
                  <div style={{ marginTop: 20 }}>
                    {returnedFromPayment && !timerExpired && (
                      <div className="p2p-nudge-in" style={{
                        marginBottom: 12, padding: "10px 12px",
                        // NOT `${color.accent}33` — these tokens are `var(…)`
                        // references, and var() substitution is token-based, so
                        // an appended alpha suffix never merges into one hex.
                        // The whole declaration is dropped and the border
                        // vanishes. color-mix composes correctly.
                        background: color.accentSoft,
                        border: `1px solid color-mix(in srgb, ${color.accent} 30%, transparent)`,
                        borderRadius: radius.md, fontSize: font.md, color: color.text, lineHeight: 1.45,
                        animation: "p2p-nudge-in 0.25s ease-out",
                      }} role="status">
                        {fiatDisplay
                          ? t("checkout.backFromAppNudge", {
                              paymentMethod: acceptedMeta?.paymentMethod ?? t("common.paymentAppFallback"),
                              currency: state.currency,
                              fiat: fiatDisplay,
                            })
                          : t("checkout.backFromAppNudgeNoAmount", {
                              paymentMethod: acceptedMeta?.paymentMethod ?? t("common.paymentAppFallback"),
                            })}
                      </div>
                    )}

                    <div style={{ marginBottom: 12 }}>
                      <StepHeader
                        n={2}
                        title={timerExpired ? t("checkout.windowClosedTitle") : t("checkout.confirmTitle")}
                        subtitle={timerExpired
                          ? undefined
                          : t("checkout.confirmSubtitle")}
                      />
                    </div>

                    <button
                      ref={confirmRef}
                      className={returnedFromPayment && !timerExpired ? "p2p-attn" : undefined}
                      style={{
                        ...S.primaryBtn,
                        opacity: isMarkingPaid || timerExpired ? 0.5 : 1,
                        cursor: timerExpired ? "not-allowed" : "pointer",
                        // Static glow once they've started paying, escalating
                        // to a repeating ring the moment they come back.
                        ...(returnedFromPayment && !timerExpired
                          ? { animation: "p2p-attn 1.6s ease-out 3" }
                          : paymentIntent && !timerExpired
                            ? { boxShadow: `0 0 0 4px ${color.accentSoft}` }
                            : null),
                      }}
                      onClick={handleMarkPaid}
                      disabled={isMarkingPaid || timerExpired || isCancelling}
                    >
                      {isMarkingPaid && <Spinner size={14} />}
                      {timerExpired
                        ? t("checkout.paymentWindowClosed")
                        : isMarkingPaid
                          ? t("checkout.confirming")
                          : fiatDisplay
                            ? t("checkout.iveSent", { currency: state.currency, fiat: fiatDisplay })
                            : t("checkout.iveMadePayment")}
                    </button>

                    {/* The 5-minute window is a deadline to *confirm*, not just
                        to pay — the on-chain paidBuyOrder reverts after it. */}
                    {!timerExpired && acceptedDeadline !== null && (
                      <p style={{
                        ...S.faint, textAlign: "center", margin: "8px 0 0",
                        color: acceptedRemaining < 60_000 ? color.danger : color.textFaint,
                        fontWeight: acceptedRemaining < 60_000 ? weight.semibold : weight.regular,
                      }}>
                        {t("checkout.confirmWithin", { countdown: formatCountdown(acceptedRemaining) })}
                      </p>
                    )}

                    {timerExpired && (
                      <div style={{ marginTop: 12, padding: "12px 14px", background: color.dangerSoft, border: `1px solid color-mix(in srgb, ${color.danger} 25%, transparent)`, borderRadius: radius.md }}>
                        <p style={{ fontSize: font.md, color: color.danger, margin: 0, lineHeight: 1.45, fontWeight: weight.semibold }}>
                          {t("checkout.alreadySentDontResend")}
                        </p>
                        <p style={{ ...S.muted, margin: "6px 0 8px", lineHeight: 1.45 }}>
                          {t("checkout.windowExpiredBody")}
                        </p>
                        <CopyRow value={t("common.orderHash", { orderId: state.orderId })} copied={copied === "order-id"} onCopy={() => copy(String(state.orderId), "order-id")} />
                      </div>
                    )}

                    {!showCancelConfirm ? (
                      <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }} onClick={() => setShowCancelConfirm(true)} disabled={isCancelling}>{t("checkout.cancelOrder")}</button>
                    ) : (
                      <div style={{ marginTop: 12, padding: 14, borderRadius: radius.md, background: color.dangerSoft, border: `1px solid color-mix(in srgb, ${color.danger} 25%, transparent)` }}>
                        <p style={{ fontSize: font.md, color: color.danger, marginTop: 0 }}>{t("checkout.cancelConfirm")}</p>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            style={{ ...S.secondaryBtn, flex: 1, height: 38, borderColor: color.danger, color: color.danger, opacity: isCancelling ? 0.6 : 1, cursor: isCancelling ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                            onClick={handleCancelConfirm}
                            disabled={isCancelling}
                          >
                            {isCancelling && <Spinner size={14} />}
                            {isCancelling ? t("checkout.cancelling") : t("checkout.yesCancel")}
                          </button>
                          <button
                            style={{ ...S.secondaryBtn, flex: 1, height: 38 }}
                            onClick={() => setShowCancelConfirm(false)}
                            disabled={isCancelling}
                          >
                            {t("checkout.keepOrder")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Slim pinned confirm bar — the safety net for the CTA
                      above, shown ONLY while that CTA is scrolled out of the
                      modal's scrollport. Collapsing to `height: 0` rather than
                      unmounting keeps it out of the flow entirely when idle,
                      so it adds no space and can't cover the QR. It sits after
                      the CTA in flow, so expanding it never shifts the element
                      being observed — no feedback loop. The card must NOT get
                      `overflow: hidden`: that would make it a scroll container
                      and break the stick. */}
                  <div
                    aria-hidden={!showConfirmBar}
                    style={{
                      position: "sticky", bottom: 0, zIndex: 2,
                      marginLeft: -32, marginRight: -32,
                      background: color.surface,
                      ...(showConfirmBar
                        ? {
                            padding: "10px 32px 12px",
                            borderTop: `1px solid ${color.border}`,
                            // Shadow is a light-theme affordance; on dark the
                            // borderTop above carries the separation.
                            boxShadow: "0 -6px 18px rgba(0,0,0,0.06)",
                            animation: "p2p-nudge-in 0.18s ease-out",
                          }
                        // `overflow: hidden` ONLY while collapsed. Applying it
                        // unconditionally clips the confirm button's expanding
                        // `p2p-attn` ring against the bar's padding box, which
                        // silently kills the one animation that exists to pull
                        // the eye back to the CTA.
                        : { height: 0, padding: 0, border: "none", boxShadow: "none", overflow: "hidden", pointerEvents: "none" }),
                    }}
                  >
                    <p style={{
                      ...S.faint, margin: "0 0 6px",
                      color: returnedFromPayment ? color.accent : color.textMuted,
                      fontWeight: returnedFromPayment ? weight.semibold : weight.medium,
                    }}>
                      {returnedFromPayment
                        ? t("checkout.stickyBackConfirm", {
                            paymentMethod: acceptedMeta?.paymentMethod ?? t("common.paymentAppFallback"),
                          })
                        : t("checkout.stickyStep2")}
                    </p>
                    <button
                      className={returnedFromPayment ? "p2p-attn" : undefined}
                      style={{
                        ...S.primaryBtn, height: 42,
                        opacity: isMarkingPaid ? 0.5 : 1,
                        ...(returnedFromPayment ? { animation: "p2p-attn 1.6s ease-out 3" } : null),
                      }}
                      onClick={handleMarkPaid}
                      disabled={isMarkingPaid || isCancelling}
                      tabIndex={showConfirmBar ? 0 : -1}
                    >
                      {isMarkingPaid && <Spinner size={14} />}
                      {isMarkingPaid
                        ? t("checkout.confirming")
                        : fiatDisplay
                          ? t("checkout.iveSent", { currency: state.currency, fiat: fiatDisplay })
                          : t("checkout.iveMadePayment")}
                    </button>
                  </div>
                </div>
              )}

              {state.phase === "paid" && (
                <CenterStatus icon={<Spinner />} title={t("checkout.verifyingTitle")} subtitle={t("checkout.verifyingSubtitle")} />
              )}

              {state.phase === "completed" && (
                <div style={{ textAlign: "center" }}>
                  <SuccessIcon />
                  <h1 style={{ ...S.h1, fontSize: font.xxl }}>
                    {state.creditOnly ? t("checkout.creditRedeemed") : t("checkout.paymentComplete")}
                  </h1>
                  {state.creditOnly ? (
                    <p style={{ ...S.muted, marginTop: 8 }}>
                      {t("checkout.creditOnlyBody")}
                    </p>
                  ) : (
                    usdcDisplay && <p style={{ ...S.muted, marginTop: 8 }}>{t("checkout.usdcDelivered", { usdc: usdcDisplay })}</p>
                  )}
                  {onClose && <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={onClose}>{t("common.done")}</button>}
                </div>
              )}

              {state.phase === "cancelled" && (
                <div style={{ textAlign: "center" }}>
                  <CenterStatus icon={<XIcon />} title={t("checkout.orderCancelled")} subtitle={t("checkout.notCharged")} variant="danger" />
                  {onClose && <button style={{ ...S.primaryBtn, marginTop: 8 }} onClick={onClose}>{t("common.done")}</button>}
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
            <h2 style={S.h2}>{displayError(state.error, t)}</h2>
            {hasPlaceOrder && <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={handlePlaceOrder}>{t("common.tryAgain")}</button>}
          </div>
        )}
      </div>
    </div>
  );

  if (mode === "modal") return <Modal open={open} onClose={onClose} themeStyle={themeStyle}>{content}</Modal>;
  return <div style={{ ...S.card, overflow: "hidden" }}>{content}</div>;
}
