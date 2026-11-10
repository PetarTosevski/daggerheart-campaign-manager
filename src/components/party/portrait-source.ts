// Portrait helpers of the party cards, the roster and the campaign shell's avatar (split out of party-display.ts, NB3).
// They read only the portrait art and the class list, so the shell (on every campaign route) does not load the
// ancestry, community and subclass lists that party-display.ts's text lines need.

import { PORTRAITS } from "@/lib/party/portraits";
import { CLASSES } from "@/lib/srd/classes";
import type { PortraitArt } from "@/lib/srd/types";
import type { CharacterSheet } from "@/lib/validation/characters";

const portraitFor = (opts: { subclassId?: string | null; ancestryId?: string | null }): PortraitArt | undefined =>
  (opts.subclassId ? PORTRAITS[`sub-${opts.subclassId}`] : undefined) ?? (opts.ancestryId ? PORTRAITS[`anc-${opts.ancestryId}`] : undefined);

/** The ancestry whose art stands in for the portrait (a mixed heritage uses the first). */
export function portraitAncestryId(ancestry: CharacterSheet["ancestry"]): string {
  if (ancestry.kind === "single") return ancestry.id;
  if (ancestry.kind === "mixed") return ancestry.first;
  return ancestry.form;
}

export type PortraitSource =
  | { kind: "upload"; storageId: string }
  | { kind: "asset"; asset: string; position: string }
  | { kind: "initial"; letter: string };

/** Uploaded image → chosen design art → default art by subclass/ancestry → the name's initial. */
export function portraitSource(sheet: Pick<CharacterSheet, "portrait" | "subclassId" | "ancestry" | "name" | "classId">): PortraitSource {
  if (sheet.portrait?.kind === "upload") return { kind: "upload", storageId: sheet.portrait.storageId };
  if (sheet.portrait?.kind === "asset") return { kind: "asset", asset: sheet.portrait.asset, position: "center 30%" };
  const art = portraitFor({ subclassId: sheet.subclassId, ancestryId: portraitAncestryId(sheet.ancestry) });
  if (art) return { kind: "asset", asset: art.asset, position: art.position };
  return { kind: "initial", letter: (sheet.name || CLASSES.find((c) => c.id === sheet.classId)?.name || "?").charAt(0).toUpperCase() };
}

/** Shrinks an image to fit within `max` on its longer side, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
