import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc } from "./_generated/dataModel";
import { env, internalMutation, type QueryCtx } from "./_generated/server";
import { isE2EDeployment } from "./lib/allowlist";
import { findCharacter, readSheet } from "./lib/characterSheet";
import { atLeast } from "./lib/permissions";
import { attackScene, awaitingAttackValidator, checkTargets, equippedWeapon, resolveAttack, resolvedAttackValidator, rollFromStored, withoutTargets } from "./lib/combatActions";
import { closeRequest, encounterRunning, loadOpenRequest, openRequests } from "./lib/combatRequests";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import { cardEffect } from "../src/lib/srd/card-effects/index";
import { costText } from "./lib/featureDrawer";
import { rangeBandValidator } from "./lib/validators/combatRequests";
import { rollValidator } from "./lib/validators/actionLog";

/**
 * Combat requests a player or the GM answers (plan combat-actions; table AA0, these functions CA3):
 * - `sanction` (GM): approves or declines a player's out-of-range attack (Q1). Approval resolves the stored attack
 *   exactly as `combatActions.attack` would (rolled now, by the server; the rows belong to the player who asked).
 * - `mine`: the open requests waiting on the caller: a player's own sanctions, Minion offers and held attacks (SD5,
 *   Q1: an attack waiting for an after-roll feature's Use / Pass); for the GM every open one of the campaign (the GM's
 *   queue, with Resolve now). Requests whose encounter is no longer running are left out.
 * - SD5: an approved sanction may itself be held for an after-roll feature (`awaiting`).
 * - `difficulties` (plan lanes B2): the rolls waiting for the GM's Difficulty (a player's Charge, a Cloaked rogue seen
 *   dimly by enemies without one); the GM answers them with `featurePrompts.answerDifficulty`.
 * - `forcedAttacks` (plan lanes-2 wave 10, E1.4b; dcm-uxsd): the forced PC attacks waiting on the caller's characters
 *   (Beguiled, HF p.75); the player answers one with `combatActions.attack` and its `forcedRequestId`.
 * Card sanctions (CA4) and incoming hits (AA2) are answered by their own tracers' functions.
 */

const declined = v.object({ status: v.literal("declined") });

/**
 * The GM approves (`approve: true`) or declines a sanction (Q1). Declining closes it. Approving re-checks the attacker's
 * token, line of sight and targets (COMBAT_NO_LINE_OF_SIGHT / COMBAT_TARGET_INVALID leave the request open, so the GM
 * can decline it), skips the range check the GM just waived, and resolves the attack. A request whose encounter ended
 * is declined instead. REQUEST_NOT_OPEN once answered; NOT_FOUND for another campaign's or a non-sanction request.
 */
export const sanction = keyedGmMutation({
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), approve: v.boolean() },
  returns: v.union(resolvedAttackValidator, awaitingAttackValidator, declined),
  handler: async (ctx, { requestId, approve }) =>
    ctx.once("combat_sanction", { requestId, approve }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      if (row.payload.kind !== "sanction") throw appError("NOT_FOUND");
      const { characterId, action, outOfRange } = row.payload;
      const added = new Set<string>(row.payload.added ?? []);
      // DA2 (user 2026-10-30): when only a rider's extra targets are out of range, Decline drops those targets only and the
      // attack resolves without them (the attack's own target is in range).
      const dropOnly = !approve && added.size > 0 && outOfRange.every((o) => added.has(o.tokenId));
      if ((!approve && !dropOnly) || !(await encounterRunning(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      if (action.kind !== "attack") throw appError("INVALID", "Card uses are answered from the card's own request.");
      const character = await ctx.db.get("characters", characterId);
      if (character === null || character.campaignId !== ctx.campaign._id || row.mapId === undefined) throw appError("COMBAT_TARGET_INVALID");
      const loaded = { campaign: ctx.campaign, character, sheet: readSheet(character.sheet), gm: false };
      const scene = await attackScene(ctx, ctx.campaign, character, row.mapId);
      const weapon = equippedWeapon(loaded.sheet, action.slot);
      const targets = await checkTargets(ctx, ctx.campaign, scene, weapon, action.targetTokenIds, rollFromStored(action.roll));
      const riders = dropOnly ? withoutTargets(action.riders ?? [], added) : (action.riders ?? []);
      const waived = dropOnly ? [] : (row.payload.added ?? []);
      const result = await resolveAttack(ctx, { loaded, actorId: row.createdBy, scene, weapon, slot: action.slot, targets, roll: rollFromStored(action.roll), riders, waived });
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return result;
    }),
});

const namedToken = v.object({ tokenId: v.id("combatTokens"), name: v.string() });

/** A request as `mine` shows it: names and bands only, no stats (U1, CF6). */
const requestView = v.union(
  v.object({
    kind: v.literal("sanction"),
    requestId: v.id("combatRequests"),
    characterId: v.id("characters"),
    characterName: v.string(),
    createdAt: v.number(),
    slot: v.union(v.literal("primary"), v.literal("secondary")),
    targets: v.array(namedToken),
    outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
  }),
  v.object({
    kind: v.literal("minionOffer"),
    requestId: v.id("combatRequests"),
    characterId: v.id("characters"),
    characterName: v.string(),
    createdAt: v.number(),
    entryId: v.id("actionLog"),
    extra: v.number(),
    candidates: v.array(v.object({ instanceId: v.id("encounterAdversaries"), tokenId: v.id("combatTokens"), name: v.string(), available: v.number() })),
  }),
  /** SD5 (Q1): the attacker's own dice and Hit / Miss per target, and the after-roll features on offer (U1). */
  v.object({
    kind: v.literal("afterRoll"),
    requestId: v.id("combatRequests"),
    characterId: v.id("characters"),
    characterName: v.string(),
    createdAt: v.number(),
    roll: rollValidator,
    targets: v.array(v.object({ tokenId: v.id("combatTokens"), name: v.string(), hit: v.boolean() })),
    options: v.array(v.object({ featureId: v.string(), useId: v.string(), name: v.string(), costs: v.array(v.string()) })),
  }),
  /** DA2 (HF p.8 Death Strike): a damage-phase rider waiting for Use on one candidate, or Pass. Names only (U1). */
  v.object({
    kind: v.literal("riderPick"),
    requestId: v.id("combatRequests"),
    characterId: v.id("characters"),
    characterName: v.string(),
    createdAt: v.number(),
    name: v.string(),
    costs: v.array(v.string()),
    candidates: v.array(namedToken),
  }),
);

async function characterName(ctx: QueryCtx, row: Doc<"combatRequests">, characterId: Doc<"characters">["_id"]): Promise<string> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== row.campaignId) return "Unknown";
  try {
    return readSheet(character.sheet).name;
  } catch {
    return "Unknown";
  }
}

/** A token's label: its encounter instance's (players see instance labels on the map already), or the custom name. */
async function tokenName(ctx: QueryCtx, row: Doc<"combatRequests">, tokenId: Doc<"combatTokens">["_id"]): Promise<string> {
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token === null || token.campaignId !== row.campaignId) return "Unknown";
  if (token.ref.kind === "custom") return token.ref.name;
  // B2: an enemy-side PC or companion can see a Cloaked rogue too.
  if (token.ref.kind === "pc") return characterName(ctx, row, token.ref.characterId);
  if (token.ref.kind === "companion") return "Companion";
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === row.campaignId ? instance.label : "Unknown";
}

/**
 * The open requests waiting on or from the caller (see the module comment). A player gets only rows they created; the
 * GM gets every open sanction and Minion offer. Oldest first.
 */
export const mine = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(requestView),
  handler: async (ctx) => {
    const gm = ctx.permission === "owner";
    const views = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      if (!gm && row.createdBy !== ctx.user._id) continue;
      if (!(await encounterRunning(ctx, row))) continue;
      const p = row.payload;
      if (p.kind === "sanction" && p.action.kind === "attack") {
        const targets = [];
        for (const tokenId of p.action.targetTokenIds) targets.push({ tokenId, name: await tokenName(ctx, row, tokenId) });
        views.push({
          kind: "sanction" as const,
          requestId: row._id,
          characterId: p.characterId,
          characterName: await characterName(ctx, row, p.characterId),
          createdAt: row.createdAt,
          slot: p.action.slot,
          targets,
          outOfRange: p.outOfRange,
        });
      } else if (p.kind === "afterRoll") {
        const targets = [];
        for (const h of p.hits) targets.push({ tokenId: h.tokenId, name: await tokenName(ctx, row, h.tokenId), hit: h.hit });
        const options = p.options.flatMap((o) => {
          const use = featureEffect(o.featureId)?.uses.find((u) => u.id === o.useId);
          return use ? [{ ...o, name: use.name, costs: (use.costs ?? []).map(costText) }] : [];
        });
        views.push({
          kind: "afterRoll" as const,
          requestId: row._id,
          characterId: p.characterId,
          characterName: await characterName(ctx, row, p.characterId),
          createdAt: row.createdAt,
          roll: p.roll,
          targets,
          options,
        });
      } else if (p.kind === "riderPick") {
        const candidates = [];
        for (const tokenId of p.candidates) candidates.push({ tokenId, name: await tokenName(ctx, row, tokenId) });
        const uses = p.rider.source === "card" ? cardEffect(p.rider.id)?.uses : featureEffect(p.rider.id)?.uses;
        const use = uses?.find((u) => u.id === p.rider.useId);
        views.push({
          kind: "riderPick" as const,
          requestId: row._id,
          characterId: p.characterId,
          characterName: await characterName(ctx, row, p.characterId),
          createdAt: row.createdAt,
          name: p.rider.name,
          costs: (use?.costs ?? []).map(costText),
          candidates,
        });
      } else if (p.kind === "minionOffer") {
        const candidates = [];
        for (const c of p.candidates) candidates.push({ ...c, name: await tokenName(ctx, row, c.tokenId) });
        views.push({
          kind: "minionOffer" as const,
          requestId: row._id,
          characterId: p.characterId,
          characterName: await characterName(ctx, row, p.characterId),
          createdAt: row.createdAt,
          entryId: p.entryId,
          extra: p.extra,
          candidates,
        });
      }
    }
    return views;
  },
});

/** B2: a roll waiting for the GM's Difficulty, as `difficulties` shows it (names only, U1). */
const difficultyView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  createdAt: v.number(),
  /** `charge`: a player's Charge (CB p.59) at `target`; `cloak`: a Cloaked rogue seen dimly by `seers` (CB p.42). */
  ask: v.union(v.literal("charge"), v.literal("cloak")),
  target: v.union(v.null(), namedToken),
  seers: v.array(namedToken),
});

/**
 * B2 (plan lanes; CB p.104 "The GM sets this Difficulty"): the rolls waiting for the GM's Difficulty: a player's Charge
 * (dcm-bxp.99.19.61) and a Cloaked rogue seen dimly only by enemies without one (dcm-bxp.99.19.62 (1)). The GM gets every
 * open one of the campaign (answered with `featurePrompts.answerDifficulty`); a player only the ones they made (their
 * drawer's "waiting for the GM"). Requests whose encounter is no longer running are left out. Oldest first.
 */
export const difficulties = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(difficultyView),
  handler: async (ctx) => {
    const gm = ctx.permission === "owner";
    const views = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      const p = row.payload;
      if (p.kind !== "difficulty") continue;
      if (!gm && row.createdBy !== ctx.user._id) continue;
      if (!(await encounterRunning(ctx, row))) continue;
      const seers = [];
      if (p.ask.kind === "cloak") for (const tokenId of p.ask.seers) seers.push({ tokenId, name: await tokenName(ctx, row, tokenId) });
      views.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: await characterName(ctx, row, p.characterId),
        createdAt: row.createdAt,
        ask: p.ask.kind,
        target: p.ask.kind === "charge" ? { tokenId: p.ask.targetTokenId, name: await tokenName(ctx, row, p.ask.targetTokenId) } : null,
        seers,
      });
    }
    return views;
  },
});

/** E1.4b (dcm-uxsd): a forced PC attack as `forcedAttacks` shows it (names only, U1). */
const forcedAttackView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  createdAt: v.number(),
  /** The forcing adversary's label and the printed feature ("Gobstalker", "Beguile"). */
  instanceLabel: v.string(),
  feature: v.string(),
  /** The locked targets. */
  targets: v.array(namedToken),
});

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-uxsd; user answer 2026-10-31: "a roll request opens the player's attack with the target
 * locked"): the open forced PC attacks on characters the caller edits (the GM: every one of the campaign). The player opens
 * the Attack bar from one; `combatActions.attack` with `forcedRequestId` answers it. Requests whose encounter is no longer
 * running are left out. Oldest first.
 */
export const forcedAttacks = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(forcedAttackView),
  handler: async (ctx) => {
    const gm = ctx.permission === "owner";
    const views = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      const p = row.payload;
      if (p.kind !== "forcedAttack") continue;
      if (!gm) {
        const found = await findCharacter(ctx, ctx.user, p.characterId, "edit");
        if (found === null || found.campaign._id !== ctx.campaign._id || !atLeast(found.permission, "edit")) continue;
      }
      if (!(await encounterRunning(ctx, row))) continue;
      const targets = [];
      for (const tokenId of p.targetTokenIds) targets.push({ tokenId, name: await tokenName(ctx, row, tokenId) });
      views.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: await characterName(ctx, row, p.characterId),
        createdAt: row.createdAt,
        instanceLabel: p.instanceLabel,
        feature: p.feature,
        targets,
      });
    }
    return views;
  },
});

/**
 * E1.4b (dcm-uxsd) test seeding for tests/e2e/lane4-forced-attack.spec.ts: opens a forced-attack request on a character
 * against locked target tokens, as E7.4's opener (convex/lib/forcedAttacks.ts) will. Internal (admin key only,
 * `convex run`), and refused on anything but the local e2e backend.
 */
export const seedForcedAttackForE2e = internalMutation({
  args: { characterId: v.id("characters"), targetTokenIds: v.array(v.id("combatTokens")), instanceLabel: v.string(), feature: v.string() },
  returns: v.id("combatRequests"),
  handler: async (ctx, { characterId, targetTokenIds, instanceLabel, feature }) => {
    if (!isE2EDeployment(env)) throw new Error("seedForcedAttackForE2e runs only on the local e2e backend.");
    const character = await ctx.db.get("characters", characterId);
    const target = targetTokenIds[0] === undefined ? null : await ctx.db.get("combatTokens", targetTokenIds[0]);
    if (character === null || target === null || target.ref.kind !== "adversary") throw new Error("Seed a character and an adversary token.");
    const instance = await ctx.db.get("encounterAdversaries", target.ref.adversaryId);
    const campaign = await ctx.db.get("campaigns", character.campaignId);
    if (instance === null || campaign === null) throw new Error("No such instance.");
    return ctx.db.insert("combatRequests", {
      campaignId: character.campaignId,
      encounterId: instance.encounterId,
      mapId: target.mapId,
      createdBy: campaign.ownerId,
      status: "open",
      createdAt: Date.now(),
      responses: [],
      kind: "forcedAttack",
      payload: { schemaVersion: 1, kind: "forcedAttack", characterId, instanceId: instance._id, instanceLabel, feature, targetTokenIds, groupId: `e2e-forced-${Date.now()}` },
    });
  },
});
