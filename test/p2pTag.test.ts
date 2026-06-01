import { describe, it, expect } from "vitest";
import { friendlyP2PTagCopy } from "../src/core/p2p-tag";
import type { SupportP2PTag } from "../src/types";

describe("friendlyP2PTagCopy", () => {
  const cases: Array<[SupportP2PTag, string]> = [
    ["awaiting_user", "Awaiting your reply"],
    ["reviewing", "Our team is reviewing"],
    ["evidence", "We need a bit more info"],
    ["escalated", "Our team is reviewing"],
  ];

  it.each(cases)("maps %s → %s", (tag, copy) => {
    expect(friendlyP2PTagCopy(tag)).toBe(copy);
  });

  it("does not leak the raw tag token", () => {
    for (const [tag] of cases) {
      expect(friendlyP2PTagCopy(tag)).not.toContain("_");
    }
  });
});
