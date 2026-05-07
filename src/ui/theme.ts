export const color = {
  bg: "#fafafa",
  surface: "#ffffff",
  surfaceAlt: "#f5f5f5",
  border: "#eaeaea",
  borderStrong: "#d4d4d4",
  text: "#0a0b0d",
  textMuted: "#6b6b6b",
  textFaint: "#9a9a9a",
  accent: "#7c3aed",
  accentText: "#ffffff",
  accentSoft: "#f3efff",
  success: "#0f9b53",
  successSoft: "#e9f8ef",
  warning: "#b5750a",
  warningSoft: "#fef4e2",
  danger: "#d12f2f",
  dangerSoft: "#fdecec",
};

export const radius = { sm: "6px", md: "8px", lg: "12px", xl: "16px", pill: "999px" };
export const shadow = {
  sm: "0 1px 2px rgba(0,0,0,0.04)",
  card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
  pop: "0 4px 16px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
};
export const font = { xs: "11px", sm: "12px", md: "13px", base: "14px", lg: "16px", xl: "18px", xxl: "22px", display: "28px", hero: "36px" };
export const weight = { regular: 400, medium: 500, semibold: 600, bold: 700 };

export const S: Record<string, React.CSSProperties> = {
  card: { background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: shadow.card },
  cardFlat: { background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg },
  h1: { fontSize: font.display, fontWeight: weight.bold, margin: 0, letterSpacing: "-0.02em" },
  h2: { fontSize: font.xxl, fontWeight: weight.semibold, margin: 0, letterSpacing: "-0.01em" },
  label: { fontSize: font.xs, fontWeight: weight.medium, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" },
  body: { fontSize: font.base, color: color.text },
  muted: { fontSize: font.md, color: color.textMuted },
  faint: { fontSize: font.sm, color: color.textFaint },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: font.md },
  num: { fontVariantNumeric: "tabular-nums" },
  primaryBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
    width: "100%", height: "46px", padding: "0 16px",
    background: color.accent, color: color.accentText, border: "none", borderRadius: radius.md,
    fontSize: font.base, fontWeight: weight.semibold, cursor: "pointer",
  },
  secondaryBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
    height: "46px", padding: "0 16px",
    background: color.surface, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md,
    fontSize: font.base, fontWeight: weight.medium, cursor: "pointer",
  },
  ghostBtn: {
    height: "36px", padding: "0 12px", background: "transparent", color: color.textMuted,
    border: "none", borderRadius: radius.sm, fontSize: font.md, fontWeight: weight.medium, cursor: "pointer",
  },
  rowBetween: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  divider: { height: 1, background: color.border, margin: "12px 0" },
};
