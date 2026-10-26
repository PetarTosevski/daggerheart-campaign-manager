// D5 delegation (plan sheet-drawer, SD1; vocabulary NV2). Pure.
//
// Features that D5 already automates (src/lib/domain/class-features: Rally, Prayer Dice, Unstoppable, Ranger's Focus,
// Hex, Marked for Death, Combo Strike, Beastform, Evolution, Channel Raw Power, Strange Patterns, Favor, Patron's Pact)
// keep their D5 record: the feature's entry runs a `delegate` step naming the D5 `FeatureMeta.key`, and the runner asks
// the handler built here, which runs that `FeatureMeta.use` on the sheet inside the same plan. So `classState`, held dice
// and D5's own once-per keys (`rally`, `unstoppable`, `channelRawPower`, `commune`) stay the one record, and a key D5
// already wrote reads as exhausted (`delegatedExhaustion`).
//
// The entry's own `costs` pay the price (Hope, Stress, Favor, …); the delegate pays only D5's once-per key and held die.
// Before the D5 feature runs, the sheet takes the runner's resources so far; after it, the runner takes the sheet's.
//
// ```ts
// const d = createDelegator({ sheet, others, rng });
// const result = run(effect, { ...context, delegate: d.handler });   // or runFeature(…, { sheet, others })
// d.sheet();   // the sheet after every D5 feature the use ran (classState, held dice, effects)
// ```

import { RESET_LABEL } from "../card-effects/availability";
import type { DelegateAnswer, DelegateHandler, DelegateSnapshot, HeldDieState } from "../card-effects/run";
import type { CardUse, DieSides, Step } from "../card-effects/types";
import type { RollRecord } from "../duality";
import { findFeature } from "../class-features/hooks";
import { CLASS_FEATURES, type Registry } from "../class-features/index";
import type { FeatureMeta, OtherSheet, Rng } from "../class-features/types";
import { RuleError } from "../../errors/app-error";
import type { CharacterSheet, FeatureUse, HeldDie } from "../../validation/characters";

/** The D5 feature keys a use delegates to, in step order (nested steps included). */
export function delegatedKeys(use: CardUse): string[] {
  const out: string[] = [];
  const walk = (steps: readonly Step[]) => {
    for (const s of steps) {
      if (s.kind === "delegate") out.push(s.feature);
      else if (s.kind === "optional" || s.kind === "followUp") walk(s.steps);
      else if (s.kind === "choose") for (const o of s.options) walk(o.steps);
      else if (s.kind === "save") {
        walk(s.onFail);
        walk(s.onSuccess);
      } else if (s.kind === "check") {
        walk(s.then);
        walk(s.otherwise);
      }
    }
  };
  walk(use.steps);
  return out;
}

/** The D5 feature of a key on this sheet (its Hope feature or a class action of the class or multiclass). */
export function delegateFeature(sheet: Pick<CharacterSheet, "classId" | "multiclass">, key: string, registry: Registry = CLASS_FEATURES): FeatureMeta | undefined {
  return findFeature(sheet, key, registry);
}

/**
 * A D5 once-per key a use's delegated features already used (`rally`, `unstoppable`, `channelRawPower`, `commune`):
 * the use reads as exhausted with that key's reset label, or null when none is used.
 */
export function delegatedExhaustion(
  sheet: Pick<CharacterSheet, "classId" | "multiclass"> & { readonly featureUses: readonly FeatureUse[] },
  use: CardUse,
  registry: Registry = CLASS_FEATURES,
): { key: string; until: FeatureUse["until"]; label: string } | null {
  for (const key of delegatedKeys(use)) {
    const once = delegateFeature(sheet, key, registry)?.cost?.use;
    if (once === undefined) continue;
    const entry = sheet.featureUses.find((u) => u.key === once.key);
    if (entry) return { key: once.key, until: entry.until, label: RESET_LABEL[entry.until] };
  }
  return null;
}

/** The sheet's held dice as the runner spends them. */
export function heldDiceState(sheet: Pick<CharacterSheet, "heldDice">): HeldDieState[] {
  return sheet.heldDice.map((d) => ({ id: d.id, kind: d.kind, sides: d.sides, ...(d.value !== undefined ? { value: d.value } : {}) }));
}

export interface DelegatorInput {
  sheet: CharacterSheet;
  /** The other characters a D5 feature may read or change (`target: "ally"` / `"party"`), as `classFeatures.use` loads them. */
  others?: readonly OtherSheet[];
  rng: Rng;
  /** The roll a D5 feature acts on (Volatile Magic, Patron's Boon, Witch's Charm). */
  roll?: RollRecord;
  /** NV3: the die size an upgrade gives the held dice the D5 feature creates (Rally d10 with Epic Poetry, CB p.29). */
  dieSides?: DieSides;
  registry?: Registry;
}

export interface Delegator {
  handler: DelegateHandler;
  /** The actor's sheet after the D5 features ran (the resources are the runner's, in the plan). */
  sheet: () => CharacterSheet;
  /** Other sheets the D5 features changed (Rally Dice to allies, Life Support). */
  others: () => OtherSheet[];
  /** D5 rolls to log. */
  rolls: () => RollRecord[];
}

/** Resizes the held dice in `after` that are not in `before` (NV3 `dieSides`). */
function resize(before: readonly HeldDie[], after: readonly HeldDie[], sides: DieSides | undefined): HeldDie[] {
  if (sides === undefined) return [...after];
  const old = new Set(before.map((d) => d.id));
  return after.map((d) => (old.has(d.id) || d.value !== undefined ? d : { ...d, sides }));
}

/** A handler for the runner's `delegate` steps, and the sheets the D5 features leave behind. */
export function createDelegator(input: DelegatorInput): Delegator {
  const registry = input.registry ?? CLASS_FEATURES;
  let sheet = input.sheet;
  let others = [...(input.others ?? [])];
  const changed = new Set<string>();
  const rolls: RollRecord[] = [];

  const handler: DelegateHandler = ({ feature, params, actor }): DelegateAnswer => {
    const meta = delegateFeature(sheet, feature, registry);
    if (!meta?.use) return { ok: false, detail: `No automated feature "${feature}".` };
    // The sheet takes the runner's resources so far (costs paid, Hope gained).
    const kept = new Set(actor.heldDice.map((d) => d.id));
    let base: CharacterSheet = {
      ...sheet,
      hope: actor.hope,
      stress: actor.stress,
      hp: actor.hp,
      armorMarked: actor.armor,
      heldDice: sheet.heldDice.filter((d) => kept.has(d.id)),
      featureUses: [...actor.featureUses],
      classState: {
        ...sheet.classState,
        ...(actor.favor !== undefined ? { favor: actor.favor } : {}),
        ...(actor.focus !== undefined && sheet.classState.martial ? { martial: { ...sheet.classState.martial, focus: actor.focus } } : {}),
      },
    };
    // D5's own price besides Hope and Stress: its once-per key and a held die.
    const once = meta.cost?.use;
    if (once) {
      if (base.featureUses.some((u) => u.key === once.key)) return { ok: false, detail: `${meta.name}: ${RESET_LABEL[once.until]}.` };
      base = { ...base, featureUses: [...base.featureUses, once] };
    }
    const dieId = meta.cost?.heldDieId;
    if (dieId) base = { ...base, heldDice: base.heldDice.filter((d) => d.id !== dieId) };
    const ally = params.targetId ? others.filter((o) => o.characterId === params.targetId) : [];
    const pass = meta.target === "ally" ? ally : meta.target === "party" ? others : [];
    let result;
    try {
      result = meta.use({
        sheet: base,
        params: {
          ...(params.choice !== undefined ? { choice: params.choice } : {}),
          ...(params.amount !== undefined ? { amount: params.amount } : {}),
          ...(params.targetId !== undefined ? { targetId: params.targetId } : {}),
          ...(params.dieIndexes ? { dieIndexes: params.dieIndexes } : {}),
        },
        rng: input.rng,
        others: pass,
        ...(input.roll ? { roll: input.roll } : {}),
      });
    } catch (error) {
      // A D5 refusal is a RuleError with the player's words; anything else is a bug and goes on up.
      if (error instanceof RuleError) return { ok: false, detail: error.message };
      throw error;
    }
    sheet = { ...result.sheet, heldDice: resize(base.heldDice, result.sheet.heldDice, input.dieSides) };
    for (const o of result.others ?? []) {
      const prev = others.find((p) => p.characterId === o.characterId);
      const resized = { ...o, sheet: { ...o.sheet, heldDice: resize(prev?.sheet.heldDice ?? [], o.sheet.heldDice, input.dieSides) } };
      others = [...others.filter((p) => p.characterId !== o.characterId), resized];
      changed.add(o.characterId);
    }
    if (result.roll) rolls.push(result.roll);
    const after: DelegateSnapshot = {
      hope: sheet.hope,
      stress: sheet.stress,
      hp: sheet.hp,
      armor: sheet.armorMarked,
      heldDice: heldDiceState(sheet),
      featureUses: sheet.featureUses,
      ...(sheet.classState.favor !== undefined ? { favor: sheet.classState.favor } : {}),
      ...(sheet.classState.martial ? { focus: sheet.classState.martial.focus } : {}),
    };
    return { ok: true, actor: after, summary: result.summary, ...(result.fearDelta ? { fearDelta: result.fearDelta } : {}) };
  };

  return {
    handler,
    sheet: () => sheet,
    others: () => others.filter((o) => changed.has(o.characterId)),
    rolls: () => [...rolls],
  };
}
