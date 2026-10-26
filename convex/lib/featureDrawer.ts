/**
 * The Combat Map sheet drawer's read model (plan sheet-drawer, tracer SD3; docs/tasks/TASK-SD-SD3.md):
 * `combatFeatures.drawer` returns the trackers (HP, Stress, Hope, Armor with their maxima), every feature the sheet holds
 * (owned(): Hope, class, subclass, ancestry, community, transformation, Beastform, stances) with its source, card, state
 * (ready / exhausted with the reset label / passive / outOfCombat / narrative, Q3, Q7, Q15), cost and limit badges, tokens,
 * upgrades, and each use with its activation; the D5 counters and held dice; the Flying toggle (Q16) and the Martial
 * Artist's stances and Focus (Q5).
 *
 * U1 / CF6: the shape is built from the character's own sheet only; it has no field for an enemy.
 */
import { v, type Infer } from "convex/values";

import { RESET_LABEL, type Availability } from "../../src/lib/domain/card-effects/availability";
import type { CardUse, Cost, Limit, NumberSource, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { derivedDefense } from "../../src/lib/domain/characters/derived";
import { withEffects } from "../../src/lib/domain/characters/effects";
import { hopeMax } from "../../src/lib/domain/characters/index";
import { CLASS_STATE_LABELS } from "../../src/lib/domain/class-features/index";
import { featureKey } from "../../src/lib/domain/feature-effects/ids";
import { holdingsFor } from "../../src/lib/domain/feature-effects/owned";
import { asCardEffect, featureAvailability } from "../../src/lib/domain/feature-effects/run";
import { activeUpgrades, applyUpgrades } from "../../src/lib/domain/feature-effects/upgrades";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { FEATURE_CLASSIFICATION } from "../../src/lib/srd/feature-effects/classification";
import { FOCUS_HOLD_MAX, type CharacterSheet, type ClassState } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import { FLYING_EFFECT_ID, ownedHere } from "./featureRunner";

const activation = v.union(v.literal("action"), v.literal("reaction"), v.literal("rider"), v.literal("auto"), v.literal("passive"));

export const drawerUseValidator = v.object({
  useId: v.string(),
  name: v.string(),
  activation,
  ready: v.boolean(),
  resetLabel: v.union(v.null(), v.string()),
  usesLeft: v.union(v.null(), v.number()),
  rolls: v.boolean(),
  /** Who it targets: side, range and count kind; null for trigger targets or none. */
  targets: v.union(v.null(), v.object({ side: v.string(), range: v.string(), count: v.string() })),
  choices: v.array(v.object({ id: v.string(), label: v.string(), min: v.number() })),
  /** Cost badges ("3 Hope", "1 Stress or 1 Hope"). */
  costs: v.array(v.string()),
  /** Limit badge ("Once per rest", "Twice per long rest on a success"), null without a limit. */
  limit: v.union(v.null(), v.string()),
  /** CB p.107: a non-roll, unlimited use may be activated several times at once (the `times` choice). */
  repeatable: v.boolean(),
  /** Situations the player confirms with a check box (Q13). */
  situations: v.array(v.string()),
});

const source = v.union(
  v.literal("hope"),
  v.literal("class"),
  v.literal("subclass"),
  v.literal("ancestry"),
  v.literal("community"),
  v.literal("beastform"),
  v.literal("transformation"),
  v.literal("stance"),
);

export const drawerFeatureValidator = v.object({
  featureId: v.string(),
  source,
  owner: v.string(),
  name: v.string(),
  text: v.string(),
  card: v.union(v.null(), v.literal("foundation"), v.literal("specialization"), v.literal("mastery")),
  multiclass: v.boolean(),
  usage: v.union(v.literal("combat"), v.literal("passive"), v.literal("outOfCombat"), v.literal("narrative")),
  /** How the analysis reads it: action, reaction, rider, auto, passive or text (the drawer's badge). */
  how: v.string(),
  /** Its effect entry exists (an FE-* table filled it): its Use runs on the map. */
  automated: v.boolean(),
  state: v.union(v.literal("ready"), v.literal("exhausted"), v.literal("passive"), v.literal("outOfCombat"), v.literal("narrative")),
  resetLabel: v.union(v.null(), v.string()),
  tokens: v.number(),
  /** The upgrades that hold ("level 5", "Epic Poetry"). */
  upgrades: v.array(v.string()),
  uses: v.array(drawerUseValidator),
});

const track = v.object({ marked: v.number(), max: v.number() });

export const drawerValidator = v.object({
  characterId: v.id("characters"),
  name: v.string(),
  trackers: v.object({ hp: track, stress: track, hope: v.object({ value: v.number(), max: v.number() }), armor: track }),
  /** Q16: the Flying toggle is on; `canFly`: the character holds a feature that lets them fly. */
  flying: v.boolean(),
  canFly: v.boolean(),
  /** Q5: the Martial Artist's known stances, the active one and Focus (HF p.12); null without the state. */
  martial: v.union(v.null(), v.object({ known: v.array(v.string()), active: v.union(v.null(), v.string()), focus: v.number(), max: v.number(), refocusReady: v.boolean() })),
  /** D5 class counters (Unstoppable, Favor, Hexes, ...). */
  counters: v.array(v.object({ key: v.string(), label: v.string(), value: v.string() })),
  heldDice: v.array(v.object({ id: v.string(), kind: v.string(), sides: v.number(), value: v.union(v.null(), v.number()) })),
  features: v.array(drawerFeatureValidator),
});
export type Drawer = Infer<typeof drawerValidator>;

// ---------------------------------------------------------------- flying and stances

/** Features that let a character fly (their classification reads "Fly"; Q16 "a Flying toggle … for PCs with a flying feature"). */
export const FLYING_FEATURES: ReadonlySet<string> = new Set(Object.entries(FEATURE_CLASSIFICATION).flatMap(([id, c]) => (/\bfly\b/i.test(c.why) ? [id] : [])));

/** The `featureUses` key of Refocus (HF p.12: "Once per rest during a moment of calm"). */
export const REFOCUS_KEY = "feat:stance:martial-artist:refocus";

// ---------------------------------------------------------------- badges

function amountText(n: NumberSource): string {
  switch (n.kind) {
    case "fixed":
      return String(n.value);
    case "chosen":
      return "any";
    case "spellcast":
      return "Spellcast";
    case "proficiency":
      return "Proficiency";
    case "level":
      return "level";
    case "trait":
      return n.trait;
    default:
      return "X";
  }
}

const POOL_WORD: Record<string, string> = { card: "token", favor: "Favor", focus: "Focus", rally: "Rally Die", prayer: "Prayer Die", patron: "Patron Die", slayer: "Slayer Die", combo: "Combo die" };

/** One cost as a badge. */
export function costText(c: Cost): string {
  switch (c.kind) {
    case "hope":
      return `${amountText(c.amount)} Hope`;
    case "stress":
      return `${amountText(c.amount)} Stress`;
    case "hp":
      return `${amountText(c.amount)} HP`;
    case "armor":
      return `${amountText(c.amount)} Armor Slot`;
    case "tokens":
      return `${amountText(c.amount)} ${POOL_WORD[c.pool ?? "card"] ?? "token"}`;
    case "fear":
      return `${amountText(c.amount)} Fear`;
    case "gold":
      return `${c.handfuls} handfuls of gold`;
    case "either":
      return c.options.map((o) => o.map(costText).join(" + ")).join(" or ");
  }
}

const PER_WORD: Record<Limit["per"], string> = { rest: "rest", longRest: "long rest", session: "session", scene: "scene" };

/** A limit as a badge. */
export function limitText(l: Limit): string {
  const times = l.times ?? 1;
  const count = times === 1 ? "Once" : times === 2 ? "Twice" : `${times} times`;
  const on = l.consumedOn === "success" ? " on a success" : l.consumedOn === "failure" ? " on a failure" : "";
  return `${count} per ${PER_WORD[l.per]}${on}${l.perTarget ? " per target" : ""}`;
}

function counterText(key: keyof ClassState, value: unknown): string {
  if (key === "unstoppable" && value && typeof value === "object") {
    const u = value as { value: number; max: number };
    return `${u.value} (d${u.max})`;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function specOf(use: CardUse): TargetSpec | undefined {
  return use.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
}

// ---------------------------------------------------------------- the drawer

/** The drawer of one character (their own sheet only, U1). */
export function drawerOf(characterId: Id<"characters">, sheet: CharacterSheet, campaign: Pick<Doc<"campaigns">, "frameId" | "options">): Drawer {
  const held = ownedHere(sheet, campaign);
  const features = held.map((f) => {
    const entry = featureEffect(f.featureId);
    const holdings = holdingsFor(sheet, held, f.owner);
    const upgraded = entry ? applyUpgrades(entry, holdings) : undefined;
    const uses = (upgraded ? asCardEffect(upgraded).uses : []).map((u) => {
      const a: Availability = entry ? featureAvailability(sheet, entry, u.id, { holdings }) : { state: "ready" };
      const spec = specOf(u);
      return {
        useId: u.id,
        name: u.name,
        activation: u.activation.kind,
        ready: a.state === "ready",
        resetLabel: a.state === "exhausted" ? a.label : null,
        usesLeft: a.state === "ready" && a.usesLeft !== undefined ? a.usesLeft : null,
        rolls: u.roll !== undefined,
        targets: spec ? { side: spec.side, range: spec.range, count: spec.count.kind } : null,
        choices: (u.choices ?? []).map((c) => ({ id: c.id, label: c.label, min: c.min })),
        costs: (u.costs ?? []).map(costText),
        limit: u.limit ? limitText(u.limit) : null,
        repeatable: u.roll === undefined && u.limit === undefined && u.activation.kind === "action",
        situations: (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
      };
    });
    const active = uses.filter((u) => u.activation !== "passive");
    let state: Drawer["features"][number]["state"];
    let resetLabel: string | null = null;
    if (f.usage !== "combat") state = f.usage;
    else if (active.length > 0 && active.every((u) => !u.ready)) {
      state = "exhausted";
      resetLabel = active.find((u) => u.resetLabel !== null)?.resetLabel ?? RESET_LABEL.rest;
    } else state = "ready";
    return {
      featureId: f.featureId,
      source: f.source,
      owner: f.owner,
      name: f.name,
      text: f.text,
      card: f.card ?? null,
      multiclass: f.multiclass === true,
      usage: f.usage,
      how: FEATURE_CLASSIFICATION[f.featureId]?.how ?? "text",
      automated: entry !== undefined,
      state,
      resetLabel,
      tokens: sheet.cardTokens?.find((t) => t.cardId === featureKey(f.featureId))?.count ?? 0,
      upgrades: entry ? activeUpgrades(entry, holdings).map((u) => u.note ?? "upgrade") : [],
      uses,
    };
  });

  const defense = derivedDefense(withEffects(sheet));
  const counters = (Object.keys(CLASS_STATE_LABELS) as (keyof ClassState)[]).flatMap((key) => {
    const value = sheet.classState[key];
    if (key === "martial" || value === undefined || value === false) return [];
    return [{ key, label: CLASS_STATE_LABELS[key], value: counterText(key, value) }];
  });
  const martial = sheet.classState.martial;
  return {
    characterId,
    name: sheet.name,
    trackers: {
      hp: { marked: sheet.hp, max: sheet.hpMax },
      stress: { marked: sheet.stress, max: sheet.stressMax },
      hope: { value: sheet.hope, max: hopeMax(sheet.scars, sheet.hopeSlotBonus) },
      armor: { marked: sheet.armorMarked, max: defense.armorScore },
    },
    flying: sheet.effects.some((e) => e.id === FLYING_EFFECT_ID),
    canFly: held.some((f) => FLYING_FEATURES.has(f.featureId)),
    martial: martial
      ? { known: martial.known, active: martial.active ?? null, focus: martial.focus, max: FOCUS_HOLD_MAX, refocusReady: !sheet.featureUses.some((u) => u.key === REFOCUS_KEY) }
      : null,
    counters,
    heldDice: sheet.heldDice.map((d) => ({ id: d.id, kind: d.kind, sides: d.sides, value: d.value ?? null })),
    features,
  };
}
