// @vitest-environment node
// The scheduled PDF0 action is "use node" (unpdf), so this file runs in Node like tests/convex/admin-library.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CHUNK_DELETE_BATCH } from "../../convex/campaignBooks";
import { PDF_MAX_BYTES } from "../../convex/lib/pdf/config";
import { retrieve } from "../../convex/lib/lorekeeper/retrieve";
import { buildPdf } from "../fixtures/pdf/make-pdf";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

/**
 * Config LB1 (Q24 b, N6 b, N7 a, N8 a): the GM and co-GMs upload a PDF for one campaign; only that campaign shows and
 * searches it; it goes with `remove` and with the campaign's purge. docs/tasks/TASK-CONFIG-LB1.md. The PDFs hold our
 * own invented text (never rulebook text).
 */

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const SALT = buildPdf([
  ["SALT ROADS", "The saltwardens mark every caravan with blue chalk before the dunes."],
  ["DUNE TOLLS", "A caravan that crosses the dunes at night pays the saltwardens double."],
]);

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = World["t"];

/** Stores bytes as an upload would, with the recorded content type (convex-test records none by itself). */
async function upload(t: T, bytes: Uint8Array, contentType: string | null = "application/pdf"): Promise<Id<"_storage">> {
  return t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)]));
    if (contentType !== null) {
      await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
    }
    return id;
  });
}

const fileGone = async (t: T, storageId: Id<"_storage">) => (await t.run((ctx) => ctx.db.system.get("_storage", storageId))) === null;
const runScheduled = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

/** A second campaign, made by the world's outsider (its GM). */
async function otherCampaign(w: World): Promise<Id<"campaigns">> {
  const { campaignId } = await w.as("outsider").mutation(api.campaigns.create, { frameId: w.frameId, name: "Elsewhere", idempotencyKey: key() });
  return campaignId;
}

async function search(w: World, campaignId: Id<"campaigns">, question: string) {
  return w.t.run(async (ctx) => retrieve(ctx, (await ctx.db.get("campaigns", campaignId))!, question));
}

async function chunksOf(t: T, bookId: Id<"lorekeeperBooks">) {
  return t.run((ctx) =>
    ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", bookId))
      .collect(),
  );
}

/** Uploads SALT as `role` and reads it. */
async function addSalt(w: World, role: "gm" | "coGm" = "gm", title = "The Salt Roads") {
  const storageId = await upload(w.t, SALT);
  const started = await w.as(role).mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, title, firstPrintedPage: 40 });
  if (!started.ok) throw new Error(started.code);
  await runScheduled(w.t);
  return { bookId: started.bookId, storageId };
}

describe("campaignBooks.add", () => {
  allowWorldEmails();

  it("reads a GM's PDF onto printed pages, for this campaign only: its library and search, never another's", async () => {
    const w = await buildWorld();
    const elsewhere = await otherCampaign(w);
    const storageId = await upload(w.t, SALT);

    const started = await w.as("gm").mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, title: "  The Salt Roads ", firstPrintedPage: 40 });
    expect(started.ok).toBe(true);
    const bookId = started.ok ? started.bookId : null!;
    const reading = await w.as("gm").query(api.campaignBooks.list, { campaignId: w.campaignId });
    expect(reading.books).toMatchObject([{ bookId, title: "The Salt Roads", status: "reading", firstPrintedPage: 40, sizeBytes: SALT.length }]);

    await runScheduled(w.t);

    const book = await w.t.run((ctx) => ctx.db.get("lorekeeperBooks", bookId));
    expect(book).toMatchObject({ key: `campaign:${w.campaignId}:1`, title: "The Salt Roads", campaignId: w.campaignId, uploadedBy: w.users.gm, pages: 2 });
    const chunks = await chunksOf(w.t, bookId);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([40, 41]));
    expect(await fileGone(w.t, storageId)).toBe(true);
    const ready = await w.as("coGm").query(api.campaignBooks.list, { campaignId: w.campaignId });
    expect(ready).toEqual({
      books: [
        { bookId, title: "The Salt Roads", status: "ready", pages: 2, chunkCount: chunks.length, sizeBytes: SALT.length, firstPrintedPage: 40, uploadedAt: book!._creationTime },
      ],
      failures: [],
    });

    // This campaign: in the library (on by default) and found by its Lorekeeper, with printed pages.
    const library = await w.as("player").query(api.lorekeeperLibrary.list, { campaignId: w.campaignId });
    expect(library.books.find((b) => b.bookId === bookId)).toMatchObject({ title: "The Salt Roads", enabled: true });
    const hits = await search(w, w.campaignId, "saltwardens caravan dunes");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.bookId === bookId)).toBe(true);
    expect(hits.map((h) => h.page)).toContain(41);
    expect((await w.as("player").query(api.lorekeeperLibrary.pageText, { campaignId: w.campaignId, bookId, page: 40 })).bookTitle).toBe("The Salt Roads");

    // Another campaign: not in its library, never searched, no page text, no switch, not in its GM's list.
    const outsider = w.as("outsider");
    expect((await outsider.query(api.lorekeeperLibrary.list, { campaignId: elsewhere })).books.map((b) => b.bookId)).not.toContain(bookId);
    expect(await search(w, elsewhere, "saltwardens caravan dunes")).toEqual([]);
    expect(errorCode(await fail(outsider.query(api.lorekeeperLibrary.pageText, { campaignId: elsewhere, bookId, page: 40 })))).toBe(
      "LOREKEEPER_BOOK_NOT_FOUND",
    );
    expect(errorCode(await fail(outsider.mutation(api.lorekeeperLibrary.setEnabled, { campaignId: elsewhere, bookId, enabled: true })))).toBe(
      "LOREKEEPER_BOOK_NOT_FOUND",
    );
    expect(await outsider.query(api.campaignBooks.list, { campaignId: elsewhere })).toEqual({ books: [], failures: [] });
    // Even switched on by a stray row, another campaign's book stays out of that campaign's search.
    await w.t.run((ctx) => ctx.db.insert("lorekeeperLibrary", { campaignId: elsewhere, bookId, enabled: true, updatedAt: NOW }));
    expect(await search(w, elsewhere, "saltwardens caravan dunes")).toEqual([]);

    // The owner's shared library leaves it out.
    expect((await w.as("appOwner").query(api.adminLibrary.list, {})).books.map((b) => b.bookId)).not.toContain(bookId);
  });

  it("lets a co-GM upload and the GM switch the book off for the search (N7 a)", async () => {
    const w = await buildWorld();
    const { bookId } = await addSalt(w, "coGm");
    expect(await w.t.run((ctx) => ctx.db.get("lorekeeperBooks", bookId))).toMatchObject({ uploadedBy: w.users.coGm });
    await w.as("gm").mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId, enabled: false });
    expect(await search(w, w.campaignId, "saltwardens caravan dunes")).toEqual([]);
  });

  it("has no book-count limit (N6 b), even with a stored bookCount, and never reuses a key", async () => {
    const w = await buildWorld();
    await w.t.run((ctx) => ctx.db.insert("lorekeeperCampaignLimits", { campaignId: w.campaignId, bookCount: 1, bookPages: 1, updatedAt: NOW, setBy: w.users.appOwner }));
    const ids: Id<"lorekeeperBooks">[] = [];
    for (let i = 0; i < 4; i++) ids.push((await addSalt(w, "gm", `Book ${i}`)).bookId);
    await w.as("gm").mutation(api.campaignBooks.remove, { campaignId: w.campaignId, bookId: ids[3]! });
    const fifth = await addSalt(w, "gm", "Book 4");
    const keys = await w.t.run(async (ctx) => Promise.all([...ids.slice(0, 3), fifth.bookId].map(async (id) => (await ctx.db.get("lorekeeperBooks", id))!.key)));
    expect(keys).toEqual([1, 2, 3, 4].map((n) => `campaign:${w.campaignId}:${n}`));
    expect((await w.as("gm").query(api.campaignBooks.list, { campaignId: w.campaignId })).books).toHaveLength(4);
  });

  it("refuses a wrong or missing type and an oversized file, deleting the file (rule 10)", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    for (const type of ["image/png", "application/x-pdf", null]) {
      const storageId = await upload(w.t, SALT, type);
      expect(await gm.mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, title: "T", firstPrintedPage: 1 })).toEqual({ ok: false, code: "BOOK_NOT_PDF" });
      expect(await fileGone(w.t, storageId)).toBe(true);
    }
    const big = await upload(w.t, new Uint8Array(PDF_MAX_BYTES + 1));
    expect(await gm.mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId: big, title: "T", firstPrintedPage: 1 })).toEqual({ ok: false, code: "BOOK_TOO_LARGE" });
    expect(await fileGone(w.t, big)).toBe(true);
    expect(await w.t.run((ctx) => ctx.db.query("lorekeeperBooks").collect())).toEqual([]);
  });

  it("never takes a storage id as proof: a recorded file or one being read is NOT_FOUND and kept", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const recorded = await upload(w.t, SALT);
    await w.t.run((ctx) => ctx.db.insert("files", { storageId: recorded, campaignId: w.campaignId, kind: "portrait", refId: w.characterA, uploadedBy: w.users.player, createdAt: NOW }));
    expect(errorCode(await fail(gm.mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId: recorded, title: "T", firstPrintedPage: 1 })))).toBe("NOT_FOUND");
    expect(await fileGone(w.t, recorded)).toBe(false);

    const storageId = await upload(w.t, SALT);
    await gm.mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, title: "T", firstPrintedPage: 1 });
    const outsider = w.as("outsider");
    const elsewhere = await otherCampaign(w);
    expect(errorCode(await fail(outsider.mutation(api.campaignBooks.add, { campaignId: elsewhere, storageId, title: "Mine", firstPrintedPage: 1 })))).toBe("NOT_FOUND");
    expect(await fileGone(w.t, storageId)).toBe(false);
  });

  it("refuses a bad title or first page with INVALID and keeps the file", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const storageId = await upload(w.t, SALT);
    for (const args of [
      { title: "   ", firstPrintedPage: 1 },
      { title: "x".repeat(121), firstPrintedPage: 1 },
      { title: "T", firstPrintedPage: -1 },
      { title: "T", firstPrintedPage: 1.5 },
      { title: "T", firstPrintedPage: 10_000 },
    ]) {
      expect(errorCode(await fail(gm.mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, ...args })))).toBe("INVALID");
    }
    expect(await fileGone(w.t, storageId)).toBe(false);
  });

  it("shows a failed read, removes its empty book and prunes the failure on the next upload", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const notPdf = await upload(w.t, new TextEncoder().encode("plain text pretending"));
    const started = await gm.mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId: notPdf, title: "Fake", firstPrintedPage: 1 });
    expect(started.ok).toBe(true);
    await runScheduled(w.t);
    expect(await fileGone(w.t, notPdf)).toBe(true);
    expect(await gm.query(api.campaignBooks.list, { campaignId: w.campaignId })).toEqual({
      books: [],
      failures: [{ title: "Fake", finishedAt: NOW, code: "BOOK_NOT_PDF" }],
    });
    await addSalt(w);
    const after = await gm.query(api.campaignBooks.list, { campaignId: w.campaignId });
    expect(after.failures).toEqual([]);
    expect(await w.t.run((ctx) => ctx.db.query("lorekeeperIngests").collect())).toHaveLength(1);
  });

  it("never turns a book removed during its read into a shared book", async () => {
    const w = await buildWorld();
    const storageId = await upload(w.t, SALT);
    const started = await w.as("gm").mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, title: "Gone", firstPrintedPage: 1 });
    const bookId = started.ok ? started.bookId : null!;
    // As the purge would: the book goes while PDF0 is about to re-register it.
    await w.t.run((ctx) => ctx.db.delete("lorekeeperBooks", bookId));
    await runScheduled(w.t).catch(() => undefined);
    const books = await w.t.run((ctx) => ctx.db.query("lorekeeperBooks").collect());
    expect(books.filter((b) => b.key.startsWith("campaign:"))).toEqual([]);
    expect(await fileGone(w.t, storageId)).toBe(true);
    expect(errorCode(await fail(w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: `campaign:${w.campaignId}:9`, pages: 1 })))).toBe(
      "LOREKEEPER_BOOK_NOT_FOUND",
    );
  });

  it("is refused for owner keys in the admin library: campaign keys are never shared uploads", async () => {
    const w = await buildWorld();
    const storageId = await upload(w.t, SALT);
    expect(
      errorCode(await fail(w.as("appOwner").mutation(api.adminLibrary.ingest, { storageId, bookKey: `campaign:${w.campaignId}:1`, firstPrintedPage: 1 }))),
    ).toBe("INVALID");
  });
});

describe("campaignBooks.remove", () => {
  allowWorldEmails();

  it("deletes the book, its switch and status rows now and its chunks in scheduled batches", async () => {
    const w = await buildWorld();
    const { bookId } = await addSalt(w);
    await w.as("gm").mutation(api.lorekeeperLibrary.setEnabled, { campaignId: w.campaignId, bookId, enabled: false });
    await w.t.run(async (ctx) => {
      for (let i = 0; i < CHUNK_DELETE_BATCH + 20; i++) await ctx.db.insert("lorekeeperChunks", { bookId, page: 1, section: "S", text: `t${i}`, ord: 100 + i });
    });

    await w.as("coGm").mutation(api.campaignBooks.remove, { campaignId: w.campaignId, bookId });
    const now = await w.t.run(async (ctx) => ({
      book: await ctx.db.get("lorekeeperBooks", bookId),
      switches: (await ctx.db.query("lorekeeperLibrary").collect()).length,
      ingests: (await ctx.db.query("lorekeeperIngests").collect()).length,
    }));
    expect(now).toEqual({ book: null, switches: 0, ingests: 0 });
    await runScheduled(w.t);
    expect(await chunksOf(w.t, bookId)).toEqual([]);
    expect(await w.as("gm").query(api.campaignBooks.list, { campaignId: w.campaignId })).toEqual({ books: [], failures: [] });
  });

  it("refuses another campaign's book, a shared book and a book still being read", async () => {
    const w = await buildWorld();
    const { bookId } = await addSalt(w);
    const elsewhere = await otherCampaign(w);
    expect(errorCode(await fail(w.as("outsider").mutation(api.campaignBooks.remove, { campaignId: elsewhere, bookId })))).toBe("LOREKEEPER_BOOK_NOT_FOUND");
    const { bookId: core } = await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "core", pages: 1 });
    expect(errorCode(await fail(w.as("gm").mutation(api.campaignBooks.remove, { campaignId: w.campaignId, bookId: core })))).toBe("LOREKEEPER_BOOK_NOT_FOUND");

    const storageId = await upload(w.t, SALT);
    const started = await w.as("gm").mutation(api.campaignBooks.add, { campaignId: w.campaignId, storageId, title: "Busy", firstPrintedPage: 1 });
    const busy = started.ok ? started.bookId : null!;
    expect(errorCode(await fail(w.as("gm").mutation(api.campaignBooks.remove, { campaignId: w.campaignId, bookId: busy })))).toBe("BOOK_INGEST_RUNNING");
    expect(await w.t.run((ctx) => ctx.db.get("lorekeeperBooks", bookId))).not.toBeNull();
  });
});

describe("campaign purge (config LB1)", () => {
  allowWorldEmails();

  it("deletes the campaign's books, chunks and status rows and keeps the shared books and other campaigns' books", async () => {
    const w = await buildWorld();
    const { bookId } = await addSalt(w);
    const { bookId: core } = await w.t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey: "core", pages: 1 });
    const elsewhere = await otherCampaign(w);
    const storageId = await upload(w.t, SALT);
    const other = await w.as("outsider").mutation(api.campaignBooks.add, { campaignId: elsewhere, storageId, title: "Kept", firstPrintedPage: 1 });
    await runScheduled(w.t);
    const otherId = other.ok ? other.bookId : null!;

    await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId, { deletedAt: NOW - 31 * DAY }));
    await w.t.mutation(internal.cleanup.purgeCampaign, { campaignId: w.campaignId });
    await runScheduled(w.t);

    const left = await w.t.run(async (ctx) => ({
      books: (await ctx.db.query("lorekeeperBooks").collect()).map((b) => b._id),
      ingests: (await ctx.db.query("lorekeeperIngests").collect()).map((r) => r.bookId),
    }));
    expect(left.books).not.toContain(bookId);
    expect(left.books).toEqual(expect.arrayContaining([core, otherId]));
    expect(left.ingests).toEqual([otherId]);
    expect(await chunksOf(w.t, bookId)).toEqual([]);
    expect((await chunksOf(w.t, otherId)).length).toBeGreaterThan(0);
  });
});
