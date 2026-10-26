// Ranger (CB 38). Hope feature: Hold Them Off (assist). Class feature: Ranger's Focus.
//
// Ranger's Focus: make the attack in the dice box, then press Ranger's Focus (1 Hope): when that latest
// action roll succeeded, its target becomes the Focus (`classState.focus`, `params.choice` names it);
// on a failure the Hope is still spent and nothing is set. After a failed attack against the Focus,
// "Focus reroll" ends the Focus and rerolls the Duality Dice of that roll; the old roll's Hope or Fear is
// taken back and the new one's given (CB 94-95), as Patron's Boon does.
import { applyResourceDelta } from "../../characters/index";
import { actionOutcome, type RolledDie } from "../../duality";
import type { CharacterSheet } from "../../../validation/characters";
import type { ClassFeatures, FeatureMeta } from "../types";
import { assistFeature, dieContribution, isFailure, refuse, rollGains } from "./shared";

const FOCUS_MAX = 80;

function withoutFocus(sheet: CharacterSheet): CharacterSheet {
  const classState = { ...sheet.classState };
  delete classState.focus;
  return { ...sheet, classState };
}

const rangersFocus: FeatureMeta = {
  key: "rangersFocus",
  name: "Ranger’s Focus",
  text: "Spend a Hope with an attack: on a success its target becomes your Focus. You know their direction, they mark a Stress when you damage them, and you can end the Focus to reroll a failed attack against them.",
  cost: { hope: 1 },
  automation: "auto",
  target: "self",
  inputs: [{ kind: "text", param: "choice", label: "Target name", placeholder: "the target" }],
  use: ({ sheet, params, roll }) => {
    if (roll?.kind !== "action") refuse("Make the attack first: your latest roll is not an action roll.");
    if (isFailure(roll)) return { sheet, summary: "used Ranger’s Focus: the attack failed, no Focus" };
    const focus = (params.choice?.trim() || "the target").slice(0, FOCUS_MAX);
    return { sheet: { ...sheet, classState: { ...sheet.classState, focus } }, summary: `used Ranger’s Focus: ${focus} is the Focus` };
  },
};

const focusReroll: FeatureMeta = {
  key: "focusReroll",
  name: "Focus reroll",
  text: "When you fail an attack against your Focus: end Ranger's Focus to reroll your Duality Dice.",
  automation: "auto",
  target: "self",
  use: ({ sheet, rng, roll }) => {
    if (sheet.classState.focus === undefined) refuse("You have no Focus.");
    if (roll?.kind !== "action" || !isFailure(roll)) refuse("Your latest roll is not a failed attack.");
    const dice = roll.dice.map((d): RolledDie => (d.role === "hope" || d.role === "fear") && !d.dropped ? { ...d, value: rng(d.sides) } : d);
    const total = roll.total - roll.dice.reduce((s, d) => s + dieContribution(d), 0) + dice.reduce((s, d) => s + dieContribution(d), 0);
    const hope = dice.find((d) => d.role === "hope" && !d.dropped)?.value ?? 0;
    const fear = dice.find((d) => d.role === "fear" && !d.dropped)?.value ?? 0;
    const next = { ...roll, dice, total, outcome: actionOutcome(hope, fear, total, roll.difficulty), manual: false };

    const before = rollGains(roll);
    const after = rollGains(next);
    let updated = applyResourceDelta(withoutFocus(sheet), "hope", -before.hope);
    updated = applyResourceDelta(updated, "hope", after.hope);
    if (after.stress !== 0) updated = applyResourceDelta(updated, "stress", after.stress);
    const fearDelta = after.fear - before.fear;
    return {
      sheet: updated,
      roll: next,
      ...(fearDelta !== 0 ? { fearDelta } : {}),
      summary: `ended Ranger’s Focus to reroll the Duality Dice, ${roll.total} → ${total}`,
    };
  },
};

const endFocus: FeatureMeta = {
  key: "endFocus",
  name: "End Focus",
  text: "Ranger's Focus ends.",
  automation: "auto",
  target: "self",
  use: ({ sheet }) => {
    if (sheet.classState.focus === undefined) refuse("You have no Focus.");
    return { sheet: withoutFocus(sheet), summary: "ended Ranger’s Focus" };
  },
};

export const ranger: ClassFeatures = {
  classId: "ranger",
  hopeFeature: assistFeature("holdThemOff", "Hold Them Off", "After a successful weapon attack, use the same roll against two more adversaries within range."),
  classActions: [rangersFocus, focusReroll, endFocus],
};
