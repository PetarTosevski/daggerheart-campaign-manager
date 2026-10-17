import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { errorMessage, mergeMessages } from "@/lib/convex-errors";
import { characterMessages } from "@/lib/errors/characters";
import { codexMessages } from "@/lib/errors/codex";
import { commonMessages } from "@/lib/errors/common";
import { mapMessages } from "@/lib/errors/maps";
import { operationMessages } from "@/lib/errors/operations";
import { trackerMessages } from "@/lib/errors/trackers";

/** The messages as they were before the per-domain split. */
const PREVIOUS: Record<string, string> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "This account can't use the campaign ledger.",
  NOT_FOUND: "That campaign no longer exists.",
  TRACKER_CORRUPT: "This tracker's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  CHARACTER_CORRUPT: "This character's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  MAP_CORRUPT: "This campaign's map data is damaged. Nothing was changed; ask the developer to repair it.",
  CODEX_CORRUPT: "This entry's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  MECHANIC_DISABLED: "That rule isn't part of this campaign's frame.",
  IDEMPOTENCY_MISMATCH: "That request clashed with an earlier one. Try again.",
};

const DOMAINS = [commonMessages, operationMessages, trackerMessages, characterMessages, mapMessages, codexMessages];

describe("errorMessage", () => {
  it("maps every previous code to the same text", () => {
    for (const [code, text] of Object.entries(PREVIOUS)) {
      expect(errorMessage(new ConvexError(code))).toBe(text);
    }
  });

  it("keeps the fallbacks", () => {
    expect(errorMessage(new ConvexError("NO_SUCH_CODE"))).toBe("Something went wrong.");
    expect(errorMessage(new ConvexError({ message: "Custom text" }))).toBe("Custom text");
    expect(errorMessage(new Error("boom"))).toBe("Something went wrong. Check your connection and try again.");
  });
});

describe("domain messages", () => {
  it("define no code twice", () => {
    const codes = DOMAINS.flatMap((messages) => Object.keys(messages));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("mergeMessages rejects a code defined by two domains", () => {
    expect(() => mergeMessages({ A: "one" }, { A: "two" })).toThrow(/A/);
  });
});
