// Wizard (CB 50). Hope feature: Not This Time (assist). Class feature: Strange Patterns.
//
// Strange Patterns: the Wizard picks a number 1-12 (`classState.strangeNumber`, `params.amount`); it can be
// changed again after a long rest (a `featureUses` mark until the long rest). When a Duality Die of an action
// roll shows the number, the dice box prompts "+1 Hope or clear 1 Stress"; the answer goes to
// `strangePatternsBenefit` with `params.choice` "hope" or "stress" (without one: Hope, or Stress when Hope is
// full). Both dice showing the number still give one benefit (decision 6). The benefit checks the Wizard's
// latest roll and marks it claimed (a `featureUses` entry keyed by the roll), so it is taken once per roll.
import { applyResourceDelta, hopeMax } from "../../characters/index";
import type { RollRecord } from "../../duality";
import type { ClassFeatures, FeatureMeta } from "../types";
import { assistFeature, dualityDie, refuse } from "./shared";

const CHANGE = "strangePatternsChange";
const CLAIM = "sp:";
const KEY_MAX = 40;

/** A roll's identity for the claim mark: its dice, modifier and total. */
const claimKey = (roll: RollRecord): string => `${CLAIM}${roll.dice.map((d) => d.value).join(".")}|${roll.modifier}|${roll.total}`.slice(0, KEY_MAX);

const matches = (roll: RollRecord, n: number): boolean => dualityDie(roll, "hope") === n || dualityDie(roll, "fear") === n;

const strangePatterns: FeatureMeta = {
  key: "strangePatterns",
  name: "Strange Patterns",
  text: "Choose a number from 1 to 12. When a Duality Die shows it, gain a Hope or clear a Stress. You can change it when you take a long rest.",
  automation: "auto",
  target: "self",
  inputs: [{ kind: "number", param: "amount", label: "Number (1-12)", min: 1, max: 12 }],
  use: ({ sheet, params }) => {
    const n = params.amount ?? Number(params.choice);
    if (!Number.isInteger(n) || n < 1 || n > 12) refuse("Choose a number from 1 to 12.");
    if (sheet.featureUses.some((u) => u.key === CHANGE)) refuse("You can change the number when you take a long rest.");
    const changed = sheet.classState.strangeNumber !== undefined;
    return {
      sheet: { ...sheet, classState: { ...sheet.classState, strangeNumber: n }, featureUses: [...sheet.featureUses, { key: CHANGE, until: "longRest" }] },
      summary: `${changed ? "changed" : "chose"} the Strange Patterns number: ${n}`,
    };
  },
};

const strangePatternsBenefit: FeatureMeta = {
  key: "strangePatternsBenefit",
  name: "Strange Patterns: benefit",
  text: "Your latest Duality roll showed your number: gain a Hope or clear a Stress.",
  automation: "auto",
  target: "self",
  inputs: [
    {
      kind: "select",
      param: "choice",
      label: "Benefit",
      required: false,
      empty: "Hope (Stress when Hope is full)",
      options: () => [
        { value: "hope", label: "+1 Hope" },
        { value: "stress", label: "Clear 1 Stress" },
      ],
    },
  ],
  use: ({ sheet, params, roll }) => {
    const n = sheet.classState.strangeNumber;
    if (n === undefined) refuse("Choose your Strange Patterns number first.");
    if ((roll?.kind !== "action" && roll?.kind !== "reaction") || !matches(roll, n)) refuse(`Your latest roll shows no ${n} on a Duality Die.`);
    const key = claimKey(roll);
    if (sheet.featureUses.some((u) => u.key === key)) refuse("You already took the benefit for this roll.");
    const choice = params.choice ?? (sheet.hope < hopeMax(sheet.scars, sheet.hopeSlotBonus) ? "hope" : "stress");
    if (choice !== "hope" && choice !== "stress") refuse("Choose Hope or Stress.");
    // Keep one claim mark: the latest roll's.
    const marked = { ...sheet, featureUses: [...sheet.featureUses.filter((u) => !u.key.startsWith(CLAIM)), { key, until: "rest" as const }] };
    if (choice === "hope") return { sheet: applyResourceDelta(marked, "hope", 1), summary: "used Strange Patterns: +1 Hope" };
    return { sheet: applyResourceDelta(marked, "stress", -1), summary: "used Strange Patterns: cleared 1 Stress" };
  },
};

export const wizard: ClassFeatures = {
  classId: "wizard",
  hopeFeature: assistFeature("notThisTime", "Not This Time", "Force an adversary within Far range to reroll an attack or damage roll."),
  classActions: [strangePatterns, strangePatternsBenefit],
  afterDualityRoll: (sheet, { roll }) => {
    const n = sheet.classState.strangeNumber;
    if (n === undefined || !matches(roll, n)) return [];
    return [
      {
        key: "strangePatterns",
        featureKey: "strangePatternsBenefit",
        text: `Strange Patterns: a Duality Die shows ${n}. Gain a Hope or clear a Stress (one benefit).`,
        choices: [
          { key: "hope", label: "+1 Hope" },
          { key: "stress", label: "Clear 1 Stress" },
        ],
      },
    ];
  },
};
