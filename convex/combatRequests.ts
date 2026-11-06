import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { env, internalMutation } from "./_generated/server";
import { isE2EDeployment } from "./lib/allowlist";
import { readSheet } from "./lib/characterSheet";
import { attackScene, awaitingAttackValidator, checkTargets, equippedWeapon, resolveAttack, resolvedAttackValidator, rollFromStored, withoutTargets } from "./lib/combatActions";
import { closeRequest, encounterRunning, loadOpenRequest } from "./lib/combatRequests";
import { keyedGmMutation } from "./lib/functions";

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
 *
 * The reads (`mine`, `difficulties`, `forcedAttacks`) live in `combatRequestsReads.ts` (dcm-uh6r), so the HUD's
 * subscriptions do not load the attack resolver this module needs.
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
      // Identity: the e2e seed's request is raised by the creator.
      createdBy: campaign.ownerId,
      status: "open",
      createdAt: Date.now(),
      responses: [],
      kind: "forcedAttack",
      payload: { schemaVersion: 1, kind: "forcedAttack", characterId, instanceId: instance._id, instanceLabel, feature, targetTokenIds, groupId: `e2e-forced-${Date.now()}` },
    });
  },
});

/**
 * dcm-bxp.99.32.25 test seeding for the HUD's "Your roll waits" (plan combat-hud H4.1; tests/e2e/hud-result.spec.ts,
 * tests/e2e/visual/HUD-H4.1.spec.ts): opens an `afterRoll` request, as a held map attack does (convex/lib/combatActions.ts
 * `resolveAttack`), for the character's primary-weapon attack on one adversary token, with fixed Hope and Fear dice and
 * the after-roll `options` the HUD offers (feature ids and uses the character holds, e.g. a warlock's Patron's Boon). The
 * stored dice replay on Use / Pass (`dualityAt` 0: the Hope Die, then the Fear Die), so the held roll and its outcome are
 * deterministic; damage dice are drawn when it resolves. The total is the two dice plus the weapon's trait. Internal
 * (admin key only, `convex run`), refused on anything but the local e2e backend.
 */
export const seedHeldAttackForE2e = internalMutation({
  args: {
    characterId: v.id("characters"),
    targetTokenId: v.id("combatTokens"),
    hope: v.number(),
    fear: v.number(),
    options: v.array(v.object({ featureId: v.string(), useId: v.string() })),
  },
  returns: v.id("combatRequests"),
  handler: async (ctx, { characterId, targetTokenId, hope, fear, options }) => {
    if (!isE2EDeployment(env)) throw new Error("seedHeldAttackForE2e runs only on the local e2e backend.");
    if (![hope, fear].every((d) => Number.isInteger(d) && d >= 1 && d <= 12)) throw new Error("Hope and Fear are d12 faces (1-12).");
    if (options.length === 0 || options.length > 8) throw new Error("Give 1 to 8 after-roll options.");
    const character = await ctx.db.get("characters", characterId);
    const target = await ctx.db.get("combatTokens", targetTokenId);
    if (character === null || target === null || target.ref.kind !== "adversary" || target.campaignId !== character.campaignId) throw new Error("Seed a character and an adversary token of its campaign.");
    const instance = await ctx.db.get("encounterAdversaries", target.ref.adversaryId);
    if (instance === null) throw new Error("No such instance.");
    const sheet = readSheet(character.sheet);
    const weapon = equippedWeapon(sheet, "primary");
    const trait = weapon.trait === "choice" ? "strength" : weapon.trait;
    const modifier = sheet.traits[trait] ?? 0;
    const total = hope + fear + modifier;
    const hit = hope === fear || total >= instance.stats.difficulty;
    const outcome = hope === fear ? "critical" : hit ? (hope > fear ? "successHope" : "successFear") : hope > fear ? "failHope" : "failFear";
    return ctx.db.insert("combatRequests", {
      campaignId: character.campaignId,
      encounterId: instance.encounterId,
      mapId: target.mapId,
      // Identity: the held attack is the character's owner's, as a real one is the attacking player's.
      createdBy: character.ownerId,
      status: "open",
      createdAt: Date.now(),
      responses: [],
      kind: "afterRoll",
      payload: {
        schemaVersion: 1,
        kind: "afterRoll",
        characterId,
        action: { kind: "attack", slot: "primary", targetTokenIds: [targetTokenId], roll: {} },
        dice: [hope, fear],
        dualityAt: 0,
        roll: {
          kind: "action",
          dice: [
            { sides: 12, value: hope, role: "hope" },
            { sides: 12, value: fear, role: "fear" },
          ],
          modifier,
          total,
          outcome,
          manual: false,
        },
        hits: [{ tokenId: targetTokenId, hit }],
        options,
      },
    });
  },
});
