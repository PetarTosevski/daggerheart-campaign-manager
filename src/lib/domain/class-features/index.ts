// The class-feature registry (D5). T8a lists one module per class from
// `classes/<classId>.ts`; T8b and T8c fill their class files.
// Callers never read it directly: use `hooks.ts` (see types.ts for the contract).

import { CLASSES } from "../../srd/classes";
import type { ClassState } from "../../validation/characters";
import { assassin } from "./classes/assassin";
import { bard } from "./classes/bard";
import { brawler } from "./classes/brawler";
import { druid } from "./classes/druid";
import { guardian } from "./classes/guardian";
import { ranger } from "./classes/ranger";
import { rogue } from "./classes/rogue";
import { seraph } from "./classes/seraph";
import { sorcerer } from "./classes/sorcerer";
import { warlock } from "./classes/warlock";
import { warrior } from "./classes/warrior";
import { witch } from "./classes/witch";
import { wizard } from "./classes/wizard";
import { rallyDieStress } from "./held-dice";
import type { ClassFeatures } from "./types";

/** Class id → its features. A class without an entry gets the no-op defaults in hooks.ts. */
export type Registry = Readonly<Record<string, ClassFeatures>>;

/** Every class can spend a held Rally Die to clear Stress (held-dice.ts), so each module lists that action too. */
const withHeldDice = (modules: readonly ClassFeatures[]): Registry =>
  Object.fromEntries(modules.map((m) => [m.classId, { ...m, classActions: [...(m.classActions ?? []), rallyDieStress] }]));

export const CLASS_FEATURES: Registry = withHeldDice([bard, druid, guardian, ranger, rogue, seraph, sorcerer, warrior, wizard, assassin, brawler, warlock, witch]);

/** A Hope & Fear class's features are offered only while the campaign's `hopeAndFear` option is on. */
export function classFeaturesAvailable(classId: string, hopeAndFear: boolean): boolean {
  return hopeAndFear || CLASSES.find((c) => c.id === classId)?.source !== "hope-and-fear";
}

/** Labels for the features panel's generic `classState` counters. */
export const CLASS_STATE_LABELS: Record<keyof ClassState, string> = {
  unstoppable: "Unstoppable die",
  focus: "Focus",
  strangeNumber: "Strange Patterns number",
  marked: "Marked for Death",
  getInGetOut: "Get In & Get Out",
  comboDie: "Combo die",
  favor: "Favor",
  hexes: "Hexed",
};
