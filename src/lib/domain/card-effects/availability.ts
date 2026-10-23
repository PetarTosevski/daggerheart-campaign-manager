// Once-per availability, requirements and costs of a domain card use (plan combat-actions, tracer CA1; rules R6, R8;
// user answers Q3, Q4). Pure: the server (CA4) refuses with CARD_EXHAUSTED / CARD_COST_UNPAID, the map Hand (CA5) and
// the sheet (CA7) grey the card with the same answer.
//
// CB p.101, "Usage Limits": "Unless a domain card states otherwise, you can use it as many times as you wish, for as long
//   as it remains in your loadout. … Some domain cards have an exhaustion limit that restricts how often you can use that
//   card (for example, once per long rest). If you use that card, you'll need a way to remember that it's temporarily
//   unavailable."
// CB p.105: an interrupted long rest gives a short rest's benefits; `expire` (characters/expiry.ts) already ends `rest`
//   uses on any rest and `longRest` uses on a long rest (Q3 a: one shared record, a session does not reset cards).
// Q4 (a): "Once per rest on a success" is used up only when the roll succeeds.
// CB p.90, "Activate a Hope Feature": "If the text instructs you to 'spend Hope,' you must spend the specified number of
//   Hope, or you can't trigger the Hope Feature." Upfront costs are checked before the roll; Hope from the same roll pays
//   only the `pay` steps after it (R8, see run.ts).
//
// Storage: the sheet's `featureUses` entry `{ key: "card:<cardId>", until }` (`card:<cardId>:<useId>` for a limit on
// one spell or part; `:<targetId>` appended for a per-target limit). `times: n` stores one entry per use.
//
// ```ts
// cardAvailability(sheet, "earthquake");                       // { state: "exhausted", until: "rest", label: "Back after a rest" }
// limitConsumed({ per: "rest", consumedOn: "success" }, false); // false (Q4)
// recordUse(sheet.featureUses, featureUseKey("earthquake"), { per: "rest" }); // [..., { key: "card:earthquake", until: "rest" }]
// ```
//
// Plan sheet-drawer, SD1 (cards and features alike):
// - `keyAvailability` answers for any `featureUses` key, so the feature runner's `feat:<featureId>[:<useId>]` keys
//   (src/lib/domain/feature-effects) share one rule with the cards. `featureLimitUntil` stores a "once per scene" feature
//   limit as `scene` (Q7: the scene ends with the encounter, the GM's End scene or the session); cards keep `session`
//   (`limitUntil`) until their tables move over.
// - NV1: a `tokens` cost may spend Favor, Focus or held dice (`pool`); `unaffordable` checks each pool on its own.
// - NV7: a `situation` requirement with a `check` is decided from `RequirementState.facts` when the facts it needs are
//   known; otherwise the player's confirmation of its text still decides it (Q13).

import type { FeatureUse } from "../../validation/characters";
import { RANGE_SQUARES } from "../combat-map/ranges";
import type { ConditionRef, Cost, HeldDieKind, Limit, Range, Requirement, StateCheck, TokenPool, Track } from "./types";
import type { DomainId } from "../../srd/types";

/** Prefix of every domain-card key in `featureUses`. */
export const CARD_USE_PREFIX = "card:";

/** The `featureUses` key of a card (or one of its uses, or one target of a per-target limit). */
export function featureUseKey(cardId: string, useId?: string, targetId?: string): string {
  const base = `${CARD_USE_PREFIX}${cardId}`;
  const withUse = useId && useId !== "main" ? `${base}:${useId}` : base;
  return targetId ? `${withUse}:${targetId}` : withUse;
}

/**
 * The `until` a limit is stored with. The sheet's `featureUses` knows rest, longRest and session; a "once per scene"
 * limit is stored as `session` (the GM's End scene does not clear feature uses; see the task doc's QUESTIONS).
 */
export function limitUntil(per: Limit["per"]): FeatureUse["until"] {
  return per === "scene" ? "session" : per;
}

/**
 * The `until` a feature's limit is stored with (SD1, Q3, Q7): the limit's own period, `scene` included ("once per
 * scene"; CB p.107: "a scene continues until the current narrative situation has played out").
 */
export function featureLimitUntil(per: Limit["per"]): FeatureUse["until"] {
  return per;
}

/** The label of an exhausted card (CA5 Hand, CA7 sheet). */
export const RESET_LABEL: Record<FeatureUse["until"], string> = {
  rest: "Back after a rest",
  longRest: "Back after a long rest",
  session: "Back next session",
  // Plan sheet-drawer SD0 (Q7): the sheet's `featureUses` gained `scene`; nothing stores it until SD1 / SD8.
  scene: "Back after the scene",
};

export type Availability =
  | { state: "ready"; usesLeft?: number }
  | { state: "exhausted"; until: FeatureUse["until"]; label: string };

export interface AvailabilityOptions {
  /** The use (grimoire spell or card part) whose limit is asked; default the card's own key. */
  useId?: string;
  /** The limit, when known: `times` uses per period. Without it one use exhausts the card. */
  limit?: Limit;
  /** For a per-target limit (Healing Hands): the target asked about. */
  targetId?: string;
}

/**
 * Whether a card (or one of its uses) is ready or exhausted, from the sheet's `featureUses` (Q3). An exhausted card
 * names when it comes back: the longest `until` among its entries.
 */
export function cardAvailability(
  sheet: { readonly featureUses?: readonly FeatureUse[] },
  cardId: string,
  options: AvailabilityOptions = {},
): Availability {
  const key = featureUseKey(cardId, options.useId, options.limit?.perTarget ? options.targetId : undefined);
  return keyAvailability(sheet, key, options.limit);
}

/**
 * Whether the `featureUses` key `key` is ready or used up under `limit` (`times` uses per period; without a limit one
 * entry exhausts it). Cards and features share it (SD1). An exhausted key names the longest `until` among its entries.
 */
export function keyAvailability(sheet: { readonly featureUses?: readonly FeatureUse[] }, key: string, limit?: Limit): Availability {
  const entries = (sheet.featureUses ?? []).filter((u) => u.key === key);
  const times = Math.max(1, limit?.times ?? 1);
  if (entries.length < times) return limit?.times ? { state: "ready", usesLeft: times - entries.length } : { state: "ready" };
  const order: FeatureUse["until"][] = ["scene", "rest", "longRest", "session"];
  const until = entries.map((e) => e.until).reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a));
  return { state: "exhausted", until, label: RESET_LABEL[until] };
}

/** Whether this use counts against its limit (Q4): `success` only on a success, `failure` only on a failure. */
export function limitConsumed(limit: Limit, success: boolean): boolean {
  const on = limit.consumedOn ?? "use";
  if (on === "use") return true;
  return on === "success" ? success : !success;
}

/** `featureUses` with one more use of `key` recorded under the limit's period. */
export function recordUse(featureUses: readonly FeatureUse[], key: string, limit: Limit): FeatureUse[] {
  return [...featureUses, { key, until: limitUntil(limit.per) }];
}

// ---------------------------------------------------------------- requirements

/** What requirements read: the actor's state and what the player confirmed. */
export interface RequirementState {
  hp: number;
  hpMax: number;
  stress: number;
  stressMax: number;
  armor: number;
  hope: number;
  armorWorn: boolean;
  loadoutDomains: readonly DomainId[];
  /** Card ids whose own sheet effect is active (Force of Nature's form, Smite charged). */
  activeCardEffects: readonly string[];
  /** Squares to the nearest enemy, when known (Arcane Door: "no adversaries within Melee range"). */
  nearestEnemy?: number;
  /** Situation texts the player confirmed ("While you're shrouded in low light"). */
  situations: readonly string[];
  /** SD1 (NV7): what the engine knows for `situation.check`; an unknown fact leaves the check to the player. */
  facts?: StateFacts;
}

/** A creature's state as a `StateCheck` reads it (the trigger's subject, the target). */
export interface CreatureFacts {
  conditions: readonly string[];
  tags?: readonly string[];
  hp: number;
  hpMax: number;
}

/**
 * The facts the server reads for `situation.check` (NV7). Every member is optional: absent means "not known here", and
 * the check then falls back to the player's confirmation (Q13).
 * - `conditions` / `tags`: the actor's standard conditions and condition tags; `flying` the Flying toggle (Q16).
 * - `featureEffects`: the actor's active feature effects (`featureId`, and the `option` an effect step named).
 * - `beastformId`: the form while in Beastform, null when not transformed.
 * - `activeStance`: the active martial stance slug, null when none (Q5).
 * - `areas`: the live map areas the actor stands in (Q14), with whether the actor drew them.
 * - `isolation`: squares from the actor (`self`) and from the target (`target`) to the nearest other creature.
 */
export interface StateFacts {
  conditions?: readonly string[];
  tags?: readonly string[];
  flying?: boolean;
  featureEffects?: readonly { featureId: string; option?: string }[];
  beastformId?: string | null;
  rollUsedExperience?: boolean;
  activeStance?: string | null;
  areas?: readonly { featureId: string; own: boolean }[];
  isolation?: { self?: number; target?: number };
  subject?: CreatureFacts;
  target?: CreatureFacts;
}

const reach = (range: Range) => (range === "veryFar" ? Infinity : RANGE_SQUARES[range]);

const marked = (s: RequirementState, track: Track) => (track === "hp" ? s.hp : track === "stress" ? s.stress : s.armor);

const hasRef = (ref: ConditionRef, conditions: readonly string[], tags: readonly string[] | undefined): boolean | undefined => {
  if (ref.kind === "standard") return conditions.includes(ref.condition);
  return tags === undefined ? undefined : tags.includes(ref.tag);
};

const STANCE_PREFIX = "stance:martial-artist:";

/**
 * Decides a `situation.check` from the known facts (NV7): true or false, or undefined when a fact it needs is not known
 * (then the player's confirmation decides, Q13).
 */
export function stateCheckMet(check: StateCheck, s: RequirementState): boolean | undefined {
  const f = s.facts ?? {};
  switch (check.kind) {
    case "hasCondition": {
      const who = check.who ?? "self";
      if (who === "self") return f.conditions === undefined ? undefined : hasRef(check.condition, f.conditions, f.tags);
      const c = who === "subject" ? f.subject : f.target;
      return c === undefined ? undefined : hasRef(check.condition, c.conditions, c.tags);
    }
    case "flying":
      return f.flying;
    case "featureEffect":
      return f.featureEffects?.some((e) => e.featureId === check.featureId && (check.option === undefined || e.option === check.option));
    case "inBeastform":
      return f.beastformId === undefined ? undefined : f.beastformId !== null && (check.formId === undefined || f.beastformId === check.formId);
    case "hopeAtLeast":
      return s.hope >= check.value;
    case "hpUnmarkedAtMost": {
      if (check.who === "self") return s.hpMax - s.hp <= check.value;
      const c = check.who === "subject" ? f.subject : f.target;
      return c === undefined ? undefined : c.hpMax - c.hp <= check.value;
    }
    case "rollUsedExperience":
      return f.rollUsedExperience;
    case "activeStance": {
      if (f.activeStance === undefined) return undefined;
      const slug = check.stance.startsWith(STANCE_PREFIX) ? check.stance.slice(STANCE_PREFIX.length) : check.stance;
      return f.activeStance === slug;
    }
    case "inArea":
      return f.areas?.some((a) => a.featureId === check.featureId && (check.owner !== "self" || a.own));
    case "isolated": {
      const away = (n: number | undefined) => (n === undefined ? undefined : n > reach(check.range));
      const self = away(f.isolation?.self);
      if (check.who === "self" || self === false) return self;
      const target = away(f.isolation?.target);
      if (target === false) return false;
      return self === undefined || target === undefined ? undefined : true;
    }
  }
}

/**
 * Whether one requirement holds. A `situation` holds when the engine can decide its `check` and it holds, or, when it
 * cannot, when the player confirmed its text (Q13).
 */
export function requirementMet(req: Requirement, s: RequirementState): boolean {
  switch (req.kind) {
    case "loadoutDomainCount":
      return s.loadoutDomains.filter((d) => d === req.domain).length >= req.min;
    case "armor":
      return s.armorWorn === req.worn;
    case "hpUnmarkedAtMost":
      return s.hpMax - s.hp <= req.value;
    case "stressFull":
      return s.stressMax > 0 && s.stress >= s.stressMax;
    case "trackMarked": {
      const m = marked(s, req.track);
      return (req.atLeast === undefined || m >= req.atLeast) && (req.atMost === undefined || m <= req.atMost);
    }
    case "hopeAtMost":
      return s.hope <= req.value;
    case "noEnemyWithin":
      return s.nearestEnemy === undefined || s.nearestEnemy > reach(req.range);
    case "effectActive":
      return s.activeCardEffects.includes(req.cardId);
    case "situation": {
      const decided = req.check ? stateCheckMet(req.check, s) : undefined;
      return decided ?? s.situations.includes(req.text);
    }
  }
}

/** The requirements that do not hold (empty = the use may go ahead). */
export function unmetRequirements(reqs: readonly Requirement[] | undefined, s: RequirementState): Requirement[] {
  return (reqs ?? []).filter((r) => !requirementMet(r, s));
}

// ---------------------------------------------------------------- costs

/** What costs draw from. */
export interface PayerState {
  hope: number;
  stress: number;
  stressMax: number;
  hp: number;
  hpMax: number;
  armor: number;
  armorMax: number;
  cardTokens: number;
  /** Adversary features (AA0): the GM's Fear and gold handfuls. */
  fear?: number;
  gold?: number;
  /** SD1 (NV1): Warlock Favor, Martial Focus and the held dice of each kind, for `tokens` costs with a `pool`. */
  favor?: number;
  focus?: number;
  heldDice?: Partial<Record<HeldDieKind, number>>;
}

/**
 * A cost with its amount resolved; `either` resolved to the picked option. SD1 (NV1): a `tokens` cost that spends another
 * pool than the card's tokens names it in `pool` (Favor, Focus, a held-die kind); `values` are the spent dice's values.
 */
export type PaidCost = {
  resource: "hope" | "stress" | "hp" | "armor" | "tokens" | "fear" | "gold";
  amount: number;
  pool?: Exclude<TokenPool, "card">;
  values?: number[];
};

/**
 * Flattens costs into resource amounts. `amountOf` resolves a cost's `NumberSource` (numbers.ts); `pickEither(i)` names
 * the option of the i-th `either` cost (default the first).
 */
export function resolveCosts(costs: readonly Cost[], amountOf: (cost: Exclude<Cost, { kind: "either" | "gold" }>) => number, pickEither: (index: number) => number = () => 0): PaidCost[] {
  const out: PaidCost[] = [];
  let eitherIndex = 0;
  const walk = (list: readonly Cost[]) => {
    for (const cost of list) {
      if (cost.kind === "either") {
        const pick = pickEither(eitherIndex++);
        walk(cost.options[pick] ?? cost.options[0] ?? []);
      } else if (cost.kind === "gold") out.push({ resource: "gold", amount: cost.handfuls });
      else if (cost.kind === "tokens" && cost.pool !== undefined && cost.pool !== "card") {
        out.push({ resource: "tokens", amount: Math.max(0, amountOf(cost)), pool: cost.pool });
      } else out.push({ resource: cost.kind, amount: Math.max(0, amountOf(cost)) });
    }
  };
  walk(costs);
  return out;
}

/** The resources a list of resolved costs is short of (empty = affordable). Stress, HP and Armor need free slots (CB p.90). */
export function unaffordable(costs: readonly PaidCost[], s: PayerState): PaidCost["resource"][] {
  const total = (r: PaidCost["resource"]) => costs.filter((c) => c.resource === r && c.pool === undefined).reduce((n, c) => n + c.amount, 0);
  const room: Record<PaidCost["resource"], number> = {
    hope: s.hope,
    stress: s.stressMax - s.stress,
    hp: s.hpMax - s.hp,
    armor: s.armorMax - s.armor,
    tokens: s.cardTokens,
    fear: s.fear ?? 0,
    gold: s.gold ?? 0,
  };
  const short = (Object.keys(room) as PaidCost["resource"][]).filter((r) => total(r) > room[r]);
  // NV1: each other pool on its own (Favor, Focus, each held-die kind); a short pool reads as "tokens".
  const pooled = new Map<string, number>();
  for (const c of costs) if (c.pool !== undefined) pooled.set(c.pool, (pooled.get(c.pool) ?? 0) + c.amount);
  const poolRoom = (pool: string): number => (pool === "favor" ? (s.favor ?? 0) : pool === "focus" ? (s.focus ?? 0) : (s.heldDice?.[pool as HeldDieKind] ?? 0));
  const poolShort = [...pooled].some(([pool, n]) => n > poolRoom(pool));
  return poolShort && !short.includes("tokens") ? [...short, "tokens"] : short;
}
