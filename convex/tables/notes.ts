import { defineTable } from "convex/server";

import { journalEntryFields, journalFields, journalPageFields, journalPageRecipientFields } from "../lib/validators/notes";

/**
 * The Notes board (D11, plan `.omc/plans/d11-notes.yaml`). N0 creates every table and index; later tracers only add
 * functions. Every row carries its `campaignId` and goes with the campaign's purge (convex/cleanup.ts); torn-out pages
 * also go with the bin cron after 30 days (N7). Page access is decided only by `permissionFor` (resource
 * `journalPage`, convex/lib/permissions.ts) through `pageAccess` (convex/lib/notes.ts).
 *
 * The plan also listed a `by_campaign` index on journals, journalPages and journalPageRecipients; each would be a
 * field-prefix of a longer campaign index on the same table (CD15, schema guard), so the purge reads the longer one.
 */
export const notesTables = {
  /**
   * - `by_campaign_user`: the caller's journals in a campaign (current journal, D3); the campaign's journals (purge,
   *   players' and past journals, N8) by its `campaignId` prefix.
   * - `by_character`: a character's journal (attachment, D3).
   */
  journals: defineTable(journalFields).index("by_campaign_user", ["campaignId", "userId"]).index("by_character", ["characterId"]),

  /**
   * - `by_journal_binned`: a journal's pages in created order with `binnedAt` undefined (lists) or set (the bin);
   *   the whole range counts pages for MAX_PAGES.
   * - `by_campaign_visibility_binned`: shared lists (N6) by visibility, not torn out; the purge by `campaignId`.
   * - `by_binned`: torn-out pages older than 30 days (bin cron, N7).
   */
  journalPages: defineTable(journalPageFields)
    .index("by_journal_binned", ["journalId", "binnedAt"])
    .index("by_campaign_visibility_binned", ["campaignId", "visibility", "binnedAt"])
    .index("by_binned", ["binnedAt"]),

  /**
   * - `by_page_user`: one point lookup per (page, reader) (permissionFor); a page's rows (delete) by its prefix.
   * - `by_campaign_user`: the pages chosen for a user ('Shared by…', N6); the purge by `campaignId`.
   */
  journalPageRecipients: defineTable(journalPageRecipientFields)
    .index("by_page_user", ["pageId", "userId"])
    .index("by_campaign_user", ["campaignId", "userId"]),

  /**
   * - `by_page_order`: a page's entries in order (B4).
   * - `by_journal_open`: a journal's open threads (B5, N4).
   * - `by_campaign`: the purge.
   * - `search_text`: entry text search within one journal (B9, Q13, N4).
   */
  journalEntries: defineTable(journalEntryFields)
    .index("by_page_order", ["pageId", "order"])
    .index("by_journal_open", ["journalId", "open"])
    .index("by_campaign", ["campaignId"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["journalId"] }),
};
