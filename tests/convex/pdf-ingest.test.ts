// @vitest-environment node
// The ingest action is "use node", so these tests run unpdf in Node (not the convex project's edge-runtime default).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { convexTest } from "convex-test";
import { createFunctionHandle, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { internalMutation } from "../../convex/_generated/server";
import { PDF_MAX_BYTES, PDF_MAX_PAGES, pdfIngestResultValidator, type PdfIngestResult } from "../../convex/lib/pdf/config";
import { readPdfPages } from "../../convex/lib/pdf/extract";
import { enoughText, isPdfHeader, pageHasText, pageTaggedText } from "../../convex/lib/pdf/pages";
import type { PdfIngestDone } from "../../convex/pdfIngest";
import schema from "../../convex/schema";
import { chunkBook } from "../../src/lib/lorekeeper/chunk";
import { buildPdf, SAMPLE_PAGES } from "../fixtures/pdf/make-pdf";
import { errorCode } from "./helpers";
import { modules } from "./setup";

// Config plan PDF0: an uploaded PDF becomes a Lorekeeper book's chunks, numbered by the printed page the uploader
// gives for the PDF's first page (N8 a); every refusal is a result code and the file is always deleted. The fixture
// tests/fixtures/pdf/sample.pdf holds our own invented text (never rulebook text).

const SAMPLE = new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", "pdf", "sample.pdf")));

type IngestArgs = { storageId: Id<"_storage">; bookId: Id<"lorekeeperBooks">; firstPrintedPage: number; onDone?: string };
const ingestPdf = makeFunctionReference<"action", IngestArgs, PdfIngestResult>("pdfIngest:ingestPdf");

// A stand-in for the caller's (AD8 / LB1) mutation that records the result: registered under a test-only module path.
const received: PdfIngestDone[] = [];
const recordDone = internalMutation({
  args: { bookId: v.id("lorekeeperBooks"), result: pdfIngestResultValidator },
  returns: v.null(),
  handler: async (_ctx, done) => {
    received.push(done);
    return null;
  },
});
const SINK_MODULE = Object.keys(modules)[0]!.replace(/convex\/.*$/, "convex/pdfIngestTestSink.ts");
const recordDoneRef = makeFunctionReference<"mutation", PdfIngestDone, null>("pdfIngestTestSink:recordDone");

function setup() {
  const t = convexTest(schema, { ...modules, [SINK_MODULE]: async () => ({ recordDone }) });
  return t;
}
type T = ReturnType<typeof setup>;

async function newBook(t: T, bookKey = "core"): Promise<Id<"lorekeeperBooks">> {
  const { bookId } = await t.mutation(internal.lorekeeperLibrary.ingestBook, { bookKey, pages: 0 });
  return bookId;
}

async function upload(t: T, bytes: Uint8Array, type = "application/pdf"): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));
}

async function fileGone(t: T, storageId: Id<"_storage">): Promise<boolean> {
  return (await t.run((ctx) => ctx.db.system.get("_storage", storageId))) === null;
}

async function chunksOf(t: T, bookId: Id<"lorekeeperBooks">) {
  return await t.run((ctx) =>
    ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", bookId))
      .collect(),
  );
}

describe("PDF helpers", () => {
  it("finds the %PDF- header only at the very start", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(isPdfHeader(enc("%PDF-1.7\n..."))).toBe(true);
    expect(isPdfHeader(enc("\n\n  %PDF-1.4"))).toBe(false);
    expect(isPdfHeader(enc("<!doctype html><p>%PDF</p>"))).toBe(false);
    expect(isPdfHeader(enc("%PDF"))).toBe(false);
    expect(isPdfHeader(new Uint8Array())).toBe(false);
  });

  it("counts a book readable when at least half its pages hold text", () => {
    const text = "A page of ordinary prose, long enough.";
    expect(pageHasText(text)).toBe(true);
    expect(pageHasText(" 12 \n ")).toBe(false);
    expect(enoughText([text, "", text, ""])).toBe(true);
    expect(enoughText([text, "", "", ""])).toBe(false);
    expect(enoughText([])).toBe(false);
  });

  it("numbers pages from the uploader's first printed page and drops fake page markers", () => {
    const tagged = pageTaggedText(["ALPHA\nfirst body text here", "===== PAGE 900 =====\nsecond body text"], 40);
    expect(tagged).not.toContain("PAGE 900");
    const chunks = chunkBook(tagged, { minChars: 0 });
    expect(chunks.map((c) => c.page)).toEqual([40, 41]);
    expect(chunks[0]!.section).toBe("Alpha");
    expect(pageTaggedText(["only page"], 0)).toContain("===== PAGE 1 =====");
  });

  it("the committed fixture is what make-pdf.ts writes", () => {
    expect(Buffer.from(buildPdf(SAMPLE_PAGES)).equals(Buffer.from(SAMPLE))).toBe(true);
  });

  it("reads the fixture's text page by page with unpdf", async () => {
    const read = await readPdfPages(SAMPLE, PDF_MAX_PAGES);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.pages).toHaveLength(3);
    expect(read.pages[0]).toContain("LANTERN KEEPING");
    expect(read.pages[1]).toContain("harbour master");
    expect(read.pages[2]).toContain("cheese sellers");
  });
});

describe("pdfIngest.ingestPdf", () => {
  it("chunks the PDF onto printed pages, updates the book, deletes the file and tells onDone", async () => {
    const t = setup();
    const bookId = await newBook(t);
    const storageId = await upload(t, SAMPLE);
    const onDone = await t.run(() => createFunctionHandle(recordDoneRef));
    received.length = 0;

    const result = await t.action(ingestPdf, { storageId, bookId, firstPrintedPage: 11, onDone });

    const chunks = await chunksOf(t, bookId);
    expect(result).toEqual({ ok: true, pages: 3, chunks: chunks.length, firstPage: 11, lastPage: 13 });
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([11, 12, 13]));
    const tides = chunks.find((c) => c.text.includes("harbour master"));
    expect(tides?.page).toBe(12);
    expect(tides?.section).toBe("Harbour Life → Tide Charts");
    expect(chunks.some((c) => c.text.includes("Chapter 2"))).toBe(false); // the footer is not body text
    const book = await t.run((ctx) => ctx.db.get("lorekeeperBooks", bookId));
    expect(book).toMatchObject({ key: "core", title: "Daggerheart Core Rulebook", pages: 3, chunkCount: chunks.length });
    expect(await fileGone(t, storageId)).toBe(true);
    expect(received).toEqual([{ bookId, result }]);
  });

  it("a re-upload replaces the book's chunks instead of adding to them", async () => {
    const t = setup();
    const bookId = await newBook(t);
    await t.action(ingestPdf, { storageId: await upload(t, SAMPLE), bookId, firstPrintedPage: 1 });
    const second = buildPdf([["FERRY RULES", "The ferry leaves when the bell rings twice and never waits for latecomers."]]);
    const result = await t.action(ingestPdf, { storageId: await upload(t, second), bookId, firstPrintedPage: 5 });

    const chunks = await chunksOf(t, bookId);
    expect(result).toMatchObject({ ok: true, pages: 1, chunks: 1 });
    expect(chunks.map((c) => [c.page, c.ord])).toEqual([[5, 0]]);
    expect((await t.run((ctx) => ctx.db.get("lorekeeperBooks", bookId)))?.chunkCount).toBe(1);
  });

  it("refuses files that aren't PDFs, keeps the old text and deletes the file", async () => {
    const t = setup();
    const bookId = await newBook(t);
    await t.action(ingestPdf, { storageId: await upload(t, SAMPLE), bookId, firstPrintedPage: 1 });
    const before = (await chunksOf(t, bookId)).length;

    const html = await upload(t, new TextEncoder().encode("<!doctype html><script>alert(1)</script>"));
    // convex-test records no content type, so the recorded-type check is exercised by the callers' tests (AD8, LB1).
    const png = await upload(t, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...SAMPLE]));
    expect(await t.action(ingestPdf, { storageId: html, bookId, firstPrintedPage: 1 })).toEqual({ ok: false, code: "BOOK_NOT_PDF" });
    expect(await t.action(ingestPdf, { storageId: png, bookId, firstPrintedPage: 1 })).toEqual({ ok: false, code: "BOOK_NOT_PDF" });

    expect(await fileGone(t, html)).toBe(true);
    expect(await fileGone(t, png)).toBe(true);
    expect((await chunksOf(t, bookId)).length).toBe(before);
  });

  it("refuses a file over 20 MB and a PDF over 300 pages as BOOK_TOO_LARGE", async () => {
    const t = setup();
    const bookId = await newBook(t);
    const big = new Uint8Array(PDF_MAX_BYTES + 1);
    big.set(SAMPLE);
    const bigId = await upload(t, big);
    const long = await upload(t, buildPdf(Array.from({ length: PDF_MAX_PAGES + 1 }, (_, i) => [`Page ${i} of a very long ledger.`])));

    expect(await t.action(ingestPdf, { storageId: bigId, bookId, firstPrintedPage: 1 })).toEqual({ ok: false, code: "BOOK_TOO_LARGE" });
    expect(await t.action(ingestPdf, { storageId: long, bookId, firstPrintedPage: 1 })).toEqual({ ok: false, code: "BOOK_TOO_LARGE" });
    expect(await fileGone(t, bigId)).toBe(true);
    expect(await fileGone(t, long)).toBe(true);
    expect(await chunksOf(t, bookId)).toEqual([]);
  });

  it("refuses a scanned book (fewer than half the pages with text) and a damaged PDF as BOOK_PARSE_FAILED", async () => {
    const t = setup();
    const bookId = await newBook(t);
    const scanned = await upload(t, buildPdf([[], ["One page of real text in a scanned book."], [], []]));
    const damaged = await upload(t, new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf at all\n%%EOF\n"));

    expect(await t.action(ingestPdf, { storageId: scanned, bookId, firstPrintedPage: 1 })).toEqual({
      ok: false,
      code: "BOOK_PARSE_FAILED",
    });
    expect(await t.action(ingestPdf, { storageId: damaged, bookId, firstPrintedPage: 1 })).toEqual({
      ok: false,
      code: "BOOK_PARSE_FAILED",
    });
    expect(await fileGone(t, scanned)).toBe(true);
    expect(await fileGone(t, damaged)).toBe(true);
  });

  it("accepts a book where exactly half the pages have text", async () => {
    const t = setup();
    const bookId = await newBook(t);
    const half = await upload(t, buildPdf([[], ["MAPS", "The cartographer inks the coastline before the rivers."]]));
    expect(await t.action(ingestPdf, { storageId: half, bookId, firstPrintedPage: 1 })).toMatchObject({ ok: true, pages: 2 });
  });

  it("reports a missing book, and still deletes the file and tells onDone", async () => {
    const t = setup();
    const bookId = await newBook(t, "hopeFear");
    await t.mutation(internal.lorekeeperLibrary.deleteBook, { bookId });
    const storageId = await upload(t, SAMPLE);
    const onDone = await t.run(() => createFunctionHandle(recordDoneRef));
    received.length = 0;

    const result = await t.action(ingestPdf, { storageId, bookId, firstPrintedPage: 1, onDone });
    expect(result).toEqual({ ok: false, code: "LOREKEEPER_BOOK_NOT_FOUND" });
    expect(await fileGone(t, storageId)).toBe(true);
    expect(received).toEqual([{ bookId, result }]);
  });

  it("throws INVALID for a bad first page number and deletes the file", async () => {
    const t = setup();
    const bookId = await newBook(t);
    for (const firstPrintedPage of [-1, 1.5, 10_000]) {
      const storageId = await upload(t, SAMPLE);
      const error = await t.action(ingestPdf, { storageId, bookId, firstPrintedPage }).catch((e: unknown) => e);
      expect(errorCode(error)).toBe("INVALID");
      expect(await fileGone(t, storageId)).toBe(true);
    }
  });
});
