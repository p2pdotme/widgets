// Theme tokens for the support surface. Kept isolated from the main
// P2PTheme system for now — the support modal renders with its own
// `--support-*` CSS variables to avoid clashing with host page styles.
// Unification with P2PTheme is a follow-up.

export interface SupportTheme {
  colorPrimary?: string;
  colorBg?: string;
  colorText?: string;
  colorMuted?: string;
  radius?: string;
  font?: string;
}

export const DEFAULT_THEME: Required<SupportTheme> = {
  colorPrimary: "#111111",
  colorBg: "#ffffff",
  colorText: "#111111",
  colorMuted: "#666666",
  radius: "12px",
  font: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
};

export function themeToCssVars(theme?: SupportTheme): React.CSSProperties {
  const merged = { ...DEFAULT_THEME, ...theme };
  return {
    ["--support-color-primary" as any]: merged.colorPrimary,
    ["--support-color-bg" as any]: merged.colorBg,
    ["--support-color-text" as any]: merged.colorText,
    ["--support-color-muted" as any]: merged.colorMuted,
    ["--support-radius" as any]: merged.radius,
    ["--support-font" as any]: merged.font,
  };
}
