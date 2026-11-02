"use client";

import "./pick.css";

import type { HudLayerProps, HudPartProps } from "../state";
import { PickLauncher } from "./attack";
import { PickRings } from "./layer";
import { PickPanel } from "./panel";
import { PickWaiting } from "./waiting";

/**
 * The picking core (plan combat-hud H3.0; HANDOFF "The picking pattern"; boards CmpPicking, Main, CmpTokens,
 * CmpPromptsPlayer). The shell mounts `HudPick` in the pop region and `HudPickLayer` on the map, each in its own
 * PartBoundary, and `PickProvider` inside its `HudProvider`. Pickers (H3.1 cards, H3.2 attacks, H3.3 features and
 * areas, H3.4 the action ring, H5.2 the GM's adversaries) import the API from here:
 *
 *   const pick = usePick();
 *   pick.open({ id, source, rule, primary, picked?, options?, rows?, extra?, data?, actor?, onCancel? });
 *
 * See types.ts for every field and docs/tasks/TASK-HUD-H3.0.md for a worked example.
 */

/** The picking panel beside the primary target, "Waiting for the GM" with Withdraw, and the interim Attack button. */
export function HudPick({ state }: HudPartProps) {
  return (
    <>
      <PickPanel state={state} />
      <PickWaiting state={state} />
      <PickLauncher state={state} />
    </>
  );
}

/** The target rings on the map (picked / in / out / los, band labels; CmpTokens 'Target rings'). */
export function HudPickLayer(props: HudLayerProps) {
  return <PickRings {...props} />;
}

export { PickProvider, usePick, type PickApi, type PickLive } from "./session";
export { plainAttackSession, type PlainAttack } from "./attack";
export { dropWithdrawn } from "./waiting";
export {
  buildRows,
  canToggle,
  GM_APPROVES_LINE,
  keepPicks,
  ruleText,
  selectionOf,
  stateOf,
  togglePick,
  waitingReason,
  waitingUses,
  type PickCreature,
  type WaitingUse,
} from "./model";
export type {
  PickActor,
  PickContext,
  PickOption,
  PickOutcome,
  PickPatch,
  PickPrimary,
  PickReach,
  PickRow,
  PickRowInput,
  PickRule,
  PickSelection,
  PickSessionSpec,
  PickSource,
  PickState,
} from "./types";
