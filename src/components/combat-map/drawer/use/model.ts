import type { FunctionReturnType } from "convex/server";

import { pickUse } from "@/lib/domain/card-effects/run";
import type { CardUse } from "@/lib/domain/card-effects/types";
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
export type ServerUse = { kind: "count"; use: CardUse; name: string; range: string } | { kind: "charge"; use: CardUse; name: string };

const RANGE_LABEL: Record<string, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };

export function serverUseOf(featureId: string, useId: string | undefined): ServerUse | null {
  const entry = featureEffect(featureId);
  if (entry === undefined) return null;
  const use = pickUse(asCardEffect(entry), useId);
  if (use === undefined) return null;
  if (featureId === CHARGE_FEATURE) return { kind: "charge", use, name: use.name };
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
