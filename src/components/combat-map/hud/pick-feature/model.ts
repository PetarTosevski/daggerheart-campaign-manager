import type { FunctionReturnType } from "convex/server";

import { pickUse, rollMatches } from "@/lib/domain/card-effects/run";
import type { AreaSpec, CardUse, Cost, Range, RollFilter, RollSpec, Step, TargetSpec, Trigger } from "@/lib/domain/card-effects/types";
import type { Footprint } from "@/lib/domain/combat-actions/distance";
import { shortfallLabel, shortfallOf } from "@/lib/domain/combat-actions/shortfall";
import { asCardEffect } from "@/lib/domain/feature-effects/run";
import { cardEffect } from "@/lib/srd/card-effects";
import { featureEffect } from "@/lib/srd/feature-effects";
import type { TraitId } from "@/lib/srd/types";

import type { api } from "../../../../../convex/_generated/api";
import { costLabel, formFor, RANGE_LABEL, type ChoiceAsk, type HandCard, type UseForm } from "../../actions/hand/model";
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
 * dcm-aiwg: the riders that ride on a feature's own action roll (Fangs + Feed's "Fear Die a d20", HF p.39). The server
 * takes them (`combatFeatures.useFeature({ riders })`, plan lanes-2 E1.3a) but lists rider options only for a weapon
 * attack (`combatActionsReads.riders`). `featureRiderOptions` mirrors the server's `riderOptions` / `riderPhase` for a feature
 * host (convex/lib/combatActions.ts; host = `rollHost` with `fromUse` the feature) from what the client holds: the held
 * features' uses and readiness (`combatFeaturesReads.drawer`) and the loadout's (`combatCardsReads.hand`). Before-roll and
 * after-roll riders only (a damage-phase rider is a prompt after the damage, DA2); default-on riders (Rise to the
 * Challenge) ride on the server's side. The server checks every rider again (`pickRiders`: INVALID for one that does not
 * ride). Follow-up bead: a `combatFeatures.riders` query to replace this mirror.
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

// ---------------------------------------------------------------- riders (dcm-aiwg)

/** What a feature's own action roll is to riders (the server's `rollHost` with `fromUse` = this feature and use). */
export type FeatureHost = {
  spec: RollSpec;
  trait: TraitId | undefined;
  weapon: boolean;
  slot: "primary" | "secondary" | undefined;
  fromUse: { id: string; useId: string };
};

export function featureHostOf(featureId: string, use: CardUse, trait: TraitId | undefined): FeatureHost | null {
  const spec = use.roll;
  if (spec === undefined || spec.kind === "adversaryAttack" || spec.kind === "reaction") return null;
  const slot = spec.kind === "attack" ? (spec.weapon === "either" ? "primary" : spec.weapon) : undefined;
  const ownTrait = spec.kind === "trait" ? (typeof spec.trait === "string" ? (spec.trait as TraitId) : (trait ?? (spec.trait[0] as TraitId | undefined))) : trait;
  return { spec, trait: ownTrait, weapon: spec.kind === "attack" || (spec.kind === "trait" && spec.asWeapon === true), slot, fromUse: { id: featureId, useId: use.id } };
}

function hostMatches(filter: RollFilter, host: FeatureHost): boolean {
  if (filter === "damage") return false;
  if ((filter === "attack" || filter === "weaponAttack") && host.weapon) return true;
  return rollMatches(filter, host.spec) || (host.trait !== undefined && filter === host.trait);
}

function fromUseHolds(filter: string | undefined, host: FeatureHost): boolean {
  if (filter === undefined) return true;
  return filter === host.fromUse.id || filter === `${host.fromUse.id}:${host.fromUse.useId}`;
}

function changesRoll(steps: readonly Step[]): boolean {
  return steps.some((s) => s.kind === "modifyRoll" || (s.kind === "choose" && s.options.some((o) => changesRoll(o.steps))) || (s.kind === "optional" && changesRoll(s.steps)));
}

type Phase = "before" | "after";

/**
 * The server's `riderPhase` for a feature host, before / after phases only. The host has no weapon range (a feature's
 * roll names none), so a trigger with `weaponRange` never rides; `cardDomain` likewise.
 */
export function featureRiderPhase(trigger: Trigger, host: FeatureHost, use: CardUse): Phase | null {
  const t = trigger as Trigger & { fromUse?: string; weaponSlot?: string; weaponRange?: Range; weapon?: boolean; roll?: RollFilter; cardDomain?: string; includeSelf?: boolean; byYou?: boolean };
  switch (trigger.kind) {
    case "beforeYouRoll":
      if (!fromUseHolds(t.fromUse, host)) return null;
      if (t.weaponSlot !== undefined && host.slot !== t.weaponSlot) return null;
      if (t.weaponRange !== undefined) return null;
      return t.roll === "damage" || (t.roll !== undefined && hostMatches(t.roll, host)) ? "before" : null;
    case "whenYouAttack":
      if (!hostMatches("attack", host) || !fromUseHolds(t.fromUse, host)) return null;
      if (t.weapon === true && !host.weapon) return null;
      if (t.weaponSlot !== undefined && host.slot !== t.weaponSlot) return null;
      if (t.weaponRange !== undefined) return null;
      return "after";
    case "afterYouRoll":
      if (!fromUseHolds(t.fromUse, host) || t.cardDomain !== undefined) return null;
      return t.roll !== undefined && t.roll !== "damage" && hostMatches(t.roll, host) && !changesRoll(use.steps) ? "after" : null;
    case "afterAllyRolls":
      if (t.includeSelf !== true) return null;
      return hostMatches(t.roll ?? "action", host) && !changesRoll(use.steps) ? "after" : null;
    case "whenYouDealDamage":
      return fromUseHolds(t.fromUse, host) ? "after" : null;
    case "gmWouldGainFear":
      return t.byYou === true ? "after" : null;
    default:
      return null;
  }
}

/** The server's `DEFAULT_ON_RIDERS` (convex/lib/combatActions.ts): they ride by themselves; switching off is Attack-bar only. */
const DEFAULT_ON: ReadonlySet<string> = new Set(["subclass:call-of-the-brave:rise-to-the-challenge"]);

const WHEN: Record<Phase, string> = { before: "Before the roll", after: "After the roll" };

function allSteps(steps: readonly Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...(s.kind === "optional" || s.kind === "followUp" ? allSteps(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((o) => allSteps(o.steps)) : []),
    ...(s.kind === "save" ? [...allSteps(s.onFail), ...allSteps(s.onSuccess)] : []),
    ...(s.kind === "check" ? [...allSteps(s.then), ...allSteps(s.otherwise)] : []),
  ]);
}

function optionOf(source: "card" | "feature", id: string, name: string, use: CardUse, phase: Phase, ready: boolean): RiderOption {
  const steps = allSteps(use.steps);
  const add = steps.find((s): s is Extract<Step, { kind: "addTargets" }> => s.kind === "addTargets");
  return {
    source,
    id,
    useId: use.id,
    name: use.name === "main" ? name : use.name,
    phase,
    when: WHEN[phase],
    ready,
    resetLabel: null,
    costs: (use.costs ?? []).map(costLabel),
    limit: null,
    numbers: (use.choices ?? []).map((c) => ({ id: `n:${c.id}`, label: c.label, min: c.min, max: c.max?.kind === "fixed" ? c.max.value : null })),
    options: steps.flatMap((st) => (st.kind === "choose" ? [{ id: `opt:${st.id}`, label: st.label, options: st.options.map((o) => ({ id: o.id, label: o.label })) }] : [])),
    situations: (use.requires ?? []).flatMap((r) => (r.kind === "situation" && r.check === undefined ? [r.text] : [])),
    addTargets: add ? { max: add.count.kind === "fixed" ? add.count.value : null, range: add.targets.range } : null,
  };
}

/**
 * dcm-aiwg: the rider options of a feature use's action roll: every `rider` use of a held feature (`combatFeaturesReads.drawer`)
 * and of a loadout card (`combatCardsReads.hand`) whose trigger rides on it, ready or not (a used-up one shows disabled).
 */
export function featureRiderOptions(input: {
  featureId: string;
  use: CardUse;
  trait?: TraitId;
  features: readonly (Pick<DrawerFeature, "featureId" | "name" | "usage"> & { uses: readonly { useId: string; ready: boolean }[] })[] | undefined;
  cards: readonly (Pick<HandCard, "cardId" | "name" | "usage"> & { uses: readonly { useId: string; ready: boolean }[] })[] | undefined;
}): RiderOption[] {
  const host = featureHostOf(input.featureId, input.use, input.trait);
  if (host === null) return [];
  const out: RiderOption[] = [];
  for (const card of input.cards ?? []) {
    if (card.usage === "outOfCombat") continue;
    const effect = cardEffect(card.cardId);
    if (!effect) continue;
    for (const use of effect.uses) {
      if (use.activation.kind !== "rider") continue;
      const phase = featureRiderPhase(use.activation.trigger, host, use);
      if (phase === null) continue;
      const ready = card.uses.find((u) => u.useId === use.id)?.ready ?? true;
      out.push(optionOf("card", card.cardId, card.name, use, phase, ready));
    }
  }
  for (const f of input.features ?? []) {
    if (f.usage === "outOfCombat" || f.usage === "narrative" || DEFAULT_ON.has(f.featureId)) continue;
    const entry = featureEffect(f.featureId);
    if (!entry) continue;
    for (const use of entry.uses) {
      if (use.activation.kind !== "rider") continue;
      const phase = featureRiderPhase(use.activation.trigger, host, use);
      if (phase === null) continue;
      const ready = f.uses.find((u) => u.useId === use.id)?.ready ?? true;
      out.push(optionOf("feature", f.featureId, f.name, use, phase, ready));
    }
  }
  return out;
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
