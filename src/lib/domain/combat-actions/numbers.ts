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
//
// Plan sheet-drawer, SD1 (NV1, NV12): a `DiceExpr` with `sidesOf` rolls the actor's own class die (`env.dieSides`, read
// from the sheet: Rally, Prayer, Patron, Slayer, Combo, Unstoppable), else its printed `sides`; a `dice` source with
// `keep: "countAtLeast"` is the number of dice that rolled `atLeast` or more (Deathless Embrace, HF p.13: "clear a Hit
// Point for each result of 4 or higher"), every die without `atLeast`, plus the expression's `plus`.

import type { Rng } from "../dice/index";
import type { DiceExpr, HeldDieKind, NumberSource, Range, Resource, Track } from "../card-effects/types";
import { RANGE_SQUARES } from "../combat-map/ranges";
import type { DomainId, TraitId } from "../../srd/types";

/**
 * A creature's tracks, as `marked` reads them. Plan lanes, E5 (each optional; absent reads as 0):
 * - `hpMax` / `stressMax` / `armorMax`: the slots, for `free` (free = slots − marked).
 * - `stats`: derived stats for `stat` (Armored Shell's Armor Score, Blade of the Forest's Major threshold).
 * - `gold`: the gold it carries, for `gold`; `tokens`: named tokens on it, for `creatureTokens`.
 */
export interface MarkedTracks {
  hp: number;
  stress: number;
  armor?: number;
  hpMax?: number;
  stressMax?: number;
  armorMax?: number;
  stats?: Partial<Record<Extract<NumberSource, { kind: "stat" }>["stat"], number>>;
  gold?: { handfuls: number; bags: number };
  tokens?: Readonly<Record<string, number>>;
}

/**
 * A creature on the map, as `creatureCount` reads it (plan lanes, E5; dcm-ttz). `side` is seen from the actor (`self`
 * is the actor itself); `pc` whether it is a player character; `name` the adversary's name; `fromSelf` / `fromTarget` the
 * squares to the actor and to the target (absent: not known, so it is not counted when the source has a `within`).
 */
export interface MapCreature {
  id: string;
  side: "self" | "ally" | "enemy";
  pc: boolean;
  name?: string;
  fromSelf?: number;
  fromTarget?: number;
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
  /** SD1 (NV1): the size of the actor's class dice, for `DiceExpr.sidesOf` (absent: the expression's own `sides`). */
  dieSides?: Partial<Record<HeldDieKind | "unstoppable" | "companion", number>>;
  // ---- Plan lanes, E5: what the sources tracer V widened read (absent reads as 0)
  /** The Hope and Fear Die of the host roll or of this move's roll (`dualityDie`; lane E3 fills it). */
  dualityDice?: { hope: number; fear: number };
  /** The creatures on the map (`creatureCount`). */
  creatures?: readonly MapCreature[];
  /** The current value of the actor's class dice (`classDie`: the Unstoppable Die, a held Rally Die). */
  classDice?: Partial<Record<HeldDieKind | "unstoppable", number>>;
  /** The Know the Tide tokens the actor holds (`tideTokens`; lane E8 fills it). */
  tideTokens?: number;
}

/** Squares each range reaches (combat-map/ranges.ts); Very Far is any distance on the map. */
const REACH: Record<Range, number> = { ...RANGE_SQUARES, veryFar: Infinity };

/** How many creatures a `creatureCount` source counts (dcm-ttz). */
function countCreatures(source: Extract<NumberSource, { kind: "creatureCount" }>, creatures: readonly MapCreature[]): number {
  const sideFits = (c: MapCreature): boolean => {
    switch (source.side) {
      case "allies":
        return c.side === "self" || c.side === "ally";
      case "enemies":
        return c.side === "enemy";
      case "pcs":
        return c.pc;
      case "all":
        return true;
    }
  };
  const within = source.within;
  return creatures.filter((c) => {
    if (source.excludeSelf && c.side === "self") return false;
    if (!sideFits(c) || (source.name !== undefined && c.name !== source.name)) return false;
    if (within === undefined) return true;
    const d = (source.of ?? "self") === "self" ? (c.side === "self" ? 0 : c.fromSelf) : c.fromTarget;
    return d !== undefined && d <= REACH[within];
  }).length;
}

/** A track's free slots (slots − marked); 0 when the slots are not known. */
function freeSlots(tracks: MarkedTracks | undefined, track: Track): number {
  if (tracks === undefined) return 0;
  const max = track === "hp" ? tracks.hpMax : track === "stress" ? tracks.stressMax : tracks.armorMax;
  return max === undefined ? 0 : Math.max(0, max - (tracks[track] ?? 0));
}

/** Handfuls of gold (CB p.104: "10 handfuls to 1 bag") or whole bags. */
function goldIn(tracks: MarkedTracks | undefined, unit: "handful" | "bag"): number {
  const g = tracks?.gold;
  if (g === undefined) return 0;
  return unit === "bag" ? g.bags : g.handfuls + g.bags * 10;
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
      const kept =
        source.keep === "highest"
          ? Math.max(0, ...rolled)
          : source.keep === "countAtLeast"
            ? rolled.filter((n) => n >= (source.atLeast ?? -Infinity)).length
            : rolled.reduce((s, n) => s + n, 0);
      const value = kept + d.plus;
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
    // Plan lanes, E5: the sources tracer V widened (TASK-LN-V.md); a value the env does not hold reads as 0.
    case "free":
      return freeSlots(source.who === "self" ? env.self : env.target, source.track);
    case "dualityDie":
      return env.dualityDice?.[source.die] ?? 0;
    case "stat":
      return (source.who === "self" ? env.self : env.target)?.stats?.[source.stat] ?? 0;
    case "creatureCount":
      return countCreatures(source, env.creatures ?? []);
    case "gold":
      return goldIn(source.who === "self" ? env.self : env.target, source.unit ?? "handful");
    case "creatureTokens":
      return (source.who === "self" ? env.self : env.target)?.tokens?.[source.name] ?? 0;
    case "classDie":
      return env.classDice?.[source.die] ?? 0;
    case "tideTokens":
      return env.tideTokens ?? 0;
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
    sides: (dice.sidesOf !== undefined ? env.dieSides?.[dice.sidesOf] : undefined) ?? dice.sides,
    plus: dice.plus ? resolveNumber(dice.plus, env, rng) : 0,
  };
}
