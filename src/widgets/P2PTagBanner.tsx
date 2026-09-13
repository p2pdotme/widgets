// Customer-facing status banner driven by the operator-set P2P tag and the
// Chatwoot conversation status (D-027-v2). Presentational only — the host
// (or `Support`) supplies `tag` / `status` from the ticket row or session.
//
// Precedence: a resolved conversation shows the "Chat closed by support"
// banner regardless of any lingering tag. Otherwise, a present tag shows
// the friendly copy. No tag + not resolved → renders nothing.
//
// Copy here is customer vocabulary only (no "merchant"/"dispute"/"circle
// admin"), per the widget user-facing copy rules.

import type { SupportP2PTag } from "../types";
import { friendlyP2PTagCopy } from "../core/p2p-tag";
import { color, radius, font, weight } from "../ui/theme";
import { useT } from "../i18n";

export interface P2PTagBannerProps {
  /** Operator-set tag carried on the conversation, if any. */
  tag?: SupportP2PTag | null;
  /** Chatwoot conversation status. `"resolved"` locks the surface. */
  status?: string;
}

export function P2PTagBanner({ tag, status }: P2PTagBannerProps) {
  const t = useT();
  if (status === "resolved") {
    return (
      <div
        data-p2p-tag-banner="resolved"
        role="status"
        style={{
          padding: "10px 14px",
          borderRadius: radius.md,
          border: `1px solid ${color.border}`,
          background: color.surfaceAlt,
          color: color.textMuted,
          fontSize: font.md,
          fontWeight: weight.medium,
        }}
      >
        {t("p2pTag.chatClosedBySupport")}
      </div>
    );
  }

  if (!tag) return null;

  return (
    <div
      data-p2p-tag-banner={tag}
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: radius.md,
        background: color.accentSoft,
        color: color.text,
        fontSize: font.md,
        fontWeight: weight.medium,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color.accent,
          flexShrink: 0,
        }}
      />
      {friendlyP2PTagCopy(tag, t)}
    </div>
  );
}
