/**
 * Which card or feature a sheet effect belongs to, and the condition markers sourced conditions leave on a sheet (SD3,
 * NV7, DA10). Split out of `./cardRunner` (dcm-uh6r): these helpers read only the card and feature effect tables, so the
 * queries that need them (the HUD sheet, death moves, cloak prompts) do not load the card runner, the adversary tables
 * and the vision engine with it. `./cardRunner` re-exports every one of them.
 */
import type { EffectEnds } from "../../src/lib/domain/characters/expiry";
import type { Step } from "../../src/lib/domain/card-effects/types";
import { featureKey, parseFeatureId } from "../../src/lib/domain/feature-effects/ids";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { FEATURE_CLASSIFICATION } from "../../src/lib/srd/feature-effects/classification";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet, Condition, Effect } from "../../src/lib/validation/characters";
import { CONDITIONS } from "../../src/lib/validation/character-constants";

/** Sheet effect ids written by cards: `card:<cardId>:<n>` (the sheet's list ids are at most 40 characters). */
const CARD_EFFECT = /^card:([a-z0-9-]+):\d+$/;

export function cardIdOfEffect(effect: Effect): string | null {
  return CARD_EFFECT.exec(effect.id)?.[1] ?? null;
}

/** The standard condition names (CB 102-103). */
export const STANDARD = new Set<string>(CONDITIONS);

/** FNV-1a (32 bit) in base 36: a short, stable name for a feature id. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Whether a runner id is a feature id (`<source>:<owner>[:<slug>]`); a card id has no colon. */
export function isFeatureUseId(id: string): boolean {
  return parseFeatureId(id) !== null;
}

/** The `cardTokens` id of a use's tokens: the card id, or `feat:<featureId>` for a feature. */
export function tokenKeyOf(id: string): string {
  return isFeatureUseId(id) ? featureKey(id) : id;
}

/**
 * The prefix of a use's sheet effect ids: `card:<cardId>`, or `feat:<hash>` for a feature (sheet effect ids once held at
 * most 40 characters and a feature id up to 53; `featureIdOfEffect` reads the hash back). An adversary feature keeps the
 * plain `card:<adversaryId>/<feature>` (ADVERSARY_SHEET_EFFECT reads it): the cap is EFFECT_ID_MAX now (dcm-s7hd).
 */
export function effectKeyOf(id: string): string {
  return isFeatureUseId(id) ? `feat:${shortHash(id)}` : `card:${id}`;
}

/** Feature ids by their effect key (`feat:<hash>`), built on first use so loading this module hashes nothing. */
let featureByHash: ReadonlyMap<string, string> | undefined;
function featureByHashMap(): ReadonlyMap<string, string> {
  featureByHash ??= new Map(Object.keys(FEATURE_CLASSIFICATION).map((id) => [effectKeyOf(id), id]));
  return featureByHash;
}

/** Whether a sheet effect belongs to this card or feature (`<prefix>:<n>`). */
export function ownsEffect(effect: Pick<Effect, "id">, id: string): boolean {
  const prefix = `${effectKeyOf(id)}:`;
  return effect.id.startsWith(prefix) && /^\d+$/.test(effect.id.slice(prefix.length));
}

/** The feature id of a sheet effect written by a feature use, or null (NV7 `featureEffect` facts read it). */
export function featureIdOfEffect(effect: Pick<Effect, "id">): string | null {
  const m = /^(feat:[a-z0-9]+):\d+$/.exec(effect.id);
  return m ? (featureByHashMap().get(m[1]!) ?? null) : null;
}

/** The condition steps of an entry, by condition name (first one wins), with their ends. Cached per entry. */
const SOURCE_STEPS = new Map<string, Map<string, EffectEnds>>();

function conditionSteps(value: unknown, out: Map<string, EffectEnds>): Map<string, EffectEnds> {
  if (Array.isArray(value)) {
    for (const v of value) conditionSteps(v, out);
  } else if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.kind === "condition" && "duration" in o) {
      const step = o as unknown as Extract<Step, { kind: "condition" }>;
      if (step.condition.kind === "standard" && !out.has(step.condition.condition)) {
        out.set(step.condition.condition, {
          duration: step.duration,
          ...(step.endsOn ? { endsOn: step.endsOn } : {}),
          ...(step.endsOnRoll ? { endsOnRoll: step.endsOnRoll } : {}),
          ...(step.endsOnCaster ? { endsOnCaster: step.endsOnCaster } : {}),
        });
      }
    }
    for (const v of Object.values(o)) conditionSteps(v, out);
  }
  return out;
}

/**
 * The ends of a card's or feature's standard condition step when they hold an event of their own (an `endsOn` other than
 * the stance drop DA10 handles, an `endsOnRoll`); undefined otherwise (the condition stays a bare name).
 */
export function sourceEnds(sourceId: string, condition: string): EffectEnds | undefined {
  let steps = SOURCE_STEPS.get(sourceId);
  if (steps === undefined) {
    const uses = cardEffect(sourceId)?.uses ?? featureEffect(sourceId)?.uses ?? [];
    steps = conditionSteps(uses, new Map());
    SOURCE_STEPS.set(sourceId, steps);
  }
  const ends = steps.get(condition);
  if (ends === undefined) return undefined;
  const events = (ends.endsOn ?? []).some((e) => e !== "stanceDrops") || ends.endsOnRoll !== undefined;
  return events ? ends : undefined;
}

/** A sheet effect that records a condition's source: the entry and the condition, or null. */
export function conditionMarkerOf(effect: Effect): { sourceId: string; condition: Condition } | null {
  const sourceId = cardIdOfEffect(effect) ?? featureIdOfEffect(effect);
  if (sourceId === null) return null;
  const label = effect.text.split("; ")[0] ?? "";
  if (!STANDARD.has(label) || sourceEnds(sourceId, label) === undefined) return null;
  return { sourceId, condition: label as Condition };
}

export function isMarker(effect: Effect, sourceId: string, condition: Condition): boolean {
  const m = conditionMarkerOf(effect);
  return m !== null && m.sourceId === sourceId && m.condition === condition;
}

/** The entries a held condition comes from (their markers); empty when the condition is bare or not held. */
export function conditionSources(sheet: Pick<CharacterSheet, "conditions" | "effects">, condition: Condition): string[] {
  if (!sheet.conditions.includes(condition)) return [];
  return sheet.effects.flatMap((e) => {
    const m = conditionMarkerOf(e);
    return m !== null && m.condition === condition ? [m.sourceId] : [];
  });
}

/** The sheet without the condition and every marker for it; the same sheet when neither is there. */
export function withoutCondition<T extends Pick<CharacterSheet, "conditions" | "effects">>(sheet: T, condition: Condition): T {
  const markers = sheet.effects.some((e) => conditionMarkerOf(e)?.condition === condition);
  if (!sheet.conditions.includes(condition) && !markers) return sheet;
  return { ...sheet, conditions: sheet.conditions.filter((c) => c !== condition), effects: sheet.effects.filter((e) => conditionMarkerOf(e)?.condition !== condition) };
}

/** A sourced condition that ended, with its marker's `source` (the card or feature name, for the feed). */
export type EndedCondition = { condition: Condition; source: string };

/** The feed words of an ended sourced condition: "Ash: Cloaked ends (Vanishing Act)". */
export function endedConditionLine(name: string, ended: EndedCondition): string {
  return `${name}: ${ended.condition.charAt(0).toUpperCase()}${ended.condition.slice(1)} ends (${ended.source})`;
}
