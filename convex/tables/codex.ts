import { defineTable } from "convex/server";
import { v } from "convex/values";

import { codexKindValidator } from "../lib/validators/codex";

export const codexTables = {
  /**
   * Characters & Locations entries (D7), one row each. `data` is read by
   * `storedEntry` (convex/lib/codex.ts): version 2 (`schemaVersion: 2`) holds
   * the summary fields only, its long text lives in `codexEntryText`; version
   * 1 (no `schemaVersion`) still holds `pdesc` and `gmn` inline and is split
   * by its first edit or by `migrations/codex:splitText`. `data` stays
   * `v.any()` until that migration has run everywhere (widen → migrate →
   * narrow, CD4). Players see only entries marked known, revealed images and
   * the allegiance shown to them; GM notes never leave the server.
   */
  codexEntries: defineTable({
    campaignId: v.id("campaigns"),
    kind: codexKindValidator,
    data: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_campaign_kind", ["campaignId", "kind"]),

  /** An entry's long text (CD10): read only by `codex.entryText`, so `codex.list` stays small. At most one row per entry. */
  codexEntryText: defineTable({
    campaignId: v.id("campaigns"),
    entryId: v.id("codexEntries"),
    /** What the players know. */
    pdesc: v.string(),
    /** GM notes; never sent to players. */
    gmn: v.string(),
  }).index("by_entry", ["entryId"]),

  /**
   * One row per campaign (CD14): how many entries it holds, checked against
   * MAX_CODEX_ENTRIES without reading them, and whether the frame's starting
   * characters were created. A campaign from before the counter gets its row
   * from `migrations/codex:countEntries` or its first codex write.
   */
  codexCounters: defineTable({
    campaignId: v.id("campaigns"),
    entries: v.number(),
    seeded: v.boolean(),
  }).index("by_campaign", ["campaignId"]),
};
