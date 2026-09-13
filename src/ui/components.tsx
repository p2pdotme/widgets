import React from "react";
import { color, radius, font, weight, S } from "./theme";
import { useT } from "../i18n";

/** Official P2PKit mark (from p2pkit.com/favicon.svg), sized for widget headers. */
export function P2PMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect x="1" y="1" width="94" height="94" rx="21" fill="#FFFFFF" stroke="#E4E7EC" strokeWidth="2" />
      <rect x="12" y="36" width="22" height="24" rx="7" fill="#0B0D12" />
      <rect x="62" y="36" width="22" height="24" rx="7" fill="#0B0D12" />
      <rect x="38" y="26" width="20" height="44" rx="7" fill="#4F5BFF" />
    </svg>
  );
}

export function Spinner({ size = 32 }: { size?: number }) {
  return <div style={{
    width: size, height: size,
    border: `3px solid ${color.border}`,
    borderTopColor: color.accent,
    borderRadius: "50%",
    animation: "p2p-spin 800ms linear infinite",
  }} />;
}


export function PulseDot() {
  return (
    <div style={{ position: "relative", width: 32, height: 32 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: color.accent, opacity: 0.25,
        animation: "p2p-pulse 1.2s ease-out infinite",
      }} />
      <div style={{ position: "absolute", inset: 8, borderRadius: "50%", background: color.accent }} />
    </div>
  );
}

export function CenterStatus({ icon, title, subtitle, variant }: {
  icon: React.ReactNode; title: string; subtitle: string;
  variant?: "danger" | "success" | "warning";
}) {
  const titleColor =
    variant === "danger" ? color.danger :
    variant === "success" ? color.success :
    variant === "warning" ? color.warning :
    color.text;
  return (
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <div style={{ marginBottom: 20, display: "inline-flex" }}>{icon}</div>
      <h1 style={{ ...S.h1, fontSize: font.xxl, color: titleColor }}>{title}</h1>
      <p style={{ ...S.muted, marginTop: 8, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>{subtitle}</p>
    </div>
  );
}

export function SuccessIcon() {
  return (
    <div style={{
      width: 64, height: 64, borderRadius: "50%",
      background: color.successSoft, color: color.success,
      display: "flex", alignItems: "center", justifyContent: "center",
      margin: "0 auto 20px",
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}

export function XIcon() {
  return (
    <div style={{
      width: 56, height: 56, borderRadius: "50%",
      background: color.dangerSoft, color: color.danger,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </div>
  );
}

export function CopyRow({ value, copied, onCopy, disabled }: {
  value: string; copied: boolean; onCopy: () => void; disabled?: boolean;
}) {
  const t = useT();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md,
      padding: "10px 12px",
    }}>
      <span style={{ ...S.mono, fontSize: font.md, wordBreak: "break-all", flex: 1, color: disabled ? color.textMuted : color.text }}>{value}</span>
      {!disabled && (
        <button style={{
          height: 28, padding: "0 10px",
          background: copied ? color.successSoft : color.surfaceAlt,
          color: copied ? color.success : color.text,
          border: "none", borderRadius: radius.sm, fontSize: font.sm, fontWeight: weight.medium, cursor: "pointer",
        }} onClick={onCopy}>{copied ? t("common.copied") : t("common.copy")}</button>
      )}
    </div>
  );
}

export function Stepper({ stepIndex }: { stepIndex: number }) {
  const t = useT();
  const steps = [t("stepper.matching"), t("stepper.payment"), t("stepper.complete")];
  return (
    <div className="p2p-stepper" style={{
      display: "flex", alignItems: "center", gap: 0,
      padding: "16px 20px", background: color.surface,
      border: `1px solid ${color.border}`, borderRadius: radius.lg,
    }}>
      {steps.map((label, i) => {
        const done = stepIndex > i;
        const active = stepIndex === i;
        return (
          <div key={label} className="p2p-stepper-step" style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "initial" }}>
            <div className="p2p-stepper-cell" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done || active ? color.accent : color.surface,
                color: done || active ? "#fff" : color.textMuted,
                border: done || active ? "none" : `1px solid ${color.border}`,
                fontSize: font.sm, fontWeight: weight.semibold,
                flexShrink: 0,
              }}>{done ? "✓" : i + 1}</div>
              <span className="p2p-stepper-label" style={{
                fontSize: font.md, fontWeight: active ? weight.semibold : weight.medium,
                color: done || active ? color.text : color.textMuted,
                whiteSpace: "nowrap",
              }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="p2p-stepper-line" style={{ flex: 1, height: 1, background: done ? color.accent : color.border, margin: "0 12px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline shimmering placeholder for values being fetched. Use when the
 * surrounding text labels stay stable and only the numbers are loading
 * (e.g. price breakdown during a currency switch) — keeps the layout in
 * place instead of collapsing/flashing.
 */
export function Skeleton({
  width = 80, height = 14, radius: r = 4,
}: { width?: number | string; height?: number | string; radius?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width, height, borderRadius: r,
        background: `linear-gradient(90deg, ${color.surfaceAlt} 0%, ${color.border} 50%, ${color.surfaceAlt} 100%)`,
        backgroundSize: "200% 100%",
        animation: "p2p-shimmer 1.4s ease-in-out infinite",
        verticalAlign: "middle",
      }}
    />
  );
}

/**
 * Numbered step header. The accepted-phase checkout is two distinct actions —
 * pay in your banking app, then confirm here — and users routinely stop after
 * the first because the QR reads as the whole job. Numbering both actions
 * makes the second one look like a step rather than an optional receipt.
 */
export function StepHeader({ n, title, subtitle, done }: {
  n: number;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Renders a ✓ instead of the number once the step looks satisfied. */
  done?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      {/* accent + accentText, not success + "#fff". A host's `success` is
          often a bright green on dark themes, where white glyphs fall to
          ~2:1 contrast. accent/accentText is a pairing the host has already
          had to make legible — every primary button uses it — and it matches
          what <Stepper> does for its own completed steps. */}
      <div style={{
        width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: color.accent,
        color: color.accentText,
        fontSize: font.sm, fontWeight: weight.bold, lineHeight: 1,
      }}>{done ? "✓" : n}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: font.base, fontWeight: weight.semibold, color: color.text, margin: 0, lineHeight: 1.3 }}>{title}</p>
        {subtitle && <p style={{ ...S.muted, margin: "3px 0 0", lineHeight: 1.45 }}>{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * Ticking `deadline - now` in ms, floored at zero, updated once a second.
 * Shared by `CountdownRing` and any caller that needs the same countdown as
 * plain text (the checkout prints "Confirm within m:ss" under its CTA) so the
 * two never drift apart. Passing `null` parks it at zero without a timer.
 */
export function useCountdown(deadline: number | null): number {
  const compute = React.useCallback(
    () => (deadline === null ? 0 : Math.max(0, deadline - Date.now())),
    [deadline],
  );
  const [remaining, setRemaining] = React.useState(compute);

  React.useEffect(() => {
    setRemaining(compute());
    if (deadline === null) return;
    const id = setInterval(() => setRemaining(compute()), 1000);
    return () => clearInterval(id);
  }, [deadline, compute]);

  return remaining;
}

/** `m:ss` for a millisecond duration. */
export function formatCountdown(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Circular countdown — shown next to the "Pay exactly" hero after a merchant
 * accepts a buy order. SVG progress ring + `mm:ss` in the center. Color
 * shifts accent → warning (half-gone) → danger (last minute / expired).
 * Fires `onExpire` exactly once when the remaining time first crosses zero
 * — parent decides what to do (typically: disable the "I've paid" CTA).
 */
export function CountdownRing({ deadline, totalMs, onExpire, size = 76, stroke = 5 }: {
  /** ms epoch when the order auto-cancels. */
  deadline: number;
  /** Total window length in ms (e.g. 5 * 60 * 1000) — used for the progress %. */
  totalMs: number;
  onExpire?: () => void;
  size?: number;
  stroke?: number;
}) {
  const t = useT();
  const remaining = useCountdown(deadline);
  const calledExpire = React.useRef(false);

  const expired = remaining === 0;
  React.useEffect(() => {
    if (expired && !calledExpire.current) {
      calledExpire.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  const text = formatCountdown(remaining);
  const progress = totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : 0;

  const urgent = !expired && remaining < 60_000;
  const halfGone = !expired && !urgent && remaining < totalMs / 2;
  const ringColor = expired || urgent ? color.danger : halfGone ? color.warning : color.accent;

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - progress);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color.border} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        color: ringColor, fontVariantNumeric: "tabular-nums",
      }}>
        <div style={{ fontSize: font.lg, fontWeight: weight.bold, lineHeight: 1 }}>
          {expired ? "0:00" : text}
        </div>
        <div style={{ fontSize: 9, fontWeight: weight.semibold, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3, opacity: 0.75 }}>
          {expired ? t("common.expired") : t("common.left")}
        </div>
      </div>
    </div>
  );
}

export function injectKeyframes() {
  const id = "p2p-checkout-keyframes";
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    // The narrow-viewport rules below collapse the order-tracker stepper to
    // just circles + connectors so it fits inside a phone-sized modal. We
    // can't use CSS-in-JS for `@media` blocks, so they live alongside the
    // keyframes in this one-time global injection.
    style.textContent = `
      @keyframes p2p-spin { to { transform: rotate(360deg); } }
      @keyframes p2p-pulse { 0% { transform: scale(0.6); opacity: 0.5; } 100% { transform: scale(1.6); opacity: 0; } }
      @keyframes p2p-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      /* Expanding ring on the confirm CTA, played when the user comes back
         from their banking app and still owes us the "I've paid" tap. */
      @keyframes p2p-attn {
        0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--p2p-color-accent, #7c3aed) 50%, transparent); }
        70%  { box-shadow: 0 0 0 12px color-mix(in srgb, var(--p2p-color-accent, #7c3aed) 0%, transparent); }
        100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--p2p-color-accent, #7c3aed) 0%, transparent); }
      }
      @keyframes p2p-nudge-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) {
        .p2p-attn, .p2p-nudge-in { animation: none !important; }
      }
      @media (max-width: 480px) {
        .p2p-stepper { padding: 12px 14px !important; }
        .p2p-stepper-label { display: none !important; }
        .p2p-stepper-cell { gap: 0 !important; }
        .p2p-stepper-line { margin: 0 8px !important; }
      }
      /* Ops side-rail: a fixed-width right column at lg+, collapsing to a
         full-width inline block below the lg breakpoint (1024px). */
      .p2p-support-side-rail { width: 380px; max-width: 100%; height: 100%; }
      @media (max-width: 1023px) {
        .p2p-support-side-rail { width: 100%; height: auto; }
      }
    `;
    document.head.appendChild(style);
  }
}
