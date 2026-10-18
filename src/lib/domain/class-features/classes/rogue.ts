// Rogue (CB 42). Hope feature: Rogue's Dodge, +2 Evasion until an attack succeeds against you, otherwise until your next rest.
import type { ClassFeatures } from "../types";
import { HOPE_COST, withEffect } from "./shared";

const DODGE = "rogues-dodge";

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
  // The effect ends on a hit (`until: "hit"`, the Got hit button) and otherwise on the next rest (CB 42).
  onRest: (sheet) => (sheet.effects.some((e) => e.id === DODGE) ? { ...sheet, effects: sheet.effects.filter((e) => e.id !== DODGE) } : sheet),
};
