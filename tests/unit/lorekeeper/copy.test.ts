import { describe, expect, it } from "vitest";

import * as lorekeeper from "../../../src/lib/lorekeeper";
import {
  BOOKS_ONLY_MISS,
  COMPOSER_PLACEHOLDER,
  SUGGESTIONS,
  VERDICT_COPY,
  WEB_DISCLAIMER,
  WEB_MISS,
  booksIndexedLabel,
  copyText,
  pinnedLabel,
  questionsLeftLabel,
  rulingMeta,
} from "../../../src/lib/lorekeeper/copy";

describe("board copy", () => {
  it("has the verdict pills and legend verbatim", () => {
    expect(VERDICT_COPY.rules).toEqual({
      label: "From the rules",
      icon: "✓",
      tone: "ok",
      legend: "Quoted from your books, with the book and section.",
    });
    expect(VERDICT_COPY.unclear.label).toBe("Rules unclear");
    expect(VERDICT_COPY.unclear.icon).toBe("?");
    expect(VERDICT_COPY.none).toMatchObject({ label: "Not in your books", icon: "✕", tone: "red" });
  });

  it("has the suggestion chips with their questions in board order", () => {
    expect(SUGGESTIONS.map((s) => s.label)).toEqual(["Critical hits", "How far is Close?", "Do Hexes stack?", "Holding breath"]);
    expect(SUGGESTIONS.every((s) => s.question.endsWith("?"))).toBe(true);
  });

  it("has the placeholder, disclaimer and books-only miss text", () => {
    expect(COMPOSER_PLACEHOLDER).toBe("Ask The Lorekeeper a rules question…");
    expect(WEB_DISCLAIMER).toMatch(/^These are other people’s readings/);
    expect(BOOKS_ONLY_MISS).toContain("internet search is off");
    expect(WEB_MISS).toBe("I couldn’t find this in your books or online. Ask your GM.");
  });

  it("formats counts", () => {
    expect(pinnedLabel(2)).toBe("2 pinned");
    expect(booksIndexedLabel(3)).toBe("3 books indexed");
    expect(booksIndexedLabel(1)).toBe("1 book indexed");
    expect(rulingMeta(4)).toBe("Pinned by the GM · Session 4");
    expect(rulingMeta(null)).toBe("Pinned by the GM");
    expect(questionsLeftLabel(12)).toBe("12 questions left today");
    expect(questionsLeftLabel(1)).toBe("1 question left today");
  });
});

describe("copyText", () => {
  it("joins prose, quotes with book and page, the GM call and the internet block", () => {
    const text = copyText({
      prose: "Count the biggest one.",
      quotes: [
        { kind: "book", text: "One Hex at a time.", bookId: "b", book: "Tiny Tome", page: 12, section: "Hexes" },
        { kind: "ruling", text: "Only the biggest.", book: "Table ruling", section: "Hexes don’t stack" },
      ],
      call: "Use the larger penalty.",
      web: [{ title: "Thread", site: "forum.example", url: "https://forum.example/t", snippet: "Most tables agree." }],
    });
    expect(text).toBe(
      [
        "Count the biggest one.",
        "“One Hex at a time.” — Tiny Tome p.12\n“Only the biggest.” — Table ruling",
        "Suggested GM call: Use the larger penalty.",
        `From the internet · unofficial. ${WEB_DISCLAIMER}\n- Thread (forum.example) https://forum.example/t: Most tables agree.`,
      ].join("\n\n"),
    );
  });

  it("leaves out empty parts", () => {
    expect(copyText({ prose: "Just this.", quotes: [], web: [] })).toBe("Just this.");
  });
});

describe("barrel", () => {
  it("re-exports every module", () => {
    for (const name of ["chunkBook", "requestBody", "createAnswerParser", "costMicros", "nextStep", "copyText", "VERDICTS"]) {
      expect(name in lorekeeper).toBe(true);
    }
  });
});
