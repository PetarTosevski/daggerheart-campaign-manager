import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CLEAR_BATCH, INGEST_BATCH } from "../../convex/lorekeeperLibrary";
import { bookKeyEnabled, MAX_CHARS, MAX_HITS, MAX_TERMS, retrieve, searchTerms } from "../../convex/lib/lorekeeper/retrieve";
import {
  batches,
  checkTextPath,
  parseArgs,
  parseRunOutput,
  toRows,
} from "../../scripts/lorekeeper-ingest.mjs";
import { chunkBook } from "../../src/lib/lorekeeper/chunk";
import { publicFunctions } from "./authz/inventory";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode } from "./helpers";

// D13 L2: the rules source. The internal ingest (what `pnpm lorekeeper:ingest` calls), retrieval over the campaign's
// enabled books, the library list, the GM's book switches and 'Open in the book'. Only the invented fixture
// tests/fixtures/lorekeeper/mini-book.txt is used: no book text.

const MINI_BOOK = join(process.cwd(), "tests", "fixtures", "lorekeeper", "mini-book.txt");
const miniRows = () => toRows(chunkBook(readFileSync(MINI_BOOK, "utf8")));

type Ingested = { bookId: Id<"lorekeeperBooks"> };

/** Ingests rows as the script does: register, clear old chunks until done, send batches. */
async function ingest(w: World, bookKey: string, rows: ReturnType<typeof miniRows>["rows"], pages: number) {
  const { bookId } = (await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey, pages })) as Ingested;
  for (;;) {
    const { done } = await w.t.mutation(internal.lorekeeperLibrary.clearChunks, { bookId });
    if (done) break;
  }
  for (const batch of batches(rows)) {
    await w.t.mutation(internal.lorekeeperLibrary.ingestChunks, { bookId, chunks: batch });
  }
  return bookId;
}

async function ingestMini(w: World, bookKey = "core") {
  const { rows, pages } = miniRows();
  return ingest(w, bookKey, rows, pages);
}

async function campaign(w: World): Promise<Doc<"campaigns">> {
  return (await w.t.run((ctx) => ctx.db.get("campaigns", w.campaignId)))!;
}

async function ask(w: World, question: string) {
  const c = await campaign(w);
  return w.t.run((ctx) => retrieve(ctx, c, question));
}

async function chunkCount(w: World, bookId: Id<"lorekeeperBooks">) {
  return w.t.run(async (ctx) => (await ctx.db.query("lorekeeperChunks").withIndex("by_book_page", (q) => q.eq("bookId", bookId)).collect()).length);
}

describe("lorekeeper ingest (internal)", () => {
  allowWorldEmails();

  it("registers a book with the board's defaults, adds the house-rules switch and loads the fixture's chunks", async () => {
    const w = await buildWorld();
    const bookId = await ingestMini(w);
    const books = await w.t.run((ctx) => ctx.db.query("lorekeeperBooks").collect());
    const core = books.find((b) => b._id === bookId)!;
    expect(core).toMatchObject({ key: "core", title: "Daggerheart Core Rulebook", subtitle: "Rules, classes, adversaries", cover: "core", chunkCount: 13, pages: 13, schemaVersion: 1 });
    expect(books.find((b) => b.key === "houseRules")).toMatchObject({ title: "House rules (notes)", chunkCount: 0 });
    expect(await chunkCount(w, bookId)).toBe(13);
  });

  it("is idempotent: a re-run replaces the book's chunks instead of adding to them", async () => {
    const w = await buildWorld();
    const first = await ingestMini(w);
    const { rows, pages } = miniRows();
    const second = await ingest(w, "core", rows.slice(0, 5), pages);
    expect(second).toBe(first);
    expect(await chunkCount(w, first)).toBe(5);
    const book = await w.t.run((ctx) => ctx.db.get("lorekeeperBooks", first));
    expect(book?.chunkCount).toBe(5);
    const houseRules = await w.t.run((ctx) => ctx.db.query("lorekeeperBooks").withIndex("by_key", (q) => q.eq("key", "houseRules")).collect());
    expect(houseRules).toHaveLength(1);
  });

  it("ensures the house-rules book once, off by default, and the GM can switch it on", async () => {
    const w = await buildWorld();
    const first = await w.t.mutation(internal.lorekeeperLibrary.ensureHouseRulesBook, {});
    const again = await w.t.mutation(internal.lorekeeperLibrary.ensureHouseRulesBook, {});
    expect(again).toEqual(first);
    const c = await campaign(w);
    expect(await w.t.run((ctx) => bookKeyEnabled(ctx, c, "houseRules"))).toBe(false);
    await w.as("gm").mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId: first.bookId, enabled: true });
    expect(await w.t.run((ctx) => bookKeyEnabled(ctx, c, "houseRules"))).toBe(true);
    const books = await w.t.run((ctx) => ctx.db.query("lorekeeperBooks").collect());
    expect(books.map((b) => [b.key, b.chunkCount])).toEqual([["houseRules", 0]]);
  });

  it("clears old chunks in bounded batches", async () => {
    const w = await buildWorld();
    const { bookId } = (await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "hopeFear", pages: 1 })) as Ingested;
    await w.t.run(async (ctx) => {
      for (let ord = 0; ord < CLEAR_BATCH + 3; ord++) await ctx.db.insert("lorekeeperChunks", { bookId, page: 1, section: "", text: "x", ord });
    });
    expect(await w.t.mutation(internal.lorekeeperLibrary.clearChunks, { bookId })).toEqual({ deleted: CLEAR_BATCH, done: false });
    expect(await w.t.mutation(internal.lorekeeperLibrary.clearChunks, { bookId })).toEqual({ deleted: 3, done: true });
  });

  it("names a frame book after its frame and refuses unknown keys, oversized batches and oversized chunks", async () => {
    const w = await buildWorld();
    const { bookId } = (await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "frame:witherwild", pages: 8 })) as Ingested;
    const frame = await w.t.run((ctx) => ctx.db.get("lorekeeperBooks", bookId));
    expect(frame).toMatchObject({ title: "The Witherwild", subtitle: "Campaign frame", cover: "frame" });

    for (const bookKey of ["bogus", "frame:no-such-frame"]) {
      const error = await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey, pages: 1 }).catch((e: unknown) => e);
      expect(errorCode(error)).toBe("INVALID");
    }
    const chunk = { page: 1, section: "", text: "x", ord: 0 };
    const tooMany = Array.from({ length: INGEST_BATCH + 1 }, (_, ord) => ({ ...chunk, ord }));
    const many = await w.t.mutation(internal.lorekeeperLibrary.ingestChunks, { bookId, chunks: tooMany }).catch((e: unknown) => e);
    expect(errorCode(many)).toBe("INVALID");
    const long = await w.t
      .mutation(internal.lorekeeperLibrary.ingestChunks, { bookId, chunks: [{ ...chunk, text: "x".repeat(4001) }] })
      .catch((e: unknown) => e);
    expect(errorCode(long)).toBe("INVALID");
  });

  it("leaves no public function that writes books or chunks", async () => {
    const names = (await publicFunctions()).map((f) => f.name).filter((name) => name.startsWith("lorekeeperLibrary:"));
    expect(names.sort()).toEqual(["lorekeeperLibrary:list", "lorekeeperLibrary:pageText", "lorekeeperLibrary:setEnabled"]);
  });
});

describe("lorekeeper ingest script helpers", () => {
  it("parses the command line, with the Witherwild page range by default", () => {
    expect(parseArgs(["core", "/books/core.txt"])).toMatchObject({ bookKey: "core", textFile: "/books/core.txt", dryRun: false });
    expect(parseArgs(["frame:witherwild", "/books/core.txt"]).pages).toEqual({ from: 254, to: 261 });
    expect(parseArgs(["frame:witherwild", "/b.txt", "--pages", "250-252"]).pages).toEqual({ from: 250, to: 252 });
    expect(parseArgs(["core", "/b.txt", "--prod"]).cli).toEqual(["--prod"]);
    expect(parseArgs(["houseRules"]).textFile).toBeUndefined();
    expect(() => parseArgs(["bogus", "/b.txt"])).toThrow();
    expect(() => parseArgs(["core"])).toThrow();
    expect(() => parseArgs(["core", "/b.txt", "--pages", "9-2"])).toThrow();
    expect(() => parseArgs(["core", "/b.txt", "--e2e", "--prod"])).toThrow();
  });

  it("refuses text inside the repository except tests/fixtures", () => {
    const root = process.cwd();
    expect(checkTextPath(MINI_BOOK, [root])).toContain("mini-book.txt");
    expect(() => checkTextPath(join(root, "package.json"), [root])).toThrow(/outside the repository/);
    expect(() => checkTextPath(join(root, "no-such-file.txt"), [root])).toThrow(/No such file/);
  });

  it("batches by count and by bytes, and reads the CLI's printed result", () => {
    const rows = Array.from({ length: 250 }, (_, ord) => ({ page: 1, section: "", text: "y".repeat(10), ord }));
    expect(batches(rows).map((b) => b.length)).toEqual([100, 100, 50]);
    const big = Array.from({ length: 60 }, (_, ord) => ({ page: 1, section: "", text: "z".repeat(3990), ord }));
    const byBytes = batches(big);
    expect(byBytes.length).toBeGreaterThan(1);
    for (const batch of byBytes) expect(JSON.stringify(batch).length).toBeLessThan(100_000);
    expect(parseRunOutput('- Running...\n{\n  "done": true\n}\n')).toEqual({ done: true });
  });
});

describe("lorekeeper retrieve", () => {
  allowWorldEmails();

  it("finds the pages for a question, with book, page and section", async () => {
    const w = await buildWorld();
    const bookId = await ingestMini(w);
    const chunks = await ask(w, "What happens on a critical hit?");
    expect(chunks.find((c) => c.page === 3)).toMatchObject({
      bookId,
      bookKey: "core",
      bookTitle: "Daggerheart Core Rulebook",
      section: "Core Mechanics → Critical Hits",
    });
    expect(chunks.some((c) => c.page === 5)).toBe(false); // Ranges: none of the terms
    expect(chunks.length).toBeLessThanOrEqual(MAX_HITS);
  });

  it("returns nothing for a miss and for a question of stopwords only", async () => {
    const w = await buildWorld();
    await ingestMini(w);
    expect(await ask(w, "Quokka zeppelin licence")).toEqual([]);
    expect(await ask(w, "what is it?")).toEqual([]);
  });

  it("leaves out a book the GM switched off", async () => {
    const w = await buildWorld();
    const bookId = await ingestMini(w);
    await w.as("gm").mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId, enabled: false });
    expect(await ask(w, "critical hit")).toEqual([]);
  });

  it("searches the campaign's frame book by default, dropping text already found in the core book", async () => {
    const w = await buildWorld();
    await ingestMini(w, "core");
    const { rows, pages } = miniRows();
    const frameId = await ingest(w, "frame:witherwild", rows.filter((r) => r.page === 10), pages);
    const unique = await ingest(w, "hopeFear", [{ page: 4, section: "Hexes → Doubled", text: "Two Hexes on one target merge into a doubled Hex.", ord: 0 }], 1);

    const chunks = await ask(w, "Hex target");
    const texts = chunks.map((c) => c.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(chunks.some((c) => c.bookId === unique)).toBe(true);
    // The frame's page-10 chunk duplicates the core chunk: only one of them is sent.
    expect(chunks.filter((c) => c.page === 10)).toHaveLength(1);
    expect(frameId).toBeDefined();
  });

  it("adds the other chunks of a hit's page", async () => {
    const w = await buildWorld();
    const rows = [
      { page: 1, section: "Lore → Tales", text: "The lantern rule: a lit lantern shows hidden doors.", ord: 0 },
      { page: 1, section: "Lore → Tales", text: "Wanderers gather around the campfire telling tales.", ord: 1 },
      { page: 2, section: "Lore → Roads", text: "Roads wind through the hills.", ord: 2 },
    ];
    await ingest(w, "core", rows, 2);
    const chunks = await ask(w, "lantern");
    expect(chunks.map((c) => c.text.slice(0, 9))).toEqual(["The lante", "Wanderers"]);
  });

  it("stays within the character budget", async () => {
    const w = await buildWorld();
    const filler = "Wanderers gather around the campfire telling tales. ".repeat(70);
    const rows = Array.from({ length: 24 }, (_, i) => ({ page: 1 + i, section: "Lore → Tales", text: `Lantern rule ${i}. ${filler}`, ord: i }));
    await ingest(w, "core", rows, 24);
    const chunks = await ask(w, "lantern");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(MAX_HITS);
    expect(chunks.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(MAX_CHARS);
  });

  it("keeps at most 16 search terms", () => {
    const question = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(searchTerms(question)).toHaveLength(MAX_TERMS);
    expect(searchTerms("What does the Hex do to a target's attacks?")).toEqual(["hex", "target", "attacks"]);
  });
});

describe("lorekeeper library", () => {
  allowWorldEmails();

  it("lists the campaign's books with their switches and never any chunk text", async () => {
    const w = await buildWorld();
    await ingestMini(w, "core");
    await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "hopeFear", pages: 0 });
    await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "frame:witherwild", pages: 0 });
    await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "frame:beast-feast", pages: 0 });

    for (const role of ["gm", "player"] as const) {
      const library = await w.as(role).query(api.lorekeeperLibrary.list, { campaignId: w.campaignId });
      expect(library.books.map((b) => [b.key, b.enabled])).toEqual([
        ["core", true],
        ["hopeFear", true],
        ["frame:witherwild", true],
        ["houseRules", false],
      ]);
      expect(library.indexedCount).toBe(3);
      expect(JSON.stringify(library)).not.toContain("twin dice");
      expect(library.books[0]).not.toHaveProperty("text");
    }
  });

  it("lets the GM switch a book (house rules on, core off) and refuses players", async () => {
    const w = await buildWorld();
    const core = await ingestMini(w, "core");
    const houseRules = (await w.t.run((ctx) => ctx.db.query("lorekeeperBooks").withIndex("by_key", (q) => q.eq("key", "houseRules")).first()))!._id;
    const gm = w.as("gm");
    await gm.mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId: core, enabled: false });
    await gm.mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId: houseRules, enabled: true });
    await gm.mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId: houseRules, enabled: true });
    const library = await w.as("player").query(api.lorekeeperLibrary.list, { campaignId: w.campaignId });
    expect(library.books.map((b) => [b.key, b.enabled])).toEqual([
      ["core", false],
      ["houseRules", true],
    ]);
    const rows = await w.t.run((ctx) => ctx.db.query("lorekeeperLibrary").collect());
    expect(rows).toHaveLength(2);

    const refused = await w
      .as("player")
      .mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId: core, enabled: true })
      .catch((e: unknown) => e);
    expect(errorCode(refused)).toBe("FORBIDDEN");
  });

  it("refuses another frame's book as not in this library", async () => {
    const w = await buildWorld();
    const { bookId } = (await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "frame:beast-feast", pages: 0 })) as Ingested;
    const error = await w
      .as("gm")
      .mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId, enabled: true })
      .catch((e: unknown) => e);
    expect(errorCode(error)).toBe("LOREKEEPER_BOOK_NOT_FOUND");
  });

  it("opens one page of an enabled book (Q5) and refuses off books and empty pages", async () => {
    const w = await buildWorld();
    const core = await ingestMini(w, "core");
    const page = await w.as("player").query(api.lorekeeperLibrary.pageText, { campaignId: w.campaignId, bookId: core, page: 10 });
    expect(page.bookTitle).toBe("Daggerheart Core Rulebook");
    expect(page.page).toBe(10);
    expect(page.sections[0]?.section).toBe("Classes → Hex");
    expect(page.sections[0]?.text).toContain("Hexweaver");

    const empty = await w
      .as("player")
      .query(api.lorekeeperLibrary.pageText, { campaignId: w.campaignId, bookId: core, page: 99 })
      .catch((e: unknown) => e);
    expect(errorCode(empty)).toBe("LOREKEEPER_BOOK_NOT_FOUND");

    await w.as("gm").mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId: core, enabled: false });
    const off = await w
      .as("gm")
      .query(api.lorekeeperLibrary.pageText, { campaignId: w.campaignId, bookId: core, page: 10 })
      .catch((e: unknown) => e);
    expect(errorCode(off)).toBe("LOREKEEPER_BOOK_NOT_FOUND");

    const outsider = await w
      .as("outsider")
      .query(api.lorekeeperLibrary.pageText, { campaignId: w.campaignId, bookId: core, page: 10 })
      .catch((e: unknown) => e);
    expect(errorCode(outsider)).toBe("NOT_FOUND");
  });
});
