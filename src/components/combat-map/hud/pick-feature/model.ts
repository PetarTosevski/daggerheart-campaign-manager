import type { FunctionReturnType } from "convex/server";

import { pickUse } from "@/lib/domain/card-effects/run";
import type { AreaSpec, CardUse, Cost, TargetSpec } from "@/lib/domain/card-effects/types";
import type { Footprint } from "@/lib/domain/combat-actions/distance";
import { shortfallLabel, shortfallOf } from "@/lib/domain/combat-actions/shortfall";
import { asCardEffect } from "@/lib/domain/feature-effects/run";
import { cardEffect } from "@/lib/srd/card-effects";
import { featureEffect } from "@/lib/srd/feature-effects";

import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { costLabel, formFor, RANGE_LABEL, type ChoiceAsk, type UseForm } from "../../actions/hand/model";
import type { RiderOption } from "../../actions/attack/riders";
import { MAX_PICKED_SQUARES, pickAreaOf, serverUseOf, type AreaPicks } from "../../drawer/use/model";
import type { AreaAsk } from "../pick-area/model";
import type { CostResource } from "../ui";

/**
 * The feature picker's pure model (plan combat-hud H3.3; CmpPicking; fold-in dcm-aiwg). What a feature's Use needs is
 * the classic models' answer, never a copy: `serverUseOf` / `pickAreaOf` (drawer/use/model.ts) for the server-decided
 * uses and the squares, `formFor` (actions/hand/model.ts) for what a use asks before it runs, `ridersToSend`
 * (actions/attack/riders.tsx) for the riders' arguments.
 *
 * dcm-aiwg / dcm-bxp.99.32.19: the riders that ride on a feature's own action roll (Fangs + Feed's "Fear Die a d20",
 * HF p.39) come from the server (`combatFeatures.riders`: `riderOptions` for the feature's `rollHost`, weapon range,
 * upgrades and requirement checks included); the picker shows them as switches and `useFeature({ riders })` checks
 * them again.
 */

export type DrawerFeature = FunctionReturnType<typeof api.combatFeaturesReads.drawer>["features"][number];
export type FeatureUseOutcome = FunctionReturnType<typeof api.combatFeatures.useFeature>;

/** How a feature's Use runs in the HUD. */
export type FeaturePlan =
  /** The classic drawer flow keeps it (Warden's Protection's rolled count, Charge's square and Difficulty). */
  | { kind: "classic" }
  /** Squares on the map (Dark Cloud's centre, Circle of Power's point): HUD square picking, after the panel when it asks more. */
  | { kind: "area"; use: CardUse; name: string; area: AreaSpec; picks: AreaPicks; form: UseForm }
  /** The picking panel: targets, riders, options. */
  | { kind: "panel"; use: CardUse; name: string; form: UseForm };

/**
 * A `point`-side use whose steps place a point-centred area (Circle of Power, HF p.? / seraph-witch.ts: `targets.side:
 * "point"`): the classic `pickAreaOf` skips it (it has targets); the area goes on the picked square (`point`). A
 * point-side use without an area (Shadow Stepper's teleport, a move prompt) picks no square.
 */
function pointSideArea(use: CardUse): { area: AreaSpec; picks: AreaPicks } | null {
  if (use.targets?.side !== "point") return null;
  return pickAreaOf({ ...use, targets: undefined });
}

export function featurePlan(featureId: string, useId: string | undefined): FeaturePlan {
  const server = serverUseOf(featureId, useId);
  if (server?.kind === "count" || server?.kind === "charge") return { kind: "classic" };
  const entry = featureEffect(featureId);
  if (entry === undefined) return { kind: "classic" };
  const use = pickUse(asCardEffect(entry), useId);
  if (use === undefined) return { kind: "classic" };
  const form = formFor(use);
  if (server?.kind === "area") return { kind: "area", use, name: server.name, area: server.area, picks: server.picks, form };
  const point = pointSideArea(use);
  if (point) return { kind: "area", use, name: use.name, area: point.area, picks: point.picks, form };
  return { kind: "panel", use, name: use.name, form };
}

/** The HUD square-picking ask of a use's area (n: the player's count for a `count` area). */
export function areaAskOf(name: string, area: AreaSpec, picks: AreaPicks, origin: Footprint | null, n = 1): AreaAsk {
  const count = picks.kind === "one" ? 1 : picks.kind === "wall" ? 2 : (picks.fixed ?? Math.max(1, Math.min(MAX_PICKED_SQUARES, Math.trunc(n))));
  return {
    name,
    label: area.label,
    shape: picks.kind === "wall" ? "wall" : "circle",
    count,
    ...(picks.kind !== "wall" ? { radius: area.radius } : {}),
    ...(area.placeWithin ? { within: area.placeWithin } : {}),
    ...(area.blocksSight ? { blocksSight: true } : {}),
    origin,
  };
}

// ---------------------------------------------------------------- costs

const COST_RESOURCE: Partial<Record<Cost["kind"], CostResource>> = { hope: "hope", stress: "stress", fear: "fear", hp: "hp", armor: "armor" };

/** A fixed cost as a pill ({ amount, resource }), else null (a choice of costs, tokens, gold). */
export function costPill(cost: Cost): { amount: number; resource: CostResource } | null {
  const resource = COST_RESOURCE[cost.kind];
  if (!resource || cost.kind === "either" || cost.kind === "gold") return null;
  return cost.amount.kind === "fixed" ? { amount: cost.amount.value, resource } : null;
}

const MARKS: ReadonlySet<string> = new Set(["stress", "hp", "armor"]);

/** The footer's cost line: "Marks 1 Stress", "Spends 3 Hope · Marks 1 Stress"; null when free. */
export function payLine(costs: readonly Cost[] | undefined, hope?: number | null): string | null {
  if (!costs || costs.length === 0) return null;
  return costs
    .map((c) => {
      if (c.kind === "hope" && c.amount.kind === "fixed" && hope != null && hope === c.amount.value) return c.amount.value === 1 ? "Spends your last Hope" : `Spends all ${hope} Hope`;
      return `${MARKS.has(c.kind) ? "Marks" : "Spends"} ${costLabel(c)}`;
    })
    .join(" · ");
}

/**
 * CmpBlocked layer 1: "Needs 3 Hope · you have 1" for a fixed Hope cost the sheet can't pay; null otherwise (H6.1's
 * `shortfallOf` / `shortfallLabel`). Hope only: Stress past full marks a Hit Point (CB p.106), so Stress never locks.
 */
export function hopeShortfall(costs: readonly Cost[] | undefined, hope: number | null | undefined): string | null {
  if (hope == null) return null;
  const short = shortfallOf(costs, { hope })[0];
  return short ? shortfallLabel(short) : null;
}

// ---------------------------------------------------------------- the target rule

/** Who the panel lists for a use (null: a use on yourself, every creature in range, a trigger, a point). */
export function ruleOf(form: UseForm): { side: "enemy" | "ally" | "selfOrAlly" | "any"; max: number | null; range: string } | null {
  return form.targets ? { side: form.targets.side, max: form.targets.max, range: form.targets.range } : null;
}

/** The rule line for a use that picks no creature: "On yourself", "Every enemy within Close". */
export function noPickText(targets: CardUse["targets"]): string {
  if (targets && targets.side !== "trigger" && targets.side !== "self" && targets.side !== "point" && targets.side !== "object" && (targets as TargetSpec).count.kind === "all") {
    const t = targets as TargetSpec;
    const who = t.side === "enemy" ? "enemy" : t.side === "ally" ? "ally" : "creature";
    return `Every ${who} within ${RANGE_LABEL[t.range] ?? t.range}`;
  }
  return "On yourself";
}

// ---------------------------------------------------------------- riders (dcm-aiwg, dcm-bxp.99.32.19)

/**
 * Whether a use has an action roll riders can ride on (the server's `rollHost` is null otherwise): the picker then asks
 * `combatFeatures.riders` for them; a use without one has none and opens at once.
 */
export function hasActionRoll(use: CardUse): boolean {
  const spec = use.roll;
  return spec !== undefined && spec.kind !== "adversaryAttack" && spec.kind !== "reaction";
}

/**
 * The switches the panel shows from `combatFeatures.riders`: a default-on rider (Rise to the Challenge) rides by itself
 * on the server's side, so it gets no switch.
 */
export function riderSwitches(options: readonly RiderOption[]): RiderOption[] {
  return options.filter((o) => o.defaultOn !== true);
}

/** A rider's cost pill (its first fixed cost), from its entry. */
export function riderPill(o: Pick<RiderOption, "source" | "id" | "useId">): { amount: number; resource: CostResource } | null {
  const uses = o.source === "card" ? cardEffect(o.id)?.uses : featureEffect(o.id)?.uses;
  const use = uses?.find((u) => u.id === o.useId);
  for (const c of use?.costs ?? []) {
    const pill = costPill(c);
    if (pill) return pill;
  }
  return null;
}

/** The rider switch's label (CmpPicking: say when it applies): "Feed: Fear Die a d20", "After the roll: Kick". */
export function riderLabel(o: Pick<RiderOption, "name" | "phase" | "situations">): string {
  return o.phase === "after" ? `After the roll, also ${o.name}` : o.name;
}

/** The switch's muted note: a situation it confirms, a reset label. */
export function riderNote(o: Pick<RiderOption, "situations" | "ready" | "resetLabel" | "options" | "numbers">): string | undefined {
  if (!o.ready) return o.resetLabel ? `Used · ${o.resetLabel}` : "Used";
  const parts = [...o.situations.map((s) => `Confirms: ${s}`), ...o.options.map((x) => `${x.label}: ${x.options[0]?.label ?? ""}`)];
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ---------------------------------------------------------------- Help an Ally (R7; dcm-bxp.134.5)

/** The panel's Help an Ally state: Book's ticked helpers, Manual's bare counter. */
export type HelpData = { help: number; helpers: Id<"characters">[] };

export const NO_HELP: HelpData = { help: 0, helpers: [] };

/**
 * What the use's `roll` carries for Help an Ally (CB p.90; the hand's `rollOf`): R7 Book the ticked helpers (1 Hope each,
 * paid by the server; the counter it refuses is never sent), R7 Manual the counter (no Hope taken, the GM gets a note).
 */
export function helpRoll(data: HelpData, book: boolean): { help?: number; helpers?: Id<"characters">[] } {
  if (book) return data.helpers.length > 0 ? { helpers: [...data.helpers] } : {};
  return data.help > 0 ? { help: data.help } : {};
}

/** A helper chip's tick: on, or off; an untick always works. */
export function toggleHelper(ticked: readonly Id<"characters">[], id: Id<"characters">): Id<"characters">[] {
  return ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
}

// ---------------------------------------------------------------- after the send

const VERDICT = (t: { hit: boolean; defeated: boolean }) => (t.defeated ? "Defeated" : t.hit ? "Hit" : "Miss");

/**
 * The result line (HANDOFF hard rule 2: Hit / Miss / Defeated per target by name, your own roll's total, never an
 * adversary number): "Fangs · rolled 14 · Lieutenant: Hit", "Shadow Stepper · done".
 */
export function resultLine(name: string, out: Extract<FeatureUseOutcome, { status: "resolved" }>, names: ReadonlyMap<string, string>): string {
  const parts = [name];
  if (out.roll) parts.push(`rolled ${out.roll.total}${out.roll.total !== undefined && !out.success ? " (failed)" : ""}`);
  const targets = out.targets.map((t) => `${names.get(t.tokenId) ?? "Target"}: ${VERDICT(t)}`);
  if (targets.length > 0) parts.push(targets.join(", "));
  else if (!out.roll) parts.push("done");
  const notes = out.notes.filter((n) => n.length > 0);
  return `${parts.join(" · ")}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
}

/** The asks of a `needsChoice` the panel answers next, in the server's order. */
export type Asks = readonly ChoiceAsk[];

/** The rule line of a follow-up step: the server's own label, or the link's. */
export function askText(asks: Asks): string {
  const chain = asks.find((a) => a.kind === "followUp");
  if (chain) return `Link ${chain.link + 1}: ${chain.label}`;
  return asks[0]?.label ?? "Choose";
}
