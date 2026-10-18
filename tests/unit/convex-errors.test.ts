import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { errorMessage, mergeMessages } from "@/lib/convex-errors";
import { actionLogMessages } from "@/lib/errors/actionLog";
import { campaignMessages } from "@/lib/errors/campaigns";
import { characterMessages } from "@/lib/errors/characters";
import { classFeatureMessages } from "@/lib/errors/classFeatures";
import { codexMessages } from "@/lib/errors/codex";
import { commonMessages } from "@/lib/errors/common";
import { deathMessages } from "@/lib/errors/death";
import { diceMessages } from "@/lib/errors/dice";
import { levelUpMessages } from "@/lib/errors/levelUp";
import { mapMessages } from "@/lib/errors/maps";
import { operationMessages } from "@/lib/errors/operations";
import { photoImportMessages } from "@/lib/errors/photoImport";
import { restMessages } from "@/lib/errors/rests";
import { trackerMessages } from "@/lib/errors/trackers";
import { witherMessages } from "@/lib/errors/wither";

/** The messages as they were before the per-domain split. */
const PREVIOUS: Record<string, string> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "This account can't use the campaign ledger.",
  NOT_FOUND: "That no longer exists.",
  TRACKER_CORRUPT: "This tracker's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  CHARACTER_CORRUPT: "This character's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  MAP_CORRUPT: "This campaign's map data is damaged. Nothing was changed; ask the developer to repair it.",
  CODEX_CORRUPT: "This entry's saved data is damaged. Nothing was changed; ask the developer to repair it.",
  MECHANIC_DISABLED: "That rule isn't part of this campaign's frame.",
  IDEMPOTENCY_MISMATCH: "That request clashed with an earlier one. Try again.",
};

const D5_DOMAINS = [
  actionLogMessages,
  diceMessages,
  levelUpMessages,
  restMessages,
  deathMessages,
  witherMessages,
  classFeatureMessages,
  photoImportMessages,
];
const DOMAINS = [commonMessages, campaignMessages, operationMessages, trackerMessages, characterMessages, mapMessages, codexMessages, ...D5_DOMAINS];

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

  it("every D5 module has its *_RULE code, and each code maps to its message", () => {
    for (const messages of D5_DOMAINS) {
      expect(Object.keys(messages).some((code) => code.endsWith("_RULE") || code === "UNDO_STALE")).toBe(true);
      for (const [code, text] of Object.entries(messages)) expect(errorMessage(new ConvexError({ code }))).toBe(text);
    }
    expect(Object.keys(actionLogMessages).sort()).toEqual(["CHARACTER_UNAVAILABLE", "UNDO_STALE"]);
  });

  it("mergeMessages rejects a code defined by two domains", () => {
    expect(() => mergeMessages({ A: "one" }, { A: "two" })).toThrow(/A/);
  });
});
