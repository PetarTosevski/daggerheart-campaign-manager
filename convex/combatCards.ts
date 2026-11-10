import { ConvexError, v } from "convex/values";

import { countsAsActionRoll } from "../src/lib/domain/countdowns/advanced";
import { rangeCheck } from "../src/lib/domain/combat-actions/index";
import { appError } from "../src/lib/errors/app-error";
import { getDomainCard } from "../src/lib/srd/index";
import type { CardUse } from "../src/lib/domain/card-effects/types";
import type { EndRoll, EndSeverity } from "../src/lib/domain/characters/expiry";
import type { RollRecord } from "../src/lib/domain/duality";
import type { TraitId } from "../src/lib/srd/types";
import type { RollFacts } from "../src/lib/domain/adversary-actions/index";
import type { CharacterSheet, Effect } from "../src/lib/validation/characters";
import { tickArmedCountdowns } from "./countdownRolls";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { attachResultPanel, logAction, newGroupId } from "./lib/actionLog";
import { cardChoicesValidator, cardRollValidator, dropDice, keepDice, keptDice, parseChoices, type CardChoice, type CardRoll, type DiceSlot } from "./lib/cardChoices";
import { writeHandHidden } from "./lib/cardHand";
import {
  adversaryBefore,
  applyUseEnds,
  damageRolls,
  effectEndsOf,
  endAdversaryConditionsForCaster,
  endAdversaryConditionsOnRoll,
  endForCasterOnInstances,
  endOnDefeat,
  endOnSheet,
  endSharedGrants,
  endSpellCast,
  gmLines,
  isSpell,
  instanceWrites,
  lastHpNotes,
  needsChoiceValidator,
  openCardHits,
  pendingCardValidator,
  promptsOf,
  publicTargets,
  resolvedCardValidator,
  resistanceNotes,
  rollText,
  srdUses,
  targetDamageOf,
  resultPanelOf,
  writeInstances,
  type InstanceWrite,
  type ResolvedCard,
} from "./lib/cardRows";
import { actorSheetAfter, buildRun, conditionMarkerOf, difficultyOf, isFeatureUseId, pickCard, planHandoff, planHopePaid, replaying, ruleNotesOfUse, runCard, writeSheetChanges, type BuiltRun, type CardPick, type HostRoll, type RunOutcome, type UsePick } from "./lib/cardRunner";
import { assertCanAct, loadCharacter, noteHopeSpent, readSheet, saveSheet } from "./lib/characterSheet";
import {
  attackScene,
  autoRiders,
  changeFear,
  damagePrompts,
  dealMinions,
  defaultOnRiders,
  emptyFolds,
  endRollFor,
  foldInto,
  pickRiders,
  recorder,
  resultHolds,
  rollOnly,
  rollTargetHolds,
  runRiderPart,
  weaponIn,
  withDieBonuses,
  withHopeSides,
  type AttackScene,
  type Folds,
  type Host,
  type PickedRider,
  type RiderEnv,
  type RiderRun,
} from "./lib/combatActions";
import { outOfRangeRefusal, refusesOutOfRange } from "./combatActions";
import { uncloakAfterAttack } from "./lib/combatMovement";
import { partyMembers } from "./lib/adversaryHits";
import { forcedStandardAttack, pcRollAdversaryUses } from "./lib/adversaryActions";
import { conditionInstanceEffect, formInstanceEffect } from "./lib/adversaryFeatures";
import { openCloakPrompt } from "./lib/cloakPrompts";
import { giftsOf, giveTo, stancesOf, type Gift } from "./lib/featureRunner";
import { setStance } from "./lib/stanceDrop";
import type { InstanceEffect } from "./lib/validators/encounters";
import type { AdversaryBefore } from "./lib/validators/actionLog";
import { closeRequest, encounterRunning, loadOpenRequest, openRiderPick } from "./lib/combatRequests";
import { openRiderAllyPicks, riderHasOwnPicks } from "./lib/allyPicks";
import { rollDie } from "./lib/dice";
import { campaignFearState, gainFear, spendFear } from "./lib/fear";
import { afterPcActionRoll } from "./lib/rollAftermath";
import { postRuleNote, ruleModesOf } from "./lib/ruleModes";
import { minionPicker } from "../src/lib/domain/combat-actions/damage";
import { campaignMutation, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { fearFor } from "./lib/fearVisibility";
import { assertMayAct, useActKind } from "./lib/spotlight";
import { changed } from "./lib/rolls";
import { logUnshakable, unshakePlan, type UnshakableRoll } from "./lib/unshakable";
import { MAX_RIDERS_PER_ATTACK, riderValidator, type Rider } from "./lib/validators/combatRequests";
import type { PlanStep, RunPlan } from "../src/lib/domain/card-effects/run";
import { activeAreasOnMap, MAX_AREA_COUNT, placeAreasFromPlan } from "./lib/combatAreas";
import type { Step } from "../src/lib/domain/card-effects/types";
import { rangeFromWeapon } from "../src/lib/domain/combat-actions/index";

/**
 * Domain cards on the Combat Map (plan combat-actions, tracer CA4; docs/tasks/TASK-CA-CA4.md). Players act for a
 * character they edit (their own; the GM any): campaign wrappers with `need: "view"`, then `loadCharacter(..., "edit")`,
 * so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2).
 *
 * - `hand`: the loadout and the vault with each card's state (ready / exhausted / passive / outOfCombat), reset label,
 *   tokens and recall cost. The character's player and the GM (who sees a selected PC's cards, user answer 2026-10-22)
 *   always; another player of the campaign while the GM's switch "Players can see each other's cards" is on and the
 *   character's player has not hidden their hand (F7-H4, dcm-bxp.99.24), read only; FORBIDDEN otherwise.
 * - `handSharing`: the GM's switch and the characters whose hands are hidden (every member); `setHandHidden`: the
 *   character's player (or the GM) hides or shows that hand to the other players.
 * - `useCard`: uses a loadout card: checks, pays, rolls, applies, logs one undoable group (public: hit / miss; GM:
 *   the full resolution). A target outside the card's range turns it into a GM sanction (Q1).
 * - `sanction` (GM): approves or declines a card use waiting for the GM; `pending`: the open card sanctions (own / all).
 *
 * CA4b (docs/tasks/TASK-CA-CA4b.md): picked / ally / follow-up creatures are range-checked from the origin the card names
 * (out of range → the GM's sanction); card effects on enemies land on the instance and undo with the group; a choice
 * asked after the roll keeps the dice, so the call that answers it (or asks again) resolves with the same dice.
 *
 * Plan sheet-drawer SD5 (docs/tasks/TASK-SD-SD5.md): `useCard` takes `riders` for a card that makes a roll (Rage Up on
 * Whirlwind): the before-roll riders' costs and additions, then the card, then the riders on its result; their damage
 * changes are folded into the card's own use as numbers, their effects on creatures land after the card's damage, all in
 * the card's actionLog group. A rider that adds targets is refused on a card (INVALID; task doc follow-up).
 *
 * The reads (`hand`, `handSharing`, `pending`) live in `combatCardsReads.ts` (dcm-uh6r), so the HUD's subscriptions do
 * not load the card runner this module needs.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

/** The character the caller edits, in this campaign, with its sheet (NOT_FOUND / FORBIDDEN otherwise). */
async function editableHere(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  // Config R2: `gm` (the GM or a co-GM acting for a PC) is never refused for range.
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/** How far back the latest action roll is looked for (Second Wind's "The attack succeeded with Hope"). */
const LAST_ROLL_SCAN = 20;

async function lastRollWithHope(ctx: QueryCtx, characterId: Id<"characters">): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(LAST_ROLL_SCAN);
  const last = rows.find((r) => r.undoneAt === undefined && r.roll?.kind === "action");
  return last?.roll?.outcome === "successHope" || last?.roll?.outcome === "critical";
}

/** Hides (or shows again) a character's hand from the other players: its player, or the GM. The GM always sees it. */
export const setHandHidden = campaignMutation({
  need: "view",
  args: { characterId: v.id("characters"), hidden: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { characterId, hidden }) => {
    await editableHere(ctx, characterId);
    await writeHandHidden(ctx, ctx.campaign._id, characterId, hidden);
    return null;
  },
});

// ---------------------------------------------------------------- resolving a use

type UseRequest = {
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  sheet: CharacterSheet;
  scene: AttackScene;
  pick: CardPick;
  targetTokenIds: readonly string[];
  choices: readonly CardChoice[];
  roll: CardRoll;
  /** Plan lanes, E1 (dcm-p1r): the vault card a `loadout` `swapWithVault` step brings in (Codex-Touched, CB p.333). */
  swapWith?: string;
  /**
   * Plan lanes-2 E1.4a (dcm-tn8u): the squares `useCard` sent (`point` first, then `points`), given to the runner as
   * `CardRequest.points` when the use's targets name points (`usesPoints`: Unleash Hellfire's bursts, an `aroundPoint` area).
   */
  squares?: readonly Square[];
};

/** Whether a use's targets are measured from picked squares (`TargetSpec.points`, an `aroundPoint` area, `origin: "point"`). */
export function usesPoints(use: CardUse): boolean {
  const t = use.targets;
  if (t === undefined || t.side === "trigger") return false;
  const spec = t as { points?: unknown; area?: string; origin?: string };
  return spec.points !== undefined || spec.area === "aroundPoint" || spec.origin === "point";
}

/** Where this use's dice are kept while it waits for a choice (convex/lib/cardChoices.ts). */
const slotOf = (req: UseRequest): DiceSlot => ({ campaignId: req.campaign._id, characterId: req.character._id, cardId: req.pick.effect.cardId, useId: req.pick.use.id });

/**
 * Runs the use with the dice kept for its choice when there are some (CA4b: a choice made after the roll never rerolls;
 * asking again replays the same dice). A use that still needs a choice keeps the dice it rolled, `userId` as their keeper.
 */
async function runKept(ctx: MutationCtx, req: UseRequest, built: BuiltRun, userId: Id<"users">): Promise<RunOutcome> {
  const kept = await keptDice(ctx, slotOf(req));
  const outcome = runCard(built, req.pick, kept ? replaying(kept, rollDie) : rollDie);
  if (outcome.kind === "needsChoice") await keepDice(ctx, slotOf(req), outcome.dice, userId);
  return outcome;
}

async function build(ctx: QueryCtx, req: UseRequest): Promise<BuiltRun> {
  const fear = await campaignFearState(ctx, req.campaign._id);
  return buildRun(ctx, {
    campaign: req.campaign,
    character: req.character,
    sheet: req.sheet,
    scene: req.scene,
    pick: req.pick,
    targetTokenIds: req.targetTokenIds,
    choices: parseChoices(req.choices),
    roll: req.roll,
    gmFear: fear.fear,
    lastRollWithHope: await lastRollWithHope(ctx, req.character._id),
    ...(req.squares && req.squares.length > 0 && usesPoints(req.pick.use) ? { points: req.squares } : {}),
  });
}

/** Applies the GM's Fear change of a use (a gain through `gainFear`, a loss through `spendFear`); returns what changed. */
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
 * Siphon Essence (Dread notes, bead dcm-0ib): "You clear a number of Hit Points equal to the number of Hit Points the
 * target marked from this attack." The runner reads the actor instead of the target, so the server clears them.
 */
function siphonHeal(plan: RunPlan): number {
  if (plan.cardId !== "siphon-essence") return 0;
  return plan.steps.reduce((n, s) => n + (s.kind === "damage" ? s.result.hpMarked : 0), 0);
}

/**
 * Plan lanes, E1 (dcm-p1r): a `loadout` `swapWithVault` step of the plan (Codex-Touched, CB p.333: "Once per rest,
 * replace this card with any card from your vault without paying its Recall Cost"): the card goes to the vault and
 * `swapWith` (a vault card of the deck, at most the character's level) comes into the loadout, with no Stress. INVALID
 * without a fitting `swapWith`. Returns the sheet and the step's prompt texts (they are done, so no manual row).
 */
function swapWithVault(sheet: CharacterSheet, plan: RunPlan, swapWith: string | undefined): { sheet: CharacterSheet; texts: string[] } {
  const steps = plan.steps.flatMap((st) => (st.kind === "prompt" && st.step?.kind === "loadout" && st.step.op === "swapWithVault" ? [st] : []));
  if (steps.length === 0) return { sheet, texts: [] };
  const deck = sheet.domainCards;
  if (swapWith === undefined || !deck.owned.includes(swapWith) || deck.loadout.includes(swapWith)) throw appError("INVALID", "Pick a card from your vault to swap in.");
  if ((getDomainCard(swapWith)?.level ?? 99) > sheet.level) throw appError("INVALID", "That card is above your level.");
  const loadout = deck.loadout.filter((c) => c !== plan.cardId);
  return { sheet: { ...sheet, domainCards: { ...deck, loadout: [...loadout, swapWith] } }, texts: steps.map((st) => st.text) };
}

// ---------------------------------------------------------------- who gave it (plan lanes-2 E1.4a)

/**
 * Plan lanes-2 E1.4a (dcm-lztq card writer; V4's `Effect.casterId`): the effects `after` gained over `before` record the
 * character whose use gave them (E6.4 reads it: an effect that ends on its caster's events, CB p.336 Mass Enrapture).
 */
export function stampCaster(before: CharacterSheet, after: CharacterSheet, casterId: Id<"characters">): CharacterSheet {
  const old = new Set(before.effects.map((e) => e.id));
  let touched = false;
  const effects = after.effects.map((e) => {
    if (old.has(e.id) || e.casterId !== undefined) return e;
    touched = true;
    return { ...e, casterId };
  });
  return touched ? { ...after, effects } : after;
}

const INVENTORY_WORDS = { take: "takes an item", takeGold: "takes gold", damageWeapon: "damages a weapon", giveGold: "gets gold", giveItem: "gets an item the GM picks" } as const;

/**
 * Plan lanes-2 E1.4a (dcm-tn8u): the runner's `inventory` plan steps (E3, dcm-vf7i; Contacts Everywhere, CB p.43): a
 * `giveGold` (handfuls, default 1) or a named `giveItem` to a PC is a gift `giveTo` writes; any other op, an item without a
 * name, or a recipient who is no PC is the table's (`byHand`: feed words).
 */
export function inventoryGifts(plan: RunPlan, isPc: (id: string) => boolean): { byTarget: Map<string, Gift[]>; byHand: (name: (id: string) => string) => string[] } {
  const byTarget = new Map<string, Gift[]>();
  const left: { id: string; op: keyof typeof INVENTORY_WORDS }[] = [];
  for (const s of plan.steps) {
    if (s.kind !== "inventory") continue;
    const gift: Gift | null =
      s.op === "giveGold" && (s.amount ?? 1) > 0 ? { kind: "gold", handfuls: s.amount ?? 1 } : s.op === "giveItem" && s.text !== undefined && s.text.trim() !== "" ? { kind: "item", name: s.text.trim().slice(0, 200) } : null;
    if (gift === null || !isPc(s.targetId)) {
      left.push({ id: s.targetId, op: s.op });
      continue;
    }
    byTarget.set(s.targetId, [...(byTarget.get(s.targetId) ?? []), gift]);
  }
  return { byTarget, byHand: (name) => left.map((l) => `${name(l.id)} ${INVENTORY_WORDS[l.op]} (by hand)`) };
}

/** The prefix of a use's instance modifiers (cardRows' `instanceKey`): `card:<cardId>`, or `feat:<featureId>`. */
const instanceKeyOf = (id: string) => (isFeatureUseId(id) ? `feat:${id}` : `card:${id}`);

/**
 * Plan lanes-2 E1.4a (dcm-svnq; dcm-j5aw writer half): a use's instance writes with
 * - each `condition` step's entry fields on the enemy (`conditionInstanceEffect`, E7: its mods, `endsOnRoll`, `escape`,
 *   `recorded`, `endFear`), merged into the condition's end marker when the use left one (cardRows' `effectsAfter`);
 * - `casterId` (the character who used it) on every modifier the use put on an instance, so a reader can tell the
 *   placing PC (Lead by Example, CB p.342: "The next PC to make an attack against that adversary" is any other PC).
 * A write that gains effects this way gets its `before.effects`, so undo puts them back.
 */
export function castWrites(writes: readonly InstanceWrite[], plan: RunPlan, built: BuiltRun, casterId: Id<"characters">, cardName: string): InstanceWrite[] {
  const key = instanceKeyOf(plan.cardId);
  const conditions = plan.steps.filter((s): s is Extract<PlanStep, { kind: "condition" }> => s.kind === "condition");
  const out = writes.map((w) => {
    const instance = w.creature.instance;
    const prior = new Set((instance.effects ?? []).map((e) => e.id));
    let effects: InstanceEffect[] | undefined = w.patch.effects;
    for (const s of conditions) {
      if (s.targetId !== (w.creature.tokenId as string)) continue;
      const made = conditionInstanceEffect([], key, cardName, casterId, s, built.context.options ?? {});
      const fields = made?.[0];
      if (fields === undefined) continue;
      const list = effects ?? instance.effects ?? [];
      const name = fields.label;
      const marker = list.find((e) => !prior.has(e.id) && e.id.startsWith(`${key}:`) && e.label === name && e.condition === undefined);
      if (marker) {
        const rest: Partial<InstanceEffect> = { ...fields };
        for (const k of ["id", "source", "label", "until"] as const) delete rest[k];
        effects = list.map((e) => (e === marker ? { ...e, ...rest } : e));
      } else effects = conditionInstanceEffect(list, key, cardName, casterId, s, built.context.options ?? {}) ?? list;
    }
    if (effects !== undefined) effects = effects.map((e) => (!prior.has(e.id) && e.casterId === undefined && e.id.startsWith(`${key}:`) ? { ...e, casterId } : e));
    if (effects === w.patch.effects) return w;
    return { ...w, before: w.before.effects === undefined ? adversaryBefore(instance, true) : w.before, patch: { ...w.patch, ...(effects ? { effects } : {}) } };
  });
  // A condition with entry fields on an enemy the use changed nothing else on.
  for (const s of conditions) {
    if (out.some((w) => (w.creature.tokenId as string) === s.targetId)) continue;
    const c = built.creatures.get(s.targetId);
    if (c?.kind !== "enemy") continue;
    const effects = conditionInstanceEffect(c.instance.effects ?? [], key, cardName, casterId, s, built.context.options ?? {});
    if (effects === null) continue;
    const inst = c.instance;
    out.push({ creature: c, before: adversaryBefore(inst, true), patch: { hp: inst.hp, stress: inst.stress, defeated: inst.defeated, conditions: inst.conditions, tags: inst.tags, effects } });
  }
  return out;
}

// ---------------------------------------------------------------- adversary uses on the use's roll (dcm-m7tm)

/** A use's action roll as the adversary engine's `pcRolls` triggers read it, or null (no duality action / reaction roll). */
function rollFactsOf(use: CardUse, plan: RunPlan, trait: TraitId | undefined): RollFacts | null {
  const r = plan.roll;
  const spec = use.roll;
  if (r === null || spec === undefined || spec.kind === "adversaryAttack" || r.record.outcome === "none") return null;
  if (r.record.kind !== "action" && r.record.kind !== "reaction") return null;
  const weapon = spec.kind === "attack" || (spec.kind === "trait" && spec.asWeapon === true);
  const attack = weapon || (spec.kind === "trait" && spec.attack === true);
  const rolledTrait = spec.kind === "trait" ? (typeof spec.trait === "string" ? spec.trait : (trait ?? spec.trait[0])) : trait;
  return {
    kind: r.record.kind,
    ...(rolledTrait !== undefined ? { trait: rolledTrait } : {}),
    ...(attack ? { attack: true } : {}),
    ...(weapon ? { weapon: true } : {}),
    ...(spec.kind === "spellcast" ? { spellcast: true } : {}),
    success: plan.success,
    withHope: r.withHope,
    withFear: r.withFear,
    total: r.record.total,
    ...(r.critical ? { critical: true } : {}),
  };
}

/** The plan with its roll records shown with the bonuses (`withDieBonuses`: the true dice and the outcome they make). */
function showBonuses(plan: RunPlan, record: RollRecord, bonuses: readonly { die: "hope" | "fear"; amount: number }[]): RunPlan {
  const shown = withDieBonuses(record, bonuses);
  if (plan.roll) plan.roll.record = shown;
  for (const st of plan.steps) if (st.kind === "roll") st.roll.record = shown;
  return plan;
}

/**
 * Plan lanes-2 E1.4a (dcm-m7tm card / feature half; E7's `pcRollAdversaryUses`, dcm-of7v): the running encounter's
 * adversary uses that fire on the use's action roll (Ill Omen, HF p.95: "their Fear Die gains a bonus equal to the amount
 * of Fear you have"; Backhanded Guidance, HF p.87) run, and their duality-die bonuses go into the roll. User answer
 * 2026-10-31: a bonus never makes a critical (a critical stays one) and only decides Hope vs Fear; a tie after the bonus is
 * WITH FEAR. The use is run again with the same dice, its Hope and Fear Die raised by the bonuses (`rerun`), so its
 * success, Hope, Fear and hits follow the new roll; a tie runs with the Fear Die one higher and the modifier one lower
 * (the total stays, the outcome is with Fear). The rows show the true dice (`withDieBonuses`). Returns the GM's lines.
 */
export async function foldPcRolls<T extends { outcome: RunOutcome }>(
  ctx: MutationCtx,
  input: { campaign: Doc<"campaigns">; characterId: Id<"characters">; use: CardUse; trait: TraitId | undefined },
  first: { plan: RunPlan; dice: readonly number[] },
  rerun: (dice: number[], modifierDelta: number) => Promise<T>,
): Promise<{ plan: RunPlan; dice: number[]; lines: string[]; again: T | null }> {
  const same = { plan: first.plan, dice: [...first.dice], lines: [] as string[], again: null };
  const facts = rollFactsOf(input.use, first.plan, input.trait);
  if (facts === null) return same;
  const uses = await pcRollAdversaryUses(ctx, input.campaign, { characterId: input.characterId, roll: facts });
  const lines = [...uses.lines, ...uses.offers.map((o) => `${o.feature} could react to this roll (the GM's call)`)];
  const roll = first.plan.roll;
  if (uses.bonuses.length === 0 || roll === null) return { ...same, lines };
  const record = roll.record;
  if (roll.critical) return { ...same, plan: showBonuses(first.plan, record, uses.bonuses), lines };
  const add = { hope: 0, fear: 0 };
  for (const b of uses.bonuses) add[b.die] += b.amount;
  const at = first.dice.findIndex((d, i) => d === roll.hope && first.dice[i + 1] === roll.fear);
  if (at < 0) return { ...same, plan: showBonuses(first.plan, record, uses.bonuses), lines };
  const hope = roll.hope + add.hope;
  let fear = roll.fear + add.fear;
  let delta = 0;
  if (hope === fear) {
    fear += 1;
    delta = -1;
  }
  const dice = [...first.dice];
  dice[at] = hope;
  dice[at + 1] = fear;
  const again = await rerun(dice, delta);
  if (again.outcome.kind !== "plan") return { ...same, plan: showBonuses(first.plan, record, uses.bonuses), lines };
  return { plan: showBonuses(again.outcome.plan, record, uses.bonuses), dice, lines, again };
}

/**
 * Writes the plan in one mutation (U4) and logs one actionLog group: the public row (the roll, the damage dice and
 * total, Hit / Miss / Defeated per target, the actor's `before`), a row per ally whose sheet changed, a public row per
 * manual step ("Mira used <card>: <step text>"), and the GM row (damage, severity, HP, saves, `adversaryBefore`).
 */
/**
 * Plan lanes-2, E1 (dcm-wn7): a card's roll as E6's end engine reads it: a Spellcast Roll, a weapon attack (an `attack`
 * spec, or a trait roll `asWeapon`), another attack (`attack: true`), the trait rolled and whether it targets another
 * creature. Null for a roll that ends nothing (damage, free).
 */
function cardEndRoll(use: CardUse, record: RollRecord, trait: TraitId | undefined, targetsCreature: boolean): EndRoll | null {
  const spec = use.roll;
  const attack: EndRoll["attack"] = spec?.kind === "attack" || (spec?.kind === "trait" && spec.asWeapon === true) ? "weapon" : spec?.kind === "trait" && spec.attack === true ? "other" : undefined;
  return endRollFor(record, { ...(attack ? { attack } : {}), ...(spec?.kind === "spellcast" ? { spellcast: true } : {}), ...(trait !== undefined ? { trait } : {}), targetsCreature });
}

async function resolveUse(ctx: MutationCtx, req: UseRequest, built: BuiltRun, plan: RunPlan, actorId: Id<"users">, riders?: RiderSheets): Promise<{ result: ResolvedCard; writes: InstanceWrite[] }> {
  const { campaign, character, pick } = req;
  // SD5: with riders the row's `before` is the sheet before the riders' costs, and the actor's sheet after them.
  const sheet = riders?.before ?? req.sheet;
  const actorToken = built.context.actor.id;
  const unshaken: { characterId: Id<"characters">; name: string; roll: UnshakableRoll }[] = [];
  const actorRolls: UnshakableRoll[] = [];
  let next = riders?.next ?? actorSheetAfter(built.paidSheet, plan, actorToken, pick.name, { out: actorRolls });
  for (const roll of actorRolls) unshaken.push({ characterId: character._id, name: req.sheet.name, roll });
  const healed = siphonHeal(plan);
  if (healed > 0) next = { ...next, hp: Math.max(0, next.hp - healed) };
  const swapped = swapWithVault(next, plan, req.swapWith);
  next = swapped.sheet;
  // Plan lanes-2, E1 (dcm-wn7): the card's roll ends the actor's effects that end on it (Spectral Mist, duration nextRoll;
  // the condition markers already went in the runner) and the modifiers its token made that end on its roll (Timejammer).
  const endRoll = plan.roll ? cardEndRoll(pick.use, plan.roll.record, req.roll.trait, built.targets.some((t) => t.tokenId !== actorToken)) : null;
  const rollEndLabels: string[] = [];
  const rollEnded: Effect[] = [];
  if (endRoll !== null) {
    const own = endOnSheet(next, { kind: "roll", roll: endRoll }, { only: (e) => conditionMarkerOf(e) === null });
    next = own.sheet;
    rollEndLabels.push(...own.lines);
    rollEnded.push(...own.ended);
  }
  // Plan lanes-2 E1.4a (dcm-tn8u): the plan's hand-offs the runner leaves to the caller, as the feature path does
  // (convex/lib/featureRunner.ts): gold and named items given to PCs (`giftsOf` / `giveTo`, CB p.43), a `setStance` step
  // shifting the actor's stance (HF p.12: the previous one drops first, `setStance`), and the feed words (`planHandoff`).
  const isPc = (id: string) => id === actorToken || built.creatures.get(id)?.kind === "pc";
  const gifts = giftsOf(plan, isPc);
  // The runner's own `inventory` plan steps (E3): `giveGold` / `giveItem` to a PC are written here too; the others (take,
  // takeGold, damageWeapon) and an unnamed item stay the table's, as a feed line.
  const inventory = inventoryGifts(plan, isPc);
  for (const [id, list] of inventory.byTarget) gifts.byTarget.set(id, [...(gifts.byTarget.get(id) ?? []), ...list]);
  next = giveTo(next, gifts.byTarget.get(actorToken) ?? []);
  const stanceBefore: AdversaryBefore[] = [];
  const stanceLines: string[] = [];
  for (const stance of stancesOf(plan, actorToken, built.context.options ?? {})) {
    const shifted = await setStance(ctx, campaign._id, next, stance, (e) => effectEndsOf(e));
    if (shifted === null) throw appError("INVALID", `You can't shift into that stance (${stance}).`);
    next = shifted.sheet;
    stanceBefore.push(...shifted.before);
    stanceLines.push(...shifted.lines);
  }
  // dcm-lztq: the effects the card gave its user carry the user as their caster.
  next = stampCaster(sheet, next, character._id);
  const handoff = planHandoff(built, plan);
  const pcName = (id: string) => {
    const c = built.creatures.get(id);
    return c?.kind === "pc" ? c.sheet.name : "an ally";
  };
  const giftNames = (id: string) => (id === actorToken ? "you" : pcName(id));
  // `gifts.notes` reads the merged recipients (the inventory gifts too).
  const giftNotes = [...gifts.notes(giftNames), ...inventory.byHand(giftNames)];
  const handled = (text: string) => gifts.texts.has(text) || plan.steps.some((s) => s.kind === "prompt" && s.prompt === "manual" && s.step?.kind === "setStance" && s.text === text);
  let prompts = promptsOf(plan, built).filter(
    (p) => !(healed > 0 && p.kind === "manual" && p.text.startsWith("You clear a number of Hit Points")) && !(p.kind === "manual" && (swapped.texts.includes(p.text) || handled(p.text))),
  );

  // Allies: tracks from the plan's creatures, Hope / effects / conditions from its steps.
  const allyRows: { character: Doc<"characters">; tokenId: string; before: CharacterSheet; after: CharacterSheet }[] = [];
  for (const c of built.creatures.all) {
    if (c.kind !== "pc" || c.character._id === character._id) continue;
    const changedTo = plan.creatures.find((x) => x.id === c.tokenId)?.after;
    let after = writeSheetChanges(c.sheet, plan.steps, c.tokenId, plan.cardId, pick.name, plan.exclusive, false);
    if (changedTo) after = { ...after, hp: Math.min(c.sheet.hpMax, changedTo.hp), stress: Math.min(c.sheet.stressMax, changedTo.stress), armorMarked: Math.max(0, changedTo.armor ?? c.sheet.armorMarked) };
    // DA10: an Unshakable ally rolls on the Stress the card marks on them (CB p.59).
    const u = unshakePlan(c.sheet, after, plan, c.tokenId, false);
    if (u.roll) unshaken.push({ characterId: c.character._id, name: c.sheet.name, roll: u.roll });
    after = giveTo(u.sheet, gifts.byTarget.get(c.tokenId) ?? []);
    after = stampCaster(c.sheet, after, character._id);
    if (changed(c.sheet, after)) allyRows.push({ character: c.character, tokenId: c.tokenId, before: c.sheet, after });
  }

  // Rule switches RC1: D8 (the last HP defeats, or the GM is told) and D6 (who picks the extra Minions) read the modes.
  const modes = ruleModesOf(campaign);
  const writes = castWrites(instanceWrites(plan, built.creatures, pick.name, srdUses, modes), plan, built, character._id, pick.name);
  await writeInstances(ctx, writes);
  const casterEnds = endRoll !== null && endRoll.kind === "action" ? await endForCasterOnInstances(ctx, campaign._id, actorToken, { kind: "roll", roll: endRoll }) : { before: [], lines: [] };
  const fearDelta = await applyFear(ctx, campaign._id, plan.gmFearDelta);
  // dcm-z9rz.23: the Hope the use paid (its Experiences and its costs, even one the roll's own Hope paid, R8) counts as
  // spent whatever it gained back; an ally counts the costs it paid for the use.
  const hopePaid = Math.max(0, req.sheet.hope - built.paidSheet.hope) + planHopePaid(plan, actorToken, actorToken);
  const sheetChanged = changed(sheet, next) || hopePaid > 0;
  noteHopeSpent(ctx, character._id, hopePaid);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  for (const a of allyRows) {
    noteHopeSpent(ctx, a.character._id, planHopePaid(plan, a.tokenId, actorToken));
    await saveSheet(ctx, a.character._id, a.after);
  }

  const groupId = newGroupId();
  const damage = damageRolls(plan);
  const { parts, outcomes, names } = publicTargets(plan, built, writes);
  const useName = pick.use.name !== pick.name ? ` (${pick.use.name})` : "";
  const rollPart = plan.roll ? `: ${rollText(pick.use, plan.roll.record, req.roll.trait)}` : "";
  const damagePart = damage.length > 0 ? `; ${plan.roll?.critical ? "critical " : ""}damage ${damage.map((d) => d.text).join(" + ")}` : "";
  const targetPart = parts.length > 0 ? ` → ${parts.join(", ")}` : "";
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "combat",
    visibility: "public",
    summary: `${sheet.name} uses ${pick.name}${useName}${riders && riders.names.length > 0 ? ` (${riders.names.join(", ")})` : ""}${rollPart}${damagePart}${targetPart}`.slice(0, 1000),
    ...(plan.roll ? { roll: plan.roll.record } : {}),
    groupId,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(fearDelta !== 0 ? { fearDelta } : {}),
    undoable: true,
  });
  for (const a of allyRows) {
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId: a.character._id,
      actorId,
      kind: "combat",
      visibility: "public",
      summary: `${a.before.name}: ${pick.name} from ${sheet.name}`,
      groupId,
      before: a.before,
      undoable: true,
    });
  }
  for (const p of prompts.filter((x) => x.kind === "manual")) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId, kind: "feature", visibility: "public", summary: `${sheet.name} used ${pick.name}: ${p.text}`, groupId, undoable: true });
  }
  for (const u of unshaken) await logUnshakable(ctx, { campaignId: campaign._id, characterId: u.characterId, actorId, name: u.name, groupId }, u.roll);
  if (rollEndLabels.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId, kind: "feature", visibility: "public", summary: rollEndLabels.join("; ").slice(0, 1000), groupId, undoable: true });
  }
  // Plan lanes-2 E1.3a (dcm-79v1 card half; dcm-rao5, CB p.33 Bird's-Eye View): a shared grant the card's roll spent ends
  // on every other party sheet too, each a row in the use's group.
  if (rollEnded.length > 0) {
    const party = (await partyMembers(ctx, campaign._id)).filter((m) => m.character._id !== character._id);
    for (const end of endSharedGrants(rollEnded, party.map((m) => ({ key: m.character._id, sheet: m.sheet })))) {
      const before = party.find((m) => m.character._id === end.key)!.sheet;
      await saveSheet(ctx, end.key, end.sheet);
      await logAction(ctx, { campaignId: campaign._id, characterId: end.key, actorId, kind: "feature", visibility: "public", summary: end.lines.join("; ").slice(0, 1000), groupId, before, undoable: true });
    }
  }
  // dcm-tn8u: the hand-offs' feed words (stance, spent, rerolled dice, forced attacks, form changes), the stance's drops
  // and the gifts, one public row.
  const handoffWords = [...handoff.notes, ...stanceLines, ...giftNotes];
  if (handoffWords.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId, kind: "feature", visibility: "public", summary: `${sheet.name} used ${pick.name}: ${handoffWords.join("; ")}`.slice(0, 1000), groupId, undoable: true });
  }
  const lines = [...gmLines(plan, built, writes), ...casterEnds.lines];
  const befores = [...writes.map((w) => w.before), ...casterEnds.before, ...stanceBefore];
  // dcm-uemx: severity and HP per adversary hit, for the GM's result panel (`combatHud.resultDamage`; U1: GM row only).
  const targetDamage = targetDamageOf(plan, built, writes);
  if (lines.length > 0 || befores.length > 0) {
    await logAction(ctx, {
      campaignId: campaign._id,
      actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${sheet.name} · ${pick.name} → ${lines.join("; ")}`.slice(0, 1000),
      ...(damage[0] ? { roll: damage[0].roll } : {}),
      groupId,
      ...(befores.length > 0 ? { adversaryBefore: befores } : {}),
      ...(targetDamage.length > 0 ? { targetDamage } : {}),
      undoable: true,
    });
  }
  // Rule switches RC1: the Manual damage rules' GM notes (D2 once the card engine leaves resistance to the GM, D8), in the
  // use's group.
  for (const summary of resistanceNotes(plan, built.creatures)) await postRuleNote(ctx, campaign, { ruleId: "resistance", summary, groupId, actorId });
  for (const summary of lastHpNotes(writes, modes)) await postRuleNote(ctx, campaign, { ruleId: "adversaryDefeated", summary, groupId, actorId });
  // RFC: line of sight (M1), condition dice (C1) and Stress overflow (D4) Manual notes for the card use.
  for (const n of ruleNotesOfUse(built, plan)) await postRuleNote(ctx, campaign, { ruleId: n.ruleId, summary: n.summary, groupId, actorId });

  // Armed countdowns tick right after an action roll, as for `actionRoll` (countdowns-advanced K1); never a reaction roll.
  if (plan.roll && countsAsActionRoll(plan.roll.record, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: plan.roll.record.outcome, actorId });
  }
  // Plan rule-switches RA (S1): the card's action roll failing (no target hit, or under its Difficulty) or rolling with Fear
  // hands the spotlight to the GM, or notes it, in the use's group. R3: the card engine (src/lib/domain/card-effects/run.ts)
  // gains the roll's Hope and Fear itself, following the run context's mode (RA2); the R3 note is posted here.
  if (plan.roll && plan.roll.record.kind === "action" && plan.roll.record.outcome !== "none") {
    await afterPcActionRoll(ctx, campaign, { characterId: character._id, name: sheet.name, kind: "action", success: plan.success, withFear: plan.roll.withFear, groupId, actorId });
  }

  // AA2b: card damage to another PC opens their incoming hit (armor, ally reactions) instead of a manual prompt.
  const hitTokens = await openCardHits(ctx, { plan, built, campaignId: campaign._id, groupId, actorId, attacker: { characterId: character._id, label: sheet.name, cardId: plan.cardId, feature: pick.name } });
  prompts = prompts.filter((p) => !(p.kind === "pcDamage" && p.tokenIds.every((t) => hitTokens.has(t))));
  const minions = await offerMinions(ctx, req, built, plan, { groupId, entryId, actorId });
  await dropDice(ctx, slotOf(req));
  const result: ResolvedCard = {
    status: "resolved",
    entryId,
    cardId: plan.cardId,
    useId: plan.useId,
    roll: plan.roll?.record ?? null,
    damage: damage.map((d) => d.roll),
    success: plan.success,
    targets: outcomes,
    fearDelta,
    prompts,
    minionOffer: minions.offer,
    ...(minions.forGm !== undefined ? { minionsForGm: minions.forGm } : {}),
  };
  // dcm-uemx (user 2026-11-09): a use on the map shows its result panel on the GM's HUD too (`combatHud.playerResults`).
  if (built.creatures.onMap) {
    await attachResultPanel(
      ctx,
      entryId,
      resultPanelOf({ kind: "card", title: pick.name, actorName: sheet.name, cardId: plan.cardId, useId: plan.useId, roll: result.roll, damage: result.damage, success: plan.success, targets: outcomes, names, prompts, minionOffer: minions.offer, ...(minions.forGm !== undefined ? { minionsForGm: minions.forGm } : {}) }),
    );
  }
  return { result, writes };
}

/**
 * Q6 (CB p.201): the card's damage earned extra Minion defeats. The offer lists the Minions still standing in the same
 * encounter that the actor sees, within the card's range (any range with Defined Ranges off), whose Difficulty the roll beat (or a critical, or no roll).
 * Picked with `combatActions.pickMinions` (the public row is a `combat` row of the group).
 */
async function offerMinions(ctx: MutationCtx, req: UseRequest, built: BuiltRun, plan: RunPlan, row: { groupId: string; entryId: Id<"actionLog">; actorId: Id<"users"> }) {
  const extra = plan.steps.reduce((n, s) => n + (s.kind === "minionOffer" ? s.extra : 0), 0);
  const anchor = built.targets.find((t) => t.kind === "enemy");
  if (extra <= 0 || anchor === undefined || anchor.kind !== "enemy") return { offer: null };
  const candidates = [];
  for (const e of await built.creatures.visibleEnemies()) {
    if (!e.minion || e.encounter._id !== anchor.encounter._id) continue;
    // Rule switches ODR2: with Defined Ranges off every standing Minion of the encounter is offered (the picker judges range).
    if (!rangeCheck(built.creatures.scene.attacker, e.token, built.range, built.definedRanges).inRange) continue;
    const instance = await ctx.db.get("encounterAdversaries", e.instance._id);
    if (instance === null || instance.defeated) continue;
    if (plan.roll && !plan.roll.critical && plan.roll.record.total < difficultyOf(instance)) continue;
    const available = Math.min(extra, instance.stats.hpMax - instance.hp);
    if (available > 0) candidates.push({ instanceId: instance._id, tokenId: e.tokenId, name: instance.label, available });
  }
  // Rule switches RC1, D6: the attacker's offer (Book), the GM's (variant, not in the books) or a GM note (Manual).
  return dealMinions(ctx, req.campaign, {
    picker: minionPicker(ruleModesOf(req.campaign).minions),
    encounterId: anchor.encounter._id,
    mapId: req.scene.map._id,
    actorId: row.actorId,
    characterId: req.character._id,
    attackerName: req.sheet.name,
    groupId: row.groupId,
    entryId: row.entryId,
    extra,
    damage: damageRolls(plan).reduce((n, d) => n + d.roll.total, 0),
    candidates,
  });
}

// ---------------------------------------------------------------- riders on a card's roll (SD5)

/** The sheets a use with riders writes: before the riders' costs, and after the riders on the result. */
export type RiderSheets = { before: CharacterSheet; next: CharacterSheet; names: string[] };

/**
 * What a use's roll is to its riders: an attack with a weapon, a Spellcast Roll, a trait roll; null for a use without an
 * action roll (none, a reaction roll, an adversary's attack). Plan lanes, E1: the use (`fromUse`), the card's domain
 * (`cardDomain`: Fane of the Wilds, dcm-z1a), whether it makes a damage roll (Twilight Toll's `noDamageRoll`, dcm-94h), and
 * a trait roll that is its own weapon (`asWeapon`, dcm-gvr). Plan lanes-2 E1.3a (dcm-1kvg): a feature's use too.
 */
export function rollHost(sheet: CharacterSheet, use: CardUse, roll: CardRoll, weaponChoice: "primary" | "secondary" | undefined, fromUse: { id: string; useId: string }, domain?: Host["cardDomain"]): Host | null {
  const spec = use.roll;
  if (spec === undefined || spec.kind === "adversaryAttack" || spec.kind === "reaction") return null;
  const slot = spec.kind === "attack" ? (spec.weapon === "either" ? (weaponChoice ?? "primary") : spec.weapon) : undefined;
  const weapon = slot ? weaponIn(sheet, slot) : undefined;
  const trait = spec.kind === "trait" ? (typeof spec.trait === "string" ? spec.trait : (roll.trait ?? spec.trait[0])) : weapon && weapon.trait !== "choice" ? weapon.trait : roll.trait;
  return {
    spec,
    trait,
    weapon: spec.kind === "attack" || (spec.kind === "trait" && spec.asWeapon === true),
    weaponRange: weapon ? rangeFromWeapon(weapon.range) : null,
    damageType: weapon?.damageType === "magic" ? "magic" : "physical",
    ...(slot ? { slot } : {}),
    fromUse,
    ...(domain ? { cardDomain: domain } : {}),
    damage: makesDamageRoll(use.steps),
  };
}

/** What a card's roll is to its riders (INVALID for a card without an action roll). */
function cardHost(req: UseRequest, weaponChoice: "primary" | "secondary" | undefined): Host {
  const host = rollHost(req.sheet, req.pick.use, req.roll, weaponChoice, { id: req.pick.effect.cardId, useId: req.pick.use.id }, getDomainCard(req.pick.effect.cardId)?.domain);
  if (host === null) throw appError("INVALID", "Riders ride on a card that makes an action roll.");
  return host;
}

/** Whether a use's steps roll damage (a `damage` step, nested ones included). */
export function makesDamageRoll(steps: readonly Step[]): boolean {
  return steps.some(
    (s) =>
      s.kind === "damage" ||
      ((s.kind === "optional" || s.kind === "followUp") && makesDamageRoll(s.steps)) ||
      (s.kind === "choose" && s.options.some((o) => makesDamageRoll(o.steps))) ||
      (s.kind === "save" && (makesDamageRoll(s.onFail) || makesDamageRoll(s.onSuccess))) ||
      (s.kind === "check" && (makesDamageRoll(s.then) || makesDamageRoll(s.otherwise))),
  );
}

/**
 * Plan lanes, E1: the automatic uses that ride on a use's roll (a loadout card's or a held feature's `auto` use whose
 * trigger fits it: Fane of the Wilds' token on a critical Spellcast Roll for a Sage spell, CB p.339, dcm-z1a), before or
 * after the roll. Damage-phase ones stay with the weapon attack.
 */
export function autoUsesOn(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host): PickedRider[] {
  return autoRiders(sheet, campaign, host).filter((r) => r.phase !== "damage");
}

const fixedN = (value: number) => ({ kind: "fixed" as const, value });

/**
 * The use with the riders' damage changes folded in as numbers (they were rolled with the rider): +Proficiency before its
 * damage roll, the added damage, "double damage" and the extra Hit Points (NV4) on the creatures it hits.
 */
export function foldSteps(use: CardUse, folds: Folds): CardUse {
  const pre: Step[] = [];
  const post: Step[] = [];
  if (folds.proficiency !== 0) pre.push({ kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: folds.proficiency } });
  if (folds.minimumSeverity) pre.push({ kind: "modifyDamage", to: "targets", change: { kind: "minimumSeverity", severity: folds.minimumSeverity } });
  if (folds.damageAdd !== 0) post.push({ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: fixedN(folds.damageAdd), ...(folds.addTypes[0] ? { type: folds.addTypes[0] } : {}) } });
  if (folds.multiply !== 1) post.push({ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "multiply", factor: 2 } });
  if (folds.extraHp > 0) post.push({ kind: "markHp", to: "targets", when: ["targetMarkedHp"], amount: fixedN(folds.extraHp) });
  if (pre.length === 0 && post.length === 0) return use;
  return { ...use, steps: [...pre, ...use.steps, ...post] };
}

/** The card's use with the riders' damage changes folded in (`foldSteps`). */
function withFolds<P extends UsePick>(pick: P, folds: Folds): P {
  const use = foldSteps(pick.use, folds);
  if (use === pick.use) return pick;
  return { ...pick, use, effect: { ...pick.effect, uses: pick.effect.uses.map((u) => (u.id === use.id ? use : u)) } };
}

function hostRollOf(plan: RunPlan): HostRoll {
  const r = plan.roll;
  return { success: plan.success, critical: r?.critical ?? false, withHope: r?.withHope ?? false, withFear: r?.withFear ?? false };
}

/** The running encounter of a use's enemy targets, if any. */
function encounterOf(built: BuiltRun): Id<"encounters"> | undefined {
  const enemy = built.targets.find((t) => t.kind === "enemy");
  return enemy?.kind === "enemy" ? enemy.encounter._id : undefined;
}

/**
 * DA2 (Rise to the Challenge, CB p.48: "roll a d20 as your Hope Die"): runs the card with its Duality roll's Hope Die drawn
 * from `sides`. The card runner draws its dice in its own order, so a first run finds the Hope Die's draw (the 12-sided
 * pair matching the roll's Hope and Fear Dice), and the second run draws that one from `sides`, keeping the draws before
 * it (and every kept die when `kept` replays a run: its Hope Die is already a d20). Without `sides`: one plain run.
 */
function runWithHopeDie(built: BuiltRun, pick: UsePick, sides: number | undefined, kept: readonly number[] | null): RunOutcome {
  if (sides === undefined || sides === 12) return runCard(built, pick, kept ? replaying(kept, rollDie) : rollDie);
  const calls: { sides: number; value: number }[] = [];
  const probeBase = kept ? replaying(kept, rollDie) : rollDie;
  const probe = runCard(built, pick, (s) => {
    const value = probeBase(s);
    calls.push({ sides: s, value });
    return value;
  });
  const info = probe.kind === "plan" ? probe.plan.roll : null;
  const at = info ? calls.findIndex((c, i) => c.sides === 12 && c.value === info.hope && calls[i + 1]?.sides === 12 && calls[i + 1]?.value === info.fear) : -1;
  if (at < 0) return probe;
  const prefix = kept ?? calls.slice(0, at).map((c) => c.value);
  let n = 0;
  const inner = replaying(prefix, rollDie);
  const outcome = runCard(built, pick, (s) => inner(n++ === at && s === 12 ? sides : s));
  if (outcome.kind === "plan" && outcome.plan.roll) {
    const roll = outcome.plan.roll;
    roll.record = withHopeSides(roll.record, sides);
    for (const st of outcome.plan.steps) if (st.kind === "roll") st.roll.record = withHopeSides(st.roll.record, sides);
  }
  return outcome;
}

/**
 * A use that takes riders on its roll: a card (`cardWithRiders`) or, plan lanes-2 E1.3a (dcm-3s6e, dcm-1kvg), a feature
 * (convex/combatFeatures.ts: Fangs with Wolf Form's +1d10 and Feed, HF p.39-40; Elemental Breath with Kick / Tusks).
 */
export type RiderUse<P extends UsePick> = {
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  /** The actor's sheet before any rider. */
  sheet: CharacterSheet;
  scene: AttackScene;
  host: Host;
  targetTokenIds: readonly string[];
  roll: CardRoll;
  /** Where the use's dice wait for a choice asked after the roll. */
  slot: DiceSlot;
  /** Builds the use on `sheet` (the riders' costs paid) with `folds`' damage changes in its steps. */
  build: (sheet: CharacterSheet, folds: Folds) => Promise<{ built: BuiltRun; pick: P }>;
  /**
   * Plan lanes-2 E1.4a (dcm-m7tm): this run resolves the use (the GM's approval of an out-of-range use). Unset: it does
   * when every target is in range. Only a resolving run lets the adversaries' `pcRolls` uses fire on its roll.
   */
  resolving?: boolean;
};

/**
 * A use with riders, computed: the use to resolve (`pick`, built on `sheet`, the sheet after the before-roll riders),
 * the rows' sheets, the rider runs (their `endEffect` steps are applied after the use, `applyUseEnds`) and `post`, which
 * writes the riders' effects on the creatures after the use's own rows and returns its runs.
 */
export type RiderOutcome<P extends UsePick> =
  | { kind: "plan"; built: BuiltRun; plan: RunPlan; pick: P; sheet: CharacterSheet; sheets: RiderSheets; runs: RiderRun[]; post: (entryId: Id<"actionLog">) => Promise<RiderRun[]>; pcLines: string[] }
  | { kind: "needsChoice"; outcome: Extract<RunOutcome, { kind: "needsChoice" }> };

/**
 * SD5: a use with riders, computed without writing: the before-roll riders (costs, roll and damage additions), the use
 * with their additions, the riders on its result (their additions folded in by running the use again with the same dice),
 * and a `post` step that writes the riders' effects on the creatures and the damage-phase riders after the use's own rows.
 */
export async function runWithRiders<P extends UsePick>(ctx: MutationCtx, use: RiderUse<P>, riders: readonly Rider[], actorId: Id<"users">, riseOff = false): Promise<RiderOutcome<P>> {
  if (riders.length > MAX_RIDERS_PER_ATTACK) throw appError("INVALID", `At most ${MAX_RIDERS_PER_ATTACK} riders.`);
  const host = use.host;
  // DA2: damage-phase riders (Death Strike) are prompts after the use's damage, never run from a toggle; default-on
  // riders (Rise to the Challenge, CB p.48) join unless turned off.
  const chosenAll = pickRiders(use.sheet, use.campaign, host, riders).filter((r) => r.phase !== "damage");
  // FH-AP: a rider whose choosers each pick their own option (Rousing Strike) waits for the picks after the use (`post`).
  const ownPicks = chosenAll.filter(riderHasOwnPicks);
  const chosen = chosenAll.filter((r) => !ownPicks.includes(r));
  const picked = [...chosen, ...defaultOnRiders(use.sheet, use.campaign, host, riseOff, chosen), ...autoUsesOn(use.sheet, use.campaign, host)];
  const rec = recorder(rollDie);
  const fear = await campaignFearState(ctx, use.campaign._id);
  const env: RiderEnv = { ctx, campaign: use.campaign, character: use.character, scene: use.scene, host, gmFear: fear.fear, rng: rec.rng, rollUsedExperience: (use.roll.experienceIds ?? []).length > 0 };
  const folds = emptyFolds();
  const used: PickedRider[] = [];
  const runs: RiderRun[] = [];
  const names: string[] = [];
  let sheet = use.sheet;
  for (const r of picked.filter((x) => x.phase === "before")) {
    const run = await runRiderPart(env, r, sheet, "pre", null, use.targetTokenIds, undefined);
    if (run === null) continue;
    used.push(r);
    if (run === "empty") continue;
    runs.push(run);
    sheet = run.sheet;
    foldInto(folds, run);
    names.push(run.name);
  }
  if (folds.addTargets.length > 0) throw appError("INVALID", "A rider can't add targets to this roll yet.");

  // The use with the before-roll riders' additions (the roll's bonus and advantage, the damage changes).
  // `modifierDelta`: the `pcRolls` fold's tie correction (`foldPcRolls`).
  let modifierDelta = 0;
  const run = async (pickFolds: Folds, kept: readonly number[] | null) => {
    const { built, pick } = await use.build(sheet, pickFolds);
    const roll = built.context.roll ?? {};
    built.context.roll = { ...roll, modifier: (roll.modifier ?? 0) + folds.modifier + modifierDelta, advantage: (roll.advantage ?? 0) + folds.advantage };
    return { built, pick, outcome: runWithHopeDie(built, pick, folds.hopeDie, kept) };
  };
  // Plan lanes, E1: automatic uses send plain uses this way too, so a choice asked after the roll keeps the use's dice
  // here as `runKept` does (CA4b: asking again never rerolls).
  const first = await run(folds, await keptDice(ctx, use.slot));
  if (first.outcome.kind === "needsChoice") {
    await keepDice(ctx, use.slot, first.outcome.dice, actorId);
    return { kind: "needsChoice", outcome: first.outcome };
  }
  // The use's own dice (the riders' are not replayed into it).
  let dice = [...first.outcome.dice];
  let built = first.built;
  let pick = first.pick;
  let plan = first.outcome.plan;
  // dcm-m7tm: the adversaries' uses on this roll (Ill Omen's Fear Die bonus) before the riders read its result.
  let pcLines: string[] = [];
  if (use.resolving ?? built.outOfRange.length === 0) {
    const folded = await foldPcRolls(ctx, { campaign: use.campaign, characterId: use.character._id, use: pick.use, trait: use.roll.trait }, { plan, dice }, (d, delta) => {
      modifierDelta = delta;
      return run(folds, d);
    });
    pcLines = folded.lines;
    if (folded.again !== null && folded.again.outcome.kind === "plan") {
      built = folded.again.built;
      pick = folded.again.pick;
    }
    plan = folded.plan;
    dice = folded.dice;
  }
  const hostRoll = hostRollOf(plan);
  // Plan lanes-2, E1 (dcm-n0dv): the riders on the result read the roll's Hope and Fear Die (Midnight-Touched).
  if (plan.roll) env.hostDice = { hope: plan.roll.hope, fear: plan.roll.fear };

  // The riders on the result, on the sheet after the use (its own Hope may pay, CB p.90).
  let after = actorSheetAfter(built.paidSheet, plan, built.context.actor.id, pick.name);
  const hitIds = plan.hits.filter((h) => h.hit).map((h) => built.creatures.get(h.id)?.tokenId ?? h.id);
  const later = emptyFolds();
  const skipped: string[] = [];
  const lead = built.targets[0];
  const subject = lead === undefined ? undefined : { token: lead.token, enemy: lead.kind === "enemy", tags: lead.kind === "enemy" ? lead.instance.tags : [], conditions: lead.kind === "enemy" ? lead.instance.conditions : lead.kind === "pc" ? lead.sheet.conditions : [] };
  for (const r of picked.filter((x) => x.phase === "after")) {
    if (!resultHolds(r.trigger, hostRoll) || !rollTargetHolds(r.trigger, host, use.scene.attacker, subject) || (!rollOnly(r.trigger) && hitIds.length === 0)) {
      if (!r.auto) skipped.push(r.name);
      continue;
    }
    const ran = await runRiderPart(env, r, after, "pre", hostRoll, hitIds, undefined);
    if (ran === null) continue;
    used.push(r);
    if (ran === "empty") continue;
    runs.push(ran);
    after = ran.sheet;
    foldInto(later, ran);
    names.push(ran.name);
  }
  if (later.addTargets.length > 0) throw appError("INVALID", "A rider can't add targets to this roll yet.");
  const merged: Folds = { ...folds, damageAdd: folds.damageAdd + later.damageAdd, addTypes: [...folds.addTypes, ...later.addTypes], proficiency: folds.proficiency + later.proficiency, multiply: folds.multiply * later.multiply, extraHp: folds.extraHp + later.extraHp, ...(later.minimumSeverity ? { minimumSeverity: later.minimumSeverity } : {}) };
  if (later.damageAdd !== 0 || later.proficiency !== 0 || later.multiply !== 1 || later.extraHp !== 0 || later.minimumSeverity) {
    // The same dice: the use's roll and damage don't change, only what the riders add to them.
    const again = await run(merged, dice);
    if (again.outcome.kind === "needsChoice") return { kind: "needsChoice", outcome: again.outcome };
    built = again.built;
    pick = again.pick;
    plan = again.outcome.plan;
  }

  const post = async (entryId: Id<"actionLog">): Promise<RiderRun[]> => {
    const groupId = (await ctx.db.get("actionLog", entryId))?.groupId;
    let now = readSheet((await ctx.db.get("characters", use.character._id))!.sheet);
    const start = now;
    const postRuns: RiderRun[] = [];
    const standing = async (tokenId: string) => {
      const c = built.creatures.get(tokenId);
      if (c?.kind !== "enemy") return c !== undefined;
      const instance = await ctx.db.get("encounterAdversaries", c.instance._id);
      return instance !== null && !instance.defeated;
    };
    const alive: string[] = [];
    for (const id of hitIds) if (await standing(id)) alive.push(id);
    for (const r of used) {
      const ran = await runRiderPart(env, r, now, "post", hostRoll, alive, undefined);
      if (ran === null || ran === "empty") continue;
      postRuns.push(ran);
      now = ran.sheet;
    }
    // DA2 (HF p.8 Death Strike; user 2026-10-30): a damage-phase rider is a Use / Pass prompt, with a pick of the ONE
    // creature when several took the damage it needs; never applied without it.
    if (groupId !== undefined) {
      // FH-AP (user 2026-11-05): the riders whose choosers each pick their own option, when their trigger held.
      const holding = ownPicks.filter((r) => resultHolds(r.trigger, hostRoll) && rollTargetHolds(r.trigger, host, use.scene.attacker, subject) && (rollOnly(r.trigger) || hitIds.length > 0));
      if (holding.length > 0) await openRiderAllyPicks(ctx, { env, riders: holding, hostRoll, entryId, groupId, ...(encounterOf(built) ? { encounterId: encounterOf(built)! } : {}), createdBy: actorId });
      for (const r of damagePrompts(use.sheet, use.campaign, host)) {
        const severity = r.trigger.kind === "whenTargetMarksHp" || r.trigger.kind === "whenEnemyTakesDamage" ? r.trigger.severity : undefined;
        const candidates: Id<"combatTokens">[] = [];
        for (const st of plan.steps) {
          if (st.kind !== "damage" || st.result.hpMarked <= 0 || (severity !== undefined && st.result.severity !== severity)) continue;
          const c = built.creatures.get(st.result.targetId);
          if (c?.kind !== "enemy" || candidates.includes(c.tokenId) || !(await standing(c.tokenId))) continue;
          candidates.push(c.tokenId);
        }
        if (candidates.length === 0) continue;
        await openRiderPick(ctx, {
          campaignId: use.campaign._id,
          ...(encounterOf(built) ? { encounterId: encounterOf(built)! } : {}),
          mapId: use.scene.map._id,
          createdBy: actorId,
          payload: { schemaVersion: 1, kind: "riderPick", characterId: use.character._id, groupId, entryId, rider: { source: r.source, id: r.id, useId: r.useId, name: r.name }, candidates, hostRoll },
        });
      }
    }
    if (postRuns.length === 0) return postRuns;
    const writes: InstanceWrite[] = [];
    const lines: string[] = [];
    let fearDelta = 0;
    const modes = ruleModesOf(use.campaign);
    for (const ran of postRuns) {
      const w = instanceWrites(ran.plan, ran.built.creatures, ran.name, srdUses, modes);
      await writeInstances(ctx, w);
      // RC1: D8 Manual's note, in the use's group (a note needs a group to be undone with it).
      if (groupId !== undefined) for (const summary of lastHpNotes(w, modes)) await postRuleNote(ctx, use.campaign, { ruleId: "adversaryDefeated", summary, groupId, actorId });
      writes.push(...w);
      const l = gmLines(ran.plan, ran.built, w);
      if (l.length > 0) lines.push(`${ran.name}: ${l.join("; ")}`);
      fearDelta += ran.plan.gmFearDelta;
    }
    const changedFear = await changeFear(ctx, use.campaign._id, fearDelta);
    const sheetChanged = changed(start, now);
    if (sheetChanged) await saveSheet(ctx, use.character._id, now);
    await logAction(ctx, {
      campaignId: use.campaign._id,
      ...(sheetChanged ? { characterId: use.character._id, before: start } : {}),
      actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${use.sheet.name} · riders → ${lines.join("; ") || postRuns.map((x) => x.name).join(", ")}`.slice(0, 1000),
      ...(groupId !== undefined ? { groupId } : {}),
      ...(writes.length > 0 ? { adversaryBefore: writes.map((w) => w.before) } : {}),
      ...(changedFear !== 0 ? { fearDelta: changedFear } : {}),
      undoable: true,
    });
    return postRuns;
  };
  return { kind: "plan", built, plan, pick, sheet, sheets: { before: use.sheet, next: after, names: [...names, ...skipped.map((n) => `${n} not used`)] }, runs, post, pcLines };
}

type CardRiderOutcome =
  | { kind: "plan"; built: BuiltRun; plan: RunPlan; req: UseRequest; sheets: RiderSheets; runs: RiderRun[]; post: (entryId: Id<"actionLog">) => Promise<RiderRun[]>; pcLines: string[] }
  | { kind: "needsChoice"; outcome: Extract<RunOutcome, { kind: "needsChoice" }> };

/** SD5: a card use with riders (`runWithRiders` with the card's host and `withFolds`). `resolving`: the GM's approval. */
async function cardWithRiders(ctx: MutationCtx, req: UseRequest, riders: readonly Rider[], actorId: Id<"users">, riseOff = false, resolving?: boolean): Promise<CardRiderOutcome> {
  const host = cardHost(req, parseChoices(req.choices).weapon);
  const out = await runWithRiders(
    ctx,
    {
      campaign: req.campaign,
      character: req.character,
      sheet: req.sheet,
      scene: req.scene,
      host,
      targetTokenIds: req.targetTokenIds,
      roll: req.roll,
      slot: slotOf(req),
      build: async (sheet, folds) => {
        const pick = withFolds(req.pick, folds);
        return { built: await build(ctx, { ...req, sheet, pick }), pick };
      },
      ...(resolving !== undefined ? { resolving } : {}),
    },
    riders,
    actorId,
    riseOff,
  );
  if (out.kind === "needsChoice") return out;
  return { kind: "plan", built: out.built, plan: out.plan, req: { ...req, sheet: out.sheet, pick: out.pick }, sheets: out.sheets, runs: out.runs, post: out.post, pcLines: out.pcLines };
}

/**
 * dcm-m7tm: a plain card use (no riders) with the adversaries' `pcRolls` uses on its roll (`foldPcRolls`): the same dice
 * replayed with the bonuses. Call only for a run that resolves (nothing fires on a dry run that waits for the GM).
 */
async function cardPcRolls(ctx: MutationCtx, req: UseRequest, built: BuiltRun, outcome: Extract<RunOutcome, { kind: "plan" }>): Promise<{ plan: RunPlan; lines: string[] }> {
  const folded = await foldPcRolls(ctx, { campaign: req.campaign, characterId: req.character._id, use: req.pick.use, trait: req.roll.trait }, outcome, async (dice, delta) => ({ outcome: rerunWith(built, req.pick, dice, delta) }));
  return { plan: folded.plan, lines: folded.lines };
}

/** Runs a built use again with `dice` replayed and the roll's modifier moved by `delta` (put back after). */
export function rerunWith(built: BuiltRun, pick: UsePick, dice: readonly number[], delta: number): RunOutcome {
  const roll = built.context.roll;
  if (delta !== 0) built.context.roll = { ...(roll ?? {}), modifier: (roll?.modifier ?? 0) + delta };
  try {
    return runCard(built, pick, replaying(dice, rollDie));
  } finally {
    built.context.roll = roll;
  }
}

// ---------------------------------------------------------------- after a use (plan lanes-2 E1.3a)

/** A square on the map, as a use's `point` / `points` args send it. */
export type Square = { x: number; y: number };

/**
 * CB p.42 (Rogue, Cloaked: "After you make an attack ... you are no longer Cloaked") and CB p.99 ("When you make an action
 * roll with the intent to harm an adversary, you're making an attack roll"): a use is an attack when its action roll is a
 * weapon attack or a trait roll marked `attack`, or when it rolls damage against an enemy target (a Spellcast attack).
 */
export function isAttackUse(use: CardUse, built: BuiltRun): boolean {
  const spec = use.roll;
  if (spec === undefined || spec.kind === "reaction" || spec.kind === "adversaryAttack") return false;
  if (spec.kind === "attack" || (spec.kind === "trait" && (spec.attack === true || spec.asWeapon === true))) return true;
  return makesDamageRoll(use.steps) && built.targets.some((t) => t.kind === "enemy");
}

/**
 * Plan lanes-2 E1.3a (dcm-uwg1 card half; HF p.8 Marked for Death: "the current adversary Marked for Death is defeated"):
 * the instances a use's writes defeated end every party member's `targetDefeated` effects tagged on them, each sheet
 * saved and logged in `groupId`. Returns the feed lines.
 */
export async function endDefeatedOnParty(ctx: MutationCtx, input: { campaignId: Id<"campaigns">; writes: readonly InstanceWrite[]; groupId: string; actorId: Id<"users"> }): Promise<string[]> {
  const defeated = input.writes.filter((w) => w.patch.defeated && !w.creature.instance.defeated).map((w) => w.creature.instance);
  if (defeated.length === 0) return [];
  const lines: string[] = [];
  for (const m of await partyMembers(ctx, input.campaignId)) {
    let sheet = m.sheet;
    const ended: string[] = [];
    for (const instance of defeated) {
      const out = endOnDefeat(sheet, instance);
      sheet = out.sheet;
      ended.push(...out.lines);
    }
    if (ended.length === 0) continue;
    await saveSheet(ctx, m.character._id, sheet);
    await logAction(ctx, { campaignId: input.campaignId, characterId: m.character._id, actorId: input.actorId, kind: "combat", visibility: "public", summary: ended.join("; ").slice(0, 1000), groupId: input.groupId, before: m.sheet, undoable: true });
    lines.push(...ended);
  }
  return lines;
}

/** What `afterUse` needs of a resolved use. */
export type AfterUse = {
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  /** The actor's sheet before the use (and its riders). */
  before: CharacterSheet;
  built: BuiltRun;
  plan: RunPlan;
  use: CardUse;
  /** The card or feature id that drew the use's areas, and its name for the feed. */
  sourceId: string;
  name: string;
  entryId: Id<"actionLog">;
  actorId: Id<"users">;
  /** The rider runs of the use (their `endEffect` steps). */
  riderRuns?: readonly RiderRun[];
  /** The instance writes of the use (`endDefeatedOnParty`); the feature path leaves them out. */
  writes?: readonly InstanceWrite[];
  point?: Square;
  points?: readonly Square[];
  /** Plan lanes-2 E1.4a (dcm-m7tm): the GM's lines of the adversary uses that fired on the use's roll (`foldPcRolls`). */
  gmNotes?: readonly string[];
};

/** The attack kind a use's roll is to the end engine of adversary-given conditions (`endAdversaryConditionsOnRoll`). */
function attackKindOf(use: CardUse): "weapon" | "spell" | "other" | undefined {
  const spec = use.roll;
  if (spec === undefined) return undefined;
  if (spec.kind === "attack" || (spec.kind === "trait" && spec.asWeapon === true)) return "weapon";
  if (spec.kind === "spellcast") return "spell";
  if (spec.kind === "trait" && spec.attack === true) return "other";
  return undefined;
}

const SEVERITY_RANK: Record<EndSeverity, number> = { none: 0, minor: 1, major: 2, severe: 3 };

/** The instances a plan's damage marked Hit Points on, with the hit as their caster-side end reads it (E6's `damageTaken`). */
function damagedInstances(plan: RunPlan, built: BuiltRun): Map<Id<"encounterAdversaries">, { severity: EndSeverity; hpMarked: number }> {
  const out = new Map<Id<"encounterAdversaries">, { severity: EndSeverity; hpMarked: number }>();
  for (const s of plan.steps) {
    if (s.kind !== "damage" || s.result.hpMarked <= 0) continue;
    const c = built.creatures.get(s.result.targetId);
    if (c?.kind !== "enemy") continue;
    const raw = s.result.severity;
    const severity: EndSeverity = raw === "minor" || raw === "major" || raw === "severe" ? raw : raw === "none" ? "none" : "minor";
    const prior = out.get(c.instance._id);
    out.set(c.instance._id, { severity: prior && SEVERITY_RANK[prior.severity] > SEVERITY_RANK[severity] ? prior.severity : severity, hpMarked: (prior?.hpMarked ?? 0) + s.result.hpMarked });
  }
  return out;
}

/** The id the adversary engine names a creature of the use by: an instance id, or a PC's character id. */
function engineIdOf(built: BuiltRun, tokenId: string): string | null {
  const c = built.creatures.get(tokenId);
  if (c?.kind === "enemy") return c.instance._id;
  if (c?.kind === "pc") return c.character._id;
  return null;
}

/**
 * Plan lanes-2 E1.4a (dcm-svnq, dcm-9l9g; Words of Discord, CB p.335: "make an attack against another adversary instead of
 * against you or your allies"; Transform, HF p.142): the plan's `forcedAttack` and `changeForm` hand-offs
 * (`planHandoff`). An adversary forced to attack makes its standard attack now (`forcedStandardAttack`, its own log
 * group); without a target, or one the engine refuses, it is the GM's ("must make its standard attack against a target
 * the GM picks"). A PC forced to attack is the player's ("must make an attack against ..."). A form change writes the
 * instance's `form` modifier (`formInstanceEffect`) in the use's group. Returns the notes for the table.
 */
async function runHandoffs(ctx: MutationCtx, input: AfterUse, groupId: string): Promise<string[]> {
  const { built, plan, campaign } = input;
  const handoff = planHandoff(built, plan);
  const notes: string[] = [];
  const nameOf = (tokenId: string) => {
    const c = built.creatures.get(tokenId);
    return c?.kind === "enemy" ? c.instance.label : c?.kind === "pc" ? c.sheet.name : "a creature";
  };
  for (const f of handoff.changeForms) {
    const c = built.creatures.get(f.tokenId);
    if (c?.kind !== "enemy") continue;
    const instance = await ctx.db.get("encounterAdversaries", c.instance._id);
    if (instance === null || instance.defeated) continue;
    await ctx.db.patch("encounterAdversaries", instance._id, { effects: formInstanceEffect(instance.effects ?? [], f.adversaryId, input.name), updatedAt: Date.now() });
    await logAction(ctx, { campaignId: campaign._id, actorId: input.actorId, kind: "combat", visibility: "gm", summary: `${instance.label} changes form (${input.name})`.slice(0, 1000), groupId, adversaryBefore: [adversaryBefore(instance, true)], undoable: true });
  }
  if (handoff.forcedAttacks.length === 0) return notes;
  const user = await ctx.db.get("users", input.actorId);
  for (const f of handoff.forcedAttacks) {
    const against = f.againstTokenIds.map((t) => nameOf(t)).join(", ") || "a target the GM picks";
    for (const attackerToken of f.attackerTokenIds) {
      const c = built.creatures.get(attackerToken);
      if (c?.kind === "pc") {
        notes.push(`${c.sheet.name} must make an attack against ${against}`);
        continue;
      }
      if (c?.kind !== "enemy") continue;
      const targets = f.againstTokenIds.filter((t) => t !== attackerToken).flatMap((t) => engineIdOf(built, t) ?? []);
      if (targets.length === 0 || user === null) {
        notes.push(`${c.instance.label} must make its standard attack against a target the GM picks`);
        continue;
      }
      try {
        await forcedStandardAttack(ctx, campaign, user, { instanceId: c.instance._id, targets });
      } catch (e) {
        if (!(e instanceof ConvexError)) throw e;
        notes.push(`${c.instance.label} must make its standard attack against ${against}`);
      }
    }
  }
  return notes;
}

/**
 * Plan lanes-2 E1.4a (dcm-wli0 card / feature half; E6's ends of adversary-given conditions): the use's damage to an
 * instance ends the PC conditions that instance gave which end on its damage (Envelop's Restrained on Severe), and its
 * roll ends the actor's that end on the bearer's roll (Slowed, Rattled, HF p.69: "until they roll with Hope"), in `groupId`.
 */
async function endAdversaryGiven(ctx: MutationCtx, input: AfterUse, groupId: string): Promise<string[]> {
  const { campaign, character, plan, built } = input;
  const lines: string[] = [];
  for (const [instanceId, hit] of damagedInstances(plan, built)) {
    const instance = await ctx.db.get("encounterAdversaries", instanceId);
    const lastHp = instance !== null && instance.hp >= instance.stats.hpMax;
    const out = await endAdversaryConditionsForCaster(ctx, { campaignId: campaign._id, casterId: instanceId, occ: { kind: "damageTaken", severity: hit.severity, hpMarked: hit.hpMarked, lastHp }, groupId, actorId: input.actorId });
    lines.push(...out.lines);
  }
  if (plan.roll) {
    const now = await ctx.db.get("characters", character._id);
    if (now !== null) {
      const sheet = readSheet(now.sheet);
      const out = endAdversaryConditionsOnRoll(sheet, plan.roll.record, attackKindOf(input.use));
      if (out.ended.length > 0) {
        await saveSheet(ctx, character._id, out.sheet);
        await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: input.actorId, kind: "feature", visibility: "public", summary: out.lines.join("; ").slice(0, 1000), groupId, before: sheet, undoable: true });
        lines.push(...out.lines);
      }
    }
  }
  return lines;
}

/**
 * Plan lanes-2 E1.4a (dcm-vx5n; user 2026-10-31; CB p.42, CB p.99): a use whose action roll targets an enemy but is not
 * an attack (`isAttackUse` false) asks the GM "Does <name>'s Cloaked end?" when the actor is Cloaked (`openCloakPrompt`).
 */
async function askCloak(ctx: MutationCtx, input: AfterUse, groupId: string): Promise<void> {
  const { built, plan } = input;
  const spec = input.use.roll;
  if (!built.creatures.onMap || plan.roll === null || plan.roll.record.kind !== "action") return;
  if (spec === undefined || spec.kind === "reaction" || spec.kind === "adversaryAttack" || isAttackUse(input.use, built)) return;
  const enemies = built.targets.filter((t) => t.kind === "enemy");
  const first = enemies[0];
  if (first === undefined || first.kind !== "enemy") return;
  const scene = built.creatures.scene;
  await openCloakPrompt(ctx, {
    campaign: input.campaign,
    characterId: input.character._id,
    tokenId: scene.attacker._id,
    mapId: scene.map._id,
    encounterId: first.encounter._id,
    label: input.name,
    groupId,
    targetTokenIds: enemies.map((t) => t.token._id),
    createdBy: input.actorId,
  });
}

/**
 * Plan lanes-2 E1.3a (dcm-m48i, dcm-9nlr, dcm-76l5 (3), dcm-bxp.99.19.67, dcm-uwg1): what a resolved card or feature use
 * does after its own rows, in its undo group: what it ends (`applyUseEnds` for its plan and its riders' plans: `endEffect`
 * and `replace` steps, effects and areas whose tokens are gone), what a spell's cast ends (`endSpellCast`: Through Your
 * Eyes, Veil of Night), the `targetDefeated` effects of the instances it defeated, an ordinary Cloaked when it was an
 * attack, then its map areas (`placeAreasFromPlan`; a wall or a `point` area without its squares is left for the table).
 * Returns the feed lines and the "place by hand" notes.
 */
export async function afterUse(ctx: MutationCtx, input: AfterUse): Promise<{ lines: string[]; byHand: string[] }> {
  const entry = await ctx.db.get("actionLog", input.entryId);
  const groupId = entry?.groupId;
  if (groupId === undefined) return { lines: [], byHand: [] };
  const { campaign, character, built, plan } = input;
  const scene = built.creatures.onMap ? built.creatures.scene : null;
  const areasBefore = scene ? (await activeAreasOnMap(ctx, scene.map._id)).filter((a) => a.characterId === character._id) : [];
  const lines: string[] = [];
  const ends = await applyUseEnds(ctx, { campaignId: campaign._id, character, before: input.before, built, plan, groupId, actorId: input.actorId });
  lines.push(...ends.lines);
  for (const r of input.riderRuns ?? []) {
    const now = await ctx.db.get("characters", character._id);
    if (now === null) break;
    const out = await applyUseEnds(ctx, { campaignId: campaign._id, character, before: readSheet(now.sheet), built: r.built, plan: r.plan, groupId, actorId: input.actorId });
    lines.push(...out.lines);
  }
  if (isSpell(input.sourceId)) {
    const now = await ctx.db.get("characters", character._id);
    if (now !== null) {
      const cast = await endSpellCast(ctx, { campaignId: campaign._id, characterId: character._id, sheet: readSheet(now.sheet), castCardId: input.sourceId, ...(scene ? { casterTokenId: built.context.actor.id } : {}), groupId, actorId: input.actorId });
      lines.push(...cast.lines);
    }
  }
  if (input.writes) lines.push(...(await endDefeatedOnParty(ctx, { campaignId: campaign._id, writes: input.writes, groupId, actorId: input.actorId })));
  if (isAttackUse(input.use, built) && (await uncloakAfterAttack(ctx, campaign, character._id, input.actorId, input.name, { groupId }))) lines.push(`${input.before.name} is no longer Cloaked`);
  // Plan lanes-2 E1.4a: the adversary-given conditions the use's damage or roll ends, the Cloaked prompt, the GM's lines of
  // the adversary uses on its roll, then the hand-offs (a forced attack runs last: its rows are a group of their own).
  lines.push(...(await endAdversaryGiven(ctx, input, groupId)));
  await askCloak(ctx, input, groupId);
  if (input.gmNotes && input.gmNotes.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, actorId: input.actorId, kind: "combat", visibility: "gm", summary: `${input.before.name} · ${input.name}: ${input.gmNotes.join("; ")}`.slice(0, 1000), groupId, undoable: true });
  }
  // Areas that ended above (their sheet rows say the rest): one public row, so the feed names them.
  if (scene) {
    const live = new Set((await activeAreasOnMap(ctx, scene.map._id)).map((a) => a._id));
    const gone = areasBefore.filter((a) => !live.has(a._id)).map((a) => `${a.label} ends`);
    if (gone.length > 0) await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: input.actorId, kind: "feature", visibility: "public", summary: `${input.before.name}: ${gone.join("; ")}`.slice(0, 1000), groupId, undoable: true });
  }
  const byHand: string[] = [];
  const areas = plan.steps.filter((s): s is Extract<PlanStep, { kind: "area" }> => s.kind === "area");
  if (areas.length > 0 && scene) {
    const squares = (input.point ? 1 : 0) + (input.points?.length ?? 0);
    const placeable = plan.steps.filter((s) => s.kind !== "area" || (s.area.shape === "wall" ? squares >= 2 : s.area.centre !== "point" || squares > 0));
    for (const s of areas) if (!placeable.includes(s)) byHand.push(`place ${s.area.label} on the map by hand`);
    const actorTokenId = built.context.actor.id;
    await placeAreasFromPlan(ctx, {
      campaignId: campaign._id,
      map: scene.map,
      characterId: character._id,
      sourceId: input.sourceId,
      useId: plan.useId,
      ownerToken: scene.attacker,
      steps: placeable,
      tokenOf: (id) => (id === actorTokenId ? scene.attacker._id : (built.creatures.get(id)?.tokenId ?? null)),
      ...(input.point ? { point: input.point } : {}),
      ...(input.points ? { points: input.points } : {}),
    });
  }
  byHand.push(...(await runHandoffs(ctx, input, groupId)));
  return { lines, byHand };
}

/** A card use's after-steps (`afterUse`) with its result: the "place by hand" notes join its prompts. */
async function afterCardUse(
  ctx: MutationCtx,
  input: { result: ResolvedCard; req: UseRequest; built: BuiltRun; plan: RunPlan; actorId: Id<"users">; before: CharacterSheet; writes: readonly InstanceWrite[]; riderRuns?: readonly RiderRun[]; point?: Square; points?: readonly Square[]; gmNotes?: readonly string[] },
): Promise<ResolvedCard> {
  const { result, req } = input;
  const out = await afterUse(ctx, {
    campaign: req.campaign,
    character: req.character,
    before: input.before,
    built: input.built,
    plan: input.plan,
    use: req.pick.use,
    sourceId: req.pick.effect.cardId,
    name: req.pick.name,
    entryId: result.entryId,
    actorId: input.actorId,
    writes: input.writes,
    ...(input.riderRuns ? { riderRuns: input.riderRuns } : {}),
    ...(input.point ? { point: input.point } : {}),
    ...(input.points ? { points: input.points } : {}),
    ...(input.gmNotes ? { gmNotes: input.gmNotes } : {}),
  });
  if (out.byHand.length === 0) return result;
  return { ...result, prompts: [...result.prompts, ...out.byHand.map((text) => ({ kind: "manual" as const, text, tokenIds: [] }))] };
}

const squareValidator = v.object({ x: v.number(), y: v.number() });

const useArgs = {
  characterId: v.id("characters"),
  mapId: v.id("combatMaps"),
  cardId: v.string(),
  /** The use: a grimoire spell or a card part (`CardUse.id`); default the card's first action use. */
  spell: v.optional(v.string()),
  targetTokenIds: v.array(v.id("combatTokens")),
  /** The player's picks as `{id, value}` (see `parseChoices` in convex/lib/cardChoices.ts for the ids). */
  choices: cardChoicesValidator,
  roll: v.optional(cardRollValidator),
  /** SD5: riders taken with the card's roll (Rage Up on Whirlwind). */
  riders: v.optional(v.array(riderValidator)),
  /**
   * DA2 (CB p.48 Rise to the Challenge, user 2026-10-30): the d20 Hope Die is ON while 2 or fewer Hit Points are unmarked
   * (an action roll); `false` turns it off for this roll.
   */
  riseToTheChallenge: v.optional(v.boolean()),
  /** Plan lanes, E1 (dcm-p1r): the vault card a swap step brings in (Codex-Touched, CB p.333). */
  swapWith: v.optional(v.string()),
  /**
   * Plan lanes-2 E1.3a (dcm-9nlr, dcm-76l5 (3)): the square a `point`-centred area goes on (as `combatFeatures.useFeature`;
   * Veil of Night, CB p.336: "between two points"), and more squares after it (a wall's second end, a `count` area's others).
   */
  point: v.optional(squareValidator),
  points: v.optional(v.array(squareValidator)),
};

/**
 * DA2: whether a default-on rider (Rise to the Challenge) applies to this card's roll now, unless turned off. Plan lanes,
 * E1: or an automatic use rides on it (`autoUsesOn`): the card then runs through the rider path too.
 */
function riseApplies(req: UseRequest, off: boolean): boolean {
  const roll = req.pick.use.roll;
  if (roll === undefined || roll.kind === "adversaryAttack" || roll.kind === "reaction") return false;
  const host = cardHost(req, parseChoices(req.choices).weapon);
  if (autoUsesOn(req.sheet, req.campaign, host).length > 0) return true;
  return !off && defaultOnRiders(req.sheet, req.campaign, host, false, []).length > 0;
}

/**
 * Uses a loadout card from the character's PC token on the live map (COMBAT_MAP_NOT_FOUND, COMBAT_TOKEN_NOT_FOUND).
 * Refusals: CARD_NOT_IN_LOADOUT, CARD_NOT_COMBAT (out of combat, passive), CARD_EXHAUSTED, CARD_COST_UNPAID,
 * COMBAT_NO_LINE_OF_SIGHT / COMBAT_TARGET_INVALID for a target, INVALID for a bad choice or an unmet condition,
 * CHARACTER_UNAVAILABLE, NOT_ENOUGH_HOPE (Experiences). A target outside the card's range: `pending` (Q1), nothing
 * rolled or paid. A card that needs a choice it didn't get: `needsChoice`, nothing written.
 */
export const useCard = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: useArgs,
  returns: v.union(resolvedCardValidator, pendingCardValidator, needsChoiceValidator),
  handler: async (ctx, args) =>
    fearFor(ctx, ctx.user, ctx.campaign, await ctx.once("combat_card", args, async () => {
      const { campaign, character, sheet, gm } = await editableHere(ctx, args.characterId);
      // Config R2 (Q2 a): a player's card use with a target out of its range is refused when the GM refuses them.
      const refuse = refusesOutOfRange(campaign, gm);
      assertCanAct(character, sheet, campaign);
      const scene = await attackScene(ctx, campaign, character, args.mapId);
      const pick = pickCard(sheet, args.cardId, args.spell);
      // S2 (plan rule-switches RS2): a card's action waits while the GM holds the spotlight; a reaction card never does.
      await assertMayAct(ctx, campaign, character, useActKind(pick.use), sheet.name);
      const req: UseRequest = { campaign, character, sheet, scene, pick, targetTokenIds: args.targetTokenIds, choices: args.choices, roll: args.roll ?? {}, ...(args.swapWith !== undefined ? { swapWith: args.swapWith } : {}) };
      const riders = args.riders ?? [];
      const riseOff = args.riseToTheChallenge === false;
      if ((args.points?.length ?? 0) > MAX_AREA_COUNT) throw appError("INVALID", `At most ${MAX_AREA_COUNT} squares.`);
      const squares = { ...(args.point ? { point: args.point } : {}), ...(args.points ? { points: args.points } : {}) };
      // dcm-tn8u: the squares go to the runner too, for a use whose targets name points.
      req.squares = [...(args.point ? [args.point] : []), ...(args.points ?? [])];
      if (riders.length > 0 || riseApplies(req, riseOff)) {
        const withRiders = await cardWithRiders(ctx, req, riders, ctx.user._id, riseOff);
        if (withRiders.kind === "needsChoice") return { status: "needsChoice" as const, asks: withRiders.outcome.asks };
        if (withRiders.built.outOfRange.length === 0) {
          const { result, writes } = await resolveUse(ctx, withRiders.req, withRiders.built, withRiders.plan, ctx.user._id, withRiders.sheets);
          const postRuns = await withRiders.post(result.entryId);
          return afterCardUse(ctx, { result, req: withRiders.req, built: withRiders.built, plan: withRiders.plan, actorId: ctx.user._id, before: sheet, writes, riderRuns: [...withRiders.runs, ...postRuns], gmNotes: withRiders.pcLines, ...squares });
        }
        if (refuse) throw outOfRangeRefusal(withRiders.built.outOfRange);
        // Q1: wait for the GM; the approval runs the card and its riders again (nothing is kept).
        const encounter = withRiders.built.targets.find((t) => t.kind === "enemy");
        const requestId = await ctx.db.insert("combatRequests", {
          campaignId: campaign._id,
          ...(encounter?.kind === "enemy" ? { encounterId: encounter.encounter._id } : {}),
          mapId: scene.map._id,
          kind: "sanction",
          status: "open",
          createdBy: ctx.user._id,
          createdAt: Date.now(),
          responses: [],
          payload: {
            schemaVersion: 1,
            kind: "sanction",
            characterId: character._id,
            action: {
              kind: "card",
              cardId: args.cardId,
              useId: pick.use.id,
              targetTokenIds: args.targetTokenIds,
              choices: args.choices,
              ...(args.roll || riseOff ? { roll: { ...args.roll, ...(riseOff ? { riseToTheChallenge: false } : {}) } } : {}),
              ...(riders.length > 0 ? { riders } : {}),
              // dcm-0x2g: the point area's square, replayed on approval (E2.3 widened the payload).
              ...(args.point ? { point: args.point } : {}),
            },
            outOfRange: withRiders.built.outOfRange,
          },
        });
        return { status: "pending" as const, requestId, outOfRange: withRiders.built.outOfRange };
      }
      const built = await build(ctx, req);
      if (refuse && built.outOfRange.length > 0) throw outOfRangeRefusal(built.outOfRange);
      // Refusals (exhausted, cost, condition) and missing choices come first, whether or not the GM must approve.
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      if (built.outOfRange.length === 0) {
        const folded = await cardPcRolls(ctx, req, built, outcome);
        const { result, writes } = await resolveUse(ctx, req, built, folded.plan, ctx.user._id);
        return afterCardUse(ctx, { result, req, built, plan: folded.plan, actorId: ctx.user._id, before: sheet, writes, gmNotes: folded.lines, ...squares });
      }

      // Q1: wait for the GM; nothing paid or logged is kept. The dry run's dice are kept, so the approval resolves with
      // them (CA4b: no rerolling by asking again).
      await keepDice(ctx, slotOf(req), outcome.dice, ctx.user._id);
      const encounter = built.targets.find((t) => t.kind === "enemy");
      const requestId = await ctx.db.insert("combatRequests", {
        campaignId: campaign._id,
        ...(encounter?.kind === "enemy" ? { encounterId: encounter.encounter._id } : {}),
        mapId: scene.map._id,
        kind: "sanction",
        status: "open",
        createdBy: ctx.user._id,
        createdAt: Date.now(),
        responses: [],
        payload: {
          schemaVersion: 1,
          kind: "sanction",
          characterId: character._id,
          action: { kind: "card", cardId: args.cardId, useId: pick.use.id, targetTokenIds: args.targetTokenIds, choices: args.choices, ...(args.roll ? { roll: args.roll } : {}), ...(args.point ? { point: args.point } : {}) },
          outOfRange: built.outOfRange,
        },
      });
      return { status: "pending" as const, requestId, outOfRange: built.outOfRange };
    }), "fearDelta", ctx.permission),
});

const declined = v.object({ status: v.literal("declined") });

/**
 * The GM approves or declines a card use waiting for them (Q1). Declining closes it. Approving re-checks the card, the
 * targets and line of sight (a failure throws and leaves the request open for a decline), skips the range check the GM
 * waived, and resolves the use with the player who asked as the rows' actor. A request whose encounter ended is declined.
 * REQUEST_NOT_OPEN once answered; NOT_FOUND for another campaign's request or one that is not a card sanction.
 */
export const sanction = keyedGmMutation({
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), approve: v.boolean() },
  returns: v.union(resolvedCardValidator, needsChoiceValidator, declined),
  handler: async (ctx, { requestId, approve }) =>
    ctx.once("combat_card_sanction", { requestId, approve }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      if (row.payload.kind !== "sanction" || row.payload.action.kind !== "card") throw appError("NOT_FOUND");
      if (!approve || !(await encounterRunning(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      const { characterId, action } = row.payload;
      const character = await ctx.db.get("characters", characterId);
      if (character === null || character.campaignId !== ctx.campaign._id || row.mapId === undefined) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      assertCanAct(character, sheet, ctx.campaign);
      const scene = await attackScene(ctx, ctx.campaign, character, row.mapId);
      const pick = pickCard(sheet, action.cardId, action.useId);
      // dcm-0x2g: the square the player picked for a point area (the payload keeps `point` only, not `points`).
      const squares = action.point ? { point: action.point } : {};
      const req: UseRequest = { campaign: ctx.campaign, character, sheet, scene, pick, targetTokenIds: action.targetTokenIds, choices: action.choices, roll: action.roll ?? {}, ...(action.point ? { squares: [action.point] } : {}) };
      const riseOff = action.roll?.riseToTheChallenge === false;
      if ((action.riders && action.riders.length > 0) || riseApplies(req, riseOff)) {
        const withRiders = await cardWithRiders(ctx, req, action.riders ?? [], row.createdBy, riseOff, true);
        if (withRiders.kind === "needsChoice") return { status: "needsChoice" as const, asks: withRiders.outcome.asks };
        const { result, writes } = await resolveUse(ctx, withRiders.req, withRiders.built, withRiders.plan, row.createdBy, withRiders.sheets);
        const postRuns = await withRiders.post(result.entryId);
        const done = await afterCardUse(ctx, { result, req: withRiders.req, built: withRiders.built, plan: withRiders.plan, actorId: row.createdBy, before: sheet, writes, riderRuns: [...withRiders.runs, ...postRuns], gmNotes: withRiders.pcLines, ...squares });
        await closeRequest(ctx, row._id, "resolved", ctx.user._id);
        return done;
      }
      const built = await build(ctx, req);
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      const folded = await cardPcRolls(ctx, req, built, outcome);
      const { result, writes } = await resolveUse(ctx, req, built, folded.plan, row.createdBy);
      const done = await afterCardUse(ctx, { result, req, built, plan: folded.plan, actorId: row.createdBy, before: sheet, writes, gmNotes: folded.lines, ...squares });
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return done;
    }),
});
