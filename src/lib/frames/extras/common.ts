// Shared pieces for per-character extras (D4). Pure module: bundled into
// Convex, so no framework imports and relative paths only.

import { z } from "zod";

import type { Range, TraitId } from "../../srd/types";

/** The extras a character can carry, each stored as one `characterExtras` row. */
export const EXTRAS = ["beastform", "companion", "motherboard", "beastFeast", "castleHigh"] as const;
export type Extra = (typeof EXTRAS)[number];

/**
 * The `frameTrackers` key an extra was stored under before the
 * `characterExtras` table (H14). Read only as a fallback for rows that
 * `migrations/characterExtras:moveFromTrackers` has not moved yet; remove it
 * once that migration has run on every deployment.
 */
export const extraKey = (characterId: string, extra: Extra) => `character:${characterId}:${extra}`;
/** The party's shared Beast Feast cookbook (one per campaign). */
export const COOKBOOK_KEY = "beastFeast.cookbook";

/** The frame each frame-exclusive extra belongs to. */
export const FRAME_OF = {
  motherboard: "motherboard",
  beastFeast: "beast-feast",
  castleHigh: "castle-high",
} as const satisfies Partial<Record<Extra, string>>;

export const DRUID_CLASS_ID = "druid";
export const BEASTBOUND_SUBCLASS_ID = "beastbound";

/** Which extras apply to a character in a campaign of the given frame. */
export function extrasFor(frameId: string, character: { classId: string; subclassId: string }): Record<Extra, boolean> {
  return {
    beastform: character.classId === DRUID_CLASS_ID,
    companion: character.subclassId === BEASTBOUND_SUBCLASS_ID,
    motherboard: frameId === FRAME_OF.motherboard,
    beastFeast: frameId === FRAME_OF.beastFeast,
    castleHigh: frameId === FRAME_OF.castleHigh,
  };
}

export const traitIdSchema = z.enum(["agility", "strength", "finesse", "instinct", "presence", "knowledge"]) satisfies z.ZodType<TraitId>;

export const RANGES: readonly Range[] = ["Melee", "Very Close", "Close", "Far", "Very Far"];
export const rangeSchema = z.enum(["Melee", "Very Close", "Close", "Far", "Very Far"]) satisfies z.ZodType<Range>;

export const TRAIT_LABEL: Record<TraitId, string> = {
  agility: "Agility",
  strength: "Strength",
  finesse: "Finesse",
  instinct: "Instinct",
  presence: "Presence",
  knowledge: "Knowledge",
};

/** One die step up: d4 → d6 → d8 → d10 → d12 (d12 stays). */
export function stepDie(sides: number, steps = 1): number {
  const ladder = [4, 6, 8, 10, 12];
  const i = ladder.indexOf(sides);
  if (i < 0) return sides;
  return ladder[Math.min(ladder.length - 1, i + steps)];
}

/** Parses a damage string such as "d10+8 phy" or "2d8 mag". */
export function parseDamage(text: string): { count: number; sides: number; bonus: number; type: string } | null {
  const m = /^(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*(\w+)?$/.exec(text.trim());
  if (!m) return null;
  return {
    count: m[1] ? Number(m[1]) : 1,
    sides: Number(m[2]),
    bonus: m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0,
    type: m[5] ?? "",
  };
}

export function formatDamage(d: { count: number; sides: number; bonus: number; type: string }): string {
  const dice = `${d.count > 1 ? d.count : ""}d${d.sides}`;
  const bonus = d.bonus > 0 ? `+${d.bonus}` : d.bonus < 0 ? `${d.bonus}` : "";
  return `${dice}${bonus}${d.type ? ` ${d.type}` : ""}`;
}
