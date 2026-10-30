// Expiry of temporary sheet state (D5 T0). Pure module: bundled into Convex.
//
// Contract: every temporary thing on a sheet (an effect, a held die, a used
// feature) carries `until`, and `expire(sheet, event)` is the ONE place that
// removes it. Rests (T3), session start/end (T5), the GM's End scene (RF1;
// CB 107: the GM decides when a scene has played out) and "Got hit" (T8a) call it;
// no class-specific code is needed. What each event ends:
//
// | event       | effects                 | heldDice   | featureUses       |
// |-------------|-------------------------|------------|-------------------|
// | shortRest   | rest                    | -          | rest              |
// | longRest    | rest, longRest          | longRest   | rest, longRest    |
// | session     | session, scene          | session    | session, scene    |
// | scene       | scene                   | -          | scene             |
// | hit         | hit                     | -          | -                 |
//
// A scene end (the encounter ends, the GM's End scene, or the session ends; sheet-drawer Q7, CB 107) also drops what
// the book ties to the scene outside those lists: the Guardian's Unstoppable Die (CB 36: "until the end of the scene")
// and the Martial Artist's active stance (HF 12: "you drop out of your active stance at the end of the scene"). Focus
// and known stances stay. Rests leave both alone, as before. It also clears the tokens of Walk Between Worlds (Hedge
// specialization, HF p.16: "When the last token is removed or at the end of the scene, you return to the Mortal Realm").
//
// A long rest refreshes "rest" features too (CB 105: rest features refresh on
// any rest). `manual` effects and dice end only through their End button.
//
// ```ts
// const rested = expire(sheet, "longRest");    // Rogue's Dodge (`hit`) stays, No Mercy (`rest`) goes
// await saveSheet(ctx, characterId, rested);
// ```

import { featureKey } from "../feature-effects/ids";
import type { CardTokens, ClassState, Effect, FeatureUse, HeldDie } from "../../validation/characters";

export type ExpiryEvent = "shortRest" | "longRest" | "session" | "scene" | "hit";

const EFFECTS: Record<ExpiryEvent, readonly Effect["until"][]> = {
  shortRest: ["rest"],
  longRest: ["rest", "longRest"],
  session: ["session", "scene"],
  scene: ["scene"],
  hit: ["hit"],
};
const HELD_DICE: Record<ExpiryEvent, readonly HeldDie["until"][]> = {
  shortRest: [],
  longRest: ["longRest"],
  session: ["session"],
  scene: [],
  hit: [],
};
const FEATURE_USES: Record<ExpiryEvent, readonly FeatureUse["until"][]> = {
  shortRest: ["rest"],
  longRest: ["rest", "longRest"],
  session: ["session", "scene"],
  scene: ["scene"],
  hit: [],
};
const ENDS_SCENE: Record<ExpiryEvent, boolean> = { shortRest: false, longRest: false, session: true, scene: true, hit: false };

/** Feature tokens (`cardTokens` keys) that end with the scene: Walk Between Worlds (HF p.16). */
export const SCENE_TOKEN_KEYS: readonly string[] = [featureKey("subclass:hedge:walk-between-worlds")];

type Expirable = {
  effects?: readonly Effect[];
  heldDice?: readonly HeldDie[];
  featureUses?: readonly FeatureUse[];
  classState?: ClassState;
  cardTokens?: readonly CardTokens[];
};

/** The class state without what a scene end drops (Unstoppable Die, active stance); the same object when nothing goes. */
function afterScene(state: ClassState | undefined): ClassState | undefined {
  if (state === undefined) return state;
  const dropsStance = state.martial?.active !== undefined;
  if (state.unstoppable === undefined && !dropsStance) return state;
  const { unstoppable: _die, martial, ...rest } = state;
  void _die;
  if (!martial) return rest;
  const { active: _active, ...kept } = martial;
  void _active;
  return { ...rest, martial: kept };
}

/** The sheet without the effects, held dice and feature uses that `event` ends. Other fields are untouched. */
export function expire<T extends Expirable>(sheet: T, event: ExpiryEvent): T {
  const classState = ENDS_SCENE[event] ? afterScene(sheet.classState) : sheet.classState;
  const tokens = sheet.cardTokens;
  const dropsTokens = ENDS_SCENE[event] && tokens !== undefined && tokens.some((t) => SCENE_TOKEN_KEYS.includes(t.cardId));
  return {
    ...sheet,
    ...(classState !== sheet.classState && classState !== undefined ? { classState } : {}),
    ...(dropsTokens ? { cardTokens: tokens.filter((t) => !SCENE_TOKEN_KEYS.includes(t.cardId)) } : {}),
    effects: (sheet.effects ?? []).filter((e) => !EFFECTS[event].includes(e.until)),
    heldDice: (sheet.heldDice ?? []).filter((d) => !HELD_DICE[event].includes(d.until)),
    featureUses: (sheet.featureUses ?? []).filter((u) => !FEATURE_USES[event].includes(u.until)),
  };
}
