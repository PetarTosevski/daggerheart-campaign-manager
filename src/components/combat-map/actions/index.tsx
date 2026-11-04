"use client";

import "./actions.css";

export { GmOwnHits } from "./reactions";
export { TargetsLayer } from "./targets";
export { ActionsProvider, useCombatTargets, type Aim, type CombatTargets } from "./targets/state";

/**
 * Combat actions slot (plan combat-actions): the target rings layer and the shared target state. Plan combat-hud H8.1
 * (cut-over): the player's Hand, Attack bar, target list, map dice, mini feed and phone bottom sheet are the HUD's now
 * (`hud/hand`, `hud/pick-attack`, `hud/pick`, `hud/scene/dice.tsx`, `hud/feed`, `hud/phone`), and the GM plays a PC's
 * cards from the HUD's hand. H8.2 (GM side): the GM column's Resolutions (adversary actions, CA5 Resolutions, the End
 * scene card) is gone: the HUD's "Waiting on you" queue holds the Resolutions and the scene tools End scene;
 * `EndSceneButton` (`./scene`) stays for the Encounter tab. Export names and props follow
 * src/components/combat-map/slots.ts.
 */
