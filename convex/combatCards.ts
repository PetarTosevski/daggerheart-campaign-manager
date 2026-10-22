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
import {
  actorSheetAfter,
  buildRun,
  cardChoicesValidator,
  cardRollValidator,
  damageRolls,
  difficultyOf,
  gmLines,
  handCardValidator,
  handOf,
  instanceWrites,
  needsChoiceValidator,
  parseChoices,
  pendingCardValidator,
  pickCard,
  promptsOf,
  publicTargets,
  resolvedCardValidator,
  rollText,
  runCard,
  writeInstances,
  writeSheetChanges,
  type BuiltRun,
  type CardChoice,
  type CardPick,
  type CardRoll,
  type ResolvedCard,
} from "./lib/cardRunner";
import { assertCanAct, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { attackScene, type AttackScene } from "./lib/combatActions";
import { closeRequest, encounterRunning, loadOpenRequest, openMinionOffer, openRequests } from "./lib/combatRequests";
import { rollDie } from "./lib/dice";
import { campaignFearState, gainFear, spendFear } from "./lib/fear";
import { campaignQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { changed } from "./lib/rolls";
import { rangeBandValidator } from "./lib/validators/combatRequests";
import type { RunPlan } from "../src/lib/domain/card-effects/run";

/**
 * Domain cards on the Combat Map (plan combat-actions, tracer CA4; docs/tasks/TASK-CA-CA4.md). Players act for a
 * character they edit (their own; the GM any): campaign wrappers with `need: "view"`, then `loadCharacter(..., "edit")`,
 * so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2).
 *
 * - `hand`: the loadout and the vault with each card's state (ready / exhausted / passive / outOfCombat), reset label,
 *   tokens and recall cost. The character's player and the GM (who sees a selected PC's cards, user answer 2026-10-22).
 * - `useCard`: uses a loadout card: checks, pays, rolls, applies, logs one undoable group (public: hit / miss; GM:
 *   the full resolution). A target outside the card's range turns it into a GM sanction (Q1).
 * - `sanction` (GM): approves or declines a card use waiting for the GM; `pending`: the open card sanctions (own / all).
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
    const { sheet } = await editableHere(ctx, characterId);
    return { characterId, ...handOf(sheet) };
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
async function resolveUse(ctx: MutationCtx, req: UseRequest, built: BuiltRun, plan: RunPlan, actorId: Id<"users">): Promise<ResolvedCard> {
  const { campaign, character, sheet, pick } = req;
  const actorToken = built.context.actor.id;
  let next = actorSheetAfter(built.paidSheet, plan, actorToken, pick.name);
  const healed = siphonHeal(plan);
  if (healed > 0) next = { ...next, hp: Math.max(0, next.hp - healed) };
  const prompts = promptsOf(plan, built).filter((p) => !(healed > 0 && p.kind === "manual" && p.text.startsWith("You clear a number of Hit Points")));

  // Allies: tracks from the plan's creatures, Hope / effects / conditions from its steps.
  const allyRows: { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }[] = [];
  for (const c of built.creatures.all) {
    if (c.kind !== "pc" || c.character._id === character._id) continue;
    const changedTo = plan.creatures.find((x) => x.id === c.tokenId)?.after;
    let after = writeSheetChanges(c.sheet, plan.steps, c.tokenId, plan.cardId, pick.name, plan.exclusive, false);
    if (changedTo) after = { ...after, hp: Math.min(c.sheet.hpMax, changedTo.hp), stress: Math.min(c.sheet.stressMax, changedTo.stress), armorMarked: Math.max(0, changedTo.armor ?? c.sheet.armorMarked) };
    if (changed(c.sheet, after)) allyRows.push({ character: c.character, before: c.sheet, after });
  }

  const writes = instanceWrites(plan, built.creatures);
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
    summary: `${sheet.name} uses ${pick.name}${useName}${rollPart}${damagePart}${targetPart}`,
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

  const minionOffer = await offerMinions(ctx, req, built, plan, { groupId, entryId, actorId });
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

const useArgs = {
  characterId: v.id("characters"),
  mapId: v.id("combatMaps"),
  cardId: v.string(),
  /** The use: a grimoire spell or a card part (`CardUse.id`); default the card's first action use. */
  spell: v.optional(v.string()),
  targetTokenIds: v.array(v.id("combatTokens")),
  /** The player's picks as `{id, value}` (see `parseChoices` in convex/lib/cardRunner.ts for the ids). */
  choices: cardChoicesValidator,
  roll: v.optional(cardRollValidator),
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
      const built = await build(ctx, req);
      // Refusals (exhausted, cost, condition) and missing choices come first, whether or not the GM must approve.
      const outcome = runCard(built, pick, rollDie);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      if (built.outOfRange.length === 0) return resolveUse(ctx, req, built, outcome.plan, ctx.user._id);

      // Q1: wait for the GM; the dry run above is thrown away (nothing rolled, paid or logged is kept).
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
      const built = await build(ctx, req);
      const outcome = runCard(built, pick, rollDie);
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
