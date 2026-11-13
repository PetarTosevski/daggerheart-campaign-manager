// The photo-import draft (D5 T7): what Claude reads from a paper sheet and the
// GM reviews before anything is saved. Pure: no framework imports, relative
// imports only (bundled into Convex and the client).

import * as z from "../zod";

import { characterSheetSchema, experienceSchema } from "../validation/characters";

export { MAX_PHOTOS, PHOTO_TYPES } from "./photo-types";

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

/**
 * What `photoImport.read` returns: a draft to review (it may not validate yet) and the fields to check. Paths are the
 * draft's ("classId", "hp", "traits.agility", "experiences.1.value"); a whole list is flagged by its name
 * ("experiences", "domainCards", "inventory").
 */
export type PhotoReadResult = {
  draft: ImportDraft;
  /** Fields Claude could not read: the review form shows them empty, in red (PS2). */
  unreadable: string[];
  /** Fields Claude read but is not sure of (messy handwriting): its guess is kept, in red (PS2). */
  uncertain: string[];
  /** Fields whose text matched nothing in the rules data. */
  unmatched: Unmatched[];
  /** True when nothing usable came back (refusal, cut-off or non-JSON reply): every field is unreadable (PS2). */
  blank: boolean;
};
