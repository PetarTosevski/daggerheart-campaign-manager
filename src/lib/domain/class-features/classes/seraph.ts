// Seraph (CB 44). Hope feature: Life Support clears a Hit Point on an ally (decision 7: written only through the feature).
// Class feature: Prayer Dice (settled rule). At session start the Seraph rolls d4s equal to their subclass's
// Spellcast trait, none when it is 0 or less, held until session end (`expire(sheet, "session")` clears the
// rest). A spent die's value goes to one of: Hope for the Seraph or an ally, reducing incoming damage (a
// reminder for the damage calculator), or the Seraph's latest roll after it is made.
// `params.dieIndexes` picks Prayer Dice by their order on the sheet (default: the first one).
import { applyResourceDelta } from "../../characters/index";
import { actionOutcome } from "../../duality";
import { getSubclass } from "../../../srd/index";
import type { CharacterSheet, HeldDie } from "../../../validation/characters";
import type { ClassFeatures, FeatureMeta, FeatureParams, Rng } from "../types";
import { rallyDieOptions, rallyDieStress } from "./bard";
import { dualityDie, HOPE_COST, refuse } from "./shared";

/** The number of Prayer Dice: the Spellcast trait of the Seraph's subclass (the multiclass's for a multiclass Seraph), 0 when ≤ 0. */
export function prayerDiceCount(sheet: CharacterSheet): number {
  const subclassId = sheet.classId === "seraph" ? sheet.subclassId : sheet.multiclass?.classId === "seraph" ? sheet.multiclass.subclassId : undefined;
  const trait = subclassId ? getSubclass(subclassId)?.spellcastTrait : undefined;
  return trait ? Math.max(0, sheet.traits[trait]) : 0;
}

/** The sheet with fresh Prayer Dice rolled (earlier ones replaced). */
export function rollPrayerDice(sheet: CharacterSheet, rng: Rng): CharacterSheet {
  const kept = sheet.heldDice.filter((d) => d.kind !== "prayer");
  const count = Math.min(prayerDiceCount(sheet), 20 - kept.length);
  const prayer = Array.from({ length: count }, (_, i): HeldDie => ({ id: `prayer-${i + 1}`, kind: "prayer", sides: 4, value: rng(4), until: "session" }));
  return { ...sheet, heldDice: [...kept, ...prayer] };
}

/** Removes the chosen Prayer Dice; returns their summed value. */
function spendPrayer(sheet: CharacterSheet, params: FeatureParams): { sheet: CharacterSheet; value: number; count: number } {
  const prayer = sheet.heldDice.filter((d) => d.kind === "prayer");
  if (prayer.length === 0) refuse("You hold no Prayer Dice.");
  const indexes = [...new Set(params.dieIndexes ?? [0])];
  const chosen = indexes.map((i) => prayer[i]);
  if (indexes.length === 0 || chosen.some((d) => d === undefined)) refuse("Choose Prayer Dice you hold.");
  const spent = chosen.filter((d): d is HeldDie => d !== undefined);
  const value = spent.reduce((s, d) => s + (d.value ?? 0), 0);
  return { sheet: { ...sheet, heldDice: sheet.heldDice.filter((d) => !spent.includes(d)) }, value, count: spent.length };
}

const dice = (count: number) => (count === 1 ? "a Prayer Die" : `${count} Prayer Dice`);

const prayerHope: FeatureMeta = {
  key: "prayerHope",
  name: "Prayer Dice: gain Hope",
  text: "Spend Prayer Dice: you, or an ally within Far range, gain Hope equal to their value.",
  automation: "auto",
  target: "party",
  use: ({ sheet, params, others }) => {
    const paid = spendPrayer(sheet, params);
    if (params.targetId === undefined) return { sheet: applyResourceDelta(paid.sheet, "hope", paid.value), summary: `spent ${dice(paid.count)} (${paid.value}) to gain Hope` };
    const ally = others.find((o) => o.characterId === params.targetId);
    if (ally === undefined) refuse("Choose an ally who can be aided now.");
    return {
      sheet: paid.sheet,
      others: [{ characterId: ally.characterId, sheet: applyResourceDelta(ally.sheet, "hope", paid.value) }],
      summary: `spent ${dice(paid.count)} (${paid.value}): ${ally.sheet.name} gains Hope`,
    };
  },
};

const prayerDamage: FeatureMeta = {
  key: "prayerDamage",
  name: "Prayer Dice: reduce damage",
  text: "Spend Prayer Dice to reduce incoming damage to you or an ally by their value (apply it in the damage calculator).",
  automation: "assist",
  target: "self",
  use: ({ sheet, params }) => {
    const paid = spendPrayer(sheet, params);
    return { sheet: paid.sheet, summary: `spent ${dice(paid.count)}: reduce incoming damage by ${paid.value}` };
  },
};

const prayerRoll: FeatureMeta = {
  key: "prayerRoll",
  name: "Prayer Dice: add to your roll",
  text: "Spend Prayer Dice after your roll is made: add their value to its result.",
  automation: "auto",
  target: "self",
  use: ({ sheet, params, roll }) => {
    if (roll === undefined || roll.kind === "free") refuse("Roll first: you have no roll to add to.");
    const paid = spendPrayer(sheet, params);
    const total = roll.total + paid.value;
    const hope = dualityDie(roll, "hope");
    const fear = dualityDie(roll, "fear");
    // Only success or failure can change: Hope and Fear depend on the dice, so what the roll gave stays.
    const outcome = roll.kind !== "damage" && hope !== undefined && fear !== undefined ? actionOutcome(hope, fear, total, roll.difficulty) : roll.outcome;
    return { sheet: paid.sheet, roll: { ...roll, total, outcome }, summary: `spent ${dice(paid.count)} on the roll, ${roll.total} → ${total}` };
  },
};

export const seraph: ClassFeatures = {
  classId: "seraph",
  hopeFeature: {
    key: "lifeSupport",
    name: "Life Support",
    text: "Clear a Hit Point on an ally within Close range.",
    cost: HOPE_COST,
    automation: "auto",
    target: "ally",
    use: ({ sheet, others }) => {
      const ally = others[0];
      if (ally === undefined) refuse("Choose an ally.");
      if (ally.sheet.hp === 0) refuse(`${ally.sheet.name} has no marked Hit Points.`);
      return {
        sheet,
        others: [{ characterId: ally.characterId, sheet: applyResourceDelta(ally.sheet, "hp", -1) }],
        summary: `used Life Support: ${ally.sheet.name} clears a Hit Point`,
      };
    },
  },
  classActions: [prayerHope, prayerDamage, prayerRoll, rallyDieStress],
  rollOptions: (sheet) => rallyDieOptions(sheet, "seraph"),
  onSessionStart: rollPrayerDice,
};
