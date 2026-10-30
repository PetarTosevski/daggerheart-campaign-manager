import { v } from "convex/values";

import { countsAsActionRoll } from "../src/lib/domain/countdowns/advanced";
import { rangeCheck } from "../src/lib/domain/combat-actions/index";
import { appError } from "../src/lib/errors/app-error";
import { getDomainCard } from "../src/lib/srd/index";
import type { CharacterSheet } from "../src/lib/validation/characters";
import { tickArmedCountdowns } from "./countdownRolls";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { cardChoicesValidator, cardRollValidator, dropDice, keepDice, keptDice, parseChoices, type CardChoice, type CardRoll, type DiceSlot } from "./lib/cardChoices";
import { handCardValidator, handOf, handSharedWithPlayers, hiddenHands, playersSeeHands, writeHandHidden } from "./lib/cardHand";
import { damageRolls, gmLines, instanceWrites, needsChoiceValidator, openCardHits, pendingCardValidator, promptsOf, publicTargets, resolvedCardValidator, rollText, writeInstances, type InstanceWrite, type ResolvedCard } from "./lib/cardRows";
import { actorSheetAfter, buildRun, difficultyOf, pickCard, replaying, runCard, writeSheetChanges, type BuiltRun, type CardPick, type HostRoll, type RunOutcome } from "./lib/cardRunner";
import { assertCanAct, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import {
  attackScene,
  changeFear,
  emptyFolds,
  foldInto,
  pickRiders,
  recorder,
  resultHolds,
  runRiderPart,
  weaponIn,
  type AttackScene,
  type Folds,
  type Host,
  type PickedRider,
  type RiderEnv,
  type RiderRun,
} from "./lib/combatActions";
import { closeRequest, encounterRunning, loadOpenRequest, openMinionOffer, openRequests } from "./lib/combatRequests";
import { rollDie } from "./lib/dice";
import { campaignFearState, gainFear, spendFear } from "./lib/fear";
import { campaignMutation, campaignQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { changed } from "./lib/rolls";
import { MAX_RIDERS_PER_ATTACK, rangeBandValidator, riderValidator, type Rider } from "./lib/validators/combatRequests";
import type { RunPlan } from "../src/lib/domain/card-effects/run";
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
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

/** The character the caller edits, in this campaign, with its sheet (NOT_FOUND / FORBIDDEN otherwise). */
async function editableHere(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet) };
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

export const hand = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters") },
  returns: v.object({ characterId: v.id("characters"), loadout: v.array(handCardValidator), vault: v.array(handCardValidator) }),
  handler: async (ctx, { characterId }) => {
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "view", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    if (!atLeast(permission, "edit") && !handSharedWithPlayers(campaign, character)) throw appError("FORBIDDEN");
    return { characterId, ...handOf(readSheet(character.sheet)) };
  },
});

/** Who sees whose hand (F7-H4): the GM's switch and the characters whose player hides their hand. Every member. */
export const handSharing = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({ playersSeeHands: v.boolean(), hidden: v.array(v.id("characters")) }),
  handler: async (ctx) => ({ playersSeeHands: playersSeeHands(ctx.campaign), hidden: await hiddenHands(ctx, ctx.campaign._id) }),
});

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
};

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
 * Writes the plan in one mutation (U4) and logs one actionLog group: the public row (the roll, the damage dice and
 * total, Hit / Miss / Defeated per target, the actor's `before`), a row per ally whose sheet changed, a public row per
 * manual step ("Mira used <card>: <step text>"), and the GM row (damage, severity, HP, saves, `adversaryBefore`).
 */
async function resolveUse(ctx: MutationCtx, req: UseRequest, built: BuiltRun, plan: RunPlan, actorId: Id<"users">, riders?: RiderSheets): Promise<ResolvedCard> {
  const { campaign, character, pick } = req;
  // SD5: with riders the row's `before` is the sheet before the riders' costs, and the actor's sheet after them.
  const sheet = riders?.before ?? req.sheet;
  const actorToken = built.context.actor.id;
  let next = riders?.next ?? actorSheetAfter(built.paidSheet, plan, actorToken, pick.name);
  const healed = siphonHeal(plan);
  if (healed > 0) next = { ...next, hp: Math.max(0, next.hp - healed) };
  let prompts = promptsOf(plan, built).filter((p) => !(healed > 0 && p.kind === "manual" && p.text.startsWith("You clear a number of Hit Points")));

  // Allies: tracks from the plan's creatures, Hope / effects / conditions from its steps.
  const allyRows: { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }[] = [];
  for (const c of built.creatures.all) {
    if (c.kind !== "pc" || c.character._id === character._id) continue;
    const changedTo = plan.creatures.find((x) => x.id === c.tokenId)?.after;
    let after = writeSheetChanges(c.sheet, plan.steps, c.tokenId, plan.cardId, pick.name, plan.exclusive, false);
    if (changedTo) after = { ...after, hp: Math.min(c.sheet.hpMax, changedTo.hp), stress: Math.min(c.sheet.stressMax, changedTo.stress), armorMarked: Math.max(0, changedTo.armor ?? c.sheet.armorMarked) };
    if (changed(c.sheet, after)) allyRows.push({ character: c.character, before: c.sheet, after });
  }

  const writes = instanceWrites(plan, built.creatures, pick.name);
  await writeInstances(ctx, writes);
  const fearDelta = await applyFear(ctx, campaign._id, plan.gmFearDelta);
  const sheetChanged = changed(sheet, next);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  for (const a of allyRows) await saveSheet(ctx, a.character._id, a.after);

  const groupId = newGroupId();
  const damage = damageRolls(plan);
  const { parts, outcomes } = publicTargets(plan, built, writes);
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
  const lines = gmLines(plan, built, writes);
  if (lines.length > 0 || writes.length > 0) {
    await logAction(ctx, {
      campaignId: campaign._id,
      actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${sheet.name} · ${pick.name} → ${lines.join("; ")}`,
      ...(damage[0] ? { roll: damage[0].roll } : {}),
      groupId,
      ...(writes.length > 0 ? { adversaryBefore: writes.map((w) => w.before) } : {}),
      undoable: true,
    });
  }

  // Armed countdowns tick right after an action roll, as for `actionRoll` (countdowns-advanced K1); never a reaction roll.
  if (plan.roll && countsAsActionRoll(plan.roll.record, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: plan.roll.record.outcome, actorId });
  }

  // AA2b: card damage to another PC opens their incoming hit (armor, ally reactions) instead of a manual prompt.
  const hitTokens = await openCardHits(ctx, { plan, built, campaignId: campaign._id, groupId, actorId, attacker: { characterId: character._id, label: sheet.name, cardId: plan.cardId, feature: pick.name } });
  prompts = prompts.filter((p) => !(p.kind === "pcDamage" && p.tokenIds.every((t) => hitTokens.has(t))));
  const minionOffer = await offerMinions(ctx, req, built, plan, { groupId, entryId, actorId });
  await dropDice(ctx, slotOf(req));
  return {
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
    minionOffer,
  };
}

/**
 * Q6 (CB p.201): the card's damage earned extra Minion defeats. The offer lists the Minions still standing in the same
 * encounter that the actor sees, within the card's range, whose Difficulty the roll beat (or a critical, or no roll).
 * Picked with `combatActions.pickMinions` (the public row is a `combat` row of the group).
 */
async function offerMinions(ctx: MutationCtx, req: UseRequest, built: BuiltRun, plan: RunPlan, row: { groupId: string; entryId: Id<"actionLog">; actorId: Id<"users"> }) {
  const extra = plan.steps.reduce((n, s) => n + (s.kind === "minionOffer" ? s.extra : 0), 0);
  const anchor = built.targets.find((t) => t.kind === "enemy");
  if (extra <= 0 || anchor === undefined || anchor.kind !== "enemy") return null;
  const candidates = [];
  for (const e of await built.creatures.visibleEnemies()) {
    if (!e.minion || e.encounter._id !== anchor.encounter._id) continue;
    if (!rangeCheck(built.creatures.scene.attacker, e.token, built.range).inRange) continue;
    const instance = await ctx.db.get("encounterAdversaries", e.instance._id);
    if (instance === null || instance.defeated) continue;
    if (plan.roll && !plan.roll.critical && plan.roll.record.total < difficultyOf(instance)) continue;
    const available = Math.min(extra, instance.stats.hpMax - instance.hp);
    if (available > 0) candidates.push({ instanceId: instance._id, tokenId: e.tokenId, name: instance.label, available });
  }
  if (candidates.length === 0) return null;
  const requestId = await openMinionOffer(ctx, {
    campaignId: req.campaign._id,
    encounterId: anchor.encounter._id,
    mapId: req.scene.map._id,
    createdBy: row.actorId,
    payload: {
      schemaVersion: 1,
      kind: "minionOffer",
      characterId: req.character._id,
      groupId: row.groupId,
      entryId: row.entryId,
      extra,
      candidates: candidates.map(({ instanceId, tokenId, available }) => ({ instanceId, tokenId, available })),
    },
  });
  return { requestId, extra, candidates };
}

// ---------------------------------------------------------------- riders on a card's roll (SD5)

/** The sheets a card use with riders writes: before the riders' costs, and after the riders on the result. */
type RiderSheets = { before: CharacterSheet; next: CharacterSheet; names: string[] };

/** What a card's roll is to its riders: an attack with a weapon, a Spellcast Roll, a trait roll. */
function cardHost(req: UseRequest, weaponChoice: "primary" | "secondary" | undefined): Host {
  const roll = req.pick.use.roll;
  if (roll === undefined || roll.kind === "adversaryAttack" || roll.kind === "reaction") throw appError("INVALID", "Riders ride on a card that makes an action roll.");
  const slot = roll.kind === "attack" ? (roll.weapon === "either" ? (weaponChoice ?? "primary") : roll.weapon) : undefined;
  const weapon = slot ? weaponIn(req.sheet, slot) : undefined;
  const trait = roll.kind === "trait" ? (typeof roll.trait === "string" ? roll.trait : (req.roll.trait ?? roll.trait[0])) : weapon && weapon.trait !== "choice" ? weapon.trait : req.roll.trait;
  return { spec: roll, trait, weapon: roll.kind === "attack", weaponRange: weapon ? rangeFromWeapon(weapon.range) : null, damageType: weapon?.damageType === "magic" ? "magic" : "physical" };
}

const fixedN = (value: number) => ({ kind: "fixed" as const, value });

/**
 * The card's use with the riders' damage changes folded in as numbers (they were rolled with the rider): +Proficiency
 * before its damage roll, the added damage, "double damage" and the extra Hit Points (NV4) on the creatures it hits.
 */
function withFolds(pick: CardPick, folds: Folds): CardPick {
  const pre: Step[] = [];
  const post: Step[] = [];
  if (folds.proficiency !== 0) pre.push({ kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: folds.proficiency } });
  if (folds.minimumSeverity) pre.push({ kind: "modifyDamage", to: "targets", change: { kind: "minimumSeverity", severity: folds.minimumSeverity } });
  if (folds.damageAdd !== 0) post.push({ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: fixedN(folds.damageAdd), ...(folds.addTypes[0] ? { type: folds.addTypes[0] } : {}) } });
  if (folds.multiply !== 1) post.push({ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "multiply", factor: 2 } });
  if (folds.extraHp > 0) post.push({ kind: "markHp", to: "targets", when: ["targetMarkedHp"], amount: fixedN(folds.extraHp) });
  if (pre.length === 0 && post.length === 0) return pick;
  const use = { ...pick.use, steps: [...pre, ...pick.use.steps, ...post] };
  return { ...pick, use, effect: { ...pick.effect, uses: pick.effect.uses.map((u) => (u.id === use.id ? use : u)) } };
}

function hostRollOf(plan: RunPlan): HostRoll {
  const r = plan.roll;
  return { success: plan.success, critical: r?.critical ?? false, withHope: r?.withHope ?? false, withFear: r?.withFear ?? false };
}

type CardRiderOutcome = { kind: "plan"; built: BuiltRun; plan: RunPlan; req: UseRequest; sheets: RiderSheets; post: (entryId: Id<"actionLog">) => Promise<void> } | { kind: "needsChoice"; outcome: Extract<RunOutcome, { kind: "needsChoice" }> };

/**
 * SD5: a card use with riders, computed without writing: the before-roll riders (costs, roll and damage additions), the
 * card with their additions, the riders on its result (their additions folded in by running the card again with the same
 * dice), and a `post` step that writes the riders' effects on the creatures and the damage-phase riders after the card's
 * own rows.
 */
async function cardWithRiders(ctx: MutationCtx, req: UseRequest, riders: readonly Rider[], actorId: Id<"users">): Promise<CardRiderOutcome> {
  if (riders.length > MAX_RIDERS_PER_ATTACK) throw appError("INVALID", `At most ${MAX_RIDERS_PER_ATTACK} riders.`);
  const parsed = parseChoices(req.choices);
  const host = cardHost(req, parsed.weapon);
  const picked = pickRiders(req.sheet, req.campaign, host, riders);
  const rec = recorder(rollDie);
  const fear = await campaignFearState(ctx, req.campaign._id);
  const env: RiderEnv = { ctx, campaign: req.campaign, character: req.character, scene: req.scene, host, gmFear: fear.fear, rng: rec.rng, rollUsedExperience: (req.roll.experienceIds ?? []).length > 0 };
  const folds = emptyFolds();
  const used: PickedRider[] = [];
  const names: string[] = [];
  let sheet = req.sheet;
  for (const r of picked.filter((x) => x.phase === "before")) {
    const run = await runRiderPart(env, r, sheet, "pre", null, req.targetTokenIds, undefined);
    if (run === null) continue;
    used.push(r);
    if (run === "empty") continue;
    sheet = run.sheet;
    foldInto(folds, run);
    names.push(run.name);
  }
  if (folds.addTargets.length > 0) throw appError("INVALID", "A rider can't add targets to a card's roll yet.");

  // The card with the before-roll riders' additions (the roll's bonus and advantage, the damage changes).
  const run = async (r: UseRequest, f: Folds, rng: typeof rollDie) => {
    const built = await build(ctx, r);
    const roll = built.context.roll ?? {};
    built.context.roll = { ...roll, modifier: (roll.modifier ?? 0) + f.modifier, advantage: (roll.advantage ?? 0) + f.advantage };
    return { built, outcome: runCard(built, r.pick, rng) };
  };
  const req1: UseRequest = { ...req, sheet, pick: withFolds(req.pick, folds) };
  const first = await run(req1, folds, rec.rng);
  if (first.outcome.kind === "needsChoice") return { kind: "needsChoice", outcome: first.outcome };
  const dice = [...rec.values];
  let built = first.built;
  let plan = first.outcome.plan;
  const hostRoll = hostRollOf(plan);

  // The riders on the result, on the sheet after the card (its own Hope may pay, CB p.90).
  let after = actorSheetAfter(built.paidSheet, plan, built.context.actor.id, req.pick.name);
  const hitIds = plan.hits.filter((h) => h.hit).map((h) => built.creatures.get(h.id)?.tokenId ?? h.id);
  const later = emptyFolds();
  const skipped: string[] = [];
  for (const r of picked.filter((x) => x.phase === "after")) {
    if (!resultHolds(r.trigger, hostRoll) || (r.trigger.kind !== "afterYouRoll" && hitIds.length === 0)) {
      skipped.push(r.name);
      continue;
    }
    const ran = await runRiderPart(env, r, after, "pre", hostRoll, hitIds, undefined);
    if (ran === null) continue;
    used.push(r);
    if (ran === "empty") continue;
    after = ran.sheet;
    foldInto(later, ran);
    names.push(ran.name);
  }
  if (later.addTargets.length > 0) throw appError("INVALID", "A rider can't add targets to a card's roll yet.");
  const merged: Folds = { ...folds, damageAdd: folds.damageAdd + later.damageAdd, addTypes: [...folds.addTypes, ...later.addTypes], proficiency: folds.proficiency + later.proficiency, multiply: folds.multiply * later.multiply, extraHp: folds.extraHp + later.extraHp, ...(later.minimumSeverity ? { minimumSeverity: later.minimumSeverity } : {}) };
  let req2 = req1;
  if (merged !== folds && (later.damageAdd !== 0 || later.proficiency !== 0 || later.multiply !== 1 || later.extraHp !== 0 || later.minimumSeverity)) {
    // The same dice: the card's roll and damage don't change, only what the riders add to them.
    req2 = { ...req, sheet, pick: withFolds(req.pick, merged) };
    const again = await run(req2, folds, replaying(dice, rollDie));
    if (again.outcome.kind === "needsChoice") return { kind: "needsChoice", outcome: again.outcome };
    built = again.built;
    plan = again.outcome.plan;
  }

  const post = async (entryId: Id<"actionLog">) => {
    const groupId = (await ctx.db.get("actionLog", entryId))?.groupId;
    let now = readSheet((await ctx.db.get("characters", req.character._id))!.sheet);
    const start = now;
    const runs: RiderRun[] = [];
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
      runs.push(ran);
      now = ran.sheet;
    }
    for (const r of picked.filter((x) => x.phase === "damage")) {
      const severity = r.trigger.kind === "whenTargetMarksHp" || r.trigger.kind === "whenEnemyTakesDamage" ? r.trigger.severity : undefined;
      const hitStep = plan.steps.find((st) => st.kind === "damage" && st.result.hpMarked > 0 && (severity === undefined || st.result.severity === severity));
      const tokenId = hitStep && hitStep.kind === "damage" ? built.creatures.get(hitStep.result.targetId)?.tokenId : undefined;
      if (tokenId === undefined || !(await standing(tokenId))) continue;
      const ran = await runRiderPart(env, r, now, "whole", hostRoll, [tokenId], undefined, tokenId);
      if (ran === null || ran === "empty") continue;
      runs.push(ran);
      now = ran.sheet;
    }
    if (runs.length === 0) return;
    const writes: InstanceWrite[] = [];
    const lines: string[] = [];
    let fearDelta = 0;
    for (const ran of runs) {
      const w = instanceWrites(ran.plan, ran.built.creatures, ran.name);
      await writeInstances(ctx, w);
      writes.push(...w);
      const l = gmLines(ran.plan, ran.built, w);
      if (l.length > 0) lines.push(`${ran.name}: ${l.join("; ")}`);
      fearDelta += ran.plan.gmFearDelta;
    }
    const changedFear = await changeFear(ctx, req.campaign._id, fearDelta);
    const sheetChanged = changed(start, now);
    if (sheetChanged) await saveSheet(ctx, req.character._id, now);
    await logAction(ctx, {
      campaignId: req.campaign._id,
      ...(sheetChanged ? { characterId: req.character._id, before: start } : {}),
      actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${req.sheet.name} · riders → ${lines.join("; ") || runs.map((x) => x.name).join(", ")}`.slice(0, 1000),
      ...(groupId !== undefined ? { groupId } : {}),
      ...(writes.length > 0 ? { adversaryBefore: writes.map((w) => w.before) } : {}),
      ...(changedFear !== 0 ? { fearDelta: changedFear } : {}),
      undoable: true,
    });
  };
  return { kind: "plan", built, plan, req: req2, sheets: { before: req.sheet, next: after, names: [...names, ...skipped.map((n) => `${n} not used`)] }, post };
}

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
};

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
    ctx.once("combat_card", args, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
      assertCanAct(character, sheet);
      const scene = await attackScene(ctx, campaign, character, args.mapId);
      const pick = pickCard(sheet, args.cardId, args.spell);
      const req: UseRequest = { campaign, character, sheet, scene, pick, targetTokenIds: args.targetTokenIds, choices: args.choices, roll: args.roll ?? {} };
      const riders = args.riders ?? [];
      if (riders.length > 0) {
        const withRiders = await cardWithRiders(ctx, req, riders, ctx.user._id);
        if (withRiders.kind === "needsChoice") return { status: "needsChoice" as const, asks: withRiders.outcome.asks };
        if (withRiders.built.outOfRange.length === 0) {
          const result = await resolveUse(ctx, withRiders.req, withRiders.built, withRiders.plan, ctx.user._id, withRiders.sheets);
          await withRiders.post(result.entryId);
          return result;
        }
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
            action: { kind: "card", cardId: args.cardId, useId: pick.use.id, targetTokenIds: args.targetTokenIds, choices: args.choices, ...(args.roll ? { roll: args.roll } : {}), riders },
            outOfRange: withRiders.built.outOfRange,
          },
        });
        return { status: "pending" as const, requestId, outOfRange: withRiders.built.outOfRange };
      }
      const built = await build(ctx, req);
      // Refusals (exhausted, cost, condition) and missing choices come first, whether or not the GM must approve.
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      if (built.outOfRange.length === 0) return resolveUse(ctx, req, built, outcome.plan, ctx.user._id);

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
          action: { kind: "card", cardId: args.cardId, useId: pick.use.id, targetTokenIds: args.targetTokenIds, choices: args.choices, ...(args.roll ? { roll: args.roll } : {}) },
          outOfRange: built.outOfRange,
        },
      });
      return { status: "pending" as const, requestId, outOfRange: built.outOfRange };
    }),
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
      assertCanAct(character, sheet);
      const scene = await attackScene(ctx, ctx.campaign, character, row.mapId);
      const pick = pickCard(sheet, action.cardId, action.useId);
      const req: UseRequest = { campaign: ctx.campaign, character, sheet, scene, pick, targetTokenIds: action.targetTokenIds, choices: action.choices, roll: action.roll ?? {} };
      if (action.riders && action.riders.length > 0) {
        const withRiders = await cardWithRiders(ctx, req, action.riders, row.createdBy);
        if (withRiders.kind === "needsChoice") return { status: "needsChoice" as const, asks: withRiders.outcome.asks };
        const result = await resolveUse(ctx, withRiders.req, withRiders.built, withRiders.plan, row.createdBy, withRiders.sheets);
        await withRiders.post(result.entryId);
        await closeRequest(ctx, row._id, "resolved", ctx.user._id);
        return result;
      }
      const built = await build(ctx, req);
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      const result = await resolveUse(ctx, req, built, outcome.plan, row.createdBy);
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return result;
    }),
});

const namedToken = v.object({ tokenId: v.id("combatTokens"), name: v.string() });

/** A card sanction as `pending` shows it: names and bands only (U1, CF6). */
const pendingView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  cardId: v.string(),
  cardName: v.string(),
  useId: v.string(),
  createdAt: v.number(),
  targets: v.array(namedToken),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

async function nameOf(ctx: QueryCtx, row: Doc<"combatRequests">, tokenId: Id<"combatTokens">): Promise<string> {
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token === null || token.campaignId !== row.campaignId) return "Unknown";
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    return character === null || character.campaignId !== row.campaignId ? "Unknown" : readSheet(character.sheet).name;
  }
  // A companion token (token refs widened by sheet-drawer SD0, Q4); nothing places one until SD-C.
  if (token.ref.kind === "companion") return "Companion";
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === row.campaignId ? instance.label : "Unknown";
}

/** The open card sanctions: a player's own, every one for the GM (the GM's queue). Those of an ended encounter are left out. */
export const pending = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(pendingView),
  handler: async (ctx) => {
    const gm = ctx.permission === "owner";
    const views = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      if (!gm && row.createdBy !== ctx.user._id) continue;
      const p = row.payload;
      if (p.kind !== "sanction" || p.action.kind !== "card" || !(await encounterRunning(ctx, row))) continue;
      const targets = [];
      for (const tokenId of p.action.targetTokenIds) targets.push({ tokenId, name: await nameOf(ctx, row, tokenId) });
      const character = await ctx.db.get("characters", p.characterId);
      views.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: character !== null && character.campaignId === row.campaignId ? readSheet(character.sheet).name : "Unknown",
        cardId: p.action.cardId,
        cardName: getDomainCard(p.action.cardId)?.name ?? p.action.cardId,
        useId: p.action.useId,
        createdAt: row.createdAt,
        targets,
        outOfRange: p.outOfRange,
      });
    }
    return views;
  },
});
