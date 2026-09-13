// Customer-facing copy for the operator-set P2P tag (D-027-v2).
//
// The raw tag tokens (`awaiting_user`, `reviewing`, `evidence`,
// `escalated`) are operator vocabulary. The customer surface never shows
// the token — it shows the neutral, reassuring phrase below. Two tokens
// intentionally collapse to the same line: `escalated` reads the same as
// `reviewing` to the user, since "escalated" is an internal routing
// signal, not something the user should worry about.

import type { SupportP2PTag } from "../types";
import { createTranslator, type Translator } from "../i18n/t";

const TAG_KEYS: Record<SupportP2PTag, string> = {
  awaiting_user: "p2pTag.awaitingUser",
  reviewing: "p2pTag.reviewing",
  evidence: "p2pTag.evidence",
  escalated: "p2pTag.reviewing",
};

const defaultT = createTranslator("en");

export function friendlyP2PTagCopy(
  tag: SupportP2PTag,
  t: Translator = defaultT,
): string {
  return t(TAG_KEYS[tag]);
}
