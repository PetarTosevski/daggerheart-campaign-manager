// Rogue (CB 42). Hope feature: Rogue's Dodge, +2 Evasion until an attack succeeds against you, otherwise until your next rest.
// Class features: Cloaked is a condition the Rogue toggles (it replaces Hidden; attacking or ending a move in
// an adversary's line of sight ends it), and Sneak Attack adds tier-many d6 to a damage roll, a dice-box
// option the player ticks when Cloaked or an ally is in Melee range of the target.
import { tierForLevel } from "../../characters/index";
import type { ClassFeatures, FeatureMeta } from "../types";
import { rallyDieOptions, rallyDieStress } from "./bard";
import { HOPE_COST, withEffect } from "./shared";

const DODGE = "rogues-dodge";

const cloaked: FeatureMeta = {
  key: "cloaked",
  name: "Cloaked",
  text: "When you would be Hidden you are Cloaked instead: you stay unseen while stationary. Attacking or ending a move in an adversary's line of sight ends it. Press again to end it.",
  automation: "auto",
  target: "self",
  use: ({ sheet }) => {
    if (sheet.conditions.includes("cloaked")) return { sheet: { ...sheet, conditions: sheet.conditions.filter((c) => c !== "cloaked") }, summary: "is no longer Cloaked" };
    return { sheet: { ...sheet, conditions: [...sheet.conditions.filter((c) => c !== "hidden"), "cloaked"] }, summary: "is Cloaked" };
  },
};

export const rogue: ClassFeatures = {
  classId: "rogue",
  hopeFeature: {
    key: "roguesDodge",
    name: "Rogue’s Dodge",
    text: "+2 Evasion until an attack succeeds against you, or until your next rest.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet }) => ({
      sheet: withEffect(sheet, { id: DODGE, source: "Rogue’s Dodge", text: "+2 Evasion until hit or your next rest.", until: "hit", mods: { evasion: 2 } }),
      summary: "used Rogue’s Dodge: +2 Evasion",
    }),
  },
  classActions: [cloaked, rallyDieStress],
  rollOptions: (sheet, kind) => {
    const tier = tierForLevel(sheet.level);
    const own = kind === "damage" ? [{ key: "sneakAttack", label: `Sneak Attack +${tier}d6`, effect: { kind: "dice" as const, count: tier, sides: 6 } }] : [];
    return [...own, ...rallyDieOptions(sheet, "rogue")];
  },
  // The effect ends on a hit (`until: "hit"`, the Got hit button) and otherwise on the next rest (CB 42).
  onRest: (sheet) => (sheet.effects.some((e) => e.id === DODGE) ? { ...sheet, effects: sheet.effects.filter((e) => e.id !== DODGE) } : sheet),
};
