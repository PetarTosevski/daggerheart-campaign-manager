/**
 * Features used on the Combat Map (plan sheet-drawer, tracer SD3; docs/tasks/TASK-SD-SD3.md): the steps behind
 * `combatFeatures.useFeature` and the GM's feature sanction. A Hope, class, subclass, ancestry, community, Beastform,
 * transformation or stance feature runs through the card path (convex/lib/cardRunner.ts: `buildRun`, `runCard`,
 * `actorSheetAfter`, `writeSheetChanges`; convex/lib/cardRows.ts: instance writes and row words), with a `UsePick` whose
 * runner is SD1's `runFeature` (upgrades, D5 delegation, `feat:` limits, repeat activation).
 *
 * Rules and answers (printed pages; quotes in the task doc):
 * - Ownership (CB p.110-111, p.71; Q10, Q11, Q5): `owned()` decides; FEATURE_NOT_OWNED otherwise.
 * - Passive uses and out-of-combat / narrative features have no Use (FEATURE_NOT_COMBAT, SD0 classification, Q15).
 * - Limits (CB p.101; Q3, Q4, Q7) are `featureUses` keys `feat:<featureId>[:<useId>][:<target>]`; a per-target key past
 *   the 80-character cap names the target by a short hash (`:~<hash>`).
 * - CB p.107 Spending Resources: a non-roll feature may be activated `times` times (choice `{id: "times"}`); a feature
 *   with a roll or a limit refuses it (INVALID).
 * - Q13: a situation the engine can't read needs the player's confirmation (choice `situations`).
 * - NV2: D5 features keep their record: the delegated D5 feature's `classState`, held dice and other sheets (Rally Dice,
 *   Life Support) are written in the same mutation as the map steps.
 * - DA12 (dcm-d95, CB p.31): a `rolledFirst` target count is the server's stored roll (convex/lib/featurePrompts.ts);
 *   `resolveFeatureUse` refuses the use without it or with more targets. A use with a server move (`intoMelee`, Charge,
 *   CB p.59) runs only through `featurePrompts.charge`.
 * - DA13 (dcm-bxp.99.19.21, CB p.33 Cannonball): a use rolled by an ally (`rolledBy`) pays here and opens an `allyRoll`
 *   prompt for the picked ally (convex/lib/featurePrompts.ts `openAllyRoll`); the ally's roll runs through
 *   `featurePrompts.allyRoll`, which writes with `resolveFeatureUse` too (`ResolveExtras`).
 * - U1 / U4: rows as cards (public: roll, own damage, Hit / Miss / Defeated; GM: the full resolution with
 *   `adversaryBefore`); one actionLog group, which `actionLog.undo` reverts.
 */
import { v, type Infer } from "convex/values";

import { pickUse, type ActorState, type RunContext, type RunPlan, type RunRefusal } from "../../src/lib/domain/card-effects/run";
import type { CardUse, Step, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { delegatedKeys } from "../../src/lib/domain/feature-effects/delegate";
import { activeBeastformId, holdingsFor, type OwnedFeature } from "../../src/lib/domain/feature-effects/owned";
import { actorExtras, asCardEffect, bindSheetNumbers, runFeature, sheetNumbers, type SheetNumbers } from "../../src/lib/domain/feature-effects/run";
import type { FeatureScope } from "../../src/lib/domain/class-features/types";
import { addGold } from "../../src/lib/domain/characters/index";
import { rangeCheck, rangeFromWeapon, tokenDistance } from "../../src/lib/domain/combat-actions/distance";
import { FRAME_OF } from "../../src/lib/frames/extras/common";
import { getWeapon } from "../../src/lib/srd/index";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { applyUpgrades } from "../../src/lib/domain/feature-effects/upgrades";
import type { OtherSheet } from "../../src/lib/domain/class-features/types";
import type { NumberEnv } from "../../src/lib/domain/combat-actions/numbers";
import { grantExtraMove } from "../../src/lib/domain/rest/feature-moves";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import { appError } from "../../src/lib/errors/app-error";
import { resolveOptions } from "../../src/lib/frames/options";
import { FLYING_EFFECT_ID, ownedHere } from "./featureOwned";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { dropDice, MAX_CARD_TARGETS, type CardChoice, type CardRoll, type DiceSlot } from "./cardChoices";
import { afterUnstoppable, cardPromptValidator, damageRolls, effectEndsOf, endOnSheet, gmLines, instanceWrites, openCardHits, promptsOf, publicTargets, rollText, writeInstances } from "./cardRows";
import { actorSheetAfter, effectOption, featureIdOfEffect, ownsEffect, planHopePaid, tokenKeyOf, writeSheetChanges, type BuiltRun, type Delegated, type UsePick } from "./cardRunner";
import { setStance } from "./stanceDrop";
import type { AdversaryBefore } from "./validators/actionLog";
import { unshakableText, unshakePlan, type UnshakableRoll } from "./unshakable";
import type { CompanionNumbers } from "./companion";
import { noteHopeSpent, partyOf, saveSheet } from "./characterSheet";
import type { AttackScene } from "./combatActions";
import { hasServerMove, isMarkOf, isRolledFirst, openAllyRoll, spendTargetCount, withoutRollCosts } from "./featurePrompts";
import { activeAreasOnMap, areaFactsFor } from "./combatAreas";
import { campaignFearState, gainFear, spendFear } from "./fear";
import { changed } from "./rolls";
import { rollValidator } from "./validators/actionLog";

// ---------------------------------------------------------------- what a caller returns

/** `useFeature` (and the GM's approval) resolved: the player's own dice, hit / miss / defeated, the D5 feed lines (U1). */
export const resolvedFeatureValidator = v.object({
  status: v.literal("resolved"),
  entryId: v.id("actionLog"),
  featureId: v.string(),
  useId: v.string(),
  roll: v.union(v.null(), rollValidator),
  damage: v.array(rollValidator),
  success: v.boolean(),
  targets: v.array(v.object({ tokenId: v.id("combatTokens"), hit: v.boolean(), defeated: v.boolean() })),
  /** The GM's Fear change; absent for a player while "Players see the GM's Fear" is off (dcm-jh6d.62). */
  fearDelta: v.optional(v.number()),
  prompts: v.array(cardPromptValidator),
  /** What the use did besides its roll: the delegated D5 features' lines, Favor / Focus, Help dice, areas. */
  notes: v.array(v.string()),
});
export type ResolvedFeature = Infer<typeof resolvedFeatureValidator>;

// ---------------------------------------------------------------- ownership and the pick

export { FLYING_EFFECT_ID, ownedHere };

/** The runner's refusals as the drawer's codes (SD0's FEATURE_* codes). */
export function featureRefusal(r: RunRefusal) {
  switch (r.reason) {
    case "exhausted":
      return appError("FEATURE_EXHAUSTED", r.detail);
    case "cost":
      return appError("FEATURE_COST_UNPAID", `Short of: ${r.detail}.`, r.shortfall);
    case "targets":
      return appError("COMBAT_TARGET_INVALID", r.detail);
    case "requirement":
      return appError("INVALID", `The feature's condition isn't met (${r.detail}).`);
    case "noUse":
    case "choice":
      return appError("INVALID", r.detail);
  }
}

/** The most times one call activates a non-roll feature (CB p.107; Frontline Tank twice is 6 Hope). */
export const MAX_TIMES = 10;

/** The SD3-only choice ids, taken out before the card path parses the rest (`parseChoices`). */
export function splitFeatureChoices(list: readonly CardChoice[]): { rest: CardChoice[]; times: number; dieIndexes?: number[]; heldDicePicks?: string[] } {
  let times = 1;
  let dieIndexes: number[] | undefined;
  let heldDicePicks: string[] | undefined;
  const rest: CardChoice[] = [];
  for (const c of list) {
    if (c.id === GIFT_EXCESS_TO) {
      // Plan lanes-2 E8.3 (dcm-i5e1): read by `resolveFeatureUse` from the request's choices, not by the card path.
      continue;
    } else if (c.id === HELD_DICE_PICKS) {
      // Plan lanes-2 E8 (dcm-qbn): the held dice (by id) to spend, e.g. which Prayer Dice (CB p.44).
      if (!Array.isArray(c.value) || c.value.length > 20) throw appError("INVALID", "heldDicePicks needs held die ids.");
      heldDicePicks = [...c.value];
    } else if (c.id === "times") {
      if (typeof c.value !== "number" || !Number.isInteger(c.value) || c.value < 1 || c.value > MAX_TIMES) throw appError("INVALID", `Times is 1 to ${MAX_TIMES}.`);
      times = c.value;
    } else if (c.id === "dieIndexes") {
      const list = Array.isArray(c.value) ? c.value : [];
      const n = list.map(Number);
      if (!Array.isArray(c.value) || n.some((x) => !Number.isInteger(x) || x < 0 || x > 20)) throw appError("INVALID", "dieIndexes needs die positions.");
      dieIndexes = n;
    } else rest.push(c);
  }
  return { rest, times, ...(dieIndexes ? { dieIndexes } : {}), ...(heldDicePicks ? { heldDicePicks } : {}) };
}

/** The choice id of the held dice a feature use spends (`{id: "heldDicePicks", value: ["die-1"]}`). */
export const HELD_DICE_PICKS = "heldDicePicks";

/** The campaign's feature scope (as convex/lib/featureScope.ts, from the fields a pick has). */
function scopeOf(campaign: Pick<Doc<"campaigns">, "frameId" | "options">): FeatureScope {
  return { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear, ikonis: campaign.frameId === FRAME_OF.motherboard };
}

/**
 * Plan lanes-2 E8 (dcm-me3, dcm-lk8, dcm-rm9): the facts a feature's own checks read beyond `factsOf`: its own tokens
 * (`cardTokens` under `feat:<featureId>`; Feed, dcm-2g9), the Lunar Phases moon die (`moonPhase`, HF p.17), the items
 * carried (`holdsItem`) and the weapons' ranges (`weaponRange`).
 */
export function ownFacts(sheet: CharacterSheet, featureId: string): NonNullable<ActorState["facts"]> {
  const key = tokenKeyOf(featureId);
  const rangeOf = (id: string | undefined) => {
    const w = id ? getWeapon(id) : undefined;
    return w ? rangeFromWeapon(w.range) : null;
  };
  const moon = sheet.sessionFeatures?.moonDie;
  return {
    cardTokens: (sheet.cardTokens ?? []).find((t) => t.cardId === key)?.count ?? 0,
    ...(moon !== undefined ? { moonPhase: moon } : {}),
    items: sheet.inventory.map((i) => i.name),
    weapons: { primary: rangeOf(sheet.primaryWeaponId), secondary: rangeOf(sheet.secondaryWeaponId) },
  };
}

/** Whether a use needs the live map: its targets are enemies, any creature, a point or an object (FEATURE_NEEDS_MAP). */
export function needsMap(effect: FeatureEffect, useId: string | undefined): boolean {
  const use = pickUse(asCardEffect(effect), useId);
  const spec = use?.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
  return spec !== undefined && (spec.side === "enemy" || spec.side === "any" || spec.side === "point" || spec.side === "object");
}

/** FNV-1a (32 bit) in base 36, for a per-target key past the cap. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The most characters of a `featureUses` key (featureUseSchema). */
export const USE_KEY_MAX = 80;

/**
 * A per-target limit key that fits the sheet's 80 characters (SD1 open point 4): `feat:<featureId>[:<useId>]:<target>`
 * with a target id that makes it longer names the target as `~<hash>`.
 */
export function storedLimitKey(key: string, targetIds: readonly string[]): string {
  if (key.length <= USE_KEY_MAX) return key;
  const target = targetIds.find((id) => key.endsWith(`:${id}`));
  return target === undefined ? key : `${key.slice(0, key.length - target.length)}~${hashOf(target)}`;
}

/** The stored (short) per-target keys read back as the runner writes them, for the targets of this use. */
export function expandedLimitKey(key: string, targetIds: readonly string[]): string {
  const m = /^(.*:)~([a-z0-9]+)$/.exec(key);
  if (!m) return key;
  const target = targetIds.find((id) => hashOf(id) === m[2]);
  return target === undefined ? key : `${m[1]}${target}`;
}

/** The facts NV7 requirements read from the sheet (Q16 Flying, Q10 Beastform, Q5 stance, feature effects, conditions). */
export function factsOf(sheet: CharacterSheet, rollUsedExperience: boolean): NonNullable<ActorState["facts"]> {
  return {
    conditions: sheet.conditions,
    tags: sheet.effects.map((e) => e.text.split("; ")[0] ?? ""),
    flying: sheet.effects.some((e) => e.id === FLYING_EFFECT_ID),
    featureEffects: sheet.effects.flatMap((e) => {
      const featureId = featureIdOfEffect(e);
      const option = effectOption(e);
      return featureId === null ? [] : [{ featureId, ...(option !== undefined ? { option } : {}) }];
    }),
    beastformId: activeBeastformId(sheet),
    activeStance: sheet.classState.martial?.active ?? null,
    rollUsedExperience,
  };
}


/** One other party member a delegated D5 feature may read, keyed by its map token when it has one (the runner's id). */
export type PartyMember = { key: string; character: Doc<"characters">; sheet: CharacterSheet };

/**
 * The campaign's other active characters, for a use that delegates to a D5 feature (Rally reaches the party, Life
 * Support the picked ally). Keyed by their PC token on the map (the runner's creature ids), else their character id.
 */
export async function partyFor(ctx: QueryCtx, campaignId: Id<"campaigns">, self: Id<"characters">, scene: AttackScene | null, readSheetOf: (c: Doc<"characters">) => CharacterSheet): Promise<PartyMember[]> {
  const tokens = new Map<string, string>();
  for (const t of scene?.scene.tokens ?? []) if (t.ref.kind === "pc") tokens.set(t.ref.characterId, t._id);
  const out: PartyMember[] = [];
  for (const c of await partyOf(ctx, campaignId)) {
    if (c._id === self || c.status !== "active") continue;
    out.push({ key: tokens.get(c._id) ?? c._id, character: c, sheet: readSheetOf(c) });
  }
  return out;
}

export type FeaturePick = UsePick & { featureId: string; feature: OwnedFeature; party: PartyMember[]; times: number };

/**
 * The feature and use asked for, ready for the card path. FEATURE_NOT_OWNED for a feature the sheet doesn't hold;
 * FEATURE_NOT_COMBAT for an out-of-combat or narrative feature, one without an effect entry yet, or a passive use.
 */
export function pickFeature(input: {
  sheet: CharacterSheet;
  campaign: Pick<Doc<"campaigns">, "frameId" | "options">;
  featureId: string;
  useId: string | undefined;
  times: number;
  dieIndexes?: number[];
  /** Plan lanes-2 E8 (dcm-qbn): the held dice (by id) the player picked to spend (`splitFeatureChoices` `heldDicePicks`). */
  heldDicePicks?: string[];
  rollUsedExperience: boolean;
  party: PartyMember[];
  /**
   * SD5: changes the use before it runs (a rider's `pre` or `post` part, convex/lib/cardRunner.ts `riderUse`). Applied
   * after the upgrades, so an upgrade's extra steps are split too.
   */
  transform?: (use: CardUse) => CardUse;
  /**
   * SD5: facts about the attack's target and the trigger's subject for NV7 checks (`hasCondition` on the target). Plan
   * lanes-2 E8.3 (dcm-576v): `weapons` too, merged over the sheet's own ranges (`attacking`: the attacking weapon's range,
   * Surrounded, HF p.10: "an attack with a Melee weapon"); a creature's `areas` (dcm-753y) ride on `target` / `subject`.
   */
  extraFacts?: Pick<NonNullable<ActorState["facts"]>, "target" | "subject" | "weapons">;
  /**
   * DA12 (dcm-d95): the stored count of a `rolledFirst` use. Absent, the run takes up to MAX_CARD_TARGETS and
   * `resolveFeatureUse` holds the use to the stored roll (`spendTargetCount`) before anything is written.
   */
  rolledTargetCount?: number;
  /**
   * DA12 (Charge): the caller makes the use's `intoMelee` move itself (convex/featurePrompts.ts `charge`). A use with such
   * a move is refused (INVALID) without it, so `combatFeatures.useFeature` can't run Charge without its square.
   */
  serverMove?: boolean;
  /**
   * Plan lanes E8 (dcm-2z2): the Beastbound companion's numbers (convex/lib/companion.ts `companionFor` +
   * `companionNumbers`); its die is the `sidesOf: "companion"` dice size. Absent: the entry's level-1 d6.
   */
  companion?: CompanionNumbers | null;
}): FeaturePick {
  const { sheet, featureId } = input;
  const held = ownedHere(sheet, input.campaign);
  const feature = held.find((f) => f.featureId === featureId);
  if (feature === undefined) throw appError("FEATURE_NOT_OWNED");
  if (feature.usage === "outOfCombat" || feature.usage === "narrative") throw appError("FEATURE_NOT_COMBAT");
  const entry = featureEffect(featureId);
  if (entry === undefined) throw appError("FEATURE_NOT_COMBAT", `${feature.name} isn't automated on the map yet.`);
  const holdings = holdingsFor(sheet, held, entry.owner);
  let upgraded = applyUpgrades(entry, holdings);
  // DA19 (DA9 follow-up 3): only the uses the feature holds (`OwnedFeature.uses`: under an Evolved form, the uses keyed by
  // its base form); any other is refused like a use the entry lacks.
  const card = asCardEffect(upgraded);
  const picked = pickUse({ ...card, uses: card.uses.filter((u) => feature.uses === undefined || feature.uses.includes(u.id)) }, input.useId);
  if (picked === undefined) throw appError("INVALID", `${feature.name} has no "${input.useId ?? ""}".`);
  if (picked.activation.kind === "passive") throw appError("FEATURE_NOT_COMBAT", `${picked.name} is always on.`);
  // Plan lanes-2 E8 (dcm-me3): the sheet's own numbers (Tide tokens, class dice, Armor Score, thresholds) are written into
  // the use as fixed numbers, until run.ts reads them from the actor (dcm-rs1z).
  const numbers = sheetNumbers(sheet, scopeOf(input.campaign));
  const binds = bindSheetNumbers(picked, numbers) !== picked;
  // Plan lanes-2 E8.3 (dcm-atiu): the costs `featurePrompts.rollCount` paid at the roll are not paid again by the use.
  const rollPaid = withoutRollCosts(picked) !== picked;
  const transform =
    input.transform || binds || rollPaid
      ? (u: CardUse) => {
          const t = input.transform ? input.transform(u) : u;
          const b = binds ? bindSheetNumbers(t, numbers) : t;
          return rollPaid ? withoutRollCosts(b) : b;
        }
      : undefined;
  // SD5: the transformed use runs as the entry's, upgrades already applied (only their die sizes are kept, which
  // `runFeature` reads for delegated held dice and which apply twice harmlessly).
  const runEntry: FeatureEffect = transform
    ? {
        ...upgraded,
        uses: upgraded.uses.map((u) => (u.id === picked.id ? transform(u) : u)),
        upgrades: (entry.upgrades ?? []).filter((u) => u.patch.dieSides !== undefined).map((u) => ({ ...u, patch: { dieSides: u.patch.dieSides! } })),
      }
    : entry;
  if (transform) upgraded = runEntry;
  const use = transform ? transform(picked) : picked;
  if (hasServerMove(use) && input.serverMove !== true) throw appError("INVALID", `${use.name} needs the square to move to (featurePrompts.charge).`);
  const rolledCount = isRolledFirst(use) ? { rolledTargetCount: input.rolledTargetCount ?? MAX_CARD_TARGETS } : {};
  const delegates = delegatedKeys(use).length > 0;
  const others: OtherSheet[] = delegates ? input.party.map((m) => ({ characterId: m.key, sheet: m.sheet })) : [];
  const facts = withExtraFacts({ ...factsOf(sheet, input.rollUsedExperience), ...ownFacts(sheet, featureId) }, input.extraFacts);

  const runner = (context: RunContext) => {
    const { useId: _useId, limitKeys: _limitKeys, delegate: _delegate, ...rest } = context;
    void _useId;
    void _limitKeys;
    void _delegate;
    const targetIds = (context.targets ?? []).map((t) => t.id);
    const actor = { ...rest.actor, featureUses: rest.actor.featureUses.map((u) => ({ ...u, key: expandedLimitKey(u.key, targetIds) })) };
    const result = runFeature(runEntry, use.id, {
      ...rest,
      ...rolledCount,
      actor,
      sheet,
      others,
      holdings,
      times: input.times,
      ...(input.dieIndexes ? { dieIndexes: input.dieIndexes } : {}),
      // dcm-qbn: the held dice the player picked to spend (Prayer Dice); the runner spends these first.
      ...(input.heldDicePicks ? { heldDicePicks: input.heldDicePicks } : {}),
    });
    if (!result.ok) return result;
    const short = (key: string) => storedLimitKey(key, targetIds);
    const plan: RunPlan = {
      ...result.plan,
      actor: { ...result.plan.actor, featureUses: result.plan.actor.featureUses.map((u) => ({ ...u, key: short(u.key) })) },
      limit: result.plan.limit ? { ...result.plan.limit, key: short(result.plan.limit.key) } : null,
    };
    const delegated: Delegated = { ...(result.sheet ? { sheet: result.sheet } : {}), others: result.others, rolls: result.rolls };
    return { ok: true as const, plan, delegated };
  };

  return {
    effect: asCardEffect(upgraded),
    use,
    name: feature.name,
    limitKey: `feat:${featureId}`,
    featureId,
    feature,
    party: input.party,
    times: input.times,
    run: runner,
    refusal: featureRefusal,
    actor: (base) => ({ ...base, ...actorFill(sheet, numbers, input.companion), facts }),
  };
}

/**
 * Plan lanes-2 E8.3 (dcm-pqbo, dcm-2z2, dcm-b9hc): what a feature's actor carries beyond the card path's `cardActor`:
 * Favor, Focus, held dice and class dice sizes (`actorExtras`), the Beastbound companion's die (`dieSides.companion`, CB
 * p.40: "your companion's damage die is a d6", stepped by Vicious) and damage type ("Choose whether they deal physical or
 * magic damage"), and the sheet's own numbers run.ts reads since E3 round 2 (`tideTokens`, `classDice`, `stats`). The
 * numbers are also bound into the use (`bindSheetNumbers`), which is harmless twice.
 */
export function actorFill(sheet: CharacterSheet, numbers: SheetNumbers, companion?: CompanionNumbers | null): Partial<ActorState> {
  const extras = actorExtras(sheet);
  // NumberEnv's dice sizes take `companion` (plan lanes V); the actor carries them on to the runner's env.
  const dieSides: NumberEnv["dieSides"] = { ...extras.dieSides, ...(companion ? { companion: companion.dieSides } : {}) };
  return {
    ...extras,
    dieSides,
    tideTokens: numbers.tideTokens,
    classDice: numbers.classDice,
    stats: { ...numbers.stats },
    ...(companion ? { companionDamageType: companion.damageType } : {}),
  };
}

/**
 * The actor's facts with the caller's extra facts (dcm-576v): `target` / `subject` replace, `weapons` merge over the
 * sheet's primary / secondary ranges so the attacking weapon (`attacking`) adds to them.
 */
export function withExtraFacts(
  own: NonNullable<ActorState["facts"]>,
  extra: Pick<NonNullable<ActorState["facts"]>, "target" | "subject" | "weapons"> | undefined,
): NonNullable<ActorState["facts"]> {
  if (extra === undefined) return own;
  const { weapons, ...rest } = extra;
  return { ...own, ...rest, ...(weapons ? { weapons: { ...own.weapons, ...weapons } } : {}) };
}

/**
 * Plan lanes-2 E8.3 (dcm-753y; Circle of Power, HF p.16: "you or an ally within the circle"): a creature's facts with the
 * live map areas its token stands in (`CreatureFacts.areas`, read by `inArea` with `who: "subject" | "target"`). For the
 * callers that build subject / target facts (convex/lib/combatActions.ts `creatureFacts`).
 */
export async function withCreatureAreas<F extends object>(
  ctx: QueryCtx,
  scene: AttackScene,
  token: Doc<"combatTokens">,
  facts: F,
  characterId: Id<"characters"> | null = null,
): Promise<F & { areas: { featureId: string; own: boolean }[] }> {
  const areas = areaFactsFor(await activeAreasOnMap(ctx, scene.scene.map._id), scene.scene.tokens, token, characterId);
  return { ...facts, areas };
}

// ---------------------------------------------------------------- resolving

export type FeatureUseRequest = {
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  sheet: CharacterSheet;
  scene: AttackScene | null;
  pick: FeaturePick;
  targetTokenIds: readonly string[];
  choices: readonly CardChoice[];
  roll: CardRoll;
};

/** Where a feature use's dice wait for its choice (convex/lib/cardChoices.ts kept dice). */
export const featureSlot = (req: FeatureUseRequest): DiceSlot => ({ campaignId: req.campaign._id, characterId: req.character._id, cardId: req.pick.featureId, useId: req.pick.use.id });

/** Applies the GM's Fear change of a use; returns what changed. */
async function applyFear(ctx: MutationCtx, campaignId: Id<"campaigns">, delta: number): Promise<number> {
  if (delta > 0) return (await gainFear(ctx, campaignId, delta)).gained;
  if (delta < 0) {
    const state = await campaignFearState(ctx, campaignId);
    const lost = Math.min(state.fear, -delta);
    if (lost > 0) await spendFear(ctx, campaignId, lost, "feature");
    return -lost;
  }
  return 0;
}

/**
 * The D5 feed line with the die the held dice really got (SD1 follow-up: Rally through `runFeature` takes Epic Poetry's
 * d10, CB p.29, while D5's own line names d6 / d8).
 */
export function delegateLine(summary: string, before: CharacterSheet, after: CharacterSheet | undefined): string {
  if (after === undefined) return summary;
  const old = new Set(before.heldDice.map((d) => d.id));
  const fresh = after.heldDice.find((d) => !old.has(d.id));
  return fresh ? summary.replace(/\(d\d+\)/, `(d${fresh.sides})`) : summary;
}

/** DA12: whether a card prompt is the plan's server move (`server: true`, Charge's `intoMelee`), which the server makes. */
function serverMovePrompt(plan: RunPlan, p: { kind: string; text: string }): boolean {
  return p.kind === "move" && plan.steps.some((s) => s.kind === "prompt" && s.prompt === "move" && s.server === true && s.text === p.text);
}

/** The words of a feature's own plan steps the card rows don't say: D5 lines, Favor / Focus, Help dice, areas. */
function notesOf(plan: RunPlan, built: BuiltRun, before: CharacterSheet, delegated: Delegated | undefined, names: ReadonlyMap<string, string>): string[] {
  const name = (id: string) => {
    if (id === built.context.actor.id) return "you";
    const c = built.creatures.get(id);
    return c?.kind === "pc" ? c.sheet.name : c?.kind === "enemy" ? c.instance.label : "an ally";
  };
  const out: string[] = [];
  for (const s of plan.steps) {
    if (s.kind === "delegate" && s.summary) out.push(renameIds(delegateLine(s.summary, before, delegated?.sheet), names));
    else if (s.kind === "resource") out.push(`${s.resource === "favor" ? "Favor" : "Focus"} ${s.before} → ${s.after}`);
    else if (s.kind === "help") out.push(`${name(s.targetId)}: a d${s.die} Help die${s.free ? " (no Hope)" : ""}`);
    else if (s.kind === "area") out.push(`an area (${s.area.radius}) to place on the map`);
  }
  return out;
}

/** The id -> name of the creatures the use's delegated D5 features ran on (dcm-53f). */
export function delegatedTargetNames(plan: RunPlan, built: BuiltRun): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of plan.steps) {
    const id = s.kind === "delegate" ? s.params.targetId : undefined;
    if (id === undefined) continue;
    const c = built.creatures.get(id);
    const name = c?.kind === "enemy" ? c.instance.label : c?.kind === "pc" ? c.sheet.name : undefined;
    if (name !== undefined) out.set(id, name);
  }
  return out;
}

/** `text` with each creature id replaced by its name. */
export function renameIds(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [id, name] of names) out = out.split(id).join(name);
  return out;
}

/**
 * dcm-53f (Hex, HF p.16): a D5 feature that names its target in words gets the creature's id from the delegate
 * (src/lib/domain/feature-effects/delegate.ts); the sheet's `classState` keeps the creature's name instead, so
 * `classState.hexes` holds the instance's label ("Bandit 2"), as the drawer and the sheet show it. A Hex on a creature
 * already Hexed by name is refused (INVALID), as D5 refuses a typed name it already holds.
 */
export function nameDelegatedTargets(sheet: CharacterSheet, names: ReadonlyMap<string, string>): CharacterSheet {
  if (names.size === 0) return sheet;
  let json = JSON.stringify(sheet.classState);
  for (const [id, name] of names) json = json.split(JSON.stringify(id)).join(JSON.stringify(name));
  const classState = JSON.parse(json) as CharacterSheet["classState"];
  const hexes = classState.hexes ?? [];
  const twice = hexes.find((h, i) => hexes.indexOf(h) !== i);
  if (twice !== undefined) throw appError("INVALID", `${twice} is already Hexed.`);
  return { ...sheet, classState };
}

/** Whether a manual step is a `downtime` grant for the next rest (Eloquent's third option, CB p.29). */
function isExtraMoveGrant(step: Step | undefined): boolean {
  return step?.kind === "downtime" && step.op === "extraMove" && step.at === "nextRest";
}

/** dcm-bxp.99.19.2: how many extra downtime moves each recipient (runner id) gets for their next rest. */
export function extraMoveGrantsOf(plan: RunPlan): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of plan.steps) {
    if (s.kind !== "prompt" || s.prompt !== "manual" || !isExtraMoveGrant(s.step)) continue;
    for (const id of s.targetIds) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** Whether a card prompt is a granted downtime move the server records (no manual row for the table). */
function extraMovePrompt(plan: RunPlan, p: { kind: string; text: string }): boolean {
  return p.kind === "manual" && plan.steps.some((s) => s.kind === "prompt" && s.prompt === "manual" && isExtraMoveGrant(s.step) && s.text === p.text);
}

// ---------------------------------------------------------------- plan lanes-2, E8: steps the feature runner writes

/** A PC's name on the map, or null. */
function pcName(built: BuiltRun, id: string): string | null {
  const c = built.creatures.get(id);
  return c?.kind === "pc" ? c.sheet.name : null;
}

/** The labels of the lasting effects a creature carries now: an adversary's instance effects, a PC's sheet effects. */
export function effectLabelsOn(built: BuiltRun, id: string, actorToken: string, sheet: CharacterSheet): string[] {
  const label = (e: { text: string }) => e.text.split("; ")[0] ?? "";
  if (id === actorToken) return sheet.effects.map(label);
  const c = built.creatures.get(id);
  if (c?.kind === "enemy") return (c.instance.effects ?? []).map((e) => e.label);
  if (c?.kind === "pc") return c.sheet.effects.map(label);
  return [];
}

/**
 * dcm-kkx (Blight Seed, HF p.9: "This effect can't stack"): a `stacking: "refuse"` effect step on a creature that already
 * carries an effect of that label becomes a note for the table instead (as run.ts does with `effectsOn`, which the
 * server's card path doesn't fill). Other plans come back unchanged.
 */
export function refuseStacked(plan: RunPlan, labelsOf: (id: string) => readonly string[]): RunPlan {
  if (!plan.steps.some((s) => s.kind === "effect" && s.stacking === "refuse")) return plan;
  const steps = plan.steps.map((s): RunPlan["steps"][number] =>
    s.kind === "effect" && s.stacking === "refuse" && labelsOf(s.targetId).includes(s.label)
      ? { kind: "prompt", prompt: "manual", text: `${s.label}: already on them (it can't stack)`, targetIds: [s.targetId] }
      : s,
  );
  return { ...plan, steps };
}

/** What an `inventory` gift step gives one PC (CB p.43, dcm-vf7i): handfuls of gold, or an item by name. */
export type Gift = { kind: "gold"; handfuls: number } | { kind: "item"; name: string };

/** The gift of a manual step, or null: `giveGold` (fixed amount, default 1 handful), `giveItem` with its `text`. */
function giftOf(step: Step | undefined): Gift | null {
  if (step?.kind !== "inventory") return null;
  if (step.op === "giveGold") {
    const amount = step.amount === undefined ? 1 : step.amount.kind === "fixed" ? step.amount.value : null;
    return amount !== null && amount > 0 ? { kind: "gold", handfuls: amount } : null;
  }
  // An item the step doesn't name is the GM's pick ("a mundane object that the situation requires"): the table's.
  if (step.op === "giveItem" && step.text !== undefined && step.text.trim() !== "") return { kind: "item", name: step.text.trim().slice(0, 200) };
  return null;
}

/**
 * The gift of a plan `inventory` step (run.ts's own step; plan lanes-2 E8.4, dcm-h1y9): `giveGold` its handfuls,
 * `giveItem` its named item, `"gmPick"` for an item it doesn't name ("a mundane object that the situation requires", CB
 * p.43: the GM's pick, a note). Null for any other step (`take`, `takeGold`, `damageWeapon` are adversary-side).
 */
function planGiftOf(step: RunPlan["steps"][number]): Gift | "gmPick" | null {
  if (step.kind !== "inventory") return null;
  if (step.op === "giveGold") {
    const handfuls = Math.trunc(step.amount ?? 1);
    return handfuls > 0 ? { kind: "gold", handfuls } : null;
  }
  if (step.op !== "giveItem") return null;
  const name = step.text?.trim() ?? "";
  return name === "" ? "gmPick" : { kind: "item", name: name.slice(0, 200) };
}

/**
 * The gifts of a plan's `inventory` steps (`giveGold` / `giveItem`) whose recipients are PCs (`isPc`): run.ts's own plan
 * steps (dcm-h1y9: Contacts Everywhere's supply as data) and its manual fallback prompts. By recipient, the prompt texts
 * they answer, and a note per recipient (an unnamed item: the GM's pick).
 */
export function giftsOf(plan: RunPlan, isPc: (id: string) => boolean): { byTarget: Map<string, Gift[]>; texts: Set<string>; notes: (name: (id: string) => string) => string[] } {
  const byTarget = new Map<string, Gift[]>();
  const texts = new Set<string>();
  const gmPicks: string[] = [];
  for (const s of plan.steps) {
    const planned = planGiftOf(s);
    if (planned !== null && s.kind === "inventory") {
      if (!isPc(s.targetId)) continue;
      if (planned === "gmPick") gmPicks.push(s.targetId);
      else byTarget.set(s.targetId, [...(byTarget.get(s.targetId) ?? []), planned]);
      continue;
    }
    if (s.kind !== "prompt" || s.prompt !== "manual") continue;
    const gift = giftOf(s.step);
    if (gift === null || s.targetIds.length === 0 || !s.targetIds.every(isPc)) continue;
    texts.add(s.text);
    for (const id of s.targetIds) byTarget.set(id, [...(byTarget.get(id) ?? []), gift]);
  }
  const words = (g: Gift) => (g.kind === "gold" ? `${g.handfuls} ${g.handfuls === 1 ? "handful" : "handfuls"} of gold` : g.name);
  return {
    byTarget,
    texts,
    notes: (name) => [...[...byTarget].map(([id, list]) => `${name(id)}: ${list.map(words).join(", ")}`), ...gmPicks.map((id) => `${name(id)}: an item the GM picks`)],
  };
}

/**
 * Plan lanes-2 E8.4 (dcm-lztq, user 2026-10-31: a sheet effect records its caster): the effects this use wrote on a
 * sheet (`after`'s effects of the feature that `before` did not hold) carry the using PC's character id as `casterId`
 * (two Skykin's Eye of the Storm, CB heritage: each ends with its own caster). Effects already there are left as they
 * are (another PC's cast of the same feature keeps its caster). The same sheet when nothing is new.
 */
export function withFeatureCaster(before: CharacterSheet, after: CharacterSheet, featureId: string, casterId: Id<"characters">): CharacterSheet {
  const keyOf = (e: CharacterSheet["effects"][number]) => `${e.id}|${e.source}|${e.text}`;
  const old = new Set(before.effects.map(keyOf));
  let touched = false;
  const effects = after.effects.map((e) => {
    if (old.has(keyOf(e)) || e.casterId !== undefined || !ownsEffect(e, featureId)) return e;
    touched = true;
    return { ...e, casterId };
  });
  return touched ? { ...after, effects } : after;
}

/** The most handfuls of gold the sheet can still take before it would need a second chest (CB p.104), up to `cap`. */
export function goldRoom(gold: CharacterSheet["gold"], cap: number): number {
  let lo = 0;
  let hi = Math.max(0, cap);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (addGold(gold, "handfuls", mid) === null) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}

/**
 * The sheet with the gifts: gold through `addGold` (CB p.104), items appended. INVALID past 60 items. Gold past a second
 * chest is INVALID too, unless `overflow` is given: then the sheet takes what fits and `overflow.excess` counts the
 * handfuls left over (plan lanes-2 E8.3, dcm-i5e1: `passExcessGold` offers them to a party member nearby).
 */
export function giveTo(sheet: CharacterSheet, gifts: readonly Gift[], overflow?: { excess: number }): CharacterSheet {
  let out = sheet;
  for (const g of gifts) {
    if (g.kind === "gold") {
      const gold = addGold(out.gold, "handfuls", g.handfuls);
      if (gold === null) {
        if (overflow === undefined) throw appError("INVALID", `${out.name} can't carry more gold: store some first (CB p.104).`);
        const fits = goldRoom(out.gold, g.handfuls);
        out = { ...out, gold: addGold(out.gold, "handfuls", fits) ?? out.gold };
        overflow.excess += g.handfuls - fits;
        continue;
      }
      out = { ...out, gold };
    } else {
      if (out.inventory.length >= 60) throw appError("INVALID", `${out.name}'s inventory is full.`);
      out = { ...out, inventory: [...out.inventory, { id: crypto.randomUUID(), name: g.name }] };
    }
  }
  return out;
}

/** The choice id that names who takes gold past a recipient's cap (a PC token id, or `"drop"`). */
export const GIFT_EXCESS_TO = "giftExcessTo";

/** One party member who could take a recipient's excess gold: their token, distance and the handfuls they still fit. */
export type ExcessCandidate = { id: string; name: string; distance: number; room: number };

/**
 * dcm-i5e1 (user answer 2026-10-31; CB p.104: "If you ever have more than 1 chest, you'll need to store some of your gold
 * before you can take more"): who takes the handfuls a gift couldn't give. Candidates are the other party members within
 * Close of the recipient with room. The player's pick (`giftExcessTo`: a candidate's token id, or `"drop"`) decides;
 * without one the nearest candidate with room takes it (the offer's default). What nobody takes is dropped. A pick that is
 * no candidate is COMBAT_TARGET_INVALID.
 */
export function passExcessGold(excess: number, candidates: readonly ExcessCandidate[], picked: string | undefined): { to: ExcessCandidate | null; given: number; dropped: number } {
  if (excess <= 0) return { to: null, given: 0, dropped: 0 };
  if (picked === "drop") return { to: null, given: 0, dropped: excess };
  const open = candidates.filter((c) => c.room > 0);
  let to: ExcessCandidate | null;
  if (picked !== undefined) {
    to = open.find((c) => c.id === picked) ?? null;
    if (to === null) throw appError("COMBAT_TARGET_INVALID", "Pick a party member within Close range who can carry more gold.");
  } else to = [...open].sort((a, b) => a.distance - b.distance)[0] ?? null;
  const given = to === null ? 0 : Math.min(excess, to.room);
  return { to, given, dropped: excess - given };
}

/** The `giftExcessTo` choice's value, or undefined. INVALID for a value that isn't a short text. */
function excessPick(choices: readonly CardChoice[]): string | undefined {
  const c = choices.find((x) => x.id === GIFT_EXCESS_TO);
  if (c === undefined) return undefined;
  if (typeof c.value !== "string" || c.value.length === 0 || c.value.length > 64) throw appError("INVALID", `${GIFT_EXCESS_TO} needs a token id or "drop".`);
  return c.value;
}

/** A `setStance` step as run.ts leaves it (V's manual fallback, or E3's plan step), for the actor. */
function stanceStepOf(s: RunPlan["steps"][number], actorToken: string): { stance?: string; choice?: string } | null {
  const loose = s as { kind: string; targetId?: string; stance?: string };
  if (loose.kind === "setStance") return loose.targetId === actorToken && loose.stance !== undefined ? { stance: loose.stance } : null;
  if (s.kind === "prompt" && s.prompt === "manual" && s.step?.kind === "setStance" && s.targetIds.includes(actorToken)) {
    return { ...(s.step.stance !== undefined ? { stance: s.step.stance } : {}), ...(s.step.choice !== undefined ? { choice: s.step.choice } : {}) };
  }
  return null;
}

/**
 * dcm-awh (Stance Fighter, HF p.12: "You can spend a Focus to shift into a martial stance"): the stances the plan shifts
 * the actor into, in order: the step's `stance`, or the option picked in its `choice` step. A `setStance` step without a
 * stance or a pick is INVALID (the drawer asks for it).
 */
export function stancesOf(plan: RunPlan, actorToken: string, options: Readonly<Record<string, readonly string[]>>): string[] {
  const out: string[] = [];
  for (const s of plan.steps) {
    const step = stanceStepOf(s, actorToken);
    if (step === null) continue;
    const stance = step.stance ?? (step.choice !== undefined ? options[step.choice]?.[0] : undefined);
    if (stance === undefined) throw appError("INVALID", "Pick the stance to shift into.");
    out.push(stance);
  }
  return out;
}

/** Whether a manual prompt is a `setStance` step the server makes. */
function stancePrompt(plan: RunPlan, text: string): boolean {
  return plan.steps.some((s) => s.kind === "prompt" && s.prompt === "manual" && s.step?.kind === "setStance" && s.text === text);
}

/**
 * DA13: what a use rolled by an ally adds to its write (convex/featurePrompts.ts `allyRoll`): the public row's opening
 * words ("Bryn throws Moss (Cannonball)") and other sheets the use changed outside the plan (the druid's Hope for the
 * second target), each logged in the group with its `before`.
 */
export type ResolveExtras = {
  title?: string;
  sheets?: readonly { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }[];
};

/**
 * Writes the plan in one mutation (U4) and logs one actionLog group: the public row (the roll, the damage dice and total,
 * Hit / Miss / Defeated per target, the D5 lines, the actor's `before`), a row per other character whose sheet changed
 * (an ally the use touched, a D5 feature's other sheets), a public row per manual step, and the GM row (damage, severity,
 * HP, saves, `adversaryBefore`).
 */
export async function resolveFeatureUse(
  ctx: MutationCtx,
  req: FeatureUseRequest,
  built: BuiltRun,
  outcome: { plan: RunPlan; delegated?: Delegated },
  actorId: Id<"users">,
  extras: ResolveExtras = {},
): Promise<ResolvedFeature> {
  const { campaign, character, sheet, pick } = req;
  const { delegated } = outcome;
  const actorToken = built.context.actor.id;
  // Plan lanes-2 E8 (dcm-kkx): an effect that can't stack is not given again to a creature that carries it.
  const plan = refuseStacked(outcome.plan, (id) => effectLabelsOn(built, id, actorToken, sheet));
  // DA12 (dcm-d95): a `rolledFirst` use takes the server's stored roll (refused without one or with more targets).
  const rolled = await spendTargetCount(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    sheet,
    featureId: pick.featureId,
    use: pick.use,
    targets: req.targetTokenIds.length,
    by: actorId,
    choices: built.context.choices ?? {},
  });
  // The D5 features' sheet (classState, held dice, effects) when they ran; resources come from the plan either way.
  // Plan lanes-2 E8 (dcm-4xl): the feature's own effects that end when it is used again go first.
  const again = endOnSheet(delegated?.sheet ?? built.paidSheet, { kind: "event", event: "usedAgain" }, { only: (e) => ownsEffect(e, pick.featureId) });
  const start = again.sheet;
  const unshaken: UnshakableRoll[] = [];
  const after = actorSheetAfter(start, plan, actorToken, pick.name, { out: unshaken });
  // B1 (dcm-bxp.99.19.55 (1)): the spent roll's scene mark leaves the sheet with the use (undo puts it back).
  const unmarked = rolled === null ? after : { ...after, featureUses: after.featureUses.filter((u) => !isMarkOf(u.key, rolled.requestId)) };
  // dcm-53f: a delegated D5 feature run on a creature (Hex) names it, not "Target N".
  const names = delegatedTargetNames(plan, built);
  // dcm-bxp.99.19.2 (Eloquent): extra downtime moves for the recipients' next rest.
  const grants = extraMoveGrantsOf(plan);
  let next = nameDelegatedTargets(unmarked, names);
  for (let i = 0; i < (grants.get(actorToken) ?? 0); i++) next = grantExtraMove(next);
  // Plan lanes-2 E8 (dcm-v17, dcm-4xl): a delegated D5 Unstoppable action that removed the die ends the sheet effect too.
  if (plan.steps.some((s) => s.kind === "delegate")) next = afterUnstoppable(next);
  // Plan lanes-2 E8 (dcm-vf7i): gold and named items the use gives to PCs are written (CB p.43 Contacts Everywhere).
  const gifts = giftsOf(plan, (id) => id === actorToken || built.creatures.get(id)?.kind === "pc");
  // dcm-i5e1: gold past a recipient's cap is passed on or dropped below (`passExcessGold`), never a refusal.
  const excessOf = new Map<string, { excess: number }>();
  const overflowFor = (id: string) => {
    const o = { excess: 0 };
    excessOf.set(id, o);
    return o;
  };
  next = giveTo(next, gifts.byTarget.get(actorToken) ?? [], overflowFor(actorToken));
  // Plan lanes-2 E8 (dcm-awh, dcm-4xl): a `setStance` step shifts the actor's stance (the previous one drops first).
  const stanceBefore: AdversaryBefore[] = [];
  const stanceLines: string[] = [];
  for (const stance of stancesOf(plan, actorToken, built.context.options ?? {})) {
    const shifted = await setStance(ctx, campaign._id, next, stance, (e) => effectEndsOf(e));
    if (shifted === null) throw appError("INVALID", `You can't shift into that stance (${stance}).`);
    next = shifted.sheet;
    stanceBefore.push(...shifted.before);
    stanceLines.push(...shifted.lines, `stance: ${stance}`);
  }
  // DA12: a move the server makes itself (`intoMelee`, Charge) is no prompt for the table.
  let prompts = promptsOf(plan, built).filter((p) => !serverMovePrompt(plan, p) && !extraMovePrompt(plan, p) && !(p.kind === "manual" && (gifts.texts.has(p.text) || stancePrompt(plan, p.text))));
  const notes = [
    ...(rolled !== null ? [`rolled ${rolled.count} target${rolled.count === 1 ? "" : "s"}`] : []),
    ...again.lines,
    ...notesOf(plan, built, sheet, delegated, names),
    ...unshaken.map(unshakableText),
    ...stanceLines,
    ...gifts.notes((id) => (id === actorToken ? "you" : (pcName(built, id) ?? "an ally"))),
  ];
  for (const [id, n] of grants) {
    const c = built.creatures.get(id);
    const who = id === actorToken ? "you" : c?.kind === "pc" ? c.sheet.name : null;
    if (who !== null) notes.push(`${who}: ${n === 1 ? "an additional downtime move" : `${n} additional downtime moves`} at the next rest`);
  }
  // DA13 (CB p.33 Cannonball): a use rolled by an ally sends the roll to the picked ally's drawer.
  const allyRoll = plan.steps.find((s) => s.kind === "prompt" && s.prompt === "allyRoll");
  const roller = allyRoll?.kind === "prompt" ? built.creatures.get(allyRoll.targetIds[0] ?? "") : undefined;
  if (allyRoll && (roller?.kind !== "pc" || !built.creatures.onMap)) throw appError("COMBAT_TARGET_INVALID", "Pick the ally on the map who makes the roll.");
  if (roller?.kind === "pc") notes.push(`${roller.sheet.name} makes the roll`);

  // Other characters: a D5 feature's other sheets (by the runner's key), then the plan's ally steps and tracks.
  const others = new Map<string, { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }>();
  for (const o of delegated?.others ?? []) {
    const m = pick.party.find((p) => p.key === o.characterId);
    if (m) others.set(m.character._id, { character: m.character, before: m.sheet, after: o.sheet });
  }
  for (const c of built.creatures.all) {
    if (c.kind !== "pc" || c.character._id === character._id) continue;
    const prior = others.get(c.character._id);
    const base = prior?.after ?? c.sheet;
    const changedTo = plan.creatures.find((x) => x.id === c.tokenId)?.after;
    let after = writeSheetChanges(base, plan.steps, c.tokenId, plan.cardId, pick.name, plan.exclusive, false);
    if (changedTo) after = { ...after, hp: Math.min(c.sheet.hpMax, changedTo.hp), stress: Math.min(c.sheet.stressMax, changedTo.stress), armorMarked: Math.max(0, changedTo.armor ?? base.armorMarked) };
    // DA10: an Unshakable ally rolls on the Stress the use marks on them (CB p.59).
    const u = unshakePlan(base, after, plan, c.tokenId, false);
    if (u.roll) notes.push(`${c.sheet.name}: ${unshakableText(u.roll)}`);
    after = u.sheet;
    for (let i = 0; i < (grants.get(c.tokenId) ?? 0); i++) after = grantExtraMove(after);
    after = giveTo(after, gifts.byTarget.get(c.tokenId) ?? [], overflowFor(c.tokenId));
    others.set(c.character._id, { character: c.character, before: prior?.before ?? c.sheet, after });
  }
  // dcm-i5e1: each recipient's excess gold goes to a party member within Close with room, else it is dropped.
  const pickedExcess = excessPick(req.choices);
  for (const [id, { excess }] of excessOf) {
    if (excess <= 0) continue;
    const from = id === actorToken ? sheet.name : (pcName(built, id) ?? "an ally");
    const candidates: (ExcessCandidate & { characterId: Id<"characters"> | null })[] = [];
    const fromToken = built.creatures.onMap ? built.creatures.scene.scene.tokens.find((t) => t._id === id) : undefined;
    if (fromToken !== undefined) {
      for (const t of built.creatures.scene.scene.tokens) {
        if (t._id === id || t.side !== "pc" || t.ref.kind !== "pc" || !rangeCheck(fromToken, t, "close").inRange) continue;
        const holder = t._id === actorToken ? null : await built.creatures.resolve(t._id).catch(() => null);
        const holderSheet = t._id === actorToken ? next : holder?.kind === "pc" ? (others.get(holder.character._id)?.after ?? holder.sheet) : null;
        if (holderSheet === null) continue;
        const characterId = holder?.kind === "pc" ? holder.character._id : null;
        candidates.push({ id: t._id, name: holderSheet.name, distance: tokenDistance(fromToken, t), room: goldRoom(holderSheet.gold, excess), characterId });
      }
    }
    const passed = passExcessGold(excess, candidates, pickedExcess);
    const to = passed.to === null ? undefined : candidates.find((c) => c.id === passed.to!.id);
    if (to !== undefined && passed.given > 0) {
      if (to.characterId === null) next = giveTo(next, [{ kind: "gold", handfuls: passed.given }]);
      else {
        const o = others.get(to.characterId);
        const holder = built.creatures.get(to.id);
        if (o) others.set(to.characterId, { ...o, after: giveTo(o.after, [{ kind: "gold", handfuls: passed.given }]) });
        else if (holder?.kind === "pc") others.set(to.characterId, { character: holder.character, before: holder.sheet, after: giveTo(holder.sheet, [{ kind: "gold", handfuls: passed.given }]) });
      }
      notes.push(`${from} can't carry ${passed.given} handful${passed.given === 1 ? "" : "s"} of gold: ${to.name} takes it`);
    }
    if (passed.dropped > 0) notes.push(`${from} can't carry ${passed.dropped} handful${passed.dropped === 1 ? "" : "s"} of gold: dropped (CB p.104)`);
  }

  // dcm-lztq: the effects this use wrote record the PC who used it.
  next = withFeatureCaster(sheet, next, pick.featureId, character._id);
  for (const [id, o] of others) others.set(id, { ...o, after: withFeatureCaster(o.before, o.after, pick.featureId, character._id) });

  const writes = instanceWrites(plan, built.creatures, pick.name);
  await writeInstances(ctx, writes);
  const fearDelta = await applyFear(ctx, campaign._id, plan.gmFearDelta);
  // dcm-z9rz.23: the Hope the use paid (its Experiences and its costs, even one the roll's own Hope paid) counts as spent.
  const hopePaid = Math.max(0, sheet.hope - built.paidSheet.hope) + planHopePaid(plan, actorToken, actorToken);
  const sheetChanged = changed(sheet, next) || hopePaid > 0;
  noteHopeSpent(ctx, character._id, hopePaid);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  const allyRows = [...others.values()].filter((o) => changed(o.before, o.after));
  for (const a of allyRows) await saveSheet(ctx, a.character._id, a.after);
  const extraRows = (extras.sheets ?? []).filter((o) => changed(o.before, o.after));
  for (const a of extraRows) await saveSheet(ctx, a.character._id, a.after);

  const groupId = newGroupId();
  const damage = damageRolls(plan);
  const { parts, outcomes } = publicTargets(plan, built, writes);
  const useName = pick.use.name !== pick.name ? ` (${pick.use.name})` : "";
  const times = pick.times;
  const rollPart = plan.roll ? `: ${rollText(pick.use, plan.roll.record, req.roll.trait)}` : "";
  const damagePart = damage.length > 0 ? `; ${plan.roll?.critical ? "critical " : ""}damage ${damage.map((d) => d.text).join(" + ")}` : "";
  const targetPart = parts.length > 0 ? ` → ${parts.join(", ")}` : "";
  const notePart = notes.length > 0 ? ` (${notes.join("; ")})` : "";
  const d5Roll = delegated?.rolls[0];
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "combat",
    visibility: "public",
    summary: `${extras.title ?? `${sheet.name} uses ${pick.name}${useName}`}${times > 1 ? ` ×${times}` : ""}${rollPart}${damagePart}${targetPart}${notePart}`.slice(0, 1000),
    ...(plan.roll ? { roll: plan.roll.record } : d5Roll ? { roll: d5Roll } : {}),
    groupId,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(fearDelta !== 0 ? { fearDelta } : {}),
    undoable: true,
  });
  for (const a of [...allyRows, ...extraRows]) {
    await logAction(ctx, { campaignId: campaign._id, characterId: a.character._id, actorId, kind: "combat", visibility: "public", summary: `${a.before.name}: ${pick.name} from ${sheet.name}`, groupId, before: a.before, undoable: true });
  }
  if (roller?.kind === "pc") {
    await openAllyRoll(ctx, {
      campaignId: campaign._id,
      mapId: built.creatures.scene.map._id,
      createdBy: actorId,
      payload: { characterId: character._id, featureId: pick.featureId, useId: plan.useId, rollerCharacterId: roller.character._id, rollerTokenId: roller.tokenId, groupId, entryId },
    });
  }
  for (const p of prompts.filter((x) => x.kind === "manual")) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId, kind: "feature", visibility: "public", summary: `${sheet.name} used ${pick.name}: ${p.text}`, groupId, undoable: true });
  }
  const lines = gmLines(plan, built, writes);
  if (lines.length > 0 || writes.length > 0 || stanceBefore.length > 0) {
    await logAction(ctx, {
      campaignId: campaign._id,
      actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${sheet.name} · ${pick.name} → ${(lines.length > 0 ? lines : stanceLines).join("; ")}`,
      ...(damage[0] ? { roll: damage[0].roll } : {}),
      groupId,
      ...(writes.length > 0 || stanceBefore.length > 0 ? { adversaryBefore: [...writes.map((w) => w.before), ...stanceBefore] } : {}),
      undoable: true,
    });
  }
  if (plan.roll && countsAsActionRoll(plan.roll.record, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: plan.roll.record.outcome, actorId });
  }
  if (built.creatures.onMap) {
    const hitTokens = await openCardHits(ctx, { plan, built, campaignId: campaign._id, groupId, actorId, attacker: { characterId: character._id, label: sheet.name, cardId: plan.cardId, feature: pick.name } });
    prompts = prompts.filter((p) => !(p.kind === "pcDamage" && p.tokenIds.every((t) => hitTokens.has(t))));
  }
  await dropDice(ctx, featureSlot(req));
  return {
    status: "resolved",
    entryId,
    featureId: pick.featureId,
    useId: plan.useId,
    roll: plan.roll?.record ?? d5Roll ?? null,
    damage: damage.map((d) => d.roll),
    success: plan.success,
    targets: outcomes,
    fearDelta,
    prompts,
    notes,
  };
}
