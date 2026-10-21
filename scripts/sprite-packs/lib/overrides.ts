/**
 * scripts/sprite-packs/overrides.json: per-sheet fixes the cutter cannot
 * decide (D8). Keys are sheet ids `<folder>/<file name without extension>`,
 * e.g. `snow-and-tundra/large` or an extra sheet `town-street-and-market/large-2`.
 *
 * Per sheet one override object, or a list of them (each `when` is checked on
 * its own and the active ones are merged in order). Fields, all optional:
 *   when      {found: n} and / or {sha256: prefix}: apply only when the cutter
 *             finds n objects, and / or only to the sheet file whose SHA-256
 *             starts with the prefix (8..64 hex digits; P11Z), so a
 *             regenerated sheet never gets a stale fix (the report says the
 *             override was inactive).
 *   skip      cut indices (reading order, 0-based) to drop.
 *   variants  {cutIndex: slug}: that cut becomes the next numbered variant of
 *             the folder's catalog item `slug` (variant 2, 3, ...); it is taken
 *             out of the labelling sequence.
 *   order     for primary sheets: the cut index to use for each catalog
 *             position, in catalog order (after skip / variants are removed
 *             from consideration, indices still refer to the original cuts).
 *   unpink    cut indices whose soft glow kept a pink aura: every pixel that
 *             leans magenta is faded out (never on purple objects).
 *   unmix     cut indices re-keyed from the sheet by unmixing the magenta
 *             (thin light strands: spider webs, nets), without erosion.
 *   untint    {cutIndex: [[x0, y0, x1, y1], ...]}: inside these areas
 *             (fractions of the cut) rose and pink pixels of an opaque
 *             pink-tinted fill (the coop netting) become a warm grey-brown,
 *             alpha kept.
 *   rotate    {cutIndex: 90 | 180 | 270}: rotate a cut clockwise (a 2 x 1
 *             item drawn upright).
 *   note      free text shown in the report.
 *
 * Extra sheets (any `<props|large|terrain>-<suffix>.<jpg|jpeg|png|webp>` in a
 * folder) are optional: absent files are simply not processed. New items on
 * an extra sheet (a cottage) are new catalog items, not variants: list them
 * under `extras` in src/lib/sprite-packs/catalog/<folder>.ts (and in the
 * prompts doc) and the cutter labels the sheet's cuts from that list in
 * reading order, like a primary sheet. `variants` can still name a cut as a
 * redrawn existing item; any other cut is listed in the report as unassigned.
 */

import { readFileSync } from "node:fs";

import { z } from "zod";

const indexList = z.array(z.number().int().min(0));
const fraction = z.number().min(0).max(1);

export const sheetOverrideSchema = z
  .object({
    when: z
      .object({ found: z.number().int().min(0).optional(), sha256: z.string().regex(/^[0-9a-f]{8,64}$/).optional() })
      .strict()
      .refine((w) => w.found !== undefined || w.sha256 !== undefined, "when needs found or sha256")
      .optional(),
    skip: indexList.optional(),
    variants: z.record(z.string().regex(/^\d+$/), z.string().regex(/^[a-z0-9-]+$/)).optional(),
    order: indexList.optional(),
    unpink: indexList.optional(),
    unmix: indexList.optional(),
    untint: z.record(z.string().regex(/^\d+$/), z.array(z.tuple([fraction, fraction, fraction, fraction])).min(1)).optional(),
    rotate: z.record(z.string().regex(/^\d+$/), z.union([z.literal(90), z.literal(180), z.literal(270)])).optional(),
    note: z.string().optional(),
  })
  .strict();
export type SheetOverride = z.infer<typeof sheetOverrideSchema>;

export const overridesSchema = z
  .object({
    $comment: z.union([z.string(), z.array(z.string())]).optional(),
    /** One override, or several evaluated independently (each with its own `when`). */
    sheets: z.record(z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/), z.union([sheetOverrideSchema, z.array(sheetOverrideSchema)])),
  })
  .strict();
export type Overrides = z.infer<typeof overridesSchema>;

export function loadOverrides(file: string): Overrides {
  return overridesSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** The overrides active for a sheet with `found` cuts (and file hash `sha256`, hex), merged, plus a note per inactive one. */
export function activeOverride(
  overrides: Overrides,
  id: string,
  found: number,
  sha256?: string,
): { active: SheetOverride; notes: string[] } {
  const raw = overrides.sheets[id];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const active: SheetOverride = {};
  const notes: string[] = [];
  for (const ov of list) {
    if (ov.when?.found !== undefined && ov.when.found !== found) {
      notes.push(`override inactive: written for ${ov.when.found} cuts, found ${found}${ov.note ? ` (${ov.note})` : ""}`);
      continue;
    }
    if (ov.when?.sha256 !== undefined && !(sha256 ?? "").startsWith(ov.when.sha256)) {
      notes.push(`override inactive: written for the sheet file ${ov.when.sha256}, this one is ${(sha256 ?? "unknown").slice(0, 12)}${ov.note ? ` (${ov.note})` : ""}`);
      continue;
    }
    if (ov.note) notes.push(ov.note);
    for (const k of ["skip", "unpink", "unmix"] as const) if (ov[k]) active[k] = [...(active[k] ?? []), ...(ov[k] ?? [])];
    if (ov.order) active.order = ov.order;
    if (ov.variants) active.variants = { ...active.variants, ...ov.variants };
    if (ov.rotate) active.rotate = { ...active.rotate, ...ov.rotate };
    if (ov.untint) active.untint = { ...active.untint, ...ov.untint };
  }
  return { active, notes };
}
