import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { internalQuery } from "../../_generated/server";

/**
 * The one read the PDF ingest action (convex/pdfIngest.ts) needs before it downloads anything: the target book's
 * metadata (so `ingestBook` can re-register it unchanged) and the uploaded file's recorded size and type. Internal
 * only; the module path is `lib/pdf/books`.
 */

const targetValidator = v.object({
  book: v.union(v.null(), v.object({ key: v.string(), title: v.string(), subtitle: v.string(), cover: v.string() })),
  file: v.union(v.null(), v.object({ size: v.number(), contentType: v.optional(v.string()) })),
});

export type IngestTarget = {
  book: { key: string; title: string; subtitle: string; cover: string } | null;
  file: { size: number; contentType?: string } | null;
};

export const ingestTarget = internalQuery({
  args: { bookId: v.id("lorekeeperBooks"), storageId: v.id("_storage") },
  returns: targetValidator,
  handler: async (ctx, { bookId, storageId }): Promise<IngestTarget> => {
    const book = await ctx.db.get("lorekeeperBooks", bookId);
    const meta = await ctx.db.system.get("_storage", storageId);
    return {
      book: book === null ? null : { key: book.key, title: book.title, subtitle: book.subtitle, cover: book.cover },
      file:
        meta === null ? null : { size: meta.size, ...(meta.contentType === undefined ? {} : { contentType: meta.contentType }) },
    };
  },
});

// Typed reference by name, so callers need no regenerated `_generated/api` (the module is `lib/pdf/books`).
export const ingestTargetRef = makeFunctionReference<
  "query",
  { bookId: Id<"lorekeeperBooks">; storageId: Id<"_storage"> },
  IngestTarget
>("lib/pdf/books:ingestTarget");
