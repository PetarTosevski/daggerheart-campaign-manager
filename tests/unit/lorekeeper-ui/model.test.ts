// D13 L6: the pure helpers of the Lorekeeper's chat column (answer actions, quote chips, copy text, composer states,
// the shared conversation selection).
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { MessageView } from "../../../convex/lorekeeper";
import type { AnswerParts } from "../../../convex/lib/validators/lorekeeper";
import {
  answerActions,
  answerCopyText,
  citesRange,
  errorCode,
  isBooksOnlyMiss,
  pinDraft,
  quoteChip,
  safeUrl,
  verdictClass,
} from "../../../src/components/lorekeeper/answer/model";
import { resolveSelection, selectConversation } from "../../../src/components/lorekeeper/chat/selection";
import { askFailure, counterText, disabledReason, sendsOnKey, usagePeriod } from "../../../src/components/lorekeeper/composer/model";
import { askerNames } from "../../../src/components/lorekeeper/conversations/names";
import {
  BOOKS_ONLY_MISS,
  CAP_CAMPAIGN_TEXT,
  CAP_DEPLOYMENT_TEXT,
  CAP_USER_TEXT,
  NOT_SET_UP,
  RATE_LIMITED_TEXT,
} from "../../../src/lib/lorekeeper/copy";

const BOOK = "book1" as Id<"lorekeeperBooks">;
const titles = new Map([[BOOK as string, "Daggerheart Core Rulebook"]]);

function answer(parts: AnswerParts | undefined, text = "The rule says so."): Pick<MessageView, "text" | "parts"> {
  return { text, ...(parts ? { parts } : {}) };
}

const bookQuote = (section = "Core Mechanics → Critical Hits") => ({ kind: "book" as const, text: "A critical hit always succeeds.", bookId: BOOK, page: 3, section });

describe("answer actions (board order, roles)", () => {
  const rules = answer({ verdict: "rules", quotes: [bookQuote()] });
  const unclear = answer({ verdict: "unclear", quotes: [bookQuote()], call: "Apply the strongest Hex." });
  const web = answer({ verdict: "none", quotes: [], web: [{ title: "T", site: "example.com", url: "https://example.com", snippet: "" }] });
  const miss = answer({ verdict: "none", quotes: [] }, BOOKS_ONLY_MISS);
  const range = answer({ verdict: "rules", quotes: [bookQuote("Combat → Range on a grid")] });

  it("gives a player Open in the book and Copy on a rules answer, the GM also Pin", () => {
    expect(answerActions(rules, { isGm: false, mine: true })).toEqual(["openInBook", "copy"]);
    expect(answerActions(rules, { isGm: true, mine: true })).toEqual(["openInBook", "pinRuling", "copy"]);
  });

  it("gives Ask the GM to the asking player on unclear and internet answers, Pin to the GM", () => {
    expect(answerActions(unclear, { isGm: false, mine: true })).toEqual(["askGm", "copy"]);
    expect(answerActions(web, { isGm: false, mine: true })).toEqual(["askGm", "copy"]);
    expect(answerActions(unclear, { isGm: true, mine: true })).toEqual(["pinRuling", "copy"]);
  });

  it("never offers Ask the GM or Pin on another member's answer", () => {
    expect(answerActions(unclear, { isGm: false, mine: false })).toEqual(["copy"]);
    expect(answerActions(unclear, { isGm: true, mine: false })).toEqual(["copy"]);
  });

  it("lets the GM pin another member's answer once it was sent to them (Ask the GM)", () => {
    expect(answerActions(unclear, { isGm: true, mine: false, askedOfGm: true })).toEqual(["pinRuling", "copy"]);
    expect(answerActions(unclear, { isGm: true, mine: false, askedOfGm: false })).toEqual(["copy"]);
  });

  it("shows only Ask the GM on the books-only miss", () => {
    expect(isBooksOnlyMiss(miss)).toBe(true);
    expect(isBooksOnlyMiss(web)).toBe(false);
    expect(answerActions(miss, { isGm: false, mine: true })).toEqual(["askGm"]);
    expect(answerActions(miss, { isGm: true, mine: true })).toEqual([]);
  });

  it("shows Show on Combat Map only when a quote cites the range section", () => {
    expect(citesRange(range.parts)).toBe(true);
    expect(citesRange(rules.parts)).toBe(false);
    expect(answerActions(range, { isGm: false, mine: true })).toEqual(["showOnMap", "copy"]);
  });

  it("leaves Open in the book out without a book quote", () => {
    const ruling = answer({ verdict: "rules", quotes: [{ kind: "ruling", text: "Only the biggest Hex.", title: "Hexes don’t stack" }] });
    expect(answerActions(ruling, { isGm: false, mine: true })).toEqual(["copy"]);
  });
});

describe("quote chips, copy text, links", () => {
  it("names the book and page on a book quote and 'Table ruling' on a ruling quote", () => {
    expect(quoteChip(bookQuote(), titles)).toBe("📖 Daggerheart Core Rulebook · p.3");
    expect(quoteChip({ kind: "ruling", text: "x", title: "Hexes" }, titles)).toBe("📌 Table ruling");
  });

  it("builds the Copy text from the prose, quotes with book and page and the GM call", () => {
    const text = answerCopyText(answer({ verdict: "unclear", quotes: [bookQuote()], call: "Apply the strongest Hex." }, "Unclear."), titles);
    expect(text).toBe("Unclear.\n\n“A critical hit always succeeds.” — Daggerheart Core Rulebook p.3\n\nSuggested GM call: Apply the strongest Hex.");
  });

  it("links only http(s) URLs", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });

  it("maps verdicts to the board's pill classes", () => {
    expect(verdictClass("rules")).toBe("lk-verdict lk-v-ok");
    expect(verdictClass("unclear")).toBe("lk-verdict lk-v-amber");
    expect(verdictClass("none")).toBe("lk-verdict lk-v-red");
  });

  it("prefills the pin dialog from the question and the GM call, within the ruling limits", () => {
    const draft = pinDraft("Do  our Hexes\nstack?", answer({ verdict: "unclear", quotes: [], call: "Only the biggest." }));
    expect(draft).toEqual({ title: "Do our Hexes stack?", text: "Only the biggest." });
    const long = pinDraft("q".repeat(200), answer(undefined, "p".repeat(900)));
    expect(long.title.length).toBe(80);
    expect(long.text.length).toBe(600);
  });
});

describe("composer states", () => {
  const usage = { questionsLeft: 3, campaignCapReached: false, deploymentCapReached: false };

  it("disables the composer when not set up or at a cap, in L5's order", () => {
    expect(disabledReason(false, usage)).toBe(NOT_SET_UP);
    expect(disabledReason(true, undefined)).toBeNull();
    expect(disabledReason(true, usage)).toBeNull();
    expect(disabledReason(true, { ...usage, questionsLeft: 0, campaignCapReached: true })).toBe(CAP_USER_TEXT);
    expect(disabledReason(true, { ...usage, campaignCapReached: true, deploymentCapReached: true })).toBe(CAP_CAMPAIGN_TEXT);
    expect(disabledReason(true, { ...usage, deploymentCapReached: true })).toBe(CAP_DEPLOYMENT_TEXT);
  });

  it("shows the character count from 900 characters", () => {
    expect(counterText(899)).toBeNull();
    expect(counterText(950)).toBe("950 / 1,000");
  });

  it("maps ask failures to the composer's notices by code", () => {
    const fail = (code: string) => askFailure(new ConvexError({ code }));
    expect(fail("RATE_LIMITED")).toEqual({ text: RATE_LIMITED_TEXT, newConversation: false });
    expect(fail("LOREKEEPER_CAP_USER").text).toBe(CAP_USER_TEXT);
    expect(fail("LOREKEEPER_CONVERSATION_FULL").newConversation).toBe(true);
    expect(fail("LOREKEEPER_UNAVAILABLE").text).toBe(NOT_SET_UP);
    expect(errorCode(new ConvexError({ code: "LOREKEEPER_BUSY" }))).toBe("LOREKEEPER_BUSY");
    expect(errorCode(new Error("x"))).toBeUndefined();
  });

  it("sends on Enter, not on Shift+Enter or while composing", () => {
    expect(sendsOnKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(sendsOnKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(sendsOnKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(sendsOnKey({ key: "a", shiftKey: false })).toBe(false);
  });

  it("passes the UTC day and month to usage.mine", () => {
    expect(usagePeriod(new Date("2026-10-21T23:30:00Z"))).toEqual({ day: "2026-10-21", month: "2026-10" });
  });
});

describe("conversation selection and names", () => {
  const a = "c1" as Id<"lorekeeperConversations">;
  it("opens the caller's most recent conversation unless one is picked", () => {
    expect(resolveSelection(undefined, undefined)).toBeUndefined();
    expect(resolveSelection(undefined, [])).toBe("new");
    expect(resolveSelection(undefined, [{ _id: a }])).toBe(a);
    expect(resolveSelection("new", [{ _id: a }])).toBe("new");
  });

  it("ignores a repeated pick", () => {
    selectConversation("camp", a);
    selectConversation("camp", a);
    expect(resolveSelection(a, [])).toBe(a);
  });

  it("names askers from the roster", () => {
    const names = askerNames({ gm: { userId: "g", name: "Gail" }, players: [{ userId: "p", name: "Moss" }] });
    expect(names.get("g")).toBe("Gail");
    expect(names.get("p")).toBe("Moss");
    expect(askerNames(undefined).size).toBe(0);
  });
});
