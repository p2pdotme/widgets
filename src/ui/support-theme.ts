// Back-compat shim. The support surface used to ship its own `--support-*`
// theme variables. It now reuses the shared P2PTheme + `--p2p-*` tokens
// like every other widget, so `theme={CHECKOUT_THEME}` actually applies.
//
// The exports below are kept for any host that imports them by name from
// `@p2pdotme/widgets/support`. New code should import P2PTheme +
// themeToCssVars from `@p2pdotme/widgets` directly.

import type { P2PTheme } from "./theme";
import { themeToCssVars as themeToCssVarsImpl } from "./theme";

export type SupportTheme = P2PTheme;

export const DEFAULT_THEME: P2PTheme = {};

export function themeToCssVars(theme?: SupportTheme): React.CSSProperties {
  return themeToCssVarsImpl(theme);
}
