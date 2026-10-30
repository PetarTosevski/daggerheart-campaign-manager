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
  isComplete,
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
import { expire } from "../../src/lib/domain/characters/expiry";
import { activeBeastform, owned } from "../../src/lib/domain/feature-effects/owned";
import { beastformEndsOn } from "../../src/lib/srd/feature-effects/beastforms";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import {
  answeringFeatures,
  armorCostOf,
  attackerBandsOnMap,
  attackerCombatant,
  attackRollOf,
  featureActor,
  featureChoices,
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
import { saveSheet } from "./characterSheet";
import { closeRequest } from "./combatRequests";
import { dropStance } from "./stanceDrop";
import { logUnshakable, UNSHAKABLE_ID, unshake, unshakableText, unshakePlan, type UnshakableRoll } from "./unshakable";
import type { AdversaryBefore } from "./validators/actionLog";
import { MAX_RIDERS, type AfterHit, type HitResponder, type HitRider } from "./validators/combatRequests";

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
  const party = windowParty(respondingParty(input.party, input.attacker), input.targetCharacterId, input.bands, { hopeAndFear, toAttacker });
  const attacker = await openingAttacker(ctx, input);
  // E2 (dcm-s77): the attacker's dearer Armor Slots, re-read from its stat block (as `rebuildWindow`).
  const armorCost = await armorCostOf(ctx, { campaignId: input.campaignId, payload: { attacker: input.attacker } });
  const state = openWindow({ hit: windowHitOf(input.attacker, input.hit, riders, armorCost), targetId: input.targetCharacterId, party, ...(attacker ? { attacker } : {}) });
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
    },
  });
  if (!isComplete({ ...state, responders: state.responders.slice(0, MAX_RESPONDERS) })) return { requestId, resolution: null };
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
      return appError("FEATURE_COST_UNPAID", `Short of: ${r.detail}.`);
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
  let paid: { sheet: CharacterSheet; cardName: string } | null = null;
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
    paid = { sheet: u.sheet, cardName };
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
      summary: characterId === state.targetId ? `${member.sheet.name} uses ${paid.cardName}` : `${member.sheet.name} uses ${paid.cardName} for ${targetName}`,
      groupId: row.payload.groupId,
      before: member.sheet,
      undoable: true,
    });
  }
  if (feature) {
    await saveSheet(ctx, characterId, feature.sheet);
    const manual = manualWords(feature.plan);
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
  return { complete: isComplete(next.state) };
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
    // The attack's riders land on whoever took the hit (user answer 2026-10-22, AA2b), also when only its damage was
    // negated or reflected; a miss or full avoidance stops them (AA2c, user answer 2026-10-22).
    if (!res.missed && (p.riders?.length ?? 0) > 0) {
      // DA8: after Dark Aegis the conditions still land, any extra "mark HP" doesn't (user answer 2026-10-29).
      const landed = applyRiders(next, p.riders ?? [], res.conditionNegated, res.hpRidersIgnored);
      next = landed.sheet;
      ridersApplied = landed.applied;
      gm.push(`riders on ${targetName}: ${ridersApplied}${res.conditionNegated ? " (conditions avoided)" : ""}${res.hpRidersIgnored ? " (no Hit Points from them)" : ""}`);
    }
    // DA10 (CB p.59 Unshakable, user 2026-10-30): a d6 for each Stress the hit (marked instead of HP) and its riders
    // would mark; a 6 skips that one. Counted before the after-hit uses, so "when you mark a Stress" reads the result.
    const riderStress = !res.missed ? (p.riders ?? []).reduce((n, r) => n + (r.kind === "stress" ? Math.max(0, Math.trunc(r.amount)) : 0), 0) : 0;
    const shaken = unshake(sheet, next, result.stressMarked + (result.overflow ? 1 : 0) + riderStress);
    next = shaken.sheet;
    const hpMarked = Math.max(0, next.hp - sheet.hp);
    deathMove = next.hpMax > 0 && sheet.hp < next.hpMax && next.hp >= next.hpMax;
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
    const offers = [...uses.offers.slice(0, 10), ...featureUses.offers.slice(0, 10)];
    if (offers.length > 0) afterHit = { characterId: target.character._id, cardIds: offers, severity: result.severity, hpMarked, deathMove };
    // DA10: what the hit ends. A Beastform on its end events (CB p.30: "If you mark your last Hit Point, you automatically
    // drop out of this form"; CB p.32 Fragile: "When you take Major or greater damage, you drop out of Beastform"), with
    // Evolution's +1 (CB p.30: "until you drop out of that Beastform"); the stance on Severe damage or the last Hit Point
    // (HF p.12), and what ends with it (Grappling's Restrain).
    const lastHp = next.hpMax > 0 && sheet.hp < next.hpMax && next.hp >= next.hpMax;
    const formEnds = beastformEnds(next, { lastHp, severity: result.severity });
    if (formEnds) next = formEnds.sheet;
    const endedWords: string[] = [...(formEnds ? [formEnds.words] : []), ...ended.names.map((n) => `${n} ends`)];
    if (lastHp || result.severity === "severe") {
      const dropped = await dropStance(ctx, row.campaignId, next);
      if (dropped.dropped) {
        next = dropped.sheet;
        endedWords.push("drops out of their stance");
        gm.push(...dropped.lines);
        adversaryBefore.push(...dropped.before);
      }
    }
    await saveSheet(ctx, target.character._id, next);
    // The sheet's death move is due at once (user answer 2026-10-22; CB p.91): a new last HP clears an earlier "spent".
    if (deathMove) await ctx.db.patch("characters", target.character._id, { deathMoveSpent: undefined });
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
          : `${targetName} took ${p.attacker.label}'s hit${deathMove ? " and must make a death move" : ""}${autos.length > 0 ? ` (${autos.join(", ")})` : ""}${endedWords.length > 0 ? `; ${endedWords.join(", ")}` : ""}`,
      groupId: p.groupId,
      before: sheet,
      undoable: true,
    });
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
      `${targetName}: ${result.incoming} ${TYPE_WORD[p.damageType]}${resisted} → ${SEVERITY_WORD[result.severityBefore]}${armor}${forced} → ${SEVERITY_WORD[result.severity]} → ${marks.join(", ")}${deathMove ? "; death move" : ""}`,
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
  if (!member || (offer.deathMove && member.sheet.hp < member.sheet.hpMax)) {
    await closeRequest(ctx, row._id, "declined", input.by);
    return "declined";
  }
  const kind = isPcAttacker(row.payload.attacker) ? ("combat" as const) : ("adversary" as const);
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
