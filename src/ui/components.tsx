import React from "react";
import { color, radius, font, weight, S } from "./theme";

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
        }} onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
      )}
    </div>
  );
}

export function Stepper({ stepIndex }: { stepIndex: number }) {
  const steps = ["Matching", "Payment", "Complete"];
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
  const compute = () => Math.max(0, deadline - Date.now());
  const [remaining, setRemaining] = React.useState(compute);
  const calledExpire = React.useRef(false);

  React.useEffect(() => {
    setRemaining(compute());
    if (remaining === 0) return;
    const id = setInterval(() => setRemaining(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  const expired = remaining === 0;
  React.useEffect(() => {
    if (expired && !calledExpire.current) {
      calledExpire.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  const text = `${mins}:${secs.toString().padStart(2, "0")}`;
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
          {expired ? "expired" : "left"}
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
