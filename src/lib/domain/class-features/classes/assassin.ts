// Assassin (HF 8). Hope feature: Deadly Determination clears 2 Stress.
//
// Class features:
// - Marked for Death: on a successful weapon attack, mark a Stress to mark the target. Damage against it adds
//   tier-many d4s (Executioners Guild: d6 with Ambush, d8 with Backstab at mastery). One target at a time; it lasts
//   until a rest (`until: "rest"`), the target is defeated or the GM spends Fear equal to the tier (the End button).
// - Get In & Get Out: spend a Hope for a way in or out; the next roll acting on it has advantage. The dice box offers
//   the advantage while the effect lasts; taking it ends the effect (`cost.effectId`), so it is spent once.
import { applyResourceDelta, tierForLevel } from "../../characters/index";
import type { CharacterSheet } from "../../../validation/characters";
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse, withEffect } from "./shared";

export const MARKED = "marked-for-death";
export const GET_IN = "get-in-get-out";

const SUCCESS = new Set(["critical", "successHope", "successFear"]);

/** The Marked for Death die: d4, Executioners Guild Ambush d6 and Backstab d8 at mastery (HF 8). Multiclass grants only the foundation. */
export function markedDie(sheet: Pick<CharacterSheet, "classId" | "subclassId" | "subclassRank" | "multiclass">): 4 | 6 | 8 {
  const own = sheet.classId === "assassin" ? { id: sheet.subclassId, rank: sheet.subclassRank } : { id: sheet.multiclass?.subclassId, rank: "foundation" };
  if (own.id !== "executioners-guild") return 4;
  return own.rank === "mastery" ? 8 : 6;
}

export const assassin: ClassFeatures = {
  classId: "assassin",
  hopeFeature: {
    key: "deadlyDetermination",
    name: "Deadly Determination",
    text: "Clear 2 Stress.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet }) => {
      if (sheet.stress === 0) refuse("No Stress is marked.");
      return { sheet: applyResourceDelta(sheet, "stress", -2), summary: "used Deadly Determination: cleared 2 Stress" };
    },
  },
  classActions: [
    {
      key: "markedForDeath",
      name: "Marked for Death",
      text: "After a successful weapon attack: mark the target. Damage against it adds a d4 per tier. Ends on a rest, when it is defeated, or when the GM spends Fear equal to your tier.",
      cost: { stress: 1 },
      automation: "auto",
      target: "none",
      inputs: [{ kind: "text", param: "choice", label: "Target name", placeholder: "The target" }],
      use: ({ sheet, params, roll }) => {
        if (roll?.kind !== "action" || !SUCCESS.has(roll.outcome)) refuse("Your latest roll is not a successful attack.");
        const target = params.choice?.trim().slice(0, 60) || "The target";
        const tier = tierForLevel(sheet.level);
        const die = markedDie(sheet);
        return {
          sheet: withEffect(sheet, {
            id: MARKED,
            source: "Marked for Death",
            text: `${target}: +${tier}d${die} damage against them. Ends on a rest, when they are defeated, or when the GM spends ${tier} Fear.`,
            until: "rest",
          }),
          summary: `used Marked for Death: ${target} is marked (+${tier}d${die} damage)`,
        };
      },
    },
    {
      key: "getInGetOut",
      name: "Get In & Get Out",
      text: "Ask the GM for a quick or inconspicuous way into or out of a place you can see. The next roll that acts on it has advantage (pick it in the dice box).",
      cost: { hope: 1 },
      automation: "auto",
      target: "none",
      use: ({ sheet }) => ({
        sheet: withEffect(sheet, { id: GET_IN, source: "Get In & Get Out", text: "Advantage on the next roll that acts on this way in or out.", until: "session" }),
        summary: "used Get In & Get Out: the next roll acting on it has advantage",
      }),
    },
  ],
  rollOptions: (sheet, kind) => {
    if (kind === "damage") {
      if (!sheet.effects.some((e) => e.id === MARKED)) return [];
      const tier = tierForLevel(sheet.level);
      const die = markedDie(sheet);
      return [{ key: "markedForDeath", label: `Marked for Death (+${tier}d${die})`, effect: { kind: "dice", count: tier, sides: die } }];
    }
    if (!sheet.effects.some((e) => e.id === GET_IN)) return [];
    return [{ key: "getInGetOut", label: "Get In & Get Out (advantage)", effect: { kind: "advantage" }, cost: { effectId: GET_IN } }];
  },
};
