// A card's permanent picks made when it is chosen (plan lanes-2 E8.3, dcm-31hq / dcm-40mj). Pure module: bundled into
// Convex. convex/levelUp.ts runs the card's `whenYouChooseThisCard` use once (feature-effects/run.ts `runOnChoose`) when a
// level-up takes the card, and writes the plan here.
//
// Vitality (Blade 5, CB p.330): "When you choose this card, permanently gain two of the following benefits: • One Stress
// slot • One Hit Point slot • +2 bonus to your damage thresholds Then place this card in your vault permanently."
//
// - Slots go through characters/slots.ts `gainSlots`, keyed `card:<cardId>:hp+<n>` / `card:<cardId>:stress+<n>` in
//   `sheet.slotBonuses`, so a level-up undo takes exactly them back (`revertChosenPicks`).
// - A threshold bonus is recorded the same way (`card:<cardId>:major+<n>`, `card:<cardId>:severe+<n>`) and read by
//   `permanentThresholds`; the sheet's derived thresholds (characters/derived.ts) add it once that lane reads it.
// - `toVault` takes the card out of the loadout (it stays owned: the vault).
//
// ```ts
// const out = runOnChoose(cardEffect("vitality")!, { actor, gmFear: 0, rng, options: { benefits: ["hp", "stress"] } });
// if (out?.ok) sheet = applyChosenPicks(sheet, "vitality", chosenPicks(out.plan, actor.id));
// ```

import type { RunPlan } from "../card-effects/run";
import { gainSlots, loseSlots } from "../characters/slots";
import type { CharacterSheet } from "../../validation/characters";

/** What a card's choosing gives for good. */
export type ChosenPicks = {
  hp: number;
  stress: number;
  major: number;
  severe: number;
  toVault: boolean;
  /** Choices the plan still asks for (a `choose` step without a pick): the caller refuses the level-up. */
  missing: string[];
  /** Lines the plan leaves to the table (manual steps). */
  manual: string[];
};

/** The permanent picks of a `whenYouChooseThisCard` plan for the actor `actorId`. */
export function chosenPicks(plan: Pick<RunPlan, "steps">, actorId: string): ChosenPicks {
  const out: ChosenPicks = { hp: 0, stress: 0, major: 0, severe: 0, toVault: false, missing: [], manual: [] };
  for (const s of plan.steps) {
    if (s.kind === "effect" && s.targetId === actorId) {
      for (const m of s.mods) {
        if (m.kind !== "stat") continue;
        if (m.stat === "hpMax") out.hp += m.delta;
        else if (m.stat === "stressMax") out.stress += m.delta;
        else if (m.stat === "majorThreshold") out.major += m.delta;
        else if (m.stat === "severeThreshold") out.severe += m.delta;
      }
    } else if (s.kind === "toVault") out.toVault = true;
    else if (s.kind === "prompt" && s.prompt === "choose") out.missing.push(s.text);
    else if (s.kind === "prompt" && s.prompt === "manual") out.manual.push(s.text);
  }
  return out;
}

const keyOf = (cardId: string, what: "hp" | "stress" | "major" | "severe", n: number) => `card:${cardId}:${what}+${n}`;
const KEY = /^card:(.+):(hp|stress|major|severe)\+(\d+)$/;

/** The sheet with a card's permanent picks: slots raised once, threshold bonuses recorded, the card vaulted. */
export function applyChosenPicks(sheet: CharacterSheet, cardId: string, picks: ChosenPicks): CharacterSheet {
  let out = sheet;
  if (picks.hp > 0) out = gainSlots(out, keyOf(cardId, "hp", picks.hp), { hp: picks.hp, stress: 0 });
  if (picks.stress > 0) out = gainSlots(out, keyOf(cardId, "stress", picks.stress), { hp: 0, stress: picks.stress });
  for (const what of ["major", "severe"] as const) {
    const n = picks[what];
    const key = keyOf(cardId, what, n);
    if (n > 0 && !(out.slotBonuses ?? []).includes(key)) out = { ...out, slotBonuses: [...(out.slotBonuses ?? []), key] };
  }
  if (picks.toVault) out = { ...out, domainCards: { ...out.domainCards, loadout: out.domainCards.loadout.filter((c) => c !== cardId) } };
  return out;
}

/** The sheet without the permanent picks of these cards (a level-up undo): slots taken back, bonuses dropped. */
export function revertChosenPicks(sheet: CharacterSheet, cardIds: readonly string[]): CharacterSheet {
  let out = sheet;
  for (const key of sheet.slotBonuses ?? []) {
    const m = KEY.exec(key);
    if (m === null || !cardIds.includes(m[1]!)) continue;
    const n = Number(m[3]);
    if (m[2] === "hp") out = loseSlots(out, key, { hp: n, stress: 0 });
    else if (m[2] === "stress") out = loseSlots(out, key, { hp: 0, stress: n });
    else out = { ...out, slotBonuses: (out.slotBonuses ?? []).filter((k) => k !== key) };
  }
  return out;
}

/** The permanent threshold bonuses the sheet's chosen cards recorded (Vitality's +2). */
export function permanentThresholds(sheet: Pick<CharacterSheet, "slotBonuses">): { major: number; severe: number } {
  const out = { major: 0, severe: 0 };
  for (const key of sheet.slotBonuses ?? []) {
    const m = KEY.exec(key);
    if (m?.[2] === "major") out.major += Number(m[3]);
    else if (m?.[2] === "severe") out.severe += Number(m[3]);
  }
  return out;
}

/** The cards a level-up adds (its card, the domain card option's, the trade's new card). */
export function cardsGained(advancement: { cardId: string; picks: readonly { option: string; targets?: readonly string[] }[]; tradeIn?: string }): string[] {
  return [advancement.cardId, ...advancement.picks.filter((p) => p.option === "domainCard").flatMap((p) => p.targets ?? []), ...(advancement.tradeIn ? [advancement.tradeIn] : [])];
}
