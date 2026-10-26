// The photo-import draft (D5 T7): what Claude reads from a paper sheet and the
// GM reviews before anything is saved. Pure: no framework imports, relative
// imports only (bundled into Convex and the client).

import { z } from "zod";

import { characterSheetSchema, experienceSchema } from "../validation/characters";

/** At most this many photos per import (the front and back of a sheet, twice over). */
export const MAX_PHOTOS = 4;
/** Photo types the Messages API reads; GIF is left out on purpose. */
export const PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * A reviewed draft: the sheet fields of `characterSheetSchema` a paper sheet
 * shows, at any level. Lists come as plain values; `sheetFromImport` gives
 * them ids. Cross-field rules (SRD ids, tiers, domains) live in
 * `sheetFromImport`, so a draft can parse and still be refused.
 */
export const importDraftSchema = characterSheetSchema
  .pick({
    name: true,
    pronouns: true,
    description: true,
    level: true,
    classId: true,
    subclassId: true,
    ancestry: true,
    communityId: true,
    traits: true,
    evasion: true,
    hpMax: true,
    hp: true,
    stressMax: true,
    stress: true,
    hope: true,
    armorMarked: true,
    proficiency: true,
    primaryWeaponId: true,
    secondaryWeaponId: true,
    armorId: true,
    gold: true,
  })
  .extend({
    hope: z.number().int().min(0).max(6),
    experiences: z.array(experienceSchema.omit({ id: true })).max(12),
    domainCards: z.array(z.string().min(1)).max(40),
    inventory: z.array(z.string().trim().min(1).max(200)).max(60),
  })
  .strict();

export type ImportDraft = z.infer<typeof importDraftSchema>;

/** A field Claude read but could not match to the rules data: the field's path and the text it read. */
export type Unmatched = { field: string; text: string };

/** What `photoImport.read` returns: a draft to review (it may not validate yet) and the fields to check. */
export type PhotoReadResult = {
  draft: ImportDraft;
  /** Paths of fields Claude could not read (filled with a default). */
  unreadable: string[];
  /** Fields whose text matched nothing in the rules data. */
  unmatched: Unmatched[];
};
