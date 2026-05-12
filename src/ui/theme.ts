// Themable surface — color/radius/font tokens resolve through `--p2p-*` CSS
// variables with widget defaults baked in via the `var(…, fallback)` form.
// Integrators override by setting the variables on any ancestor element
// (e.g., `:root`) or by passing a `theme` prop on the widget — see
// `themeToCssVars` below for the prop → CSS-var bridge.
//
// Tokens NOT exposed via the public theme prop (textFaint, warning,
// borderStrong) remain as fixed widget tokens. The "soft" variants of
// accent/success/danger derive from their respective vars via `color-mix`,
// so a custom accent gets a matching halo automatically.
const v = (name: string, fallback: string) => `var(--p2p-color-${name}, ${fallback})`;

export const color = {
  bg: "#fafafa",                                    // page bg — internal
  surface: v("bg", "#ffffff"),                      // → --p2p-color-bg
  surfaceAlt: v("surface-alt", "#f5f5f5"),          // → --p2p-color-surface-alt
  border: v("border", "#eaeaea"),                   // → --p2p-color-border
  borderStrong: "#d4d4d4",                          // internal
  text: v("fg", "#0a0b0d"),                         // → --p2p-color-fg
  textMuted: v("muted", "#6b6b6b"),                 // → --p2p-color-muted
  textFaint: "#9a9a9a",                             // internal
  accent: v("accent", "#7c3aed"),                   // → --p2p-color-accent
  accentText: v("accent-fg", "#ffffff"),            // → --p2p-color-accent-fg
  accentSoft: `color-mix(in srgb, ${v("accent", "#7c3aed")} 12%, ${v("bg", "white")})`,
  success: v("success", "#0f9b53"),                 // → --p2p-color-success
  successSoft: `color-mix(in srgb, ${v("success", "#0f9b53")} 12%, ${v("bg", "white")})`,
  warning: "#b5750a",                               // internal (not in public spec)
  warningSoft: "#fef4e2",                           // internal
  danger: v("danger", "#d12f2f"),                   // → --p2p-color-danger
  dangerSoft: `color-mix(in srgb, ${v("danger", "#d12f2f")} 12%, ${v("bg", "white")})`,
};

const rv = (name: string, fallback: string) => `var(--p2p-radius-${name}, ${fallback})`;

export const radius = {
  sm: "6px",                              // internal
  md: rv("button", "8px"),                // → --p2p-radius-button
  lg: rv("modal", "12px"),                // → --p2p-radius-modal (secondary surfaces)
  xl: rv("modal", "16px"),                // → --p2p-radius-modal (primary modal)
  pill: "999px",                          // internal
};

/**
 * Public theming surface. Each field is optional; only set ones are written
 * into the widget root as `--p2p-*` CSS variables. Fields you don't set
 * fall back to the widget's defaults.
 */
export interface P2PTheme {
  colors?: {
    bg?: string;
    /**
     * Secondary surface used inside the modal for inner panels — fee
     * breakdown card, payment-details card, currency-picker active item,
     * order-history row. Default `#f5f5f5` (a hair off white) works on
     * light themes; on dark themes set this to a faint tint over `bg`
     * (e.g. `rgba(255,255,255,0.04)`) so the inner panels stay readable.
     */
    surfaceAlt?: string;
    fg?: string;
    muted?: string;
    border?: string;
    accent?: string;
    accentFg?: string;
    success?: string;
    danger?: string;
  };
  radii?: {
    /** Radius (px) for the modal + larger card surfaces. Default 12–16. */
    modal?: number;
    /** Radius (px) for buttons, inputs, and smaller surfaces. Default 8. */
    button?: number;
  };
  /** Any valid CSS `font-family` value. Default inherits from the host. */
  font?: string;
}

/**
 * Map a `P2PTheme` to the set of `--p2p-*` CSS variables that should be
 * written onto the widget root. Each widget calls this once and spreads
 * the result into its outermost element's `style`. The variables cascade
 * to all descendants without any extra plumbing.
 */
export function themeToCssVars(theme?: P2PTheme): React.CSSProperties {
  if (!theme) return {};
  const style: Record<string, string> = {};
  const c = theme.colors;
  if (c?.bg)         style["--p2p-color-bg"] = c.bg;
  if (c?.surfaceAlt) style["--p2p-color-surface-alt"] = c.surfaceAlt;
  if (c?.fg)         style["--p2p-color-fg"] = c.fg;
  if (c?.muted)      style["--p2p-color-muted"] = c.muted;
  if (c?.border)     style["--p2p-color-border"] = c.border;
  if (c?.accent)     style["--p2p-color-accent"] = c.accent;
  if (c?.accentFg)   style["--p2p-color-accent-fg"] = c.accentFg;
  if (c?.success)    style["--p2p-color-success"] = c.success;
  if (c?.danger)     style["--p2p-color-danger"] = c.danger;
  const r = theme.radii;
  if (r?.modal !== undefined)  style["--p2p-radius-modal"] = `${r.modal}px`;
  if (r?.button !== undefined) style["--p2p-radius-button"] = `${r.button}px`;
  if (theme.font)              style["--p2p-font"] = theme.font;
  return style as React.CSSProperties;
}
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
  // `boxSizing: "border-box"` on the button styles guarantees `width: 100%`
  // controls never overflow their container — relevant for buttons inside
  // modal cards where padding sits on the parent, not the button.
  primaryBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
    width: "100%", height: "46px", padding: "0 16px", boxSizing: "border-box" as const,
    background: color.accent, color: color.accentText, border: "none", borderRadius: radius.md,
    fontSize: font.base, fontWeight: weight.semibold, cursor: "pointer",
  },
  secondaryBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
    height: "46px", padding: "0 16px", boxSizing: "border-box" as const,
    background: color.surface, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md,
    fontSize: font.base, fontWeight: weight.medium, cursor: "pointer",
  },
  ghostBtn: {
    height: "36px", padding: "0 12px", boxSizing: "border-box" as const,
    background: "transparent", color: color.textMuted,
    border: "none", borderRadius: radius.sm, fontSize: font.md, fontWeight: weight.medium, cursor: "pointer",
  },
  rowBetween: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  divider: { height: 1, background: color.border, margin: "12px 0" },
};
