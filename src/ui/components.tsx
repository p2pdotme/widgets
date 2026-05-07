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
  const steps = ["Merchant", "Payment", "Complete"];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      padding: "16px 20px", background: color.surface,
      border: `1px solid ${color.border}`, borderRadius: radius.lg,
    }}>
      {steps.map((label, i) => {
        const done = stepIndex > i;
        const active = stepIndex === i;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "initial" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done || active ? color.accent : color.surface,
                color: done || active ? "#fff" : color.textMuted,
                border: done || active ? "none" : `1px solid ${color.border}`,
                fontSize: font.sm, fontWeight: weight.semibold,
              }}>{done ? "✓" : i + 1}</div>
              <span style={{
                fontSize: font.md, fontWeight: active ? weight.semibold : weight.medium,
                color: done || active ? color.text : color.textMuted,
              }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 1, background: done ? color.accent : color.border, margin: "0 12px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LockFooter() {
  return (
    <div style={{ padding: "16px 0", display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: color.textMuted, fontSize: font.sm }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Powered by</span>
        <span style={{ fontWeight: weight.semibold, color: color.text }}>P2P.me</span>
      </div>
    </div>
  );
}

export function injectKeyframes() {
  const id = "p2p-checkout-keyframes";
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes p2p-spin { to { transform: rotate(360deg); } }
      @keyframes p2p-pulse { 0% { transform: scale(0.6); opacity: 0.5; } 100% { transform: scale(1.6); opacity: 0; } }
    `;
    document.head.appendChild(style);
  }
}
