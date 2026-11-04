import type { FunctionReturnType } from "convex/server";

import { featureEffect } from "@/lib/srd/feature-effects";

import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { Drawer, DrawerFeature } from "../list/model";

/** What `featurePrompts.allyRolls` returns: names and bands only (U1). */
export type AllyRolls = FunctionReturnType<typeof api.featurePrompts.allyRolls>;
export type AllyAsk = AllyRolls["asks"][number];
export type AskEnemy = AllyAsk["enemies"][number];

/** A use of the feature that an ally rolls (`rolledBy`, DA0: Cannonball, CB p.33), or null. */
export function allyRolledUse(featureId: string): { useId: string; name: string } | null {
  const use = featureEffect(featureId)?.uses.find((u) => u.rolledBy !== undefined);
  return use ? { useId: use.id, name: use.name } : null;
}

/** The drawer's features with a use an ally rolls (the druid's "ask an ally to throw you"). */
export function throwFeatures(drawer: Pick<Drawer, "features">): { feature: DrawerFeature; useId: string; ready: boolean }[] {
  return drawer.features.flatMap((feature) => {
    const use = allyRolledUse(feature.featureId);
    if (use === null) return [];
    const ready = feature.uses.find((u) => u.useId === use.useId)?.ready ?? false;
    return [{ feature, useId: use.useId, ready }];
  });
}

/** The enemies that may be the second target: those near the first (Very Close of it for Cannonball). */
export function secondCandidates(ask: Pick<AllyAsk, "enemies">, firstId: Id<"combatTokens"> | null): AskEnemy[] {
  if (firstId === null) return [];
  const near = new Set(ask.enemies.find((e) => e.tokenId === firstId)?.near ?? []);
  return ask.enemies.filter((e) => near.has(e.tokenId));
}

type Resolved = Extract<FunctionReturnType<typeof api.featurePrompts.allyRoll>, { status: "resolved" }>;

/** One line for the ally's result: the total, then Hit / Miss / Defeated per target by name (no adversary numbers, U1). */
export function resultLine(result: Pick<Resolved, "roll" | "targets" | "damage">, names: ReadonlyMap<string, string>): string {
  const total = result.roll ? `Rolled ${result.roll.total}${result.roll.outcome === "critical" ? " (critical)" : ""}` : "Rolled";
  const parts = result.targets.map((t) => `${names.get(t.tokenId) ?? "Target"}: ${t.defeated ? "Defeated" : t.hit ? "Hit" : "Miss"}`);
  const damage = result.damage.length > 0 ? `; damage ${result.damage.map((d) => d.total).join(" + ")}` : "";
  return `${total}${damage}${parts.length > 0 ? ` → ${parts.join(", ")}` : ""}`;
}
