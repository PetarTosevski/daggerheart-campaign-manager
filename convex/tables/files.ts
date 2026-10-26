import { defineTable } from "convex/server";
import { v } from "convex/values";

export const fileTables = {
  /**
   * Uploaded files (Convex file storage), recorded when attached so a file
   * belongs to one thing: a campaign's map, a codex entry, a character, a combat map or an uploaded sprite
   * (`refId`). Only a file's own owner serves or deletes it.
   */
  files: defineTable({
    storageId: v.id("_storage"),
    campaignId: v.id("campaigns"),
    uploadedBy: v.id("users"),
    kind: v.union(
      v.literal("map"),
      v.literal("codexImage"),
      v.literal("portrait"),
      v.literal("photoImport"),
      v.literal("combatMap"),
      v.literal("sprite"),
    ),
    /**
     * The campaign (map, photoImport), codex entry (codexImage), character (portrait), combat map (combatMap, D9)
     * or uploaded sprite (sprite: the `spritePackSprites` id, sprite packs D9) id. Photo-import files are deleted
     * after reading (D5 T7).
     */
    refId: v.string(),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_ref", ["kind", "refId"])
    /** Oldest first within a kind: the hourly photo-import expiry (D5 R3). */
    .index("by_kind_created", ["kind", "createdAt"])
    .index("by_campaign_kind", ["campaignId", "kind"])
    .index("by_uploader", ["uploadedBy"]),

  /**
   * Sharing: a principal (a user, or every GM and member of a campaign) gets
   * view, edit or owner permission on a resource. One row per (resource,
   * principal), enforced by `upsertGrant`. Empty for now.
   */
  grants: defineTable({
    resourceType: v.union(v.literal("map"), v.literal("codexEntry"), v.literal("character"), v.literal("campaign")),
    resourceId: v.string(),
    principalKind: v.union(v.literal("user"), v.literal("campaign")),
    principalId: v.string(),
    permission: v.union(v.literal("view"), v.literal("edit"), v.literal("owner")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_resource_principal", ["resourceType", "resourceId", "principalKind", "principalId"])
    .index("by_principal_type", ["principalKind", "principalId", "resourceType"])
    .index("by_creator", ["createdBy"]),
};
