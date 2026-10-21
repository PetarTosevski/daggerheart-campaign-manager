import { describe, expect, it } from "vitest";

import {
  MAX_QUOTES,
  QUOTE_MAX_CHARS,
  createAnswerParser,
  cutText,
  parseAnswer,
  siteOf,
  webResultsFromToolContent,
  type ApiCitation,
} from "../../../src/lib/lorekeeper/answer";
import type { CitationSource } from "../../../src/lib/lorekeeper/types";

const sources: CitationSource[] = [
  { kind: "book", bookId: "b1", bookTitle: "Tiny Tome", page: 2, section: "Core Lanterns → Lantern Dice" },
  { kind: "book", bookId: "b1", bookTitle: "Tiny Tome", page: 3, section: "Core Lanterns → Worries" },
  { kind: "book", bookId: "b2", bookTitle: "Pebble Guide", page: 9, section: "Throwing" },
  { kind: "book", bookId: "b2", bookTitle: "Pebble Guide", page: 10, section: "Catching" },
  { kind: "rulings", rulings: [{ id: "r1", title: "Sparks cap" }, { title: "Pebbles" }] },
];

const cite = (document_index: number, cited_text: string, start_block_index = 0): ApiCitation => ({
  type: "content_block_location",
  cited_text,
  document_index,
  document_title: "ignored",
  start_block_index,
  end_block_index: start_block_index + 1,
});

/** Feed text in pieces and record every snapshot. */
function stream(text: string, size: number) {
  const p = createAnswerParser(sources);
  const snaps = [];
  for (let i = 0; i < text.length; i += size) {
    p.pushText(text.slice(i, i + size));
    snaps.push(p.snapshot());
  }
  return { p, snaps };
}

describe("verdict line", () => {
  it("parses each verdict, case-insensitively, with markdown noise", () => {
    expect(parseAnswer("VERDICT: rules\nYes.", [], sources).verdict).toBe("rules");
    expect(parseAnswer("verdict: Unclear\nMaybe.", [], sources).verdict).toBe("unclear");
    expect(parseAnswer("**VERDICT: none**\nNothing.", [], sources)).toMatchObject({ verdict: "none", prose: "Nothing." });
    expect(parseAnswer("\n\nVERDICT - rules\nYes.", [], sources)).toMatchObject({ verdict: "rules", prose: "Yes.", verdictFromModel: true });
  });

  it("takes prose written on the verdict line itself", () => {
    expect(parseAnswer("VERDICT: rules. Yes, you gain a spark.", [], sources)).toMatchObject({
      verdict: "rules",
      prose: "Yes, you gain a spark.",
    });
  });

  it("falls back to 'rules' with citations and 'unclear' without when the line is missing", () => {
    const a = parseAnswer("Yes, roll two lanterns.", [cite(0, "Roll two lanterns.")], sources);
    expect(a).toMatchObject({ verdict: "rules", verdictFromModel: false, prose: "Yes, roll two lanterns." });
    expect(parseAnswer("I think so.", [], sources)).toMatchObject({ verdict: "unclear", verdictFromModel: false });
  });

  it("drops a garbled verdict line and falls back", () => {
    expect(parseAnswer("VERDICT: probably\nIt depends.", [], sources)).toMatchObject({
      verdict: "unclear",
      verdictFromModel: false,
      prose: "It depends.",
    });
  });

  it("keeps prose that merely starts with V", () => {
    expect(parseAnswer("Very Close is three hops.", [], sources).prose).toBe("Very Close is three hops.");
  });
});

describe("streaming snapshots", () => {
  const reply = "VERDICT: unclear\nThe book says one Hex works.\nIt is silent on two.\nGM CALL: Count only the biggest one.";

  for (const size of [1, 2, 3, 5, 7, 11]) {
    it(`never shows a partial verdict or GM CALL line (chunks of ${size})`, () => {
      const { p, snaps } = stream(reply, size);
      for (const s of snaps) {
        expect(s.prose).not.toMatch(/VERD|verd/);
        expect(s.prose).not.toMatch(/(^|\n)G(M( C(A(L(L)?)?)?)?)?$/);
        expect(s.prose).not.toContain("GM CALL");
        if (s.verdict !== null) expect(s.verdict).toBe("unclear");
      }
      // Prose only grows (no flicker), until the call line appears.
      for (let i = 1; i < snaps.length; i++) {
        expect(snaps[i]!.prose.startsWith(snaps[i - 1]!.prose.trim()) || snaps[i - 1]!.prose === "").toBe(true);
      }
      const done = p.finish();
      expect(done).toMatchObject({
        verdict: "unclear",
        prose: "The book says one Hex works.\nIt is silent on two.",
        call: "Count only the biggest one.",
      });
    });
  }

  it("shows the verdict once its line is complete, before the newline when prose follows on the line", () => {
    const p = createAnswerParser(sources);
    p.pushText("VERDICT: ru");
    expect(p.snapshot()).toMatchObject({ verdict: null, prose: "" });
    p.pushText("les");
    expect(p.snapshot().verdict).toBeNull();
    p.pushText("\nYe");
    expect(p.snapshot()).toMatchObject({ verdict: "rules", prose: "Ye" });
    p.pushText("s, mid-wo");
    expect(p.snapshot().prose).toBe("Yes, mid-wo");
  });

  it("shows prose at once when the reply has no verdict line", () => {
    const p = createAnswerParser(sources);
    p.pushText("Yes, you");
    expect(p.snapshot()).toMatchObject({ verdict: null, prose: "Yes, you" });
  });

  it("holds back a last line that may become GM CALL, and releases it when it does not", () => {
    const p = createAnswerParser(sources);
    p.pushText("VERDICT: rules\nFirst line.\nG");
    expect(p.snapshot().prose).toBe("First line.");
    p.pushText("ood news.");
    expect(p.snapshot().prose).toBe("First line.\nGood news.");
  });

  it("streams the call text after the GM CALL marker", () => {
    const p = createAnswerParser(sources);
    p.pushText("VERDICT: unclear\nUnclear.\nGM CALL: Let");
    expect(p.snapshot()).toMatchObject({ prose: "Unclear.", call: "Let" });
  });

  it("returns copies, so callers cannot mutate parser state", () => {
    const p = createAnswerParser(sources);
    p.pushCitation(cite(0, "Roll two lanterns."));
    p.snapshot().quotes[0]!.text = "changed";
    expect(p.finish().quotes[0]?.text).toBe("Roll two lanterns.");
    expect(p.rawText()).toBe("");
  });
});

describe("quotes from citations", () => {
  it("maps document_index to book, page and section", () => {
    const a = parseAnswer("VERDICT: rules\nYes.", [cite(1, "Mark a worry when the GM spends a shadow.")], sources);
    expect(a.quotes).toEqual([
      { kind: "book", text: "Mark a worry when the GM spends a shadow.", bookId: "b1", book: "Tiny Tome", page: 3, section: "Core Lanterns → Worries" },
    ]);
  });

  it("maps ruling citations by block index", () => {
    const a = parseAnswer("VERDICT: rules\nYes.", [cite(4, "Pebbles always hit.", 1), cite(4, "No more than five sparks.", 0)], sources);
    expect(a.quotes).toEqual([
      { kind: "ruling", text: "Pebbles always hit.", book: "Table ruling", section: "Pebbles" },
      { kind: "ruling", text: "No more than five sparks.", book: "Table ruling", section: "Sparks cap", rulingId: "r1" },
    ]);
  });

  it("accepts char_location and page_location citations", () => {
    const a = parseAnswer(
      "VERDICT: rules\nYes.",
      [
        { type: "char_location", cited_text: "Roll two lanterns.", document_index: 0, start_char_index: 0, end_char_index: 18 },
        { type: "page_location", cited_text: "Pebbles fly.", document_index: 2, start_page_number: 1, end_page_number: 2 },
      ],
      sources,
    );
    expect(a.quotes.map((q) => [q.book, q.page])).toEqual([
      ["Tiny Tome", 2],
      ["Pebble Guide", 9],
    ]);
  });

  it("cuts cited text to 300 characters", () => {
    const long = "spark ".repeat(100);
    const [q] = parseAnswer("VERDICT: rules\nYes.", [cite(0, long)], sources).quotes;
    expect(q!.text.length).toBeLessThanOrEqual(QUOTE_MAX_CHARS);
    expect(q!.text.endsWith("…")).toBe(true);
  });

  it("merges duplicates of the same book, page and section", () => {
    const a = parseAnswer(
      "VERDICT: rules\nYes.",
      [cite(0, "Roll two lanterns."), cite(0, "Roll two lanterns."), cite(0, "Glow brightly.")],
      sources,
    );
    expect(a.quotes).toHaveLength(1);
    expect(a.quotes[0]?.text).toBe("Roll two lanterns. … Glow brightly.");
  });

  it("keeps the longer text when one cited text contains the other", () => {
    const a = parseAnswer("VERDICT: rules\nYes.", [cite(0, "two lanterns"), cite(0, "Roll two lanterns now.")], sources);
    expect(a.quotes[0]?.text).toBe("Roll two lanterns now.");
  });

  it("shows at most 3 quotes", () => {
    const a = parseAnswer("VERDICT: rules\nYes.", [cite(0, "a1"), cite(1, "a2"), cite(2, "a3"), cite(3, "a4")], sources);
    expect(a.quotes).toHaveLength(MAX_QUOTES);
    expect(a.quotes.map((q) => q.page)).toEqual([2, 3, 9]);
  });

  it("ignores unknown document indexes and empty cited text", () => {
    const a = parseAnswer("Hmm.", [cite(99, "ghost"), cite(0, "   ")], sources);
    expect(a.quotes).toEqual([]);
    expect(a.verdict).toBe("unclear");
  });
});

describe("unofficial block (web results)", () => {
  const web = (url: string, cited_text: string, title = "A thread"): ApiCitation => ({
    type: "web_search_result_location",
    url,
    title,
    cited_text,
    encrypted_index: "x",
  });

  it("collects web citations with site, title and snippet, merged by url, at most 3", () => {
    const a = parseAnswer(
      "VERDICT: none\nNothing in your books.",
      [
        web("https://www.reddit.com/r/x/1", "Run it as a countdown."),
        web("https://www.reddit.com/r/x/1", "Tick it down on a failure."),
        web("https://blog.example.org/p", "Borrow from other games.", "A blog"),
        web("https://c.example/3", "c"),
        web("https://d.example/4", "d"),
      ],
      sources,
    );
    expect(a.verdict).toBe("none");
    expect(a.web).toEqual([
      { title: "A thread", site: "reddit.com", url: "https://www.reddit.com/r/x/1", snippet: "Run it as a countdown. … Tick it down on a failure." },
      { title: "A blog", site: "blog.example.org", url: "https://blog.example.org/p", snippet: "Borrow from other games." },
      { title: "A thread", site: "c.example", url: "https://c.example/3", snippet: "c" },
    ]);
    expect(a.quotes).toEqual([]);
  });

  it("drops non-http urls", () => {
    const a = parseAnswer("VERDICT: none\nx", [web("javascript:alert(1)", "x")], sources);
    expect(a.web).toEqual([]);
  });

  it("takes search results from a web_search_tool_result block and fills snippets later", () => {
    const p = createAnswerParser(sources);
    p.pushWebResults(
      webResultsFromToolContent([
        { type: "web_search_result", url: "https://forum.example/t", title: "Forum thread", encrypted_content: "x" },
        { type: "something_else", url: "https://nope.example" },
      ]),
    );
    p.pushCitation(web("https://forum.example/t", "Use Stress.", ""));
    expect(p.finish().web).toEqual([{ title: "Forum thread", site: "forum.example", url: "https://forum.example/t", snippet: "Use Stress." }]);
  });

  it("treats a server-tool error object as no results", () => {
    expect(webResultsFromToolContent({ type: "web_search_tool_result_error", error_code: "max_uses_exceeded" })).toEqual([]);
    expect(webResultsFromToolContent(null)).toEqual([]);
  });
});

describe("helpers", () => {
  it("siteOf strips www and handles bad urls", () => {
    expect(siteOf("https://www.example.com/a")).toBe("example.com");
    expect(siteOf("not a url")).toBe("");
  });

  it("cutText leaves short text, cuts long text at a word boundary within the limit", () => {
    expect(cutText("  short   text ")).toBe("short text");
    const cut = cutText("word ".repeat(10), 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut).toBe("word word word word…");
    expect(cutText("x".repeat(50), 20)).toBe(`${"x".repeat(19)}…`);
  });
});
