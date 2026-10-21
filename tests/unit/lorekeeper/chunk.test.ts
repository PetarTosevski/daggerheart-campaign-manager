import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_CHUNK_CHARS,
  chunkBook,
  parsePages,
  printedPageForBlock,
  sectionPath,
  titleCase,
} from "../../../src/lib/lorekeeper/chunk";

const tiny = readFileSync(join(process.cwd(), "tests", "unit", "lorekeeper", "fixtures", "tiny-book.txt"), "utf8");
const miniBookPath = join(process.cwd(), "tests", "fixtures", "lorekeeper", "mini-book.txt");

describe("parsePages", () => {
  const pages = parsePages(tiny);

  it("reads every block and ignores text before the first marker", () => {
    expect(pages.map((p) => p.block)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pages.some((p) => p.text.includes("Invented test text"))).toBe(false);
  });

  it("maps block N to printed page N-1 without a footer", () => {
    expect(printedPageForBlock(93)).toBe(92);
    expect(pages[0]).toMatchObject({ block: 1, page: 0 });
    expect(pages[5]).toMatchObject({ block: 6, page: 5 });
    expect(pages[5]?.chapter).toBeUndefined();
  });

  it("reads page and chapter from '<n>   Chapter N: Title' footers and removes them", () => {
    expect(pages[2]).toMatchObject({ block: 3, page: 2, chapter: "Core Lanterns" });
    expect(pages[2]?.text).not.toContain("Chapter 1");
    expect(pages[2]?.text.endsWith("adds a spark.")).toBe(true);
  });

  it("reads a '<n> Title' footer", () => {
    expect(pages[1]).toMatchObject({ block: 2, page: 1, chapter: "Introduction" });
    expect(pages[1]?.text).not.toMatch(/Introduction$/);
  });

  it("finds an inline chapter footer at the top of a page", () => {
    expect(pages[4]).toMatchObject({ block: 5, page: 4, chapter: "Tiny Combat" });
    expect(pages[4]?.text).not.toContain("Chapter 2");
  });

  it("uses the footer number over the block number when they differ a little", () => {
    const text = "===== PAGE 10 =====\nBody text here.  11   Chapter 4: Odd Pages\n";
    expect(parsePages(text)[0]).toMatchObject({ block: 10, page: 11, chapter: "Odd Pages" });
  });

  it("ignores a trailing number far from the expected page (not a footer)", () => {
    const text = "===== PAGE 50 =====\nThe bridge holds up to 3\n";
    const [page] = parsePages(text);
    expect(page?.page).toBe(49);
    expect(page?.text).toBe("The bridge holds up to 3");
  });

  it("accepts a bare page-number footer", () => {
    const [page] = parsePages("===== PAGE 8 =====\nSome words.  7\n");
    expect(page).toMatchObject({ page: 7, text: "Some words." });
    expect(page?.chapter).toBeUndefined();
  });

  it("returns nothing for text without markers", () => {
    expect(parsePages("no markers at all")).toEqual([]);
  });
});

describe("chunkBook", () => {
  const chunks = chunkBook(tiny, { minChars: 0 });

  it("numbers chunks in order without gaps", () => {
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
  });

  it("splits pages at headings with chapter → heading section paths", () => {
    expect(chunks.map((c) => [c.page, c.section])).toEqual([
      [0, "The Tiny Tome"],
      [1, "Introduction → Welcome"],
      [2, "Core Lanterns → Lantern Dice"],
      [2, "Core Lanterns → Glow Surge"],
      [3, "Core Lanterns → Glow Surge"],
      [3, "Core Lanterns → Worries"],
      [4, "Tiny Combat → Pebble Throwing"],
      [5, "Tiny Combat → Pebble Throwing"],
      [6, "Tiny Combat → Range on a Grid"],
    ]);
  });

  it("keeps the heading in the chunk text and joins segments with single spaces", () => {
    const lantern = chunks.find((c) => c.section.endsWith("Lantern Dice"));
    expect(lantern?.text).toBe("LANTERN DICE Roll two lanterns. If they glow the same colour, you gain a spark.");
    expect(lantern).toMatchObject({ block: 3, chapter: "Core Lanterns" });
  });

  it("carries a heading that ends a page over to the next page", () => {
    const last = chunks[chunks.length - 1];
    expect(last?.text.startsWith("Near is two hops")).toBe(true);
    expect(last?.section).toBe("Tiny Combat → Range on a Grid");
  });

  it("drops a heading-only section and never emits empty chunks", () => {
    expect(chunks.every((c) => c.text.trim().length > 0)).toBe(true);
    expect(chunks.some((c) => c.text === "RANGE ON A GRID")).toBe(false);
  });

  it("merges short sections into the next one on the same page, keeping the first section path", () => {
    const merged = chunkBook(tiny);
    const page2 = merged.filter((c) => c.page === 2);
    expect(page2).toHaveLength(1);
    expect(page2[0]?.section).toBe("Core Lanterns → Lantern Dice");
    expect(page2[0]?.text).toContain("GLOW SURGE A glow surge clears one worry");
    // Never across pages.
    expect(merged.filter((c) => c.page === 3)).toHaveLength(1);
    expect(merged.map((c) => c.ord)).toEqual(merged.map((_, i) => i));
  });

  it("does not merge when the result would pass maxChars", () => {
    const big = "A long sentence about lanterns and sparks. ".repeat(20).trim();
    const text = `===== PAGE 3 =====\nSHORT  Tiny bit.  BIG  ${big}\n`;
    const parts = chunkBook(text, { maxChars: 400, minChars: 300 });
    expect(parts[0]?.text).toBe("SHORT Tiny bit.");
    expect(parts[1]?.section).toBe("Big");
  });

  it("filters by printed page range (frame books)", () => {
    const frame = chunkBook(tiny, { minChars: 0, pages: { from: 3, to: 5 } });
    expect(frame.map((c) => c.page)).toEqual([3, 3, 4, 5]);
    expect(frame.map((c) => c.ord)).toEqual([0, 1, 2, 3]);
    // Headings and chapters before the range still apply.
    expect(frame[0]?.section).toBe("Core Lanterns → Glow Surge");
  });

  it("splits long sections at sentence ends within maxChars", () => {
    const sentence = "The lantern hums softly in the dark. ";
    const text = `===== PAGE 3 =====\nLONG RULE  ${sentence.repeat(400)} 2   Chapter 1: Core Lanterns\n`;
    const long = chunkBook(text);
    expect(long.length).toBeGreaterThan(3);
    for (const c of long) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(c.page).toBe(2);
      expect(c.section).toBe("Core Lanterns → Long Rule");
    }
    expect(long.slice(0, -1).every((c) => c.text.endsWith("."))).toBe(true);
    expect(long.map((c) => c.text).join(" ").length).toBeGreaterThan(sentence.length * 399);
  });

  it("hard-splits text without spaces and honours a smaller maxChars", () => {
    const text = `===== PAGE 2 =====\n${"x".repeat(1000)}\n`;
    const pieces = chunkBook(text, { maxChars: 300 });
    expect(pieces.map((c) => c.text.length)).toEqual([300, 300, 300, 100]);
  });

  it("handles newline-separated lines and markdown-style headings", () => {
    const text = "===== PAGE 11 =====\n# DUSK RULES\nAt dusk every lantern dims by one.\n10 Chapter 3: Night\n";
    const [c] = chunkBook(text);
    expect(c).toMatchObject({ page: 10, section: "Night → Dusk Rules", text: "DUSK RULES At dusk every lantern dims by one." });
  });

  it("resets the heading when the chapter changes", () => {
    const text = [
      "===== PAGE 3 =====",
      "OLD HEADING  Text one.  2 Chapter 1: First",
      "===== PAGE 4 =====",
      "Text two without a heading.  3 Chapter 2: Second",
    ].join("\n");
    expect(chunkBook(text).map((c) => c.section)).toEqual(["First → Old Heading", "Second"]);
  });

  it.skipIf(!existsSync(miniBookPath))("chunks L0's mini-book fixture into page-tagged chunks", () => {
    const mini = chunkBook(readFileSync(miniBookPath, "utf8"));
    expect(mini.length).toBeGreaterThan(5);
    for (const c of mini) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(Number.isInteger(c.page)).toBe(true);
    }
    expect(mini.some((c) => c.section.length > 0)).toBe(true);
  });
});

describe("titleCase and sectionPath", () => {
  it("title-cases ALL-CAPS headings and keeps small words low", () => {
    expect(titleCase("RANGE ON A GRID")).toBe("Range on a Grid");
    expect(titleCase("THE WITCH’S HEX")).toBe("The Witch’s Hex");
    expect(titleCase("STEP 1: PICK A TRAIT")).toBe("Step 1: Pick a Trait");
    expect(titleCase("(OPTIONAL) RULES")).toBe("(Optional) Rules");
    expect(titleCase("STEP 4: RESOLVE THE SITUATION.")).toBe("Step 4: Resolve the Situation");
  });

  it("keeps mixed-case text as written", () => {
    expect(titleCase("Core  Mechanics")).toBe("Core Mechanics");
  });

  it("joins chapter and heading", () => {
    expect(sectionPath("Combat", "Damage")).toBe("Combat → Damage");
    expect(sectionPath(undefined, "Damage")).toBe("Damage");
    expect(sectionPath("Combat", undefined)).toBe("Combat");
    expect(sectionPath(undefined, undefined)).toBe("");
  });
});
