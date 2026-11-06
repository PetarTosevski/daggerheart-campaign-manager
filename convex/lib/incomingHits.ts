/**
 * Incoming hits on PCs and their reaction windows (plan combat-actions, tracer AA2; docs/tasks/TASK-CA-AA2.md). One
 * `combatRequests` row of kind `incomingHit` per hit PC: the damage waits while the target chooses armor and allies
 * answer with eligible reaction cards, then the hit resolves into HP / Stress / Armor / Hope marks on the sheet. The
 * state machine is AA1's pure window (src/lib/domain/adversary-actions/window.ts); this module stores, rebuilds and
 * writes it. Callers are campaign wrappers that already checked access.
 *
 * User answers (binding, quoted in the task doc): Q13 the hit PC chooses whether to mark an Armor Slot and allies may
 * respond (I Am Your Shield, CB p.341); Q14 the hit PC sees the damage and its severity against their own thresholds,
 * never the roll; Q17 (a) the window closes when the target chose armor and every eligible ally answered, or on the
 * GM's "Resolve now", no timer; Q18 (a) without a live map no range limits; 2026-10-22: card damage to another PC opens
 * the same incoming hit (this module is that API; see `openIncomingHit`).
 *
 * Rules (printed pages): CB p.91 thresholds, last HP → death move; CB p.114 one Armor Slot per hit, one step each;
 * CB p.99 no Armor Slot on direct damage; CB p.195 forced slots "without gaining its benefit"; CB p.92 Stress overflow.
 *
 * Storage: the row holds the hit, its responders and the answers (AA0's validators, unchanged). The window is rebuilt
 * from them on every read: `openWindow` with the party now, the stored responders, then every stored answer in order.
 * A card answer's folds are recomputed by re-running the card with dice seeded from the request and the answer's index
 * (`seededRng`), so a rolled fold (Rune Ward's 1d8) comes out the same every time and can't be fished for.
 *
 * Every actionLog row written here carries the request's `createdBy` (the GM who made the attack) as actor, so a player
 * can't undo an adversary's hit by undoing their own armor answer; the GM undoes the whole group.
 *
 * AA2b (docs/tasks/TASK-CA-AA2b.md; user answers 2026-10-22): the attacker may be a PC (a card's damage to an ally); the
 * attack's riders (conditions, effects, Stress, Hope) wait in the row and land on whoever takes the hit, so they follow
 * I Am Your Shield; a hit that marks the target's last HP makes the sheet's death move due at once (`deathMoveSpent`
 * cleared, `deathMove` returned); the hit PC's after-hit card uses run (Rise Up, Valor-Touched) or are offered with the
 * row kept open (`afterHit`: Unbreakable); Bold Presence keeps condition riders off.
 *
 * AA2c (docs/tasks/TASK-CA-AA2c.md; user answers 2026-10-22): "riders land whenever the attack hit, even if its damage
 * was negated (only a miss or full avoidance stops them)"; "damage reflected at a PC attacker opens the normal
 * incoming-hit prompt" (a new hit on that PC in the same group, the reflecting PC as its attacker).
 */
import { applyDamageTo, type Combatant } from "../../src/lib/domain/combat-actions/index";
import {
  afterHitAmount,
  afterHitFeatures,
  afterHitUses,
  armorAnswered as armorAnsweredOf,
  targetArmorPreview,
  awaiting as awaitingOf,
  cardAnswers,
  chooseSteps,
  featureAnswers,
  featureUse,
  grantAnswers,
  grantsTaken,
  hitRuleNotes,
  isComplete,
  armorOptions,
  marksFactor,
  openWindow,
  optionalSteps,
  progress as progressOf,
  resolveNow,
  resolveWindow,
  respond as windowRespond,
  runReactionCard,
  runReactionFeature,
  slotsPerStep,
  targetPrompt,
  type HitChoice,
  type MarkFacts,
  type PcSeverity,
  type WindowResolution,
} from "../../src/lib/domain/adversary-actions/index";
import type { PlanStep, RunPlan, RunRefusal } from "../../src/lib/domain/card-effects/run";
import { expire, payMaintain, takenSeverity, type EndOccurrence } from "../../src/lib/domain/characters/expiry";
import { activeBeastform, owned } from "../../src/lib/domain/feature-effects/owned";
import { beastformEndsOn } from "../../src/lib/srd/feature-effects/beastforms";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { lastHpNote } from "../../src/lib/domain/death/index";
import { logAction } from "./actionLog";
import { postRuleNote, ruleMode } from "./ruleModes";
import {
  answeringFeatures,
  armorCostOf,
  attackerAreasOnMap,
  attackerBandsOnMap,
  attackerCombatant,
  effectiveKeyword,
  hitKeywordInfoOf,
  keywordGuards,
  markHpGuard,
  markHpKeywordOf,
  rollEndLines,
  type KeywordInfo,
  attackRollOf,
  featureActor,
  featureChoices,
  goldForHpOf,
  hitRulesOf,
  hopeAndFearOf,
  isFeatureId,
  progressAmount,
  resolveRerolls,
  spentDiceChoice,
  standardDamageOf,
  cardRefusal,
  isHitRow,
  isPcAttacker,
  memberId,
  partyMembers,
  rebuildWindow,
  respondingParty,
  runAfterHitCard,
  seededRng,
  sheetAfterCard,
  windowHitOf,
  windowParty,
  windowPcOf,
  applyRiders,
  bandsOnMap,
  type BandBetween,
  type HitAttacker,
  type HitDraft,
  type HitRow,
  type PartyMember,
  type Rebuilt,
} from "./adversaryHits";
import type { CardChoice } from "./cardChoices";
import { actorSheetAfter, cardActor, cardIdOfEffect, pcCombatant } from "./cardRunner";
import { readSheet, saveSheet } from "./characterSheet";
import { effectEndsOf, endCasterAreas, endForCasterOnInstances, endForCasterOnSheets, endOnSheet, refusedConditions } from "./cardRows";
import { tokensOnMap } from "./combatMaps";
import { closeRequest } from "./combatRequests";
import { dropStance } from "./stanceDrop";
import { logUnshakable, UNSHAKABLE_ID, unshake, unshakableText, unshakePlan, type UnshakableRoll } from "./unshakable";
import type { AdversaryBefore } from "./validators/actionLog";
import { MAX_RIDERS, type AfterHit, type HitResponder, type HitRider, type KeywordAnswer, type KeywordAsk } from "./validators/combatRequests";
import type { DamageKeyword } from "../../src/lib/domain/card-effects/types";

// The building blocks moved to ./adversaryHits.ts (AA2c, CH9); callers keep importing them from here.
export {
  applyRiders,
  attackerInstanceId,
  bandsOnMap,
  isHitRow,
  isPcAttacker,
  memberId,
  partyMembers,
  rebuildWindow,
  seededRng,
  windowPcOf,
  type BandBetween,
  type HitAttacker,
  type HitDraft,
  type HitRow,
  type PartyMember,
  type Rebuilt,
} from "./adversaryHits";

/** Effects that end with the Beastform (CB p.30 Evolution: "until you drop out of that Beastform"; classFeatures ENDS_WITH). */
const BEASTFORM_EFFECTS = new Set(["beastform", "evolution"]);

/**
 * DA10 (dcm-bxp.99.19.6 (1)): the sheet out of its Beastform when a resolved hit sets off one of the form's end events
 * (`beastformEndsOn`: the last Hit Point, and Major or greater damage for a Fragile form, CB p.30, p.32). An Evolved form
 * keeps its base form's features (CB p.34: "you retain all traits and features from the original form"), so a Fragile
 * base counts; a Hybrid counts when it picked Fragile. Null when the form stays (or there is none).
 */
export function beastformEnds(sheet: CharacterSheet, hit: { lastHp: boolean; severity: PcSeverity }): { sheet: CharacterSheet; words: string } | null {
  const form = activeBeastform(sheet);
  if (form === null) return null;
  const events = new Set([
    ...beastformEndsOn(form.formId),
    ...(form.baseFormId ? beastformEndsOn(form.baseFormId) : []),
    ...((form.hybridFeatures ?? []).some((p) => p.endsWith(":fragile")) ? (["majorDamage"] as const) : []),
  ]);
  const ends = (hit.lastHp && events.has("lastHp")) || (events.has("majorDamage") && (hit.severity === "major" || hit.severity === "severe"));
  if (!ends) return null;
  return { sheet: { ...sheet, effects: sheet.effects.filter((e) => !BEASTFORM_EFFECTS.has(e.id)) }, words: "drops out of Beastform" };
}

// ---------------------------------------------------------------- the GM's keyword ask (E2.4, dcm-sk4r)

/**
 * Plan lanes-2, E2.4 (dcm-sk4r; user answer 2026-10-31: "Fireproof on an untyped hit: the GM decides whether the hit is
 * fire; a fire-tagged hit applies it directly"): the ask a new hit stores. When the data can't settle the hit's keyword
 * (`info.known` false) and the target holds a keyword guard (Fireproof, HF p.22): with the caller's own step keyword
 * (`draft`), an ask already answered by it (no `answeredBy`: the data's, not the GM's); otherwise an open ask the GM
 * answers. Null when nothing needs asking.
 */
export function openingKeywordAsk(info: KeywordInfo, draft: DamageKeyword | undefined, target: PartyMember | undefined, hopeAndFear: boolean): KeywordAsk | null {
  if (info.known || target === undefined) return null;
  const guard = keywordGuards(target.sheet, hopeAndFear)[0];
  if (!guard) return null;
  const ask: KeywordAsk = { keyword: draft ?? guard.keyword, characterId: target.character._id, feature: guard.feature };
  return draft !== undefined ? { ...ask, answer: true } : ask;
}

/** Whether the hit's keyword ask still waits for the GM. */
export function keywordAskOpen(ask: KeywordAsk | null | undefined): boolean {
  return ask !== null && ask !== undefined && ask.answer === undefined;
}

/** The GM's question: "Was this hit fire? (Fireproof)". */
export function keywordAskQuestion(ask: Pick<KeywordAsk, "keyword" | "feature">): string {
  return `Was this hit ${ask.keyword}? (${ask.feature})`;
}

/** The most responders one window lists (the party cap the validator names, CD8). */
export const MAX_RESPONDERS = 12;

// ---------------------------------------------------------------- opening a hit

export type OpenHitInput = {
  campaignId: Id<"campaigns">;
  encounterId?: Id<"encounters">;
  mapId?: Id<"combatMaps">;
  /** The GM who made the attack (the rows' actor). */
  createdBy: Id<"users">;
  /** The action's actionLog group; the hit's resolution logs into it, so one undo reverts the lot (U4). */
  groupId: string;
  attacker: HitAttacker;
  targetCharacterId: Id<"characters">;
  targetTokenId?: Id<"combatTokens">;
  hit: HitDraft;
  party: readonly PartyMember[];
  bands: BandBetween;
  /** AA2b: the attack's riders, for whoever takes the hit (at most MAX_RIDERS). */
  riders?: readonly HitRider[];
};

/**
 * Opens one hit's reaction window (Q13): the responders are the target (when they can mark an Armor Slot or hold an
 * eligible card) and every ally with an eligible reaction card (at most MAX_RESPONDERS). A window nobody has to answer
 * resolves in the same mutation. Returns the row and, when it resolved, the resolution.
 *
 * Card damage to another PC (user answer 2026-10-22) opens the same row with a PC `attacker` (AA2b, widened); that PC
 * doesn't answer their own card's hit.
 */
export async function openIncomingHit(ctx: MutationCtx, input: OpenHitInput): Promise<{ requestId: Id<"combatRequests">; resolution: HitResolution | null }> {
  const riders = (input.riders ?? []).slice(0, MAX_RIDERS);
  // SD4: the PCs carry their features (owned, with effect entries) and their band to the attacker.
  const hopeAndFear = await hopeAndFearOf(ctx, input.campaignId);
  const toAttacker = await attackerBandsOnMap(ctx, input.mapId, input.attacker);
  // Plan lanes-2, E2: the hit's keyword (dcm-dv6) and the areas the attacker stands in (dcm-nt4), as `rebuildWindow`.
  // E2.4 (dcm-sk4r): the step's own keyword wins; a guarded target on a hit the data can't settle gets the GM's ask.
  const info = await hitKeywordInfoOf(ctx, { campaignId: input.campaignId, payload: { attacker: input.attacker } });
  const keywordAsk = openingKeywordAsk(info, input.hit.keyword, input.party.find((m) => m.character._id === input.targetCharacterId), hopeAndFear);
  const keyword = effectiveKeyword(input.hit.keyword !== undefined ? { keyword: input.hit.keyword, known: true } : info, keywordAsk ? { keywordAsk } : {});
  const attackerAreas = await attackerAreasOnMap(ctx, input.mapId, input.attacker);
  const party = windowParty(respondingParty(input.party, input.attacker), input.targetCharacterId, input.bands, { hopeAndFear, toAttacker, ...(keyword ? { keyword } : {}), ...(attackerAreas ? { attackerAreas } : {}) });
  const attacker = await openingAttacker(ctx, input);
  // E2 (dcm-s77): the attacker's dearer Armor Slots, re-read from its stat block (as `rebuildWindow`).
  const armorCost = await armorCostOf(ctx, { campaignId: input.campaignId, payload: { attacker: input.attacker } });
  // Plan lanes-2, E2.3 (dcm-5cn5): the attacker's gold-instead-of-HP grant (Money Talks), re-read like the armor cost.
  const gold = await goldForHpOf(ctx, { campaignId: input.campaignId, payload: { attacker: input.attacker } });
  // Rule switches RC2: A1 (no Armor Slot offer in Manual), D2, D4, D5 and Massive Damage, as `rebuildWindow`.
  const rules = await hitRulesOf(ctx, input.campaignId);
  const state = openWindow({ hit: windowHitOf(input.attacker, input.hit, riders, armorCost, keyword, gold), targetId: input.targetCharacterId, party, rules, ...(attacker ? { attacker } : {}) });
  const responders: HitResponder[] = state.responders.slice(0, MAX_RESPONDERS).map((r) => ({
    characterId: memberId(input.party, r.characterId, input.targetCharacterId),
    role: r.role,
    // SD4: the feature ids ride after the card ids (told apart by their `<source>:` prefix; the validator is unchanged).
    cardIds: [...r.cardIds.slice(0, 10), ...(r.featureIds ?? []).slice(0, 10)],
  }));
  const own = await ownAttack(ctx, input);
  const requestId = await ctx.db.insert("combatRequests", {
    campaignId: input.campaignId,
    ...(input.encounterId ? { encounterId: input.encounterId } : {}),
    ...(input.mapId ? { mapId: input.mapId } : {}),
    kind: "incomingHit",
    status: "open",
    createdBy: input.createdBy,
    createdAt: Date.now(),
    responses: [],
    payload: {
      schemaVersion: 1,
      kind: "incomingHit",
      attacker: input.attacker,
      targetCharacterId: input.targetCharacterId,
      ...(input.targetTokenId ? { targetTokenId: input.targetTokenId } : {}),
      damage: Math.max(0, Math.trunc(input.hit.amount)),
      damageType: input.hit.type,
      direct: input.hit.direct,
      ...(input.hit.forcedArmor > 0 ? { forcedArmor: input.hit.forcedArmor } : {}),
      critical: input.hit.critical,
      groupId: input.groupId,
      responders,
      ...(riders.length > 0 ? { riders: [...riders] } : {}),
      ...(own.total !== undefined ? { attackTotal: own.total } : {}),
      ...(own.disadvantage > 0 ? { attackDisadvantage: own.disadvantage } : {}),
      ...(keywordAsk ? { keywordAsk } : {}),
    },
  });
  // E2.4 (dcm-sk4r): an open ask holds the hit until the GM answers (`answerKeywordAsk`) or resolves it now (not fire).
  if (keywordAskOpen(keywordAsk) || !isComplete({ ...state, responders: state.responders.slice(0, MAX_RESPONDERS) })) return { requestId, resolution: null };
  const row = await ctx.db.get("combatRequests", requestId);
  if (row === null || !isHitRow(row)) throw new Error("openIncomingHit: the row just written is gone.");
  return { requestId, resolution: await resolveIncomingHit(ctx, { row, by: input.createdBy, early: false, ...(input.hit.attackTotal !== undefined ? { attackTotal: input.hit.attackTotal } : {}) }) };
}

/**
 * DA8 (DA1 follow-up 2): this target's own attack total and the disadvantage it adds to the roll, stored with the hit so
 * a window rebuilt later compares Evasion answers with its own total and rerolls with its own disadvantage. The
 * disadvantage is read from the totals (the action's GM row is written before its hits): a total below the whole roll's
 * means the target kept the lower die for its own disadvantage (Sturdy, Harrowing; one source more than the roll).
 * Two equal dice can't be told apart, so such a target rerolls with the whole roll's advantage / disadvantage.
 */
async function ownAttack(ctx: QueryCtx, input: OpenHitInput): Promise<{ total?: number; disadvantage: number }> {
  const total = input.hit.attackTotal;
  if (total === undefined || isPcAttacker(input.attacker)) return { disadvantage: 0 };
  const record = await attackRollOf(ctx, { campaignId: input.campaignId, payload: { groupId: input.groupId } });
  return { total, disadvantage: record !== null && total < record.total ? 1 : 0 };
}

/** The attacker as a creature when the hit opens (the feature triggers' `source`); null when it is gone. */
async function openingAttacker(ctx: QueryCtx, input: OpenHitInput): Promise<Combatant | null> {
  return (await attackerCombatant(ctx, { campaignId: input.campaignId, payload: { attacker: input.attacker } }, input.party))?.combatant ?? null;
}

// ---------------------------------------------------------------- answering

/** A stored or sent answer: the window's choices, or (SD4) a feature use with its `useFeature` choices. */
export type AnswerChoice = Exclude<HitChoice, { kind: "feature" }> | { kind: "feature"; featureId: string; useId?: string; choices: CardChoice[] };

export type RespondInput = { row: HitRow; characterId: Id<"characters">; choice: AnswerChoice; by: Id<"users"> };

/** The runner's refusals of a feature answer as SD0's FEATURE_* codes (as ./featureRunner.ts `featureRefusal`). */
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
    default:
      return appError("INVALID", r.detail);
  }
}

/** A `choose` step the answer left unpicked (Not This Time: the attack or the damage) refuses: INVALID. */
export function assertPicked(plan: RunPlan) {
  const open = plan.steps.find((s: PlanStep) => s.kind === "prompt" && s.prompt === "choose");
  if (open && open.kind === "prompt") throw appError("INVALID", `Pick one: ${open.text}.`);
}

/** The manual words a feature's plan leaves for the table (Unshakable's 6, Loyal Protector's sprint). */
export function manualWords(plan: RunPlan): string[] {
  return plan.steps.flatMap((s: PlanStep) => (s.kind === "prompt" && s.prompt === "manual" ? [s.text] : []));
}

/**
 * SD4: what a feature's plan did to the attacker (Revenge's Hit Point, Draining Bane's Stress, Deadly Vengeance, Eye for
 * an Eye, Elemental Incarnation's Fire), written on the instance (read fresh: several answers may touch it in one
 * mutation); its before-state for the GM row, so undo puts it back (U4). A PC attacker's marks are left to the table.
 */
export async function writeAttackerChanges(
  ctx: MutationCtx,
  plan: RunPlan,
  attacker: { instance: Doc<"encounterAdversaries"> | null; combatant: Combatant } | null,
  label: string,
): Promise<{ before: AdversaryBefore | null; line: string | null }> {
  if (!attacker) return { before: null, line: null };
  const changed = plan.creatures.find((c) => c.id === attacker.combatant.id);
  if (!changed) return { before: null, line: null };
  const hpDelta = changed.after.hp - changed.before.hp;
  const stressDelta = changed.after.stress - changed.before.stress;
  if (hpDelta === 0 && stressDelta === 0) return { before: null, line: null };
  const words = [hpDelta !== 0 ? `${hpDelta} HP` : "", stressDelta !== 0 ? `${stressDelta} Stress` : ""].filter(Boolean).join(", ");
  if (attacker.instance === null) return { before: null, line: `${label} marks ${words}: mark it on their sheet` };
  const instance = await ctx.db.get("encounterAdversaries", attacker.instance._id);
  if (instance === null) return { before: null, line: null };
  const before: AdversaryBefore = { instanceId: instance._id, hp: instance.hp, stress: instance.stress, defeated: instance.defeated, conditions: instance.conditions, tags: instance.tags };
  const hp = Math.max(0, Math.min(instance.stats.hpMax, instance.hp + hpDelta));
  const stress = Math.max(0, Math.min(instance.stats.stressMax, instance.stress + stressDelta));
  await ctx.db.patch("encounterAdversaries", instance._id, { hp, stress, defeated: instance.defeated || hp >= instance.stats.hpMax, updatedAt: Date.now() });
  return { before, line: `${label} marks ${words} (${hp}/${instance.stats.hpMax} HP, ${stress}/${instance.stats.stressMax} Stress)` };
}

/** One answered feature: the responder's sheet after it, the stored choice and the attacker's changes. */
type FeaturePaid = { sheet: CharacterSheet; name: string; choice: AnswerChoice; plan: RunPlan; effect: FeatureEffect };

/**
 * Records one answer (Q13, Q17): the target's armor choice (`armor {slots}` up to what this hit allows, `noArmor`,
 * `pass`) or a responder's reaction card, run through CA1's card runner with the hit as its trigger and paid at once
 * (its Stress / Hope, its once-per entry, Shrug It Off's vault). SD4: or a feature use the responder may answer with now
 * (`featureAnswers`: its trigger fits the hit as the answers so far left it, ready and affordable), run through SD1's
 * feature runner and paid at once (Favor, Focus, held dice too); what it does to the attacker (Revenge) is written now.
 * NOT_A_RESPONDER for a character the window doesn't list, one that already answered, or a card or feature it wasn't
 * offered; INVALID for more Armor Slots than allowed or a missing pick. Returns whether the window is now complete.
 */
export async function respondToHit(ctx: MutationCtx, input: RespondInput): Promise<{ complete: boolean }> {
  const { row, characterId, choice } = input;
  const rebuilt = await rebuildWindow(ctx, row);
  const { state, members, attacker } = rebuilt;
  const member = members.find((m) => m.character._id === characterId);
  if (!member) throw appError("NOT_A_RESPONDER");
  let folds;
  let paid: { sheet: CharacterSheet; cardName: string; manual: string[] } | null = null;
  let feature: FeaturePaid | null = null;
  const unshaken: UnshakableRoll[] = [];
  if (choice.kind === "armor") {
    const slots = choice.slots ?? 1;
    if (!Number.isInteger(slots) || slots < 1) throw appError("INVALID", "Mark at least one Armor Slot.");
    const defense = rebuilt.party.find((p) => p.id === characterId);
    if (state.targetId === characterId && defense && slots > targetPrompt(state, defense).maxSlots) throw appError("INVALID", "You can't mark that many Armor Slots on this hit.");
    // E2 (dcm-s77): dearer slots are marked in whole steps (Armor Eater: 2 for one threshold).
    if (slots % slotsPerStep(state.hit) !== 0) throw appError("INVALID", `Mark Armor Slots in steps of ${slotsPerStep(state.hit)} on this hit.`);
  }
  if (choice.kind === "card") {
    const card = cardEffect(choice.cardId);
    const target = members.find((m) => m.character._id === state.targetId);
    if (!card || !target) throw appError("NOT_A_RESPONDER", choice.cardId);
    const actor = cardActor(characterId, member.sheet, card.cardId, undefined);
    const creatures = { target: pcCombatant(target.character._id, target.sheet), ...(attacker ? { attacker: attacker.combatant } : {}) };
    const run = runReactionCard(card, actor, state, creatures, seededRng(`${row._id}:${row.responses.length}`), choice.useId);
    if (!run.result.ok) throw cardRefusal(run.result);
    folds = run.folds;
    const cardName = getDomainCard(card.cardId)?.name ?? card.cardId;
    // DA10: Unshakable (CB p.59) on the card's Stress cost.
    const u = unshakePlan(member.sheet, sheetAfterCard(member.sheet, run.result.plan, characterId, cardName), run.result.plan, characterId, true);
    if (u.roll) unshaken.push(u.roll);
    // Plan lanes-2, E2.3 (TASK-LN2-R1's finding): the card's manual words go on its line, as a feature answer's do.
    // Plan lanes-2, E2.4 (dcm-8fc2): what the card's own roll ended on the responder (Vanishing Act's Cloaked) is named.
    paid = { sheet: u.sheet, cardName, manual: [...manualWords(run.result.plan), ...rollEndLines(member.sheet.name, member.sheet, run.result.plan)] };
  }
  if (choice.kind === "feature") {
    const pc = rebuilt.party.find((p) => p.id === characterId);
    const effect = pc?.features?.find((f) => f.featureId === choice.featureId);
    const target = members.find((m) => m.character._id === state.targetId);
    const defense = rebuilt.party.find((p) => p.id === state.targetId);
    const now = featureAnswers(state, characterId).find((f) => f.featureId === choice.featureId && (choice.useId === undefined || f.useId === choice.useId));
    if (!effect || !target || !defense || !now) throw appError("NOT_A_RESPONDER", choice.featureId);
    const creatures = { target: pcCombatant(target.character._id, target.sheet), ...(attacker ? { attacker: attacker.combatant } : {}) };
    const index = row.responses.length;
    const ran = runReactionFeature(effect, featureActor(characterId, member.sheet), state, creatures, seededRng(`${row._id}:${index}`), { useId: now.useId, amount: progressAmount(state, defense), ...featureChoices(choice.choices) });
    if (!ran.result.ok) throw featureRefusal(ran.result);
    assertPicked(ran.result.plan);
    const damage = ran.folds.some((f) => f.kind === "rerollDamage") ? await standardDamageOf(ctx, row, attacker) : null;
    folds = resolveRerolls(ran.folds, `${row._id}:${index}:reroll`, isPcAttacker(row.payload.attacker) ? null : await attackRollOf(ctx, row), damage, { disadvantage: row.payload.attackDisadvantage ?? 0 });
    const plan = ran.result.plan;
    const spent = spentDiceChoice(plan);
    const stored: AnswerChoice = { kind: "feature", featureId: effect.featureId, useId: plan.useId, choices: [...choice.choices.filter((c) => c.id !== "spentDice"), ...(spent ? [spent] : [])] };
    feature = { sheet: actorSheetAfter(member.sheet, plan, characterId, plan.name, { out: unshaken }), name: plan.name, choice: stored, plan, effect };
  }
  const next = windowRespond(state, { characterId, choice: feature ? feature.choice : choice, ...(folds ? { folds } : {}) });
  if (!next.ok) throw appError(next.code, next.detail);

  const targetName = members.find((m) => m.character._id === state.targetId)?.sheet.name ?? "an ally";
  if (paid) {
    await saveSheet(ctx, characterId, paid.sheet);
    await logAction(ctx, {
      campaignId: row.campaignId,
      characterId,
      actorId: row.createdBy,
      kind: "adversary",
      visibility: "public",
      summary: `${member.sheet.name} uses ${paid.cardName}${characterId === state.targetId ? "" : ` for ${targetName}`}${paid.manual.length > 0 ? ` (${paid.manual.join("; ")})` : ""}`.slice(0, 1000),
      groupId: row.payload.groupId,
      before: member.sheet,
      undoable: true,
    });
  }
  if (feature) {
    await saveSheet(ctx, characterId, feature.sheet);
    // E2.4 (dcm-8fc2): `actorSheetAfter` already ended what the feature's own roll ends; the line names it.
    const manual = [...manualWords(feature.plan), ...rollEndLines(member.sheet.name, member.sheet, feature.plan)];
    await logAction(ctx, {
      campaignId: row.campaignId,
      characterId,
      actorId: row.createdBy,
      kind: isPcAttacker(row.payload.attacker) ? "combat" : "adversary",
      visibility: "public",
      summary: `${member.sheet.name} uses ${feature.name}${characterId === state.targetId ? "" : ` for ${targetName}`}${manual.length > 0 ? ` (${manual.join("; ")})` : ""}`.slice(0, 1000),
      groupId: row.payload.groupId,
      before: member.sheet,
      undoable: true,
    });
    const written = await writeAttackerChanges(ctx, feature.plan, attacker, row.payload.attacker.label);
    if (written.line) {
      await logAction(ctx, {
        campaignId: row.campaignId,
        actorId: row.createdBy,
        kind: "adversary",
        visibility: "gm",
        summary: `${member.sheet.name} · ${feature.name} → ${written.line}`,
        groupId: row.payload.groupId,
        ...(written.before ? { adversaryBefore: [written.before] } : {}),
        undoable: true,
      });
    }
  }
  for (const roll of unshaken) await logUnshakable(ctx, { campaignId: row.campaignId, characterId, actorId: row.createdBy, name: member.sheet.name, groupId: row.payload.groupId }, roll);
  await ctx.db.patch("combatRequests", row._id, { responses: [...row.responses, { characterId, choice: feature ? feature.choice : (choice as Exclude<AnswerChoice, { kind: "feature" }>), by: input.by, at: Date.now() }] });
  // E2.4 (dcm-sk4r): an open keyword ask holds the hit for the GM's answer.
  return { complete: isComplete(next.state) && !keywordAskOpen(row.payload.keywordAsk) };
}

// ---------------------------------------------------------------- resolving

export type HitResolution = {
  requestId: Id<"combatRequests">;
  /** The action's actionLog group (the attacker's triggers log into it). */
  groupId: string;
  attacker: HitAttacker;
  originalTargetId: Id<"characters">;
  /** Who took the hit (after I Am Your Shield). */
  targetId: Id<"characters">;
  missed: boolean;
  negated: boolean;
  severity: PcSeverity;
  hpMarked: number;
  stressMarked: number;
  armorMarked: number;
  deathMove: boolean;
  taken: number;
  manual: string[];
  /** The window's raw resolution (the adversary side reads it for its triggers). */
  window: WindowResolution;
  /** AA2b: the riders that landed on the target (none when the attack missed or Bold Presence kept them off). */
  ridersApplied: number;
  /** AA2b: after-hit card uses that ran at once (Rise Up, Valor-Touched), by card name. */
  autos: string[];
  /** AA2b: set when the target still has an after-hit card to answer (the row stays open for it). */
  afterHit: AfterHit | null;
  /** AA2c: the incoming hit opened on a PC attacker for damage reflected at them (Arcane Reflection against a card). */
  reflectedHitId?: Id<"combatRequests">;
  /**
   * E2 (dcm-sos): the target marked Armor Slots to reduce this hit (Rend and Crush, CB p.233: "If a target damaged by the
   * Dragon doesn't mark an Armor Slot to reduce the damage"; the `usedArmor` state check after the window).
   */
  usedArmor: boolean;
};

const SEVERITY_WORD: Record<PcSeverity, string> = { none: "No damage", minor: "Minor", major: "Major", severe: "Severe" };
const TYPE_WORD = { physical: "phy", magic: "mag", both: "phy/mag" } as const;

/**
 * Resolves the hit (Q17: complete, or the GM's "Resolve now" with `early`): AA1's `resolveWindow`, then the target's
 * HP / Stress / Armor / Hope on the sheet (CB p.91, p.114, p.92), reflected damage dealt to the attacker, and the rows:
 * a public row "<target> took <attacker>'s hit" (no numbers, Q14) with the sheet before, and a GM row with the damage,
 * severity, armor and marks (and the attacker's `adversaryBefore` when it took reflected damage). Closes the request.
 */
export async function resolveIncomingHit(ctx: MutationCtx, input: { row: HitRow; by: Id<"users">; early: boolean; attackTotal?: number }): Promise<HitResolution> {
  const { row } = input;
  const p = row.payload;
  const rebuilt = await rebuildWindow(ctx, row, input.attackTotal);
  const state = input.early ? resolveNow(rebuilt.state) : rebuilt.state;
  const res = resolveWindow(state, rebuilt.party);
  const target = rebuilt.members.find((m) => m.character._id === res.targetId);
  const result = res.result;
  const gm: string[] = [];
  const targetName = target?.sheet.name ?? "The target";

  let ridersApplied = 0;
  let deathMove = false;
  const adversaryBefore: AdversaryBefore[] = [];
  let afterHit: AfterHit | null = null;
  const autos: string[] = [];
  const kind = isPcAttacker(p.attacker) ? ("combat" as const) : ("adversary" as const);
  // Rule switches RC2: the modes the window resolved with (A1, D2, D4, D5, Massive Damage).
  const hitRules = rebuilt.state.rules ?? {};
  let riderOverflowDropped = false;

  if (target && result) {
    const sheet = target.sheet;
    let next: CharacterSheet = { ...sheet, hp: result.after.hp, stress: result.after.stress, armorMarked: result.after.armor, hope: Math.max(0, result.after.hope) };
    // E2 (dcm-fyb, user answer 2026-10-30): a successful attack ends the PC's "until an attack succeeds against you" effects
    // (Rogue's Dodge, CB p.42), before this attack's own riders land. The manual Got hit button stays as a fallback.
    const succeeded = attackSucceeded(p, rebuilt.state.hit.attackTotal);
    if (succeeded) next = expire(next, "hit");
    // E2 (dcm-sim): what a card's answer turned into no Hit Points ends (Shield Aura, CB p.341).
    const ended = endedOnNoHp(next, res.endedOnNoHp);
    next = ended.sheet;
    if (ended.names.length > 0) gm.push(`${targetName}: ${ended.names.join(", ")} ended (no Hit Points marked)`);
    // Plan lanes-2, E2.3: what the target took of the attacker's grants (`grant` answers, the current target's only).
    const grants = grantsTaken(state);
    // dcm-5cn5 (Money Talks, CB p.228: "spend a handful of gold instead of marking HP (1 handful per HP)"): the handfuls
    // replace the HP this hit's damage marks (capped by those and by the handfuls held); the Demon's Collect is the GM's.
    const goldSpent = Math.min(grants.gold, Math.max(0, next.hp - sheet.hp), sheet.gold.handfuls);
    if (goldSpent > 0) {
      next = { ...next, hp: next.hp - goldSpent, gold: { ...next.gold, handfuls: next.gold.handfuls - goldSpent } };
      gm.push(`${targetName} pays ${goldSpent} handful${goldSpent === 1 ? "" : "s"} of gold instead of ${goldSpent} HP: add ${goldSpent === 1 ? "it" : "them"} to ${p.attacker.label}'s gold (Collect)`);
    }
    // The attack's riders land on whoever took the hit (user answer 2026-10-22, AA2b), also when only its damage was
    // negated or reflected; a miss or full avoidance stops them (AA2c, user answer 2026-10-22).
    // Plan lanes-2, E2.4 (dcm-sk4r): a hit carrying a guarded keyword was ignored by the guard (Fireproof, HF p.22).
    const hopeAndFear = await hopeAndFearOf(ctx, row.campaignId);
    const hitKeyword = rebuilt.state.hit.keyword;
    const hitGuard = hitKeyword !== undefined && !res.missed ? markHpGuard(sheet, hopeAndFear, hitKeyword) : null;
    if (hitGuard) gm.push(`${targetName}: ${hitGuard.feature} (immune to ${hitKeyword} damage)`);
    // E2.4 (dcm-n7kt): the attacking feature's outright HP marks carry its `markHp` keyword (Fire Beam, HF p.96); a guard
    // of that keyword stops them (Fireproof: "immune to damage from magical or mundane flame").
    const hpKeyword = !res.missed && (p.riders ?? []).some((r) => r.kind === "hp") ? await markHpKeywordOf(ctx, row) : undefined;
    const hpGuard = markHpGuard(sheet, hopeAndFear, hpKeyword);
    if (hpGuard) gm.push(`${targetName}: ${hpGuard.feature} (immune to ${hpKeyword}): no Hit Points marked from ${p.attacker.feature ?? p.attacker.label}`);
    const riders = hpGuard ? (p.riders ?? []).filter((r) => r.kind !== "hp") : (p.riders ?? []);
    if (!res.missed && riders.length > 0) {
      // DA8: after Dark Aegis the conditions still land, any extra "mark HP" doesn't (user answer 2026-10-29).
      // Plan lanes-2, E2 (dcm-t8c): conditions the PC's effects forbid stay off (Unstoppable, CB p.36, dcm-v17).
      // Plan lanes-2, E2.3 (dcm-nnbl, HF p.75): the Hope the target chose to spend comes off the riders' forced HP.
      const defense = rebuilt.party.find((x) => x.id === target.character._id);
      const landed = applyRiders(next, riders, res.conditionNegated, res.hpRidersIgnored, refusedConditions(next), { amount: grants.hope, factor: defense ? marksFactor(defense, "hope") : 1 }, hitRules);
      next = landed.sheet;
      riderOverflowDropped = landed.overflowDropped === true;
      ridersApplied = landed.applied;
      gm.push(
        `riders on ${targetName}: ${ridersApplied}${res.conditionNegated ? " (conditions avoided)" : ""}${res.hpRidersIgnored ? " (no Hit Points from them)" : ""}${landed.hopeSpent > 0 ? ` (${landed.hopeSpent} Hope spent for fewer HP)` : ""}`,
      );
    }
    // DA10 (CB p.59 Unshakable, user 2026-10-30): a d6 for each Stress the hit (marked instead of HP) and its riders
    // would mark; a 6 skips that one. Counted before the after-hit uses, so "when you mark a Stress" reads the result.
    const riderStress = !res.missed ? (p.riders ?? []).reduce((n, r) => n + (r.kind === "stress" ? Math.max(0, Math.trunc(r.amount)) : 0), 0) : 0;
    const shaken = unshake(sheet, next, result.stressMarked + (result.overflow ? 1 : 0) + riderStress);
    next = shaken.sheet;
    const hpMarked = Math.max(0, next.hp - sheet.hp);
    deathMove = next.hpMax > 0 && sheet.hp < next.hpMax && next.hp >= next.hpMax;
    // Plan lanes-2, E2 (dcm-t8c): the hit's end events (E6's engine, convex/lib/cardRows.ts) on the PC who took it and on
    // the effects they made on the party: Transform (CB p.334, "until you take damage"; dcm-utu), Night's Glamour (HF
    // p.17, on a Hit Point marked; dcm-4qv: its Stress to maintain it is offered below), Eye of the Storm (HF p.23, on the
    // caster's Severe damage; dcm-wjv). A hit reduced to no Hit Points ends only what the window's `endedOnNoHp` says
    // (Shield Aura made the difference, dcm-sim), so it doesn't run here.
    // User answer 2026-10-31 (plan lanes-2, E2.3): "took damage" means at least 1 HP was actually marked. A hit that armor,
    // a feature or a grant left at 0 HP marked is not taking damage even at Minor or worse (Slumber, CB p.332: "Asleep
    // until they take damage"; replaces round-1 E6 Q1's reading), so its severity counts as none here and no `takeDamage`
    // / `majorDamage` end fires; what ends on `reducedToNoHp` is the window's `endedOnNoHp` (dcm-sim).
    const occ: EndOccurrence = { kind: "damageTaken", severity: hpMarked > 0 ? result.severity : "none", hpMarked, lastHp: deathMove };
    const hitEnds = hitEndEvents(next, occ, target.character._id, await partyMembers(ctx, row.campaignId));
    next = hitEnds.sheet;
    gm.push(...hitEnds.lines);
    // Plan lanes-2, E2.3 (dcm-8f51): what the hit PC made on the adversaries and their live areas end on the caster's
    // damage too (Hush, CB p.336: "or you take Major damage"): the instances in the GM row's `adversaryBefore` (undo).
    const casterEnds = await hitCasterEnds(ctx, row, target.character._id, occ);
    gm.push(...casterEnds.lines);
    adversaryBefore.push(...casterEnds.before);
    // After-hit card uses (CE-valor): autos run now; reactions are offered with the row kept open.
    const facts: MarkFacts = { hpMarked, deathMove, armorSlots: result.armorSlots, fromAttack: true, severity: result.severity, stressMarked: Math.max(0, next.stress - sheet.stress), damageType: p.damageType };
    const uses = afterHitUses(windowPcOf({ character: target.character, sheet: next }), facts);
    const laterRolls: UnshakableRoll[] = [];
    for (const [i, u] of uses.auto.entries()) {
      const ran = runAfterHitCard(target, next, u.cardId, u.useId, { amount: result.taken, ...(rebuilt.attacker ? { source: rebuilt.attacker.combatant } : {}) }, `${row._id}:after:${i}`);
      if ("ok" in ran) continue;
      const shook = unshakePlan(next, sheetAfterCard(next, ran.plan, target.character._id, ran.cardName), ran.plan, target.character._id, true);
      if (shook.roll) laterRolls.push(shook.roll);
      next = shook.sheet;
      autos.push(ran.cardName);
    }
    // SD4: after-hit feature uses: autos run now (Unshakable, Elemental Incarnation's Fire); reactions are offered.
    const scope = { hopeAndFear: await hopeAndFearOf(ctx, row.campaignId), toAttacker: await attackerBandsOnMap(ctx, row.mapId, p.attacker) };
    const toAttacker = scope.toAttacker(target.character._id);
    const pcNow = windowPcOf({ character: target.character, sheet: next }, undefined, { hopeAndFear: scope.hopeAndFear, ...(toAttacker !== undefined ? { bandToAttacker: toAttacker } : {}) });
    const featureUses = afterHitFeatures(pcNow, facts, { ...(pcNow.actor ? { subject: pcNow.actor } : {}), ...(rebuilt.attacker ? { source: rebuilt.attacker.combatant } : {}), taken: result.taken });
    for (const [i, u] of featureUses.auto.entries()) {
      // DA10: Unshakable already rolled on each Stress above (`unshake`).
      if (u.featureId === UNSHAKABLE_ID) continue;
      const effect = pcNow.features?.find((f) => f.featureId === u.featureId);
      if (!effect) continue;
      const ran = runAfterHitFeature(effect, u.useId, { character: target.character, sheet: next }, facts, result.taken, rebuilt.attacker?.combatant, `${row._id}:afterFeature:${i}`, [], laterRolls);
      if (!ran.ok) continue;
      next = ran.sheet;
      autos.push(ran.plan.name);
      for (const text of manualWords(ran.plan)) gm.push(`${targetName}: ${text}`);
      const written = await writeAttackerChanges(ctx, ran.plan, rebuilt.attacker, p.attacker.label);
      if (written.line) gm.push(written.line);
      if (written.before) adversaryBefore.push(written.before);
    }
    if (autos.length > 0) gm.push(`${targetName}: ${autos.join(", ")}`);
    const offers = [...uses.offers.slice(0, 10), ...featureUses.offers.slice(0, 10), ...hitEnds.maintain.slice(0, 4).map(maintainId)];
    if (offers.length > 0) afterHit = { characterId: target.character._id, cardIds: offers, severity: result.severity, hpMarked, deathMove };
    // DA10: what the hit ends. A Beastform on its end events (CB p.30: "If you mark your last Hit Point, you automatically
    // drop out of this form"; CB p.32 Fragile: "When you take Major or greater damage, you drop out of Beastform"), with
    // Evolution's +1 (CB p.30: "until you drop out of that Beastform"); the stance on Severe damage or the last Hit Point
    // (HF p.12), and what ends with it (Grappling's Restrain).
    const lastHp = next.hpMax > 0 && sheet.hp < next.hpMax && next.hp >= next.hpMax;
    // User answer 2026-10-31: Fragile's "take Major or greater damage" and the stance's "Severe damage" need a marked HP too.
    // Plan lanes-2, E2.4 (dcm-hs6u; same answer: "severity follows the HP actually marked after armor (Major = 2 HP,
    // Severe = 3 HP)"): the severity of the HP this hit's damage marked (`takenSeverity`, E6's reading: 1 Minor, 2 Major,
    // 3 Severe; on the last HP the hit's own severity when higher). Gold paid instead and forced HP riders don't count.
    const damageHp = Math.max(0, result.hpMarked - goldSpent);
    const markedSeverity = takenSeverity({ severity: damageHp > 0 ? result.severity : "none", hpMarked: damageHp, lastHp });
    const formEnds = beastformEnds(next, { lastHp, severity: markedSeverity });
    if (formEnds) next = formEnds.sheet;
    const endedWords: string[] = [...(formEnds ? [formEnds.words] : []), ...ended.names.map((n) => `${n} ends`), ...hitEnds.names.map((n) => `${n} ends`), ...casterEnds.areas.map((n) => `${n} ends`)];
    if (lastHp || markedSeverity === "severe") {
      const dropped = await dropStance(ctx, row.campaignId, next);
      if (dropped.dropped) {
        next = dropped.sheet;
        endedWords.push("drops out of their stance");
        gm.push(...dropped.lines);
        adversaryBefore.push(...dropped.before);
      }
    }
    const guardWords = hitGuard ? ` (${hitGuard.feature}: immune to ${hitKeyword})` : hpGuard ? ` (${hpGuard.feature}: no Hit Points from ${hpKeyword})` : "";
    await saveSheet(ctx, target.character._id, next);
    // The sheet's death move is due at once (user answer 2026-10-22; CB p.91): a new last HP clears an earlier "spent".
    if (deathMove) await ctx.db.patch("characters", target.character._id, { deathMoveSpent: undefined });
    // Rule switches RX, X1 Manual (CB p.106): nobody is asked for the death move; the GM gets a note instead.
    const campaign = deathMove ? await ctx.db.get("campaigns", row.campaignId) : null;
    const promptManual = campaign !== null && ruleMode(campaign, "deathMovePrompt") === "manual";
    const deathWords = !deathMove ? "" : promptManual ? " and marked their last Hit Point" : " and must make a death move";
    await logAction(ctx, {
      campaignId: row.campaignId,
      characterId: target.character._id,
      actorId: row.createdBy,
      kind,
      visibility: "public",
      summary: res.missed
        ? `${targetName} avoided ${p.attacker.label}'s hit`
        : res.negated
          ? `${targetName} took no damage from ${p.attacker.label}'s hit`
          : `${targetName} took ${p.attacker.label}'s hit${guardWords}${deathWords}${autos.length > 0 ? ` (${autos.join(", ")})` : ""}${endedWords.length > 0 ? `; ${endedWords.join(", ")}` : ""}`,
      groupId: p.groupId,
      before: sheet,
      undoable: true,
    });
    if (campaign !== null && promptManual) {
      await postRuleNote(ctx, campaign, { ruleId: "deathMovePrompt", summary: lastHpNote(targetName), characterId: target.character._id, groupId: p.groupId, actorId: row.createdBy });
    }
    // Rule switches RC2: the Manual notes of A1 (no Armor Slot offered), D2 (resistance not applied) and D4 (Stress past a
    // full track dropped), GM-only and in the hit's group (undone with it).
    const hitPc = rebuilt.party.find((x) => x.id === target.character._id);
    const armorWouldBeOffered = hitPc !== undefined && armorOptions(hitPc, rebuilt.state.hit).canUseArmor;
    for (const note of hitRuleNotes(targetName, result, hitRules, { armorWouldBeOffered, riderOverflowDropped })) {
      await postRuleNote(ctx, { _id: row.campaignId }, { ruleId: note.ruleId, summary: note.summary, characterId: target.character._id, groupId: p.groupId, actorId: row.createdBy });
    }
    // Plan lanes-2, E2 (dcm-wjv): allies whose effects the hit PC made ended with it (Eye of the Storm on an ally).
    for (const o of hitEnds.others) {
      await saveSheet(ctx, o.character._id, o.sheet);
      await logAction(ctx, { campaignId: row.campaignId, characterId: o.character._id, actorId: row.createdBy, kind, visibility: "public", summary: `${o.names.join(", ")} ends for ${o.before.name} (${targetName} took ${SEVERITY_WORD[result.severity]} damage)`, groupId: p.groupId, before: o.before, undoable: true });
    }
    for (const roll of [shaken.roll, ...laterRolls]) await logUnshakable(ctx, { campaignId: row.campaignId, characterId: target.character._id, actorId: row.createdBy, name: targetName, groupId: p.groupId }, roll);
    const armor = result.armorSlots > 0 ? `, ${result.armorSlots} Armor Slot${result.armorSlots === 1 ? "" : "s"}` : "";
    const forced = result.forcedArmor > 0 ? `, ${result.forcedArmor} forced` : "";
    const resisted = result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : "";
    const marks = [
      result.hpMarked > 0 ? `${result.hpMarked} HP (${result.after.hp}/${sheet.hpMax})` : "no HP",
      ...(result.stressMarked > 0 ? [`${result.stressMarked} Stress`] : []),
      ...(result.hopeSpent > 0 ? [`${result.hopeSpent} Hope`] : []),
      ...(shaken.roll ? [unshakableText(shaken.roll)] : []),
    ];
    gm.push(
      `${targetName}: ${result.incoming} ${TYPE_WORD[p.damageType]}${resisted} → ${result.massiveBefore ? "Massive" : SEVERITY_WORD[result.severityBefore]}${armor}${forced} → ${result.massive ? "Massive" : SEVERITY_WORD[result.severity]} → ${marks.join(", ")}${deathMove ? (promptManual ? "; last HP" : "; death move") : ""}`,
    );
  } else if (target) {
    gm.push(`${targetName}: ${res.missed ? "the hit became a miss" : "no damage"}`);
    await logAction(ctx, { campaignId: row.campaignId, actorId: row.createdBy, kind, visibility: "public", summary: `${targetName} avoided ${p.attacker.label}'s hit`, groupId: p.groupId, undoable: true });
  }
  if (afterHit) gm.push(`${targetName} may answer ${afterHit.cardIds.map((id) => answerName(id)).join(", ")}`);
  if (res.targetId !== res.originalTargetId) gm.push(`(redirected from ${rebuilt.members.find((m) => m.character._id === res.originalTargetId)?.sheet.name ?? "the first target"})`);
  if (input.early) gm.push("(resolved by the GM)");

  // Damage a card sends back (Arcane Reflection): the attacker takes it against its thresholds (CB p.91, p.99).
  const reflectedToAttacker = res.reflected.filter((r) => r.to === "attacker").reduce((n, r) => n + r.amount, 0);
  let reflectedHit: { attacker: HitAttacker; targetCharacterId: Id<"characters"> } | null = null;
  if (reflectedToAttacker > 0 && rebuilt.attacker && rebuilt.attacker.instance === null && isPcAttacker(p.attacker)) {
    // AA2c (user answer 2026-10-22): the PC attacker gets the normal incoming hit, from the PC whose card reflected it.
    const reflector = reflectorOf(rebuilt.state);
    const by = rebuilt.members.find((m) => m.character._id === reflector?.characterId);
    if (reflector && by) {
      reflectedHit = { attacker: { kind: "pc", characterId: by.character._id, label: by.sheet.name, cardId: reflector.cardId, feature: getDomainCard(reflector.cardId)?.name ?? reflector.cardId }, targetCharacterId: p.attacker.characterId };
      gm.push(`Reflected ${reflectedToAttacker} damage to ${p.attacker.label}: an incoming hit`);
    } else gm.push(`Reflected ${reflectedToAttacker} damage to ${p.attacker.label}: mark it on their sheet`);
  } else if (reflectedToAttacker > 0 && rebuilt.attacker && rebuilt.attacker.instance !== null) {
    const { combatant } = rebuilt.attacker;
    const instance = rebuilt.attacker.instance;
    const dealt = applyDamageTo(combatant, reflectedToAttacker, p.damageType);
    adversaryBefore.push({ instanceId: instance._id, hp: instance.hp, stress: instance.stress, defeated: instance.defeated, conditions: instance.conditions, tags: instance.tags });
    const hp = Math.min(instance.stats.hpMax, dealt.after.hp);
    await ctx.db.patch("encounterAdversaries", instance._id, { hp, defeated: instance.defeated || hp >= instance.stats.hpMax, updatedAt: Date.now() });
    gm.push(`${p.attacker.label} takes ${reflectedToAttacker} reflected → ${dealt.hpMarked} HP (${hp}/${instance.stats.hpMax})`);
  }
  for (const r of res.reflected.filter((x) => x.to === "picked")) gm.push(`Redirected ${r.amount} damage to a creature the player picks: apply it in the tracker`);
  for (const text of res.manual) gm.push(text);

  await logAction(ctx, {
    campaignId: row.campaignId,
    actorId: row.createdBy,
    kind,
    visibility: "gm",
    summary: `${p.attacker.label} → ${gm.join("; ")}`,
    groupId: p.groupId,
    ...(adversaryBefore.length > 0 ? { adversaryBefore } : {}),
    undoable: true,
  });
  // An after-hit card to answer keeps the row open for that character alone (AA2b); otherwise it closes.
  if (afterHit) await ctx.db.patch("combatRequests", row._id, { payload: { ...p, afterHit } });
  else await closeRequest(ctx, row._id, "resolved", input.by);
  let reflectedHitId: Id<"combatRequests"> | undefined;
  if (reflectedHit) {
    const opened = await openIncomingHit(ctx, {
      campaignId: row.campaignId,
      ...(row.encounterId ? { encounterId: row.encounterId } : {}),
      ...(row.mapId ? { mapId: row.mapId } : {}),
      createdBy: row.createdBy,
      groupId: p.groupId,
      attacker: reflectedHit.attacker,
      targetCharacterId: reflectedHit.targetCharacterId,
      hit: { amount: reflectedToAttacker, type: p.damageType, direct: p.direct, forcedArmor: 0, critical: false },
      party: await partyMembers(ctx, row.campaignId),
      bands: await bandsOnMap(ctx, row.mapId),
    });
    reflectedHitId = opened.requestId;
  }
  return {
    requestId: row._id,
    groupId: p.groupId,
    attacker: p.attacker,
    originalTargetId: p.targetCharacterId,
    targetId: memberId(rebuilt.members, res.targetId, p.targetCharacterId),
    missed: res.missed,
    negated: res.negated,
    severity: result?.severity ?? "none",
    hpMarked: result?.hpMarked ?? 0,
    stressMarked: result?.stressMarked ?? 0,
    armorMarked: (result?.armorSlots ?? 0) + (result?.forcedArmor ?? 0),
    deathMove,
    taken: result?.taken ?? 0,
    manual: res.manual,
    window: res,
    ridersApplied,
    autos,
    afterHit,
    ...(reflectedHitId ? { reflectedHitId } : {}),
    usedArmor: (result?.armorSlots ?? 0) > 0,
  };
}

/** The after-hit offer id of a maintainable effect (Night's Glamour): `maintain:<effect id>` (a feature-shaped id). */
const MAINTAIN = "maintain:";
export const maintainId = (effectId: string) => `${MAINTAIN}${effectId}`;
export const isMaintainId = (id: string) => id.startsWith(MAINTAIN);

/** What a hit's end events did: the hit PC's sheet, the maintainable effects ended (offered), and the allies' sheets. */
export type HitEnds = {
  sheet: CharacterSheet;
  names: string[];
  lines: string[];
  /** Ended effects the PC may pay to keep (`maintain`, dcm-4qv), the payment affordable now. */
  maintain: string[];
  others: { character: PartyMember["character"]; before: CharacterSheet; sheet: CharacterSheet; names: string[] }[];
};

/**
 * Plan lanes-2, E2 (dcm-t8c): the end events of a resolved hit (`damageTaken`, E6's `EndOccurrence`). The bearer side on
 * the hit PC's sheet (`endOnSheet`: Transform's `takeDamage`, Night's Glamour's `markHp`); an ended effect with an
 * affordable `maintain` (HF p.17: "Unless you mark a Stress to maintain your Glamour, it drops when you mark a Hit Point")
 * is listed for the after-hit offer: it drops now, and paying puts it back (`respondAfterHit`). The caster side on the
 * party (`endForCasterOnSheets`: Eye of the Storm, HF p.23 "until you take Severe damage", on the PC and their allies;
 * with two holders of the card it is left to the GM, E6 Q3). A hit reduced to no Hit Points is skipped (the window's
 * `endedOnNoHp` decides `reducedToNoHp`, dcm-sim).
 */
export function hitEndEvents(sheet: CharacterSheet, occ: Extract<EndOccurrence, { kind: "damageTaken" }>, targetId: Id<"characters">, party: readonly PartyMember[]): HitEnds {
  const none: HitEnds = { sheet, names: [], lines: [], maintain: [], others: [] };
  if (occ.severity === "none" && occ.hpMarked === 0) return none;
  const own = endOnSheet(sheet, occ);
  let next = own.sheet;
  const names = own.ended.map((e) => e.text.split("; ")[0] ?? e.source);
  const lines = [...own.lines];
  const maintain = own.maintainable.flatMap((e) => {
    const m = effectEndsOf(e)?.maintain;
    return m && payMaintain(next, m) !== null ? [e.id] : [];
  });
  if (maintain.length > 0) lines.push(`${sheet.name} may pay to keep ${own.maintainable.filter((e) => maintain.includes(e.id)).map((e) => e.text.split("; ")[0]).join(", ")}`);
  const others: HitEnds["others"] = [];
  const members = party.filter((m) => m.character._id !== targetId);
  const caster = endForCasterOnSheets(next, [{ key: null as Id<"characters"> | null, sheet: next }, ...members.map((m) => ({ key: m.character._id as Id<"characters"> | null, sheet: m.sheet }))], occ);
  for (const c of caster) {
    lines.push(...c.lines);
    const ended = c.ended.map((e) => e.text.split("; ")[0] ?? e.source);
    if (c.key === null) {
      next = c.sheet;
      names.push(...ended);
      continue;
    }
    const member = members.find((m) => m.character._id === c.key);
    if (member) others.push({ character: member.character, before: member.sheet, sheet: c.sheet, names: ended });
  }
  return { sheet: next, names, lines, maintain, others };
}

/**
 * Plan lanes-2, E2.3 (dcm-8f51): the caster side of a resolved hit beyond the party's sheets: the modifiers and conditions
 * the hit PC's token made on the running encounters' instances (`endForCasterOnInstances`: Hush's Silenced, CB p.336 "or
 * you take Major damage") and the PC's live areas whose spec ends on the event (`endCasterAreas`, `AreaSpec.endsOnCaster`).
 * Skipped for a hit reduced to no damage (as `hitEndEvents`). Instances are found by the PC's token on the hit's live map;
 * without one only the areas end. `before`: the instances as they were, for the GM row.
 */
export async function hitCasterEnds(
  ctx: MutationCtx,
  row: HitRow,
  characterId: Id<"characters">,
  occ: Extract<EndOccurrence, { kind: "damageTaken" }>,
): Promise<{ before: AdversaryBefore[]; lines: string[]; areas: string[] }> {
  if (occ.severity === "none" && occ.hpMarked === 0) return { before: [], lines: [], areas: [] };
  const tokenId = await pcTokenOf(ctx, row, characterId);
  const inst = tokenId !== null ? await endForCasterOnInstances(ctx, row.campaignId, tokenId, occ) : { before: [], lines: [] };
  const areas = await endCasterAreas(ctx, row.campaignId, characterId, occ);
  return { before: inst.before, lines: [...inst.lines, ...areas.map((a) => `${a} ends (its caster took ${SEVERITY_WORD[occ.severity]} damage)`)], areas };
}

/** The PC's token on the hit's map (the stored target token for the first target; else read from the map), or null. */
async function pcTokenOf(ctx: QueryCtx, row: HitRow, characterId: Id<"characters">): Promise<string | null> {
  if (row.payload.targetTokenId !== undefined && characterId === row.payload.targetCharacterId) return row.payload.targetTokenId;
  if (row.mapId === undefined) return null;
  const token = (await tokensOnMap(ctx, row.mapId)).find((t) => t.ref.kind === "pc" && t.ref.characterId === characterId);
  return token?._id ?? null;
}

/**
 * Plan lanes-2, E2 (dcm-4qv): the ended effect a `maintain` offer puts back, from the hit PC's sheet before the hit (the
 * public row of the hit's group that carries their `before`). Null when it can't be found (the group was undone).
 */
async function endedEffect(ctx: QueryCtx, row: HitRow, characterId: Id<"characters">, effectId: string): Promise<Effect | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.payload.groupId))
    .take(50);
  for (const r of rows) {
    if (r.characterId !== characterId || r.before === undefined || r.undoneAt !== undefined) continue;
    try {
      const found = readSheet(JSON.parse(r.before)).effects.find((e) => e.id === effectId);
      if (found) return found;
    } catch {
      // An unreadable before can't hold it.
    }
  }
  return null;
}

/**
 * E2 (dcm-fyb): the hit came from an adversary's attack roll that succeeded (Rogue's Dodge, CB p.42: "until the next time
 * an attack succeeds against you"): an adversary attacker with an attack total (a feature's reaction-roll damage has
 * none). A PC's card damage on an ally (AA2b) is left to the Got hit button.
 */
export function attackSucceeded(p: HitRow["payload"], attackTotal: number | undefined): boolean {
  return !isPcAttacker(p.attacker) && attackTotal !== undefined;
}

/**
 * E2 (dcm-sim): the bearer's sheet without what `reducedToNoHp` ended: a standard condition comes off, a card tag or an
 * effect goes with the sheet effect that card wrote under that label. Returns the names for the feed.
 */
export function endedOnNoHp(sheet: CharacterSheet, ends: WindowResolution["endedOnNoHp"]): { sheet: CharacterSheet; names: string[] } {
  let next = sheet;
  const names: string[] = [];
  for (const e of ends) {
    if (e.ends.kind === "standard") {
      const condition = e.ends.condition;
      if (!next.conditions.includes(condition)) continue;
      next = { ...next, conditions: next.conditions.filter((c) => c !== condition) };
      names.push(condition);
      continue;
    }
    const label = e.ends.kind === "tag" ? e.ends.tag : e.ends.label;
    const keep = next.effects.filter((x) => !(cardIdOfEffect(x) === e.cardId && (x.text.split("; ")[0] ?? "") === label));
    if (keep.length === next.effects.length) continue;
    next = { ...next, effects: keep };
    names.push(label);
  }
  return { sheet: next, names };
}

/** The card answer that sent the damage back at the attacker (its responder and card), from the window's answers. */
function reflectorOf(state: Rebuilt["state"]): { characterId: string; cardId: string } | null {
  for (const r of state.responses) {
    if (r.choice.kind === "card" && (r.folds ?? []).some((f) => f.kind === "reflect" && f.to === "attacker")) return { characterId: r.characterId, cardId: r.choice.cardId };
  }
  return null;
}

/** A card's or (SD4) a feature's printed name, for the GM's lines. */
function answerName(id: string): string {
  if (!isFeatureId(id)) return getDomainCard(id)?.name ?? id;
  return id.split(":").pop()?.replace(/-/g, " ") ?? id;
}

/**
 * SD4: runs one of the hit PC's after-hit feature uses with the hit as its trigger (dice seeded from the row: no
 * fishing): the trigger amount is the Hit Points marked for a "mark HP" trigger (Deadly Vengeance, Eye for an Eye), else
 * the damage taken. Returns the sheet after it (its costs, Favor, the choices' steps, Brave Face's Stress turned into a
 * spent Hope) or the refusal.
 */
export function runAfterHitFeature(
  effect: FeatureEffect,
  useId: string,
  member: Pick<PartyMember, "character" | "sheet">,
  facts: Pick<MarkFacts, "hpMarked">,
  taken: number,
  source: Combatant | undefined,
  seed: string,
  choices: readonly CardChoice[],
  unshaken?: UnshakableRoll[],
): ({ ok: true; plan: RunPlan; sheet: CharacterSheet }) | RunRefusal {
  const use = featureUse(effect, useId);
  if (!use) return { ok: false, reason: "noUse", detail: effect.featureId };
  const sheet = member.sheet;
  const subject = pcCombatant(member.character._id, sheet);
  const actor = featureActor(member.character._id, sheet);
  const parsed = featureChoices(choices);
  const result = runFeature(effect, use.id, {
    actor: { ...actor, facts: { ...(actor.facts ?? {}), subject: { conditions: subject.conditions, ...(subject.tags ? { tags: subject.tags } : {}), hp: subject.hp, hpMax: subject.hpMax } } },
    gmFear: 0,
    choices: parsed.choices,
    options: parsed.options,
    optionals: parsed.optionals,
    optionalsOff: parsed.optionalsOff,
    situations: parsed.situations,
    trigger: { amount: afterHitAmount(use, facts, taken), subject, ...(source ? { source } : {}) },
    rng: seededRng(seed),
  });
  if (!result.ok) return result;
  let next = actorSheetAfter(sheet, result.plan, member.character._id, result.plan.name, unshaken ? { out: unshaken } : {});
  // Brave Face (HF p.32): "spend a Hope instead" of the forced Stress: the Stress comes off, a Hope is spent.
  if (result.plan.steps.some((s: PlanStep) => s.kind === "fold" && s.step.kind === "convertMarks" && s.step.from === "stress" && s.step.into === "hope")) {
    if (next.hope < 1 || next.stress < 1) return { ok: false, reason: "cost", detail: "hope" };
    next = { ...next, stress: next.stress - 1, hope: next.hope - 1 };
  }
  return { ok: true, plan: result.plan, sheet: next };
}

/**
 * An answer to an after-hit offer (AA2b; the row's `afterHit`): `card` runs the offered card with the hit as its trigger
 * (Unbreakable: 1d6 HP cleared, the card to the vault, CB p.342) and logs a public row in the hit's group; SD4: `feature`
 * runs the offered feature (Not Done Yet, Deadly Vengeance, Eye for an Eye, Brave Face) and writes what it does to the
 * attacker; `pass` (or any armor answer) declines it. A death-move offer whose moment passed (the character is no longer
 * at their last HP or left play) declines the row. NOT_A_RESPONDER for anyone else or an answer not offered. Closes the row.
 */
export async function respondAfterHit(ctx: MutationCtx, input: RespondInput & { row: HitRow & { payload: { afterHit: AfterHit } } }): Promise<"resolved" | "declined"> {
  const { row, characterId, choice } = input;
  const offer = row.payload.afterHit;
  if (offer.characterId !== characterId) throw appError("NOT_A_RESPONDER");
  if (choice.kind !== "card" && choice.kind !== "feature") {
    await closeRequest(ctx, row._id, "resolved", input.by);
    return "resolved";
  }
  const offered = choice.kind === "card" ? choice.cardId : choice.featureId;
  if (!offer.cardIds.includes(offered)) throw appError("NOT_A_RESPONDER", offered);
  const members = await partyMembers(ctx, row.campaignId);
  const member = members.find((m) => m.character._id === characterId);
  const kind = isPcAttacker(row.payload.attacker) ? ("combat" as const) : ("adversary" as const);
  // Plan lanes-2, E2 (dcm-4qv): paying a `maintain` (Night's Glamour's Stress, HF p.17) puts the ended effect back.
  if (choice.kind === "feature" && isMaintainId(choice.featureId)) {
    if (!member) {
      await closeRequest(ctx, row._id, "declined", input.by);
      return "declined";
    }
    return await payToMaintain(ctx, { ...input, row, member, effectId: choice.featureId.slice(MAINTAIN.length), kind });
  }
  if (!member || (offer.deathMove && member.sheet.hp < member.sheet.hpMax)) {
    await closeRequest(ctx, row._id, "declined", input.by);
    return "declined";
  }
  const unshaken: UnshakableRoll[] = [];
  let next: CharacterSheet;
  let name: string;
  let stored: AnswerChoice = choice;
  if (choice.kind === "card") {
    const ran = runAfterHitCard(member, member.sheet, choice.cardId, choice.useId, { amount: offer.hpMarked }, `${row._id}:afterHit`);
    if ("ok" in ran) throw cardRefusal(ran);
    const u = unshakePlan(member.sheet, sheetAfterCard(member.sheet, ran.plan, characterId, ran.cardName), ran.plan, characterId, true);
    if (u.roll) unshaken.push(u.roll);
    next = u.sheet;
    name = ran.cardName;
  } else {
    const effect = answeringFeatures(member.sheet, await hopeAndFearOf(ctx, row.campaignId)).find((f) => f.featureId === choice.featureId);
    const use = effect ? featureUse(effect, choice.useId) : undefined;
    if (!effect || !use) throw appError("NOT_A_RESPONDER", choice.featureId);
    const attacker = await attackerCombatant(ctx, row, members);
    const ran = runAfterHitFeature(effect, use.id, member, { hpMarked: offer.hpMarked }, offer.hpMarked, attacker?.combatant, `${row._id}:afterHit`, choice.choices, unshaken);
    if (!ran.ok) throw featureRefusal(ran);
    assertPicked(ran.plan);
    next = ran.sheet;
    name = ran.plan.name;
    stored = { kind: "feature", featureId: effect.featureId, useId: use.id, choices: choice.choices.filter((c) => c.id !== "spentDice") };
    const written = await writeAttackerChanges(ctx, ran.plan, attacker, row.payload.attacker.label);
    if (written.line) {
      await logAction(ctx, {
        campaignId: row.campaignId,
        actorId: row.createdBy,
        kind,
        visibility: "gm",
        summary: `${member.sheet.name} · ${name} → ${written.line}`,
        groupId: row.payload.groupId,
        ...(written.before ? { adversaryBefore: [written.before] } : {}),
        undoable: true,
      });
    }
    const manual = manualWords(ran.plan);
    if (manual.length > 0) name = `${name} (${manual.join("; ")})`;
  }
  await saveSheet(ctx, characterId, next);
  await logAction(ctx, {
    campaignId: row.campaignId,
    characterId,
    actorId: row.createdBy,
    kind,
    visibility: "public",
    summary: `${member.sheet.name} uses ${name}${offer.deathMove ? " instead of a death move" : ""}`.slice(0, 1000),
    groupId: row.payload.groupId,
    before: member.sheet,
    undoable: true,
  });
  for (const roll of unshaken) await logUnshakable(ctx, { campaignId: row.campaignId, characterId, actorId: row.createdBy, name: member.sheet.name, groupId: row.payload.groupId }, roll);
  await ctx.db.patch("combatRequests", row._id, { responses: [...row.responses, { characterId, choice: stored, by: input.by, at: Date.now() }] });
  await closeRequest(ctx, row._id, "resolved", input.by);
  return "resolved";
}

/**
 * Plan lanes-2, E2 (dcm-4qv): the maintain answer: the effect the hit ended comes back and its `maintain` is paid (HF p.17:
 * "mark a Stress to maintain your Glamour"; Unshakable rolls on the Stress, DA10). CARD_COST_UNPAID when it can't be paid
 * now; a declined row when the effect can't be found (the hit was undone).
 */
async function payToMaintain(
  ctx: MutationCtx,
  input: { row: HitRow; by: Id<"users">; characterId: Id<"characters">; member: PartyMember; effectId: string; kind: "combat" | "adversary" },
): Promise<"resolved" | "declined"> {
  const { row, member, characterId } = input;
  const effect = await endedEffect(ctx, row, characterId, input.effectId);
  const maintain = effect ? effectEndsOf(effect)?.maintain : undefined;
  if (!effect || !maintain || member.sheet.effects.some((e) => e.id === effect.id)) {
    await closeRequest(ctx, row._id, "declined", input.by);
    return "declined";
  }
  const paid = payMaintain(member.sheet, maintain);
  if (paid === null) throw appError("CARD_COST_UNPAID", "stress");
  const stress = Math.max(0, paid.stress - member.sheet.stress) + Math.max(0, paid.hp - member.sheet.hp);
  const shaken = unshake(member.sheet, paid, stress);
  const next: CharacterSheet = { ...shaken.sheet, effects: [...shaken.sheet.effects, effect].slice(-20) };
  const label = effect.text.split("; ")[0] ?? effect.source;
  await saveSheet(ctx, characterId, next);
  await logAction(ctx, { campaignId: row.campaignId, characterId, actorId: row.createdBy, kind: input.kind, visibility: "public", summary: `${member.sheet.name} pays to keep ${label}`.slice(0, 1000), groupId: row.payload.groupId, before: member.sheet, undoable: true });
  if (shaken.roll) await logUnshakable(ctx, { campaignId: row.campaignId, characterId, actorId: row.createdBy, name: member.sheet.name, groupId: row.payload.groupId }, shaken.roll);
  await ctx.db.patch("combatRequests", row._id, { responses: [...row.responses, { characterId, choice: { kind: "feature", featureId: maintainId(effect.id), useId: "maintain", choices: [] }, by: input.by, at: Date.now() }] });
  await closeRequest(ctx, row._id, "resolved", input.by);
  return "resolved";
}

/**
 * Plan lanes-2, E2 (dcm-4qv): the after-hit prompt's view of a maintain offer (as a feature answer: Use or OK), from the
 * effect the hit ended (the sheet before the hit).
 */
async function maintainViews(ctx: QueryCtx, row: HitRow, characterId: Id<"characters">, ids: readonly string[]): Promise<FeatureView[]> {
  const out: FeatureView[] = [];
  for (const id of ids) {
    if (!isMaintainId(id)) continue;
    const effect = await endedEffect(ctx, row, characterId, id.slice(MAINTAIN.length));
    const maintain = effect ? effectEndsOf(effect)?.maintain : undefined;
    if (!effect || !maintain) continue;
    const label = effect.text.split("; ")[0] ?? effect.source;
    // The book's maintain costs are fixed Hope or Stress (`payMaintain`); anything else reads as one of its kind.
    const cost = maintain.costs.map((c) => ("amount" in c && c.amount.kind === "fixed" ? `${c.amount.value} ${c.kind === "hope" ? "Hope" : "Stress"}` : `1 ${c.kind}`)).join(" and ");
    out.push({ featureId: id, useId: "maintain", name: `Keep ${label}`, text: `${label} drops after this hit. Mark ${cost} to maintain it.`, numbers: [], options: [], optionals: [], situations: [] });
  }
  return out;
}

/** A hit row waiting only for its after-hit answer. */
export function hasAfterHit(row: HitRow): row is HitRow & { payload: { afterHit: AfterHit } } {
  return row.payload.afterHit !== undefined;
}

// ---------------------------------------------------------------- reading

/** Whether the hit's actionLog group was undone (undo leaves the hit's row open; it is declined when next touched). */
export async function groupUndone(ctx: QueryCtx, row: { campaignId: Id<"campaigns">; payload: { groupId: string } }): Promise<boolean> {
  const first = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.payload.groupId))
    .first();
  return first !== null && first.undoneAt !== undefined;
}

/**
 * SD4: one feature answer as a player's prompt shows it: the feature's printed name and text (from the SRD, never the
 * enemy's numbers), and what its Use asks: counts (Prayer Dice to spend), a pick per `choose` step (Not This Time's
 * attack or damage), optional steps (Draining Bane's "clear a Stress") and situations to confirm (Q13).
 */
export type FeatureView = {
  featureId: string;
  useId: string;
  name: string;
  text: string;
  numbers: { id: string; label: string; min: number }[];
  options: { id: string; label: string; options: { id: string; label: string }[] }[];
  /** DA8: `defaultOn`: ticked unless the player unticks it (Draining Bane's "Clear a Stress", dcm-bxp.99.19.15). */
  optionals: { id: string; label: string; defaultOn?: boolean }[];
  situations: string[];
};

/** The prompt's view of one feature use (SD4). */
export function featureView(effect: FeatureEffect, useId: string, sheet: CharacterSheet, hopeAndFear: boolean): FeatureView {
  const use = featureUse(effect, useId);
  const held = owned(sheet, { hopeAndFear }).find((f) => f.featureId === effect.featureId);
  return {
    featureId: effect.featureId,
    useId,
    name: held?.name ?? use?.name ?? effect.featureId,
    text: held?.text ?? "",
    numbers: (use?.choices ?? []).map((c) => ({ id: c.id, label: c.label, min: c.min })),
    options: use ? chooseSteps(use).map((c) => ({ id: c.id, label: c.label, options: c.options.map((o) => ({ id: o.id, label: o.label })) })) : [],
    optionals: use ? optionalSteps(use).map((o) => ({ id: o.id, label: o.label, ...(o.defaultOn ? { defaultOn: true } : {}) })) : [],
    situations: (use?.requires ?? []).flatMap((r) => (r.kind === "situation" && r.check === undefined ? [r.text] : [])),
  };
}

export type HitView = {
  requestId: Id<"combatRequests">;
  attackerLabel: string;
  targetCharacterId: Id<"characters">;
  targetName: string;
  role: "target" | "ally";
  /** Still owed an answer from this character. */
  awaiting: boolean;
  cardIds: string[];
  createdAt: number;
  /** Only for the hit PC (Q14): the damage, its severity against their own thresholds, the slots they may mark. */
  damage?: number;
  severity?: PcSeverity;
  direct?: boolean;
  maxSlots?: number;
  armorPreview?: { slots: number; severity: PcSeverity; hp: number }[];
  /**
   * AA2b: the hit already resolved and this character (who took it) may answer an after-hit card (`cardIds`, e.g.
   * Unbreakable) with `card` or `pass`; no armor choice. `deathMove`: the hit marked their last HP.
   */
  afterHit?: boolean;
  deathMove?: boolean;
  /** AA2b: after a redirect (I Am Your Shield), who was hit first ("Tabby stepped in" on their line). */
  originalTargetName?: string;
  /** SD4: the feature uses this character may answer with now (Iron Will, Prayer Dice, Not This Time, …). */
  features?: FeatureView[];
  /** SD4: the hit PC answered armor; only severity-gated features (Thick Skin) or Done are left. */
  armorAnswered?: boolean;
  /** SD4 (Q2): a before-roll prompt: nothing is rolled yet; Use a before-roll feature or Pass. */
  preRoll?: boolean;
  /**
   * Plan lanes-2, E2.3: the attacker's grants the hit PC may still take (answer `grant {id, amount}`, `amount` 1..the
   * listed amount): `hope` Hope for fewer forced HP (dcm-nnbl), `gold` handfuls instead of HP (dcm-5cn5).
   */
  grants?: { id: string; label: string; amount?: number }[];
};

/** Plan lanes-2, E2.3: the prompt's words for a grant. */
const GRANT_LABEL: Record<"hope" | "gold", string> = {
  hope: "Spend Hope to mark that many fewer of the Hit Points this attack forces",
  gold: "Spend handfuls of gold instead of marking Hit Points (1 handful per HP)",
};

/** What one character sees of an open hit: the target their own numbers (Q14), an ally only who was hit and their cards. */
export async function hitView(ctx: QueryCtx, row: HitRow, characterId: Id<"characters">): Promise<HitView | null> {
  const offer = row.payload.afterHit;
  if (offer) {
    if (offer.characterId !== characterId) return null;
    const member = (await partyMembers(ctx, row.campaignId)).find((m) => m.character._id === characterId);
    const hopeAndFear = await hopeAndFearOf(ctx, row.campaignId);
    const effects = member ? answeringFeatures(member.sheet, hopeAndFear) : [];
    const features = member
      ? offer.cardIds.filter(isFeatureId).flatMap((id) => {
          const effect = effects.find((f) => f.featureId === id);
          const use = effect?.uses.find((u) => u.activation.kind === "reaction");
          return effect && use ? [featureView(effect, use.id, member.sheet, hopeAndFear)] : [];
        })
      : [];
    // Plan lanes-2, E2 (dcm-4qv): a maintain offer (Night's Glamour's Stress) shows as a feature answer.
    features.push(...(await maintainViews(ctx, row, characterId, offer.cardIds)));
    return {
      requestId: row._id,
      attackerLabel: row.payload.attacker.label,
      targetCharacterId: characterId,
      targetName: member?.sheet.name ?? "Unknown",
      role: "target",
      awaiting: true,
      cardIds: offer.cardIds.filter((id) => !isFeatureId(id)),
      createdAt: row.createdAt,
      afterHit: true,
      deathMove: offer.deathMove,
      ...(features.length > 0 ? { features } : {}),
    };
  }
  const { state, party, members } = await rebuildWindow(ctx, row);
  const responder = state.responders.find((r) => r.characterId === characterId);
  const isTarget = state.targetId === characterId;
  if (!responder && !isTarget && row.payload.targetCharacterId !== characterId) return null;
  const awaiting = awaitingOf(state).includes(characterId);
  const target = members.find((m) => m.character._id === state.targetId);
  // AA2b: a card this character already played in this window isn't offered again (I Am Your Shield after its use).
  const played = new Set(state.responses.flatMap((r) => (r.characterId === characterId && r.choice.kind === "card" ? [r.choice.cardId] : [])));
  const redirected = state.targetId !== state.originalTargetId;
  // DA8: a slot substitute (Stable, Celestial Wings) is the armor answer too.
  const armorAnswered = isTarget && armorAnsweredOf(state, characterId);
  // DA8: the hit PC's cards fit the hit as it is now (before or after the armor answer, CB p.107).
  const cardIds = isTarget ? cardAnswers(state, characterId) : armorAnswered ? [] : (responder?.cardIds ?? []).filter((id) => !played.has(id));
  const me = members.find((m) => m.character._id === characterId);
  const pc = party.find((x) => x.id === characterId);
  const hopeAndFear = me ? await hopeAndFearOf(ctx, row.campaignId) : true;
  const features =
    awaiting && me && pc
      ? featureAnswers(state, characterId).flatMap((f) => {
          const effect = pc.features?.find((e) => e.featureId === f.featureId);
          return effect ? [featureView(effect, f.useId, me.sheet, hopeAndFear)] : [];
        })
      : [];
  // Plan lanes-2, E2.3: the grants the target may still take, while they owe an answer.
  const grants = awaiting && isTarget ? grantAnswers(state, characterId).map((g) => ({ id: g.id, label: GRANT_LABEL[g.id], amount: g.max })) : [];
  const view: HitView = {
    requestId: row._id,
    attackerLabel: row.payload.attacker.label,
    targetCharacterId: memberId(members, state.targetId, row.payload.targetCharacterId),
    targetName: target?.sheet.name ?? "Unknown",
    role: isTarget ? "target" : "ally",
    awaiting,
    cardIds,
    createdAt: row.createdAt,
    ...(redirected ? { originalTargetName: members.find((m) => m.character._id === state.originalTargetId)?.sheet.name ?? "Unknown" } : {}),
    ...(features.length > 0 ? { features } : {}),
    ...(isTarget && armorAnswered ? { armorAnswered: true } : {}),
    ...(grants.length > 0 ? { grants } : {}),
  };
  const defense = party.find((p) => p.id === characterId);
  if (isTarget && defense && armorAnswered) {
    // DA8: after the armor answer the hit PC sees the hit as the answers so far left it (Q14: their own numbers only).
    const now = progressOf(state, defense);
    return { ...view, damage: now.amount, severity: now.severity, direct: row.payload.direct, maxSlots: 0, armorPreview: [{ slots: 0, severity: now.severity, hp: now.hp }] };
  }
  if (isTarget && defense) {
    const prompt = targetPrompt(state, defense);
    // A1: the preview counts what the answers so far folded in (a slot substitute beside further slots, dcm-bxp.99.19.55 (6)).
    const preview = targetArmorPreview(state, defense);
    return { ...view, damage: prompt.damage, severity: prompt.severity, direct: row.payload.direct, maxSlots: prompt.maxSlots, armorPreview: preview };
  }
  return view;
}

// ---------------------------------------------------------------- the GM's keyword answer (E2.4, dcm-sk4r)

/** What the GM's row shows of an open keyword ask (convex/hitKeywords.ts `asks`). GM only: the hit's numbers are fine. */
export type KeywordAskView = {
  requestId: Id<"combatRequests">;
  attackerLabel: string;
  feature?: string;
  targetCharacterId: Id<"characters">;
  targetName: string;
  keyword: DamageKeyword;
  /** The guard's printed name (Fireproof). */
  guard: string;
  question: string;
  damage: number;
  damageType: HitRow["payload"]["damageType"];
  createdAt: number;
};

/** The GM's view of a hit's open keyword ask, or null when it has none (or it was answered). */
export function keywordAskView(row: HitRow, targetName: string): KeywordAskView | null {
  const ask = row.payload.keywordAsk;
  if (!ask || !keywordAskOpen(ask) || row.payload.afterHit) return null;
  const p = row.payload;
  return {
    requestId: row._id,
    attackerLabel: p.attacker.label,
    ...(p.attacker.feature !== undefined ? { feature: p.attacker.feature } : {}),
    targetCharacterId: ask.characterId,
    targetName,
    keyword: ask.keyword,
    guard: ask.feature,
    question: keywordAskQuestion(ask),
    damage: p.damage,
    damageType: p.damageType,
    createdAt: row.createdAt,
  };
}

/**
 * Plan lanes-2, E2.4 (dcm-sk4r): records the GM's answer to a hit's keyword ask (`carries`: the hit was fire) on the
 * payload (`keywordAsk.answer` / `answeredBy`, plan lanes-2 V4) with a GM feed line in the hit's group. INVALID when the
 * hit has no ask or the answer names another keyword; REQUEST_NOT_OPEN once answered. Returns whether the window is now
 * complete (the caller then resolves the hit). A "yes" makes the guard apply (`effectiveKeyword`, `pcResistance`).
 */
export async function answerKeywordAsk(ctx: MutationCtx, input: { row: HitRow; answer: KeywordAnswer; by: Id<"users"> }): Promise<{ complete: boolean; row: HitRow }> {
  const { row, answer } = input;
  const ask = row.payload.keywordAsk;
  if (!ask) throw appError("INVALID", "This hit asks nothing.");
  if (!keywordAskOpen(ask) || row.payload.afterHit) throw appError("REQUEST_NOT_OPEN");
  if (answer.keyword !== ask.keyword) throw appError("INVALID", `This hit asks about ${ask.keyword}.`);
  const payload = { ...row.payload, keywordAsk: { ...ask, answer: answer.carries, answeredBy: input.by } };
  await ctx.db.patch("combatRequests", row._id, { payload });
  const fresh: HitRow = { ...row, payload };
  const { state, members } = await rebuildWindow(ctx, fresh);
  const name = members.find((m) => m.character._id === ask.characterId)?.sheet.name ?? "the target";
  await logAction(ctx, {
    campaignId: row.campaignId,
    actorId: input.by,
    kind: isPcAttacker(row.payload.attacker) ? "combat" : "adversary",
    visibility: "gm",
    summary: `${row.payload.attacker.label} → ${name}: the hit ${answer.carries ? "was" : "wasn't"} ${ask.keyword} (${ask.feature}${answer.carries ? " applies" : " doesn't apply"})`,
    groupId: row.payload.groupId,
    undoable: true,
  });
  return { complete: isComplete(state), row: fresh };
}
