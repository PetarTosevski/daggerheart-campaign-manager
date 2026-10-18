// Warlock (HF 14). Hope feature: Patron's Boon, when you fail a roll, reroll it with advantage.
//
// The Duality Dice and the advantage/disadvantage dice are rolled again, with one more advantage
// than before (CB 100: advantage and disadvantage cancel one for one to a single d6; a Help die and
// the advantage die keep the highest). Help, extra and damage dice and the modifier stay. The new
// result replaces the old one: the Hope or Fear the failed action roll gave is taken back and the
// new roll's is given (CB 94-95).
import { applyResourceDelta } from "../../characters/index";
import { actionOutcome, type RolledDie } from "../../duality";
import type { ClassFeatures } from "../types";
import { dieContribution, HOPE_COST, isFailure, refuse, rollGains } from "./shared";

const REROLLED = new Set<RolledDie["role"]>(["hope", "fear", "advantage", "disadvantage"]);

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
};
