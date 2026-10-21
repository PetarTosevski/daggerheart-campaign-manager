// Resolves the card vocabulary's numbers (`NumberSource`, `DiceExpr`) against a use's state (plan combat-actions,
// tracer CA1). Pure; dice roll through the injected `Rng`. Used by the runner (card-effects/run.ts) and by the
// availability checks (card-effects/availability.ts) for cost amounts.
//
// CB p.98: "Any time a move tells you to deal damage using your Proficiency, you roll a number of dice equal to your
//   Proficiency. Any time it tells you to deal damage using your Spellcast trait, you roll a number of dice equal to your
//   Spellcast trait."
// CB p.107, "Rounding Up": "This game doesn't use fractions; if you need to round to a whole number, round up unless
//   otherwise specified." So `calc` with `divide` rounds up unless the source says `round: "down"`.
//
// ```ts
// resolveNumber({ kind: "proficiency" }, env, rng);                                    // 3
// resolveNumber({ kind: "calc", of: { kind: "trait", trait: "agility" }, divide: 2 }, env, rng); // half Agility, rounded up
// resolveDice({ count: { kind: "proficiency" }, sides: 8, plus: { kind: "fixed", value: 2 } }, env, rng); // { count: 3, sides: 8, plus: 2 }
// ```

import type { Rng } from "../dice/index";
import type { DiceExpr, NumberSource, Resource, Track } from "../card-effects/types";
import type { DomainId, TraitId } from "../../srd/types";

/** A creature's tracks, as `marked` reads them. */
export interface MarkedTracks {
  hp: number;
  stress: number;
  armor?: number;
}

/** What `resolveNumber` reads. The runner keeps one per use and updates it as the use resolves. */
export interface NumberEnv {
  traits: Readonly<Record<TraitId, number>>;
  /** The value of the actor's Spellcast trait (CB p.98). */
  spellcast: number;
  proficiency: number;
  level: number;
  tier: 1 | 2 | 3 | 4;
  /** What this use paid so far, per resource. */
  spent: Partial<Record<Resource, number>>;
  /** The player's numbers, by choice id. */
  choices: Readonly<Record<string, number>>;
  /** Tokens on this card right now. */
  cardTokens: number;
  gmFear: number;
  self: MarkedTracks;
  /** The recipient a per-target number is read for (`marked` / `markedThisMove` with `who: "target"`). */
  target?: MarkedTracks & { id: string };
  /** Marked by this move so far: the actor's and each creature's (by id). */
  markedThisMove: { self: Partial<Record<Track, number>>; byTarget: Readonly<Record<string, Partial<Record<Track, number>>>> };
  targetCount: { picked: number; hit: number; failedSave: number };
  rollTotal?: number;
  triggerAmount?: number;
  /** Domains of the cards in the loadout and the vault (one entry per card). */
  loadoutDomains: readonly DomainId[];
  vaultDomains: readonly DomainId[];
  /** The total of the latest dice this use rolled (`dice` sources and `check` steps write it). */
  lastRoll?: number;
}

/** Rolls `count` d`sides`; returns the dice. */
export function rollDice(count: number, sides: number, rng: Rng): number[] {
  return Array.from({ length: Math.max(0, Math.trunc(count)) }, () => rng(sides));
}

function divideRounded(value: number, by: number, round: "down" | "up" | undefined): number {
  const q = value / by;
  return round === "down" ? Math.floor(q) : Math.ceil(q);
}

/** The number a source stands for now. `dice` sources roll through `rng` and set `env.lastRoll`. */
export function resolveNumber(source: NumberSource, env: NumberEnv, rng: Rng): number {
  switch (source.kind) {
    case "fixed":
      return source.value;
    case "trait":
      return env.traits[source.trait] ?? 0;
    case "spellcast":
      return env.spellcast;
    case "proficiency":
      return env.proficiency;
    case "level":
      return env.level;
    case "spent":
      return env.spent[source.resource] ?? 0;
    case "chosen":
      return env.choices[source.choice] ?? 0;
    case "cardTokens":
      return env.cardTokens;
    case "gmFear":
      return env.gmFear;
    case "marked": {
      const tracks = source.who === "self" ? env.self : env.target;
      return tracks?.[source.track] ?? 0;
    }
    case "markedThisMove": {
      const marks = source.who === "self" ? env.markedThisMove.self : env.target ? env.markedThisMove.byTarget[env.target.id] : undefined;
      return marks?.[source.track] ?? 0;
    }
    case "targetCount":
      return env.targetCount[source.which];
    case "rollTotal":
      return env.rollTotal ?? 0;
    case "triggerAmount":
      return env.triggerAmount ?? 0;
    case "domainCards":
      return [...env.loadoutDomains, ...(source.includeVault ? env.vaultDomains : [])].filter((d) => d === source.domain).length;
    case "dice": {
      const d = resolveDice(source.dice, env, rng);
      const rolled = rollDice(d.count, d.sides, rng);
      const value = (source.keep === "highest" ? Math.max(0, ...rolled) : rolled.reduce((s, n) => s + n, 0)) + d.plus;
      env.lastRoll = value;
      return value;
    }
    case "lastRoll":
      return env.lastRoll ?? 0;
    case "byTier":
      return source.values[env.tier - 1]!;
    case "sum":
      return source.of.reduce((s, n) => s + resolveNumber(n, env, rng), 0);
    case "product":
      return source.of.reduce((s, n) => s * resolveNumber(n, env, rng), 1);
    case "max":
      return Math.max(...source.of.map((n) => resolveNumber(n, env, rng)));
    case "calc": {
      let value = resolveNumber(source.of, env, rng);
      if (source.times !== undefined) value *= source.times;
      if (source.divide !== undefined) value = divideRounded(value, source.divide, source.round);
      if (source.plus !== undefined) value += source.plus;
      if (source.min !== undefined) value = Math.max(source.min, value);
      if (source.max !== undefined) value = Math.min(resolveNumber(source.max, env, rng), value);
      return value;
    }
  }
}

/** A `DiceExpr` with its numbers resolved. */
export interface ResolvedDice {
  count: number;
  sides: number;
  plus: number;
}

export function resolveDice(dice: DiceExpr, env: NumberEnv, rng: Rng): ResolvedDice {
  return {
    count: Math.max(0, resolveNumber(dice.count, env, rng)),
    sides: dice.sides,
    plus: dice.plus ? resolveNumber(dice.plus, env, rng) : 0,
  };
}
