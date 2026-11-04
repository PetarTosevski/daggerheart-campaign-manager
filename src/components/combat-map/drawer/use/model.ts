import type { FunctionReturnType } from "convex/server";

import { pickUse } from "@/lib/domain/card-effects/run";
import type { AreaSpec, CardUse, Step } from "@/lib/domain/card-effects/types";
import { asCardEffect } from "@/lib/domain/feature-effects/run";
import { featureEffect } from "@/lib/srd/feature-effects";

import type { api } from "../../../../../convex/_generated/api";

/** What `featurePrompts.chargeOptions` returns: names, bands and squares only (U1). */
export type ChargeTarget = FunctionReturnType<typeof api.featurePrompts.chargeOptions>[number];
export type CountView = FunctionReturnType<typeof api.featurePrompts.targetCount>;

/** The Firbolg's Charge (CB p.59): its square and roll go through `featurePrompts.charge`. */
export const CHARGE_FEATURE = "ancestry:firbolg:charge";

/**
 * The server-decided uses the drawer runs itself (dcm-bxp.99.19.56): `count` for a use whose target count the server
 * rolls first (Warden's Protection, CB p.31: `featurePrompts.rollCount`, then `combatFeatures.useFeature`), `charge` for
 * Charge (`featurePrompts.charge`). Null for every other use (the general Use flow, SD7).
 */
export type ServerUse =
  | { kind: "count"; use: CardUse; name: string; range: string }
  | { kind: "charge"; use: CardUse; name: string }
  | { kind: "area"; use: CardUse; name: string; area: AreaSpec; picks: AreaPicks };

/**
 * How many squares an area use picks (plan lanes-2 E4.4, AO follow-up): `one` centre, a `wall`'s two ends (Wall of Flame,
 * CB p.332), or a `count` area's squares, one area each (Forest Sprites, CB p.339: "appear at points you choose"): a
 * `fixed` number, or a number the player picks (`choice`: the use's choice id the count reads, sent as `n:<choice>`).
 */
export type AreaPicks = { kind: "one" } | { kind: "wall" } | { kind: "count"; fixed: number | null; choice: string | null };

/** The most squares one use sends (the server's MAX_AREA_COUNT, convex/combatAreas.ts). */
export const MAX_PICKED_SQUARES = 10;

export const RANGE_LABEL: Record<string, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };

/** Every `area` step of a step list, nested ones (choice options, success branches) included. */
export function areaStepsOf(steps: readonly Step[]): AreaSpec[] {
  const out: AreaSpec[] = [];
  for (const step of steps) {
    if (step.kind === "area") out.push(step.area);
    for (const value of Object.values(step)) {
      if (!Array.isArray(value)) continue;
      for (const x of value as unknown[]) {
        if (x === null || typeof x !== "object") continue;
        if ("kind" in x) out.push(...areaStepsOf([x as Step]));
        else if (Array.isArray((x as { steps?: unknown }).steps)) out.push(...areaStepsOf((x as { steps: Step[] }).steps));
      }
    }
  }
  return out;
}

/**
 * The area a use places on a square the player picks (plan lanes-2 AO, dcm-u2wx): its first `point`-centred circle
 * (Dark Cloud, CB p.42: "a point ... within Close range"), when the use names no targets (a targeted use needs the
 * general flow, SD7). Walls take two squares (`pickAreaOf`, which the drawer reads since plan lanes-2 E4.4). Else null.
 */
export function pointAreaOf(use: CardUse): AreaSpec | null {
  if (use.targets !== undefined) return null;
  return areaStepsOf(use.steps).find((a) => a.centre === "point" && a.shape !== "wall") ?? null;
}

type UseOutcome =
  | { status: "pending" }
  | { status: "needsChoice" }
  | { status: "resolved"; roll: { total: number } | null; success: boolean; notes: readonly string[] };

/** The line after a point area's use: the roll and whether the area went down (`notes` say what the server could not place). */
export function areaUseLine(name: string, label: string, out: UseOutcome): string {
  if (out.status === "pending") return `${name}: waiting for the GM to approve.`;
  if (out.status === "needsChoice") return `${name} needs another choice: use it from the Hand.`;
  const rolled = out.roll ? `Rolled ${out.roll.total}: ` : "";
  const notes = out.notes.length > 0 ? ` (${out.notes.join("; ")})` : "";
  return out.success ? `${rolled}${label} is on the map.${notes}` : `${rolled}${name} failed.${notes}`;
}

/**
 * The area a use places on squares the player picks, and how many (plan lanes-2 E4.4): the first `point`-centred area
 * step, walls and `count` areas included, when the use names no targets. Else null.
 */
export function pickAreaOf(use: CardUse): { area: AreaSpec; picks: AreaPicks } | null {
  if (use.targets !== undefined) return null;
  const area = areaStepsOf(use.steps).find((a) => a.centre === "point");
  if (area === undefined) return null;
  if (area.shape === "wall") return { area, picks: { kind: "wall" } };
  const count = area.count;
  if (count === undefined) return { area, picks: { kind: "one" } };
  const fixed = count.kind === "fixed" ? Math.max(1, Math.min(MAX_PICKED_SQUARES, Math.trunc(count.value))) : null;
  return { area, picks: { kind: "count", fixed, choice: count.kind === "chosen" ? count.choice : null } };
}

/** The squares a use picks: 2 for a wall, the count for a `count` area (`n`: the player's number), else 1. */
export function squaresToPick(picks: AreaPicks, n: number): number {
  if (picks.kind === "one") return 1;
  if (picks.kind === "wall") return 2;
  return picks.fixed ?? Math.max(1, Math.min(MAX_PICKED_SQUARES, Math.trunc(n)));
}

/** The banner prompt for the i-th square (0-based) of `total`. */
export function pickPrompt(area: AreaSpec, picks: AreaPicks, i: number, total: number, within: string): string {
  if (picks.kind === "wall") return i === 0 ? `Pick one end of ${area.label}${within}` : `Pick the other end of ${area.label}${within}`;
  if (picks.kind === "count" && total > 1) return `Pick square ${i + 1} of ${total} for ${area.label}${within}`;
  return `Pick the centre of ${area.label}${within}`;
}

/**
 * The squares and choices `combatFeatures.useFeature` takes for picked squares: the first as `point`, the rest as
 * `points` (a wall's second end, a `count` area's others), and a chosen count as `n:<choice>`.
 */
export function areaUseArgs(picks: AreaPicks, squares: readonly { x: number; y: number }[]): { point: { x: number; y: number }; points?: { x: number; y: number }[]; choices: { id: string; value: number }[] } {
  const [point, ...rest] = squares;
  if (point === undefined) throw new Error("No square picked.");
  const choices = picks.kind === "count" && picks.choice !== null ? [{ id: `n:${picks.choice}`, value: squares.length }] : [];
  return { point, ...(rest.length > 0 ? { points: rest.slice(0, MAX_PICKED_SQUARES - 1) } : {}), choices };
}

export function serverUseOf(featureId: string, useId: string | undefined): ServerUse | null {
  const entry = featureEffect(featureId);
  if (entry === undefined) return null;
  const use = pickUse(asCardEffect(entry), useId);
  if (use === undefined) return null;
  if (featureId === CHARGE_FEATURE) return { kind: "charge", use, name: use.name };
  const placed = pickAreaOf(use);
  if (placed !== null) return { kind: "area", use, name: use.name, area: placed.area, picks: placed.picks };
  const spec = use.targets;
  if (spec !== undefined && spec.side !== "trigger" && spec.count.kind === "upTo" && spec.count.rolledFirst === true) {
    return { kind: "count", use, name: use.name, range: RANGE_LABEL[spec.range] ?? "range" };
  }
  return null;
}

/** The picked allies that still stand in the list, in range, at most `count` of them. */
export function validAllies(view: Pick<CountView, "allies">, picked: readonly string[], count: number): string[] {
  const ok = new Set(view.allies.filter((a) => a.inRange).map((a) => a.tokenId as string));
  return picked.filter((id) => ok.has(id)).slice(0, count);
}

/** "Bear (Far)" for the target select. */
export function targetLabel(t: Pick<ChargeTarget, "name" | "band">): string {
  return `${t.name} (${t.band === "veryFar" ? "Very Far" : "Far"})`;
}

/** "North-west of Bear" for the square select; a repeated side gets a number. */
export function squareLabels(t: Pick<ChargeTarget, "name" | "squares">): string[] {
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const q of t.squares) total.set(q.label, (total.get(q.label) ?? 0) + 1);
  return t.squares.map((q) => {
    const n = (seen.get(q.label) ?? 0) + 1;
    seen.set(q.label, n);
    const side = q.label.charAt(0).toUpperCase() + q.label.slice(1);
    return (total.get(q.label) ?? 0) > 1 ? `${side} of ${t.name} (${n})` : `${side} of ${t.name}`;
  });
}

type Resolved = { roll: { total: number; outcome: string } | null; targets: readonly { tokenId: string; hit: boolean; defeated: boolean }[] };

/** The Charge result line: Hit / Defeated per target by name, no adversary numbers (U1). */
export function chargeLine(moved: boolean, use: Resolved, names: ReadonlyMap<string, string>): string {
  const total = use.roll ? `Rolled ${use.roll.total}` : "Rolled";
  if (!moved) return `${total}: the Agility Roll failed, the token stays.`;
  const hits = use.targets.filter((t) => t.hit || t.defeated).map((t) => `${names.get(t.tokenId) ?? "Target"}: ${t.defeated ? "Defeated" : "Hit"}`);
  return `${total}: charged into Melee${hits.length > 0 ? ` → ${hits.join(", ")}` : "."}`;
}
