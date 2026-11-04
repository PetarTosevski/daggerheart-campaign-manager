import type { FunctionReturnType } from "convex/server";

import type { Step } from "@/lib/domain/card-effects/types";
import type { RollRecord } from "@/lib/domain/duality";
import { cardEffect } from "@/lib/srd/card-effects";
import { featureEffect } from "@/lib/srd/feature-effects";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Attack riders (plan sheet-drawer SD5; docs/tasks/TASK-SD-SD5.md): the picks for each rider of the character's loadout
 * cards and features that rides on the chosen weapon's attack (Rage Up, Hold Them Off, Kick...): a number, an option, a
 * situation to confirm, extra targets. Automatic riders (Sneak Attack from positions, First Strike...) are not listed:
 * the server applies them. The HUD's attack and feature pickers show the rows (plan combat-hud H3.1); the classic toggles
 * and after-roll prompt went with the cut-over (H8.1), and `HeldRoll` is the held roll the HUD's result shows (Q1).
 */

export type RiderOption = FunctionReturnType<typeof api.combatActions.riders>[number];

/** What the player set for one rider. */
export type RiderPick = { on: boolean; numbers: Record<string, number>; options: Record<string, string>; situations: string[]; extra: string[] };

export type RiderPicks = Record<string, RiderPick>;

/** A rider's key in the picks: source, id and use. */
export const riderKey = (o: Pick<RiderOption, "source" | "id" | "useId">) => `${o.source}|${o.id}|${o.useId}`;

const EMPTY: RiderPick = { on: false, numbers: {}, options: {}, situations: [], extra: [] };

/** A rider's picks; a default-on rider (Rise to the Challenge, DA2) starts on. */
export function pickOf(picks: RiderPicks, o: RiderOption): RiderPick {
  return picks[riderKey(o)] ?? (o.defaultOn ? { ...EMPTY, on: true } : EMPTY);
}

/**
 * DA2 (CB p.48 Rise to the Challenge, user 2026-10-30): the d20 Hope Die is on by default while it applies; `false` when
 * the player switched a default-on rider off (fishing for a critical), else undefined (the server's default: on).
 */
export function riseToSend(options: readonly RiderOption[], picks: RiderPicks): false | undefined {
  return options.some((o) => o.defaultOn && !pickOf(picks, o).on) ? false : undefined;
}

/** The most extra targets a rider allows with these picks (Surrounded: as many as the Hope picked). */
export function extraMax(o: RiderOption, pick: RiderPick): number {
  if (o.addTargets === null) return 0;
  if (o.addTargets.max !== null) return o.addTargets.max;
  const first = o.numbers[0];
  return first ? (pick.numbers[first.id] ?? first.min) : 0;
}

/**
 * The `riders` argument of `combatActions.attack` for the toggled riders (only ready ones): numbers (`n:`), options
 * (`opt:`), confirmed situations and the extra targets (`picked`, at most `extraMax`).
 */
export function ridersToSend(options: readonly RiderOption[], picks: RiderPicks): { source: "card" | "feature"; id: string; useId: string; choices: { id: string; value: number | string | string[] }[] }[] {
  return options.flatMap((o) => {
    const pick = pickOf(picks, o);
    // A default-on rider is applied by the server; only switching it off is sent (`riseToSend`).
    if (!pick.on || !o.ready || o.defaultOn) return [];
    const choices: { id: string; value: number | string | string[] }[] = [];
    for (const n of o.numbers) choices.push({ id: n.id, value: pick.numbers[n.id] ?? n.min });
    for (const opt of o.options) {
      const value = pick.options[opt.id];
      if (value !== undefined) choices.push({ id: opt.id, value: [value] });
    }
    if (pick.situations.length > 0) choices.push({ id: "situations", value: pick.situations.filter((s) => o.situations.includes(s)) });
    if (o.addTargets !== null && pick.extra.length > 0) choices.push({ id: "picked", value: pick.extra.slice(0, extraMax(o, pick)) });
    return [{ source: o.source, id: o.id, useId: o.useId, choices }];
  });
}

/** What a toggled rider still needs before the attack (an unanswered option), or null. */
export function riderProblem(options: readonly RiderOption[], picks: RiderPicks): string | null {
  for (const o of options) {
    const pick = pickOf(picks, o);
    if (!pick.on || !o.ready) continue;
    const missing = o.options.find((opt) => pick.options[opt.id] === undefined);
    if (missing) return `${o.name}: ${missing.label}`;
  }
  return null;
}

type Chip = { _id: Id<"combatTokens">; name: string; ally?: boolean };

/** Every `addTargets` step of a list, nested ones included. */
function addTargetsSteps(steps: readonly Step[]): Extract<Step, { kind: "addTargets" }>[] {
  return steps.flatMap((s) => [
    ...(s.kind === "addTargets" ? [s] : []),
    ...(s.kind === "optional" || s.kind === "followUp" ? addTargetsSteps(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((x) => addTargetsSteps(x.steps)) : []),
  ]);
}

/** Whether a rider's extra targets may be allies: its `addTargets` spec's side is `any`, `ally` or `selfOrAlly` (AB2). */
export function extraTakesAllies(o: Pick<RiderOption, "source" | "id" | "useId">): boolean {
  const entry = o.source === "card" ? cardEffect(o.id) : featureEffect(o.id);
  const use = entry?.uses.find((u) => u.id === o.useId);
  return addTargetsSteps(use?.steps ?? []).some((s) => s.targets.side === "any" || s.targets.side === "ally" || s.targets.side === "selfOrAlly");
}

/** The chips a rider's extra targets offer: the enemies, plus the allies when its spec takes any creature (Surrounded). */
export function extraCandidates(o: Pick<RiderOption, "source" | "id" | "useId">, enemies: readonly Chip[], allies: readonly Chip[]): readonly Chip[] {
  return allies.length > 0 && extraTakesAllies(o) ? [...enemies, ...allies.map((a) => ({ ...a, ally: true }))] : enemies;
}

/** A held roll as the prompt shows it: the attacker's own dice, Hit / Miss per target and the features on offer (U1). */
export type HeldRoll = {
  requestId: Id<"combatRequests">;
  roll: RollRecord;
  targets: readonly { tokenId: string; name: string; hit: boolean }[];
  options: readonly { featureId: string; useId: string; name: string; costs: readonly string[] }[];
};
