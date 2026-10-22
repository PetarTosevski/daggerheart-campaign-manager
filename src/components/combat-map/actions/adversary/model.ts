// The GM's adversary controls on the Combat Map and the hit flashes (plan combat-actions AA5): the pure parts. No React,
// no Convex calls.
//
// ```ts
// parseActionRow("Bandit hit Mira; missed Tabby");      // { attacker: "Bandit", feature: null, marks: [{ name: "Mira", tone: "hit" }, { name: "Tabby", tone: "miss" }] }
// parseActionRow("Bandit used Roar on Mira, Tabby");    // tones "effect" (a feature with no attack roll)
// newActionFlashes(rows, seen, tokens);                 // one flash per PC token named by an action row not seen at load
// rangeRows(self, pcs, sight, "Melee");                 // [{ name: "Mira", band: "melee", sight: "clear", inAttackRange: true }]
// ```

import { rangeCheck, rangeFromWeapon, withinRange, type Footprint } from "@/lib/domain/combat-actions/distance";
import type { SightResult } from "@/lib/domain/combat-actions/sight";
import type { Range } from "@/lib/domain/card-effects/types";

/** What a flash says about a token: the attack hit it, missed it, or a feature without a roll named it. */
export type FlashTone = "hit" | "miss" | "effect";

export type ActionRow = { attacker: string; feature: string | null; marks: { name: string; tone: FlashTone }[] };

const names = (list: string) =>
  list
    .split(", ")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

/**
 * Reads the public row AA2 writes for an adversary action (`convex/lib/adversaryActions.ts`, its `publicText`; Q14:
 * players see only who hit whom): "Bandit hit Mira", "Bandit used Bite: hit Mira; missed Tabby" (an attack roll), or
 * "Bandit used Roar on Mira, Tabby" / "Bandit used Roar" (no roll). Null for any other row ("Mira took Bandit's hit",
 * "Tabby uses I Am Your Shield for Mira", a sheet change), which is not an action of its own.
 */
export function parseActionRow(summary: string): ActionRow | null {
  const rolled = /^(.+?)(?: used (.+?):)? ((?:hit|missed) .+)$/.exec(summary);
  if (rolled) {
    const marks: ActionRow["marks"] = [];
    for (const part of rolled[3]!.split("; ")) {
      const verdict = /^(hit|missed) (.+)$/.exec(part);
      if (!verdict) return null;
      const tone: FlashTone = verdict[1] === "hit" ? "hit" : "miss";
      for (const name of names(verdict[2]!)) marks.push({ name, tone });
    }
    return { attacker: rolled[1]!, feature: rolled[2] ?? null, marks };
  }
  const used = /^(.+?) used (.+?)(?: on (.+))?$/.exec(summary);
  if (!used || used[2]!.endsWith("'s sheet")) return null;
  return { attacker: used[1]!, feature: used[2]!, marks: used[3] ? names(used[3]).map((name) => ({ name, tone: "effect" as const })) : [] };
}

/** A feed row as the flashes read it (`feed.list`, either role's shape). */
export type FlashFeedRow = { _id: string; kind: string; visibility: string; summary: string; undone: boolean };
/** A PC token as the flashes read it (`combatTokens.party`). */
export type FlashToken = { _id: string; name: string; x: number; y: number; size: number };

export type Flash = { key: string; rowId: string; tokenId: string; tone: FlashTone; x: number; y: number; size: number; label: string };

const FLASH_LABEL: Record<FlashTone, string> = { hit: "Hit", miss: "Miss", effect: "!" };

/**
 * The flashes to play: every public adversary action row that was not in the feed when the map opened (`seen`) and is
 * not undone, on each PC token it names (names are the sheet names the tokens carry). Whichever page made the action
 * (the Encounter tab or this map), its row is the same, so both flash alike.
 */
export function newActionFlashes(rows: readonly FlashFeedRow[], seen: ReadonlySet<string>, tokens: readonly FlashToken[]): Flash[] {
  const out: Flash[] = [];
  for (const row of rows) {
    if (seen.has(row._id) || row.undone || row.kind !== "adversary" || row.visibility !== "public") continue;
    const action = parseActionRow(row.summary);
    if (!action) continue;
    for (const mark of action.marks) {
      for (const t of tokens) {
        if (t.name !== mark.name) continue;
        out.push({ key: `${row._id}:${t._id}`, rowId: row._id, tokenId: t._id, tone: mark.tone, x: t.x, y: t.y, size: t.size, label: FLASH_LABEL[mark.tone] });
      }
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
