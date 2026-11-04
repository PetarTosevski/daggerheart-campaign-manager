// Rogue (CB 42). Hope feature: Rogue's Dodge, +2 Evasion until an attack succeeds against you, otherwise until your next rest.
// Class features: Cloaked is a condition the Rogue toggles (it replaces Hidden; attacking or ending a move in
// an adversary's line of sight ends it), and Sneak Attack adds tier-many d6 to a damage roll, a dice-box
// option the player ticks when Cloaked or an ally is in Melee range of the target.
import { tierForLevel } from "../../characters/index";
import type { ClassFeatures, FeatureMeta } from "../types";
import type { CharacterSheet } from "../../../validation/characters";
import { HOPE_COST, refuse, withEffect } from "./shared";

const DODGE = "rogues-dodge";

/** The sheet effect Rogue's Dodge writes (+2 Evasion until hit or the next rest). */
export const ROGUES_DODGE_EFFECT_ID = DODGE;

/** When an active Rogue's Dodge can be used again. */
export const ROGUES_DODGE_BACK = "Until an attack succeeds against you, or your next rest";

/**
 * Rogue's Dodge's +2 is active (user 2026-10-30, dcm-bxp.99.19.41): it neither refreshes nor stacks, so while the bonus
 * lasts the feature can't be used again; it comes back when an attack succeeds against the Rogue or at the next rest.
 */
export function roguesDodgeActive(sheet: Pick<CharacterSheet, "effects">): boolean {
  return sheet.effects.some((e) => e.id === DODGE);
}

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
    use: ({ sheet }) => {
      if (roguesDodgeActive(sheet)) refuse("Rogue’s Dodge is already active: use it again after an attack succeeds against you or after a rest.");
      return {
        sheet: withEffect(sheet, { id: DODGE, source: "Rogue’s Dodge", text: "+2 Evasion until hit or your next rest.", until: "hit", mods: { evasion: 2 } }),
        summary: "used Rogue’s Dodge: +2 Evasion",
      };
    },
  },
  classActions: [cloaked],
  rollOptions: (sheet, kind) => {
    const tier = tierForLevel(sheet.level);
    return kind === "damage" ? [{ key: "sneakAttack", label: `Sneak Attack +${tier}d6`, effect: { kind: "dice" as const, count: tier, sides: 6 } }] : [];
  },
  // The effect ends on a hit (`until: "hit"`, the Got hit button) and otherwise on the next rest (CB 42).
  onRest: (sheet) => (sheet.effects.some((e) => e.id === DODGE) ? { ...sheet, effects: sheet.effects.filter((e) => e.id !== DODGE) } : sheet),
};
