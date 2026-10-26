import { z } from "zod";

import { codexEntryDataSchema, emptyEntry, MAX_CODEX_ENTRIES, MAX_CODEX_IMAGES, type CodexEntryData, type CodexKind } from "../../src/lib/codex/schema";
import { seedCharacters } from "../../src/lib/codex/seed";
import { appError } from "../../src/lib/errors/app-error";
import { MAX_TOKENS, type MapToken } from "../../src/lib/world/map-state";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { parseOrCorrupt } from "./blobs";
import { listMapTokens, toToken, tokenRow } from "./maps";
import { campaignScope } from "./operations";

// Characters & Locations storage (H15). An entry row holds its summary
// fields (`codex.list` reads them all); its long text lives in one
// `codexEntryText` row read only by `codex.entryText`; a per-campaign
// `codexCounters` row counts the entries (CD14).

export const ENTRY_VERSION = 2;

/** Version 2 `codexEntries.data`: the summary fields, without the long text. */
export const entrySummarySchema = codexEntryDataSchema.omit({ pdesc: true, gmn: true }).extend({ schemaVersion: z.literal(ENTRY_VERSION) });
const entryTextSchema = codexEntryDataSchema.pick({ pdesc: true, gmn: true });

export type EntrySummary = Omit<CodexEntryData, "pdesc" | "gmn">;
export type EntryText = Pick<CodexEntryData, "pdesc" | "gmn">;

/**
 * An entry's stored data by version (CD3): `legacyText` is the text still
 * inline in a version 1 row (no `schemaVersion`), else null. Throws CODEX_CORRUPT.
 */
export function storedEntry(raw: unknown): { summary: EntrySummary; legacyText: EntryText | null } {
  const version = typeof raw === "object" && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version === undefined) {
    const { pdesc, gmn, ...summary } = parseOrCorrupt(codexEntryDataSchema, raw, "CODEX_CORRUPT");
    return { summary, legacyText: { pdesc, gmn } };
  }
  const parsed: Partial<z.output<typeof entrySummarySchema>> & EntrySummary = parseOrCorrupt(entrySummarySchema, raw, "CODEX_CORRUPT");
  delete parsed.schemaVersion;
  return { summary: parsed, legacyText: null };
}

/** The version 2 data to store, or INVALID with the first problem. */
function summaryData(summary: EntrySummary) {
  const parsed = entrySummarySchema.safeParse({ ...summary, schemaVersion: ENTRY_VERSION });
  if (!parsed.success) throw appError("INVALID", parsed.error.issues[0]?.message ?? "Invalid entry.");
  return parsed.data;
}

function textRow(ctx: QueryCtx, entryId: Id<"codexEntries">) {
  return ctx.db
    .query("codexEntryText")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .unique();
}

/** The entry's long text: its `codexEntryText` row, else the text still inline in a version 1 row, else empty. */
export async function readText(ctx: QueryCtx, entry: Doc<"codexEntries">): Promise<EntryText> {
  const row = await textRow(ctx, entry._id);
  if (row) return { pdesc: row.pdesc, gmn: row.gmn };
  return storedEntry(entry.data).legacyText ?? { pdesc: "", gmn: "" };
}

/** Stores the entry's long text (merged over what it has), or INVALID. */
export async function writeText(ctx: MutationCtx, entry: Doc<"codexEntries">, patch: Partial<EntryText>): Promise<void> {
  const row = await textRow(ctx, entry._id);
  const current = row ? { pdesc: row.pdesc, gmn: row.gmn } : (storedEntry(entry.data).legacyText ?? { pdesc: "", gmn: "" });
  const parsed = entryTextSchema.safeParse({ ...current, ...patch });
  if (!parsed.success) throw appError("INVALID", parsed.error.issues[0]?.message ?? "Invalid entry.");
  if (row) await ctx.db.patch("codexEntryText", row._id, parsed.data);
  else await ctx.db.insert("codexEntryText", { campaignId: entry.campaignId, entryId: entry._id, ...parsed.data });
}

/**
 * Stores the entry's summary as version 2. A version 1 row moves its inline
 * text to `codexEntryText` first, so every write leaves a split entry.
 */
export async function saveSummary(ctx: MutationCtx, entry: Doc<"codexEntries">, summary: EntrySummary): Promise<void> {
  const data = summaryData(summary);
  const { legacyText } = storedEntry(entry.data);
  if (legacyText !== null && (await textRow(ctx, entry._id)) === null) {
    await ctx.db.insert("codexEntryText", { campaignId: entry.campaignId, entryId: entry._id, ...legacyText });
  }
  await ctx.db.patch("codexEntries", entry._id, { data, updatedAt: Date.now() });
}

/** Deletes the entry's text row (the entry itself and its files are deleted by the caller). */
export async function deleteText(ctx: MutationCtx, entryId: Id<"codexEntries">): Promise<void> {
  const row = await textRow(ctx, entryId);
  if (row) await ctx.db.delete("codexEntryText", row._id);
}

/** The campaign's entries of one kind; capped by MAX_CODEX_ENTRIES, so the range is bounded. */
export function entriesOfKind(ctx: QueryCtx, campaignId: Id<"campaigns">, kind: CodexKind) {
  return ctx.db
    .query("codexEntries")
    .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campaignId).eq("kind", kind))
    .take(MAX_CODEX_ENTRIES);
}

/** Every entry, newest first (the board puts new entries on top); entries created together keep their order. */
export async function campaignEntries(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  const rows = [...(await entriesOfKind(ctx, campaignId, "character")), ...(await entriesOfKind(ctx, campaignId, "location"))];
  return rows.sort((a, b) => b.createdAt - a.createdAt || a._creationTime - b._creationTime);
}

/** Every codex image file of the campaign by storage id (at most MAX_CODEX_IMAGES per entry): one index range. */
export async function codexImageFiles(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Map<string, Doc<"files">>> {
  const rows = await ctx.db
    .query("files")
    .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campaignId).eq("kind", "codexImage"))
    .take(MAX_CODEX_ENTRIES * MAX_CODEX_IMAGES);
  return new Map(rows.map((row) => [row.storageId, row]));
}

/** URL of one of the entry's own image files (CF17: resolved through its `files` row), or null. */
export async function imageUrl(ctx: QueryCtx, files: Map<string, Doc<"files">>, entryId: Id<"codexEntries">, storageId: string): Promise<string | null> {
  const file = files.get(storageId);
  if (file === undefined || file.refId !== entryId) return null;
  return ctx.storage.getUrl(file.storageId).catch(() => null);
}

/**
 * The campaign's map markers (codex pins). Reads the marker rows only; just a
 * map with no marker rows (none placed, or a version 1 map not split yet)
 * falls back to `listMapTokens`. None when the map is unreadable: the codex still works.
 */
export async function pinTokens(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<MapToken[]> {
  const rows = await ctx.db
    .query("mapTokens")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId))
    .take(MAX_TOKENS);
  if (rows.length > 0) return rows.map(toToken);
  try {
    return await listMapTokens(ctx, campaignId);
  } catch {
    return [];
  }
}

/** Whether the map has a marker with this id. */
export async function hasToken(ctx: QueryCtx, campaignId: Id<"campaigns">, tokenId: number): Promise<boolean> {
  if ((await tokenRow(ctx, campaignId, tokenId)) !== null) return true;
  return (await pinTokens(ctx, campaignId)).some((t) => t.id === tokenId);
}

// ---- the entry counter

type Counter = { rowId: Id<"codexCounters"> | null; entries: number; seeded: boolean };

/**
 * The campaign's counter. A campaign from before the counter is counted once
 * (bounded by the cap) and counts as seeded when the old `codex:seed`
 * operation ran or it already has entries; the caller's write stores it.
 */
export async function readCounter(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Counter> {
  const row = await ctx.db
    .query("codexCounters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  if (row) return { rowId: row._id, entries: row.entries, seeded: row.seeded };
  return { rowId: null, ...(await legacyCount(ctx, campaignId)) };
}

/** Counts a campaign from before the counter (`readCounter`, `migrations/codex:countEntries`). */
export async function legacyCount(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<{ entries: number; seeded: boolean }> {
  const entries = (await entriesOfKind(ctx, campaignId, "character")).length + (await entriesOfKind(ctx, campaignId, "location")).length;
  const seedOp = await ctx.db
    .query("operations")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", campaignScope(campaignId)).eq("idempotencyKey", "codex:seed"))
    .unique();
  return { entries, seeded: seedOp !== null || entries > 0 };
}

export async function writeCounter(ctx: MutationCtx, campaignId: Id<"campaigns">, counter: Counter, next: { entries: number; seeded: boolean }): Promise<void> {
  if (counter.rowId) await ctx.db.patch("codexCounters", counter.rowId, next);
  else await ctx.db.insert("codexCounters", { campaignId, ...next });
}

/** Room for `n` more entries, or INVALID; returns the counter to update after inserting. */
export async function reserveEntries(ctx: MutationCtx, campaignId: Id<"campaigns">, n: number): Promise<Counter> {
  const counter = await readCounter(ctx, campaignId);
  if (counter.entries + n > MAX_CODEX_ENTRIES) throw appError("INVALID", `A campaign holds at most ${MAX_CODEX_ENTRIES} entries.`);
  return counter;
}

/** Inserts an entry as version 2 (its text, when any, as a text row). Count it with the counter. */
export async function insertEntry(ctx: MutationCtx, campaignId: Id<"campaigns">, kind: CodexKind, entry: CodexEntryData, now: number) {
  const { pdesc, gmn, ...summary } = entry;
  const entryId = await ctx.db.insert("codexEntries", { campaignId, kind, data: summaryData(summary), createdAt: now, updatedAt: now });
  if (pdesc !== "" || gmn !== "") await ctx.db.insert("codexEntryText", { campaignId, entryId, ...entryTextSchema.parse({ pdesc, gmn }) });
  return entryId;
}

/**
 * Creates the frame's starting characters (all secret, with their true
 * allegiance) once per campaign: `campaigns.create` calls it for every new
 * campaign, `codex.seed` for older ones. Idempotent through the counter's
 * `seeded` flag; stops at the entry cap.
 */
export async function seedCodex(ctx: MutationCtx, campaignId: Id<"campaigns">, frameId: string): Promise<{ created: number }> {
  const counter = await readCounter(ctx, campaignId);
  if (counter.seeded) {
    if (counter.rowId === null) await writeCounter(ctx, campaignId, counter, { entries: counter.entries, seeded: true });
    return { created: 0 };
  }
  const now = Date.now();
  const seeds = seedCharacters(frameId).slice(0, Math.max(0, MAX_CODEX_ENTRIES - counter.entries));
  for (const s of seeds) {
    await insertEntry(ctx, campaignId, "character", emptyEntry({ name: s.name, role: s.role, allegiance: s.allegiance ?? "" }), now);
  }
  await writeCounter(ctx, campaignId, counter, { entries: counter.entries + seeds.length, seeded: true });
  return { created: seeds.length };
}
