// Ranger (Beastbound) companion sheet (Core Book pp.40–41).

import { z } from "zod";

import { RuleError } from "../../errors/app-error";

import type { Range } from "../../srd/types";
import { RANGES } from "./common";

/** "Fill in their Evasion, which starts at 10." */
export const COMPANION_BASE_EVASION = 10;
/** Stress slots before Resilient (the companion sheet's three printed slots, as on the Party board). */
export const COMPANION_BASE_STRESS = 3;
export const COMPANION_EXPERIENCE_VALUE = 2;
export const COMPANION_DICE = [6, 8, 10, 12] as const;

/** Level-up options; `max` is how many boxes the sheet gives each (as on the Party board). */
export const TRAINING = [
  { id: "intelligent", max: 3, name: "Intelligent", text: "Your companion gains a permanent +1 bonus to a Companion Experience of your choice." },
  { id: "lightInTheDark", max: 1, name: "Light in the Dark", text: "Use this as an additional Hope slot your character can mark." },
  {
    id: "creatureComfort",
    max: 1,
    name: "Creature Comfort",
    text: "Once per rest, when you take time during a quiet moment to give your companion love and attention, you can gain a Hope or you can both clear a Stress.",
  },
  { id: "armored", max: 1, name: "Armored", text: "When your companion takes damage, you can mark one of your Armor Slots instead of marking one of their Stress." },
  { id: "vicious", max: 3, name: "Vicious", text: "Increase your companion’s damage dice or range by one step (d6 to d8, Close to Far, etc.)." },
  { id: "resilient", max: 3, name: "Resilient", text: "Your companion gains an additional Stress slot." },
  {
    id: "bonded",
    max: 1,
    name: "Bonded",
    text: "When you mark your last Hit Point, your companion rushes to your side to comfort you. Roll a number of d6s equal to the unmarked Stress slots they have and mark them. If any roll a 6, your companion helps you up. Clear your last Hit Point and return to the scene.",
  },
  { id: "aware", max: 3, name: "Aware", text: "Your companion gains a permanent +2 bonus to their Evasion." },
] as const;
export type TrainingId = (typeof TRAINING)[number]["id"];

const text = (max: number) => z.string().max(max);

export const companionStateSchema = z.object({
  name: text(80),
  kind: text(80),
  experiences: z.array(z.object({ name: z.string().trim().min(1).max(80), value: z.number().int().min(-5).max(10) })).max(5),
  attack: z.object({ name: text(80), damageType: z.enum(["phy", "mag"]) }),
  stress: z.number().int().min(0).max(COMPANION_BASE_STRESS + 3),
  training: z.record(z.string(), z.number().int().min(0).max(3)),
  /** One entry per Vicious mark: which step it took. */
  vicious: z.array(z.enum(["die", "range"])).max(3),
  /** Extra options from Expert Training (+1) and Advanced Training (+2). */
  bonusTraining: z.number().int().min(0).max(3),
  gifts: text(2000),
  inventory: text(2000),
});
export type CompanionState = z.infer<typeof companionStateSchema>;

export const INITIAL_COMPANION: CompanionState = {
  name: "",
  kind: "",
  experiences: [],
  attack: { name: "", damageType: "phy" },
  stress: 0,
  training: {},
  vicious: [],
  bonusTraining: 0,
  gifts: "",
  inventory: "",
};

const count = (s: CompanionState, id: TrainingId) => s.training[id] ?? 0;

/** "Whenever you gain a new Experience, your companion also gains one": PCs gain one at levels 2, 5 and 8. */
export function companionExperienceLimit(level: number): number {
  return 2 + [2, 5, 8].filter((l) => level >= l).length;
}

/** One option per level-up, plus Expert/Advanced Training. */
export function trainingCap(level: number, bonusTraining: number): number {
  return Math.max(0, level - 1) + bonusTraining;
}

export function companionStats(s: CompanionState, level: number) {
  const dieSteps = s.vicious.filter((v) => v === "die").length;
  const rangeSteps = s.vicious.length - dieSteps;
  const stressMax = COMPANION_BASE_STRESS + count(s, "resilient");
  const used = TRAINING.reduce((sum, t) => sum + count(s, t.id), 0);
  return {
    evasion: COMPANION_BASE_EVASION + 2 * count(s, "aware"),
    stressMax,
    damageDie: COMPANION_DICE[Math.min(COMPANION_DICE.length - 1, dieSteps)],
    range: RANGES[Math.min(RANGES.length - 1, rangeSteps)] as Range,
    trainingUsed: used,
    trainingCap: trainingCap(level, s.bonusTraining),
    experienceLimit: companionExperienceLimit(level),
    /** "When they mark their last Stress, they drop out of the scene." */
    out: s.stress >= stressMax,
  };
}

/** Throws a readable Error when the sheet breaks a companion rule at this character level. */
export function validateCompanion(s: CompanionState, level: number): void {
  for (const key of Object.keys(s.training)) {
    const option = TRAINING.find((t) => t.id === key);
    if (!option) throw new RuleError("EXTRA_RULE", "Unknown training option.");
    if (s.training[key] > option.max) throw new RuleError("EXTRA_RULE", `${option.name} can be taken ${option.max === 1 ? "once" : `${option.max} times`}.`);
  }
  const stats = companionStats(s, level);
  if (stats.trainingUsed > stats.trainingCap) throw new RuleError("EXTRA_RULE", `Your companion can have ${stats.trainingCap} training option(s) at level ${level}.`);
  if (s.vicious.length !== count(s, "vicious")) throw new RuleError("EXTRA_RULE", "Choose damage die or range for each Vicious mark.");
  const dieSteps = s.vicious.filter((v) => v === "die").length;
  if (dieSteps > COMPANION_DICE.length - 1) throw new RuleError("EXTRA_RULE", "The damage die can't go past d12.");
  if (s.vicious.length - dieSteps > RANGES.length - 1) throw new RuleError("EXTRA_RULE", "The range can't go past Very Far.");
  if (s.stress > stats.stressMax) throw new RuleError("EXTRA_RULE", `Your companion has ${stats.stressMax} Stress slots.`);
  if (s.experiences.length > stats.experienceLimit) throw new RuleError("EXTRA_RULE", `Your companion can have ${stats.experienceLimit} Experiences at level ${level}.`);
}
