// Customer-facing copy for the operator-set P2P tag (D-027-v2).
//
// The raw tag tokens (`awaiting_user`, `reviewing`, `evidence`,
// `escalated`) are operator vocabulary. The customer surface never shows
// the token — it shows the neutral, reassuring phrase below. Two tokens
// intentionally collapse to the same line: `escalated` reads the same as
// `reviewing` to the user, since "escalated" is an internal routing
// signal, not something the user should worry about.

import type { SupportP2PTag } from "../types";

const COPY: Record<SupportP2PTag, string> = {
  awaiting_user: "Awaiting your reply",
  reviewing: "Our team is reviewing",
  evidence: "We need a bit more info",
  escalated: "Our team is reviewing",
};

export function friendlyP2PTagCopy(tag: SupportP2PTag): string {
  return COPY[tag];
}
