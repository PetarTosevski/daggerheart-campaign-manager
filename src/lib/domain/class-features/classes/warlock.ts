// Warlock (HF 14). Hope feature: Patron's Boon, when you fail a roll, reroll it with advantage.
//
// The Duality Dice and the advantage/disadvantage dice are rolled again, with one more advantage
// than before (CB 100: advantage and disadvantage cancel one for one to a single d6; a Help die and
// the advantage die keep the highest). Help, extra and damage dice and the modifier stay. The new
// result replaces the old one: the Hope or Fear the failed action roll gave is taken back and the
// new roll's is given (CB 94-95).
//
// Class features (HF 14):
// - Favor (`classState.favor`): starts at 3 (unset reads as 3; the session start writes it). A downtime move shows
//   tribute: gain Favor equal to the Spellcast trait (`warlockSpellcast`). It is the rest move "tribute"
//   (convex/lib/restHooks.ts), not a class action, so it is taken once per rest through the rest picker. A success
//   with Hope can take a Favor instead of the Hope (a class action on the latest roll; the dice box shows a prompt).
// - Patron's Pact: before an action roll in the patron's sphere, spend a Favor for the Patron Die (d6, d8 from level
//   5): the class action holds it (`heldDice` kind `patron`) and the dice box adds it to the next action roll.
import type { CharacterSheet } from "../../../validation/characters";
import { applyResourceDelta } from "../../characters/index";
import { withEffects } from "../../characters/effects";
import { spellcastTraitOf } from "../../characters/spellcast";
import { actionOutcome, type RolledDie, type RollRecord } from "../../duality";
import type { ClassFeatures } from "../types";
import { dieContribution, HOPE_COST, isFailure, refuse, rollGains } from "./shared";

const REROLLED = new Set<RolledDie["role"]>(["hope", "fear", "advantage", "disadvantage"]);

export const START_FAVOR = 3;
export const PATRON_DIE_ID = "patron-die";
/** `featureUses` prefix marking the roll whose Hope was already traded for a Favor. */
const TRADED = "favorForHope:";

export const favorOf = (sheet: Pick<CharacterSheet, "classState">): number => sheet.classState.favor ?? START_FAVOR;

const withFavor = (sheet: CharacterSheet, favor: number): CharacterSheet => ({ ...sheet, classState: { ...sheet.classState, favor: Math.max(0, Math.min(99, favor)) } });

/** The Patron Die: d6, d8 from level 5 (HF 14). */
export const patronDie = (level: number): 6 | 8 => (level >= 5 ? 8 : 6);

/** The Spellcast trait value (with effects; the multiclass choice, CB 111, via `spellcastTraitOf`), or 0 when it is not positive. */
export function warlockSpellcast(sheet: CharacterSheet): number {
  const trait = spellcastTraitOf(sheet);
  return trait ? Math.max(0, withEffects(sheet).traits[trait]) : 0;
}

const succeededWithHope = (roll: RollRecord | undefined): roll is RollRecord => roll?.kind === "action" && (roll.outcome === "successHope" || roll.outcome === "critical");

/** A short, stable fingerprint of a roll, so its Hope is traded only once. */
function fingerprint(roll: RollRecord): string {
  const text = `${roll.dice.map((d) => `${d.role}${d.value}`).join(",")}=${roll.total}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return TRADED + hash.toString(36);
}

export const warlock: ClassFeatures = {
  classId: "warlock",
  hopeFeature: {
    key: "patronsBoon",
    name: "Patron’s Boon",
    text: "When you fail a roll, reroll it with advantage.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet, rng, roll }) => {
      if (roll === undefined || (roll.kind !== "action" && roll.kind !== "reaction") || !isFailure(roll)) refuse("Your latest roll is not a failed roll.");

      const counted = (role: RolledDie["role"]) => roll.dice.filter((d) => d.role === role && !d.dropped).length;
      const net = counted("advantage") - counted("disadvantage") + 1;
      const kept = roll.dice.filter((d) => !REROLLED.has(d.role));
      const hope: RolledDie = { sides: 12, value: rng(12), role: "hope" };
      const fear: RolledDie = { sides: 12, value: rng(12), role: "fear" };
      const edge: RolledDie[] = net === 0 ? [] : [{ sides: 6, value: rng(6), role: net > 0 ? "advantage" : "disadvantage" }];
      let dice = [hope, fear, ...edge, ...kept];
      // Help dice and the advantage die: only the highest counts (CB 100).
      const pool = dice.filter((d) => (d.role === "advantage" || d.role === "help") && !d.dropped);
      if (net > 0 && pool.length > 1) {
        const best = pool.reduce((a, b) => (b.value > a.value ? b : a));
        dice = dice.map((d) => (pool.includes(d) && d !== best ? { ...d, dropped: true } : d));
      }
      const total = roll.total - roll.dice.reduce((s, d) => s + dieContribution(d), 0) + dice.reduce((s, d) => s + dieContribution(d), 0);
      const next = { ...roll, dice, total, outcome: actionOutcome(hope.value, fear.value, total, roll.difficulty), manual: false };

      const before = rollGains(roll);
      const after = rollGains(next);
      let updated = applyResourceDelta(sheet, "hope", -before.hope);
      updated = applyResourceDelta(updated, "hope", after.hope);
      if (after.stress !== 0) updated = applyResourceDelta(updated, "stress", after.stress);
      const fearDelta = after.fear - before.fear;
      return {
        sheet: updated,
        roll: next,
        ...(fearDelta !== 0 ? { fearDelta } : {}),
        summary: `used Patron’s Boon: rerolled with advantage, ${roll.total} → ${total}`,
      };
    },
  },
  classActions: [
    {
      key: "patronsPact",
      name: "Patron’s Pact",
      text: "Before an action roll in your patron’s sphere: spend a Favor to call on them. Add the Patron Die (d6, d8 from level 5) in the dice box.",
      automation: "auto",
      target: "self",
      use: ({ sheet }) => {
        const favor = favorOf(sheet);
        if (favor < 1) refuse("You have no Favor to spend.");
        if (sheet.heldDice.some((d) => d.kind === "patron")) refuse("You already hold your Patron Die: add it to your next action roll.");
        const sides = patronDie(sheet.level);
        return {
          sheet: { ...withFavor(sheet, favor - 1), heldDice: [...sheet.heldDice, { id: PATRON_DIE_ID, kind: "patron", sides, until: "manual" }] },
          summary: `used Patron’s Pact: spent a Favor for the Patron Die (d${sides}), ${favor - 1} Favor left`,
        };
      },
    },
    {
      key: "favorForHope",
      name: "Favor instead of Hope",
      text: "After an action roll that succeeds with Hope: gain a Favor instead of that Hope.",
      automation: "auto",
      target: "self",
      use: ({ sheet, roll }) => {
        if (!succeededWithHope(roll)) refuse("Your latest roll is not a success with Hope.");
        const mark = fingerprint(roll);
        if (sheet.featureUses.some((u) => u.key === mark)) refuse("You already took a Favor for this roll.");
        if (sheet.hope === 0) refuse("You have no Hope to trade.");
        const favor = favorOf(sheet);
        const traded = withFavor(applyResourceDelta(sheet, "hope", -1), favor + 1);
        return {
          sheet: { ...traded, featureUses: [...sheet.featureUses.filter((u) => !u.key.startsWith(TRADED)), { key: mark, until: "session" }] },
          summary: `took a Favor instead of a Hope (${favor + 1} Favor)`,
        };
      },
    },
  ],
  rollOptions: (sheet, kind) =>
    kind === "action"
      ? sheet.heldDice
          .filter((d) => d.kind === "patron")
          .map((d) => ({ key: "patronDie", label: `Patron Die (d${d.sides})`, effect: { kind: "heldDie" as const, heldDieId: d.id } }))
      : [],
  afterDualityRoll: (_sheet, { roll }) =>
    succeededWithHope(roll)
      ? [{ key: "favorForHope", featureKey: "favorForHope", text: "Favor: you can take a Favor instead of this Hope (Features, “Favor instead of Hope”).", choices: [{ key: "favor", label: "Favor instead of Hope" }] }]
      : [],
  onSessionStart: (sheet) => (sheet.classState.favor === undefined ? withFavor(sheet, START_FAVOR) : sheet),
};
