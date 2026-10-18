// Witch (HF 16). Hope feature: Witch's Charm, when you or an ally fails an action roll, change it into
// a success with Fear. Settled rule: if the roll was with Hope, the Hope it gave is removed and the GM
// gains 1 Fear; a roll already with Fear changes nothing else. The dispatcher loads the latest roll of
// the chosen ally (or the Witch's own without one).
//
// Class features (HF 16):
// - Hex: mark a Stress to temporarily Hex a target within Far range (`classState.hexes`, named by `params.choice` or
//   "Target N"): −tier to its damage rolls and Difficulty (the GM applies it). At most Spellcast-trait targets at once.
//   Temporary: "Clear Hexes" ends them, and every rest and session end clears them.
// - Commune: once per long rest, roll Spellcast-trait d6s and read a result on the chart.
import { getSubclass } from "../../../srd/index";
import type { CharacterSheet } from "../../../validation/characters";
import { applyResourceDelta, tierForLevel } from "../../characters/index";
import { withEffects } from "../../characters/effects";
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse } from "./shared";

/** The Witch subclass's Spellcast trait value (with effects), or 0 when it is not positive. */
export function witchSpellcast(sheet: CharacterSheet): number {
  const subclassId = sheet.classId === "witch" ? sheet.subclassId : sheet.multiclass?.subclassId;
  const trait = subclassId ? getSubclass(subclassId)?.spellcastTrait : undefined;
  return trait ? Math.max(0, withEffects(sheet).traits[trait]) : 0;
}

/** Commune's chart (HF 16). */
export function communeVision(result: number): string {
  if (result >= 6) return "you psychically experience a scene relevant to the answer as if you were there";
  if (result >= 4) return "you hear sounds or see a vision relevant to the answer";
  return "you taste a flavor, smell a scent, or feel a sensation relevant to the answer";
}

/** The sheet without any Hexes. */
function unhexed(sheet: CharacterSheet): CharacterSheet {
  if (sheet.classState.hexes === undefined) return sheet;
  const classState = { ...sheet.classState };
  delete classState.hexes;
  return { ...sheet, classState };
}

export const witch: ClassFeatures = {
  classId: "witch",
  hopeFeature: {
    key: "witchsCharm",
    name: "Witch’s Charm",
    text: "When you or an ally within Far range fails an action roll, change it into a success with Fear.",
    cost: HOPE_COST,
    automation: "auto",
    target: "ally",
    use: ({ sheet, others, roll }) => {
      const ally = others[0];
      const who = ally?.sheet ?? sheet;
      if (roll?.kind !== "action" || (roll.outcome !== "failHope" && roll.outcome !== "failFear")) {
        refuse(`${ally ? `${who.name}’s` : "Your"} latest roll is not a failed action roll.`);
      }
      const withHope = roll.outcome === "failHope";
      const changed = withHope ? applyResourceDelta(who, "hope", -1) : who;
      const summary = `used Witch’s Charm: ${ally ? `${who.name}’s` : "their"} roll succeeds with Fear`;
      const next = { ...roll, outcome: "successFear" as const };
      const fear = withHope ? { fearDelta: 1 } : {};
      if (ally === undefined) return { sheet: changed, roll: next, ...fear, summary };
      return { sheet, others: withHope ? [{ characterId: ally.characterId, sheet: changed }] : [], roll: next, ...fear, summary };
    },
  },
  classActions: [
    {
      key: "hex",
      name: "Hex",
      text: "Temporarily Hex a target within Far range: −your tier to its damage rolls and Difficulty. At most as many Hexed as your Spellcast trait.",
      cost: { stress: 1 },
      automation: "auto",
      target: "none",
      use: ({ sheet, params }) => {
        const hexes = sheet.classState.hexes ?? [];
        const max = witchSpellcast(sheet);
        if (hexes.length >= max) refuse(max === 0 ? "Your Spellcast trait allows no Hexes." : `You can Hex at most ${max} at a time (your Spellcast trait).`);
        const target = params.choice?.trim().slice(0, 80) || `Target ${Array.from({ length: hexes.length + 1 }, (_, i) => i + 1).find((n) => !hexes.includes(`Target ${n}`))}`;
        if (hexes.includes(target)) refuse(`${target} is already Hexed.`);
        const tier = tierForLevel(sheet.level);
        return {
          sheet: { ...sheet, classState: { ...sheet.classState, hexes: [...hexes, target] } },
          summary: `used Hex on ${target}: −${tier} to its damage rolls and Difficulty`,
        };
      },
    },
    {
      key: "clearHexes",
      name: "Clear Hexes",
      text: "End your Hexes (a Hexed target cleared it, or the scene ended).",
      automation: "auto",
      target: "none",
      use: ({ sheet }) => {
        const hexes = sheet.classState.hexes ?? [];
        if (hexes.length === 0) refuse("Nothing is Hexed.");
        return { sheet: unhexed(sheet), summary: `ended their Hex on ${hexes.join(", ")}` };
      },
    },
    {
      key: "commune",
      name: "Commune",
      text: "Once per long rest, in a moment of calm: ask an ancestor, deity, spirit or otherworldly being a question and roll d6s equal to your Spellcast trait; choose a result.",
      cost: { use: { key: "commune", until: "longRest" } },
      automation: "auto",
      target: "self",
      use: ({ sheet, rng }) => {
        const count = witchSpellcast(sheet);
        if (count === 0) refuse("Your Spellcast trait gives no dice to roll.");
        const results = Array.from({ length: count }, () => rng(6));
        const best = Math.max(...results);
        return {
          sheet,
          roll: { kind: "free", dice: results.map((value) => ({ sides: 6, value, role: "extra" as const })), modifier: 0, total: best, outcome: "none", manual: false },
          summary: `used Commune: d6 ${results.join(", ")}; best ${best}: ${communeVision(best)}`,
        };
      },
    },
  ],
  // A Hex is temporary: a rest or the session's end is past its scene.
  onRest: (sheet) => unhexed(sheet),
  onSessionEnd: (sheet) => unhexed(sheet),
};
