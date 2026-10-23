// The GM's adversary controls on the Combat Map and the hit flashes (plan combat-actions AA5): the pure parts. No React,
// no Convex calls.
//
// ```ts
// newActionFlashes(rows, seen, tokens, gm);             // one flash per token id in an action row's `targets` not seen at load
// rangeRows(self, pcs, sight, "Melee");                 // [{ name: "Mira", band: "melee", sight: "clear", inAttackRange: true }]
// ```

import { rangeCheck, rangeFromWeapon, withinRange, type Footprint } from "@/lib/domain/combat-actions/distance";
import type { SightResult } from "@/lib/domain/combat-actions/sight";
import type { Range } from "@/lib/domain/card-effects/types";

/** What a flash says about a token: the attack hit it, missed it, or a feature without a roll touched it. */
export type FlashTone = "hit" | "miss" | "effect";

/** A creature the public row names (`feed.list`'s `targets`, H3): its token id, PC or adversary token, and the tone. */
export type FlashTarget = { tokenId: string; side: "pc" | "adversary"; tone: FlashTone };
/** A feed row as the flashes read it (`feed.list`, either role's shape). */
export type FlashFeedRow = { _id: string; kind: string; visibility: string; summary: string; undone: boolean; targets?: readonly FlashTarget[] };
/** A token as the flashes read it (`combatTokens.list` for the GM, `combatTokens.party` for a player). */
export type FlashToken = { _id: string; x: number; y: number; size: number };

export type Flash = { key: string; rowId: string; tokenId: string; tone: FlashTone; x: number; y: number; size: number; label: string };

const FLASH_LABEL: Record<FlashTone, string> = { hit: "Hit", miss: "Miss", effect: "!" };

/**
 * The flashes to play: every public adversary action row that was not in the feed when the map opened (`seen`) and is
 * not undone, on each token its `targets` name by id (followups-7 H3; never matched by name). Adversary tokens flash
 * only with `gm` (user answer); the server already sends a player only the PC entries. Whichever page made the action
 * (the Encounter tab or this map), its row is the same, so both flash alike.
 */
export function newActionFlashes(rows: readonly FlashFeedRow[], seen: ReadonlySet<string>, tokens: readonly FlashToken[], gm: boolean): Flash[] {
  const out: Flash[] = [];
  for (const row of rows) {
    if (seen.has(row._id) || row.undone || row.kind !== "adversary" || row.visibility !== "public") continue;
    for (const target of row.targets ?? []) {
      if (target.side === "adversary" && !gm) continue;
      const t = tokens.find((token) => token._id === target.tokenId);
      if (!t) continue;
      out.push({ key: `${row._id}:${t._id}`, rowId: row._id, tokenId: t._id, tone: target.tone, x: t.x, y: t.y, size: t.size, label: FLASH_LABEL[target.tone] });
    }
  }
  return out;
}

/** The GM's adversary rows for the Resolutions card (rolls, damage, marks; each with Undo, U4), newest first. */
export function adversaryResolutionsOf<R extends Pick<FlashFeedRow, "kind" | "visibility">>(rows: readonly R[], shown: number): R[] {
  return rows.filter((r) => r.kind === "adversary" && r.visibility === "gm").slice(0, shown);
}

/** How a PC looks from the adversary on the live map (CB p.104, Q2): clear, in cover (disadvantage) or out of sight. */
export type SightTone = "clear" | "cover" | "blocked" | "unknown";

export type RangeRow = { characterId: string; name: string; band: Range; sight: SightTone; inAttackRange: boolean };

const WEAPON_RANGES = new Set(["Melee", "Very Close", "Close", "Far", "Very Far"]);

/** The attack's printed range as a band, or null when it isn't one of the five (then nothing is "beyond" it). */
export function attackBand(range: string): Range | null {
  return WEAPON_RANGES.has(range) ? rangeFromWeapon(range as Parameters<typeof rangeFromWeapon>[0]) : null;
}

/**
 * The PCs on the live map as seen from the adversary's token: the Defined Range band (CB p.103), line of sight and cover
 * (CB p.104; the server checks it again and refuses a PC out of sight), and whether the band is within the attack's
 * printed range (adversary attacks are not refused for range: the GM decides, analysis B4). `sight` is null while the
 * layout loads.
 */
export function rangeRows(
  self: Footprint,
  pcs: readonly (Footprint & { characterId: string; name: string })[],
  sight: ((from: Footprint, to: Footprint) => SightResult) | null,
  attackRange: string,
): RangeRow[] {
  const reach = attackBand(attackRange);
  return pcs.map((pc) => {
    const { band } = rangeCheck(self, pc, "melee");
    const seen = sight ? sight(self, pc) : null;
    const tone: SightTone = seen === null ? "unknown" : !seen.lineOfSight ? "blocked" : seen.cover ? "cover" : "clear";
    return { characterId: pc.characterId, name: pc.name, band, sight: tone, inAttackRange: reach === null || withinRange(band, reach) };
  });
}

export const BAND_TEXT: Record<Range, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };
export const SIGHT_TEXT: Record<SightTone, string> = { clear: "In sight", cover: "Cover: disadvantage", blocked: "No line of sight", unknown: "Sight checked on attack" };
