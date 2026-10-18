// Expiry of temporary sheet state (D5 T0). Pure module: bundled into Convex.
//
// Contract: every temporary thing on a sheet (an effect, a held die, a used
// feature) carries `until`, and `expire(sheet, event)` is the ONE place that
// removes it. Rests (T3), session start/end (T5) and "Got hit" (T8a) call it;
// no class-specific code is needed. What each event ends:
//
// | event       | effects                 | heldDice   | featureUses       |
// |-------------|-------------------------|------------|-------------------|
// | shortRest   | rest                    | -          | rest              |
// | longRest    | rest, longRest          | longRest   | rest, longRest    |
// | session     | session, scene          | session    | session           |
// | hit         | hit                     | -          | -                 |
//
// A long rest refreshes "rest" features too (CB 105: rest features refresh on
// any rest). `manual` effects and dice end only through their End button.
//
// ```ts
// const rested = expire(sheet, "longRest");    // Rogue's Dodge (`hit`) stays, No Mercy (`rest`) goes
// await saveSheet(ctx, characterId, rested);
// ```

import type { Effect, FeatureUse, HeldDie } from "../../validation/characters";

export type ExpiryEvent = "shortRest" | "longRest" | "session" | "hit";

const EFFECTS: Record<ExpiryEvent, readonly Effect["until"][]> = {
  shortRest: ["rest"],
  longRest: ["rest", "longRest"],
  session: ["session", "scene"],
  hit: ["hit"],
};
const HELD_DICE: Record<ExpiryEvent, readonly HeldDie["until"][]> = {
  shortRest: [],
  longRest: ["longRest"],
  session: ["session"],
  hit: [],
};
const FEATURE_USES: Record<ExpiryEvent, readonly FeatureUse["until"][]> = {
  shortRest: ["rest"],
  longRest: ["rest", "longRest"],
  session: ["session"],
  hit: [],
};

type Expirable = { effects?: readonly Effect[]; heldDice?: readonly HeldDie[]; featureUses?: readonly FeatureUse[] };

/** The sheet without the effects, held dice and feature uses that `event` ends. Other fields are untouched. */
export function expire<T extends Expirable>(sheet: T, event: ExpiryEvent): T {
  return {
    ...sheet,
    effects: (sheet.effects ?? []).filter((e) => !EFFECTS[event].includes(e.until)),
    heldDice: (sheet.heldDice ?? []).filter((d) => !HELD_DICE[event].includes(d.until)),
    featureUses: (sheet.featureUses ?? []).filter((u) => !FEATURE_USES[event].includes(u.until)),
  };
}
