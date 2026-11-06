// @vitest-environment node
// The scheduled PDF0 action is "use node" (unpdf), so this file runs in Node like tests/convex/pdf-ingest.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { INGEST_STALE_MS, TITLE_MAX } from "../../convex/adminLibrary";
import { PDF_MAX_BYTES } from "../../convex/lib/pdf/config";
import { buildPdf } from "../fixtures/pdf/make-pdf";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD8 (Q23 b, N6 b, N8 a): the owner uploads or replaces a shared book as a PDF from the admin; PDF0 reads it.
 * docs/tasks/TASK-CONFIG-AD8.md. The fixture holds our own invented text (never rulebook text).
 */

const SAMPLE = new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", "pdf", "sample.pdf")));
const NOW = new Date("2026-11-04T12:00:00Z").getTime();

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 });
    const other = await ctx.db.insert("users", { email: "other@example.com", emailVerificationTime: 1 });
    await ctx.db.insert("appConfig", { key: "app", ownerId: owner, updatedAt: NOW });
    return { owner, other };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), other: as(ids.other) };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type T = Setup["t"];

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

async function bookOf(t: T, key: string) {
  return t.run((ctx) =>
    ctx.db
      .query("lorekeeperBooks")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first(),
  );
}

async function chunksOf(t: T, bookId: Id<"lorekeeperBooks">) {
  return t.run((ctx) =>
    ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", bookId))
      .collect(),
  );
}

const audits = (t: T) => t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());

describe("adminLibrary access", () => {
  it("refuses everyone but the owner", async () => {
    const { t, other } = await setup();
    expect(errorCode(await fail(t.query(api.adminLibrary.list, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(other.query(api.adminLibrary.list, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(other.mutation(api.adminLibrary.uploadUrl, {})))).toBe("FORBIDDEN");
    const storageId = await upload(t, SAMPLE);
    expect(errorCode(await fail(other.mutation(api.adminLibrary.ingest, { storageId, bookKey: "core", firstPrintedPage: 1 })))).toBe(
      "FORBIDDEN",
    );
    expect(await fileGone(t, storageId)).toBe(false);
  });

  it("rate-limits upload URLs", async () => {
    const { owner } = await setup();
    for (let i = 0; i < 20; i++) expect(typeof (await owner.mutation(api.adminLibrary.uploadUrl, {}))).toBe("string");
    expect(errorCode(await fail(owner.mutation(api.adminLibrary.uploadUrl, {})))).toBe("RATE_LIMITED");
  });
});

describe("adminLibrary.ingest", () => {
  it("uploads a new book: running, then PDF0 reads it onto printed pages, the file goes and the change is audited", async () => {
    const { t, owner, ids } = await setup();
    expect((await owner.query(api.adminLibrary.list, {})).available.map((a) => a.key)).toContain("core");
    const storageId = await upload(t, SAMPLE);

    const started = await owner.mutation(api.adminLibrary.ingest, { storageId, bookKey: "core", title: "  My Core  ", firstPrintedPage: 11 });
    expect(started.ok).toBe(true);
    const running = await owner.query(api.adminLibrary.ingestStatus, { bookKey: "core" });
    expect(running).toMatchObject({ bookKey: "core", status: "running", firstPrintedPage: 11, title: "My Core", result: null, finishedAt: null });

    await runScheduled(t);

    const status = await owner.query(api.adminLibrary.ingestStatus, { bookKey: "core" });
    const book = await bookOf(t, "core");
    const chunks = await chunksOf(t, book!._id);
    expect(status).toMatchObject({ status: "done", result: { ok: true, pages: 3, chunks: chunks.length, firstPage: 11, lastPage: 13 } });
    expect(book).toMatchObject({ title: "My Core", pages: 3, chunkCount: chunks.length });
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([11, 12, 13]));
    expect(await fileGone(t, storageId)).toBe(true);

    const library = await owner.query(api.adminLibrary.list, {});
    expect(library.books).toEqual([
      { bookId: book!._id, key: "core", title: "My Core", subtitle: "Rules, classes, adversaries", pages: 3, chunkCount: chunks.length, ingestedAt: NOW },
    ]);
    expect(library.available.map((a) => a.key)).not.toContain("core");
    expect(library.available.map((a) => a.key)).not.toContain("houseRules");
    expect(await audits(t)).toMatchObject([{ action: "library.upload", actorId: ids.owner, field: "core", to: "My Core", target: book!._id }]);
  });

  it("replaces a book: new text and title only once the new PDF is read; audited as a replace", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, SAMPLE), bookKey: "hopeFear", firstPrintedPage: 1 });
    await runScheduled(t);
    const bookId = (await bookOf(t, "hopeFear"))!._id;

    const second = buildPdf([["FERRY RULES", "The ferry leaves when the bell rings twice and never waits for latecomers."]]);
    const started = await owner.mutation(api.adminLibrary.ingest, {
      storageId: await upload(t, second),
      bookKey: "hopeFear",
      title: "Hope & Fear, 2nd printing",
      firstPrintedPage: 5,
    });
    expect(started).toEqual({ ok: true, bookId });
    expect((await bookOf(t, "hopeFear"))?.title).toBe("Hope & Fear"); // not yet
    await runScheduled(t);

    expect(await bookOf(t, "hopeFear")).toMatchObject({ _id: bookId, title: "Hope & Fear, 2nd printing", pages: 1, chunkCount: 1 });
    expect((await chunksOf(t, bookId)).map((c) => c.page)).toEqual([5]);
    expect((await audits(t)).map((a) => [a.action, a.from, a.to])).toEqual([
      ["library.upload", undefined, "Hope & Fear"],
      ["library.replace", "Hope & Fear", "Hope & Fear, 2nd printing"],
    ]);
  });

  it("a failed replace keeps the old text and title", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, SAMPLE), bookKey: "core", firstPrintedPage: 1 });
    await runScheduled(t);
    const before = await bookOf(t, "core");

    const html = await upload(t, new TextEncoder().encode("<!doctype html><p>not a pdf</p>"));
    await owner.mutation(api.adminLibrary.ingest, { storageId: html, bookKey: "core", title: "Broken", firstPrintedPage: 1 });
    await runScheduled(t);

    expect(await owner.query(api.adminLibrary.ingestStatus, { bookKey: "core" })).toMatchObject({
      status: "failed",
      result: { ok: false, code: "BOOK_NOT_PDF" },
    });
    expect(await bookOf(t, "core")).toMatchObject({ _id: before!._id, title: before!.title, chunkCount: before!.chunkCount });
    expect(await fileGone(t, html)).toBe(true);
  });

  it("a failed first upload removes the empty book again and keeps the failure", async () => {
    const { t, owner } = await setup();
    const scanned = buildPdf([[], [], []]);
    await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, scanned), bookKey: "frame:witherwild", firstPrintedPage: 1 });
    expect(await bookOf(t, "frame:witherwild")).not.toBeNull(); // the action needs a book row
    await runScheduled(t);

    expect(await bookOf(t, "frame:witherwild")).toBeNull();
    expect(await owner.query(api.adminLibrary.ingestStatus, { bookKey: "frame:witherwild" })).toMatchObject({
      status: "failed",
      result: { ok: false, code: "BOOK_PARSE_FAILED" },
    });
    expect((await owner.query(api.adminLibrary.list, {})).available.map((a) => a.key)).toContain("frame:witherwild");
  });

  it("refuses a recorded type other than application/pdf, or none, and deletes the file", async () => {
    const { t, owner } = await setup();
    for (const type of ["image/png", "application/x-pdf", null]) {
      const storageId = await upload(t, SAMPLE, type);
      expect(await owner.mutation(api.adminLibrary.ingest, { storageId, bookKey: "core", firstPrintedPage: 1 })).toEqual({
        ok: false,
        code: "BOOK_NOT_PDF",
      });
      expect(await fileGone(t, storageId)).toBe(true);
    }
    expect(await bookOf(t, "core")).toBeNull();
    expect(await owner.query(api.adminLibrary.ingestStatus, { bookKey: "core" })).toBeNull();
    expect(await audits(t)).toEqual([]);
  });

  it("refuses a file over 20 MB and deletes it", async () => {
    const { t, owner } = await setup();
    const big = new Uint8Array(PDF_MAX_BYTES + 1);
    big.set(SAMPLE);
    const storageId = await upload(t, big);
    expect(await owner.mutation(api.adminLibrary.ingest, { storageId, bookKey: "core", firstPrintedPage: 1 })).toEqual({
      ok: false,
      code: "BOOK_TOO_LARGE",
    });
    expect(await fileGone(t, storageId)).toBe(true);
  });

  it("allows one running ingest per book; a stale one no longer blocks", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, SAMPLE), bookKey: "core", firstPrintedPage: 1 });
    const second = await upload(t, SAMPLE);
    expect(await owner.mutation(api.adminLibrary.ingest, { storageId: second, bookKey: "core", firstPrintedPage: 1 })).toEqual({
      ok: false,
      code: "BOOK_INGEST_RUNNING",
    });
    expect(await fileGone(t, second)).toBe(true);
    // Another book is not blocked.
    expect((await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, SAMPLE), bookKey: "hopeFear", firstPrintedPage: 1 })).ok).toBe(
      true,
    );

    // The first run was killed before it reported: after INGEST_STALE_MS it reads as failed and a new upload may start.
    vi.setSystemTime(NOW + INGEST_STALE_MS + 1);
    expect(await owner.query(api.adminLibrary.ingestStatus, { bookKey: "core" })).toMatchObject({
      status: "failed",
      result: { ok: false, code: "BOOK_PARSE_FAILED" },
    });
    expect((await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, SAMPLE), bookKey: "core", firstPrintedPage: 1 })).ok).toBe(true);
  });

  it("never takes a recorded file's storage id, and never deletes it (CF17)", async () => {
    const { t, owner, other, ids } = await setup();
    const storageId = await upload(t, SAMPLE);
    const { campaignId } = await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "C", idempotencyKey: key() });
    await t.run((ctx) =>
      ctx.db.insert("files", { storageId, campaignId, uploadedBy: ids.other, kind: "map", refId: campaignId, createdAt: NOW }),
    );
    expect(errorCode(await fail(owner.mutation(api.adminLibrary.ingest, { storageId, bookKey: "core", firstPrintedPage: 1 })))).toBe("NOT_FOUND");
    expect(await fileGone(t, storageId)).toBe(false);

    const gone = await upload(t, SAMPLE);
    await t.run((ctx) => ctx.storage.delete(gone));
    expect(errorCode(await fail(owner.mutation(api.adminLibrary.ingest, { storageId: gone, bookKey: "core", firstPrintedPage: 1 })))).toBe("NOT_FOUND");
  });

  it("refuses unknown keys, the house-rules book, bad first pages and long titles as INVALID", async () => {
    const { t, owner } = await setup();
    const storageId = await upload(t, SAMPLE);
    const call = (args: { bookKey: string; firstPrintedPage: number; title?: string }) =>
      fail(owner.mutation(api.adminLibrary.ingest, { storageId, ...args }));
    expect(errorCode(await call({ bookKey: "houseRules", firstPrintedPage: 1 }))).toBe("INVALID");
    expect(errorCode(await call({ bookKey: "mystery", firstPrintedPage: 1 }))).toBe("INVALID");
    expect(errorCode(await call({ bookKey: "frame:custom", firstPrintedPage: 1 }))).toBe("INVALID");
    expect(errorCode(await call({ bookKey: "core", firstPrintedPage: -1 }))).toBe("INVALID");
    expect(errorCode(await call({ bookKey: "core", firstPrintedPage: 1.5 }))).toBe("INVALID");
    expect(errorCode(await call({ bookKey: "core", firstPrintedPage: 10000 }))).toBe("INVALID");
    expect(errorCode(await call({ bookKey: "core", firstPrintedPage: 1, title: "x".repeat(TITLE_MAX + 1) }))).toBe("INVALID");
    expect(await bookOf(t, "core")).toBeNull();
  });

  it("recordIngest ignores a result for a book with no running ingest", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.adminLibrary.ingest, { storageId: await upload(t, SAMPLE), bookKey: "core", firstPrintedPage: 1 });
    await runScheduled(t);
    const bookId = (await bookOf(t, "core"))!._id;
    await t.mutation(internal.adminLibrary.recordIngest, { bookId, result: { ok: false, code: "BOOK_PARSE_FAILED" } });
    expect(await owner.query(api.adminLibrary.ingestStatus, { bookKey: "core" })).toMatchObject({ status: "done" });
    expect(await bookOf(t, "core")).not.toBeNull();
  });
});
