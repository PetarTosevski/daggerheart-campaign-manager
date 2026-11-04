/**
 * The spotlight's server helpers (plan combat-hud H1.S, user answer 1c, user answer 2026-11-01 on movement). The
 * `combatSpotlight` table holds at most one row per campaign: who holds the spotlight now, since when and why.
 *
 * Rules: CB p.100 "Battling Adversaries": "The player characters pass the spotlight between themselves, making moves
 * until someone fails a roll or rolls with Fear, or until the GM spends a Fear to interrupt the players' turns. When
 * play passes to the GM, the GM can make a move to spotlight an adversary [...] Once the GM has finished, play passes
 * back to the PCs." CB p.149 "When to Make a Move": "Rolls with Fear on an action roll. / Fails an action roll."
 *
 * - `moveToGm(ctx, campaign, reason, rollBy?)`: the engine's call when a PC's action roll comes up with Fear or fails
 *   (`rollWithFear` / `failedRoll`), or the GM spotlights an adversary (`adversary`). Wired by bead dcm-bxp.99.32.4;
 *   until then only the GM's `combatSpotlight.gmTake` moves it.
 * - `spotlightAdversary(ctx, campaign, tokenId)`: the GM spotlights one adversary (`combatSpotlight.gmTake({ tokenId })`,
 *   reason `adversary`); the row names its token (`adversaryTokenId`) so the map can light it (bead dcm-bxp.99.32.35).
 *   A move to the GM from a PC and a hand-back to a PC clear it.
 * - `giveTo(ctx, campaign, characterId)`: the GM hands it to a PC (`combatSpotlight.handTo`).
 * - Spotlight per PC per live session (plan journal JD1, user answer 2026-11-03): every real move to a specific PC
 *   (`setHolder` writes a new PC holder) while a session is live adds 1 to that PC's `sessionSpotlights` row. Moves to
 *   the GM, to an adversary and to the whole party (`giveToParty`, no holder) do not count; neither does a move with no
 *   live session or to the PC who already holds it. It runs inside the caller's keyed `once`, so a retry counts once.
 * - `giveToParty(ctx, campaign)`: the GM hands it to the whole party, nobody chosen (`combatSpotlight.handToParty`, plan
 *   combat-hud H9.S, user answer Q8 a): the row goes, which is the "players hold it, nobody in particular" state.
 * - `takeWithFear(ctx, campaign, user, tokenId?)`: the GM spends 1 Fear to interrupt (`combatSpotlight.gmTake({ pay:
 *   "fear" })`, H9.S, user answer Q7 a; CB p.155). With a token the payment counts as that adversary's spotlight this
 *   GM turn, so its first action costs nothing more. Logged (one undoable group) so the GM's undo gives the Fear back.
 * - `assertMayAct(ctx, campaign, character, kind)`: refuses a player's `action` or token `move` with
 *   SPOTLIGHT_WITH_GM while the GM holds the spotlight; a `reaction` always passes, and so does the GM. Wired by bead
 *   dcm-bxp.99.32.5; until then nothing is refused.
 *
 * ```ts
 * // in a roll mutation, after the outcome is known (dcm-bxp.99.32.4):
 * if (outcome.withFear) await moveToGm(ctx, campaign, "rollWithFear", characterId);
 * else if (!outcome.success) await moveToGm(ctx, campaign, "failedRoll", characterId);
 * // at the top of a player's card use, feature use, attack or token move (dcm-bxp.99.32.5):
 * await assertMayAct(ctx, campaign, character, "action"); // or "move"; a reaction passes "reaction"
 * ```
 */
import { isDefeated } from "../../src/lib/domain/encounters/damage";
import { applySpotlight, spotlightsThisTurn } from "../../src/lib/domain/encounters/spotlight";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { SpotlightHolder, SpotlightReason } from "../tables/combatSpotlight";
import { logAction, newGroupId } from "./actionLog";
import { loadCombatToken } from "./combatMaps";
import { campaignFearState, spendFear } from "./fear";
import { atLeast, permissionFor } from "./permissions";
import { liveSession } from "./sessions";

/** What a player is about to do: an `action` (a roll, a card, a feature, an attack), a token `move`, or a `reaction`. */
export type ActKind = "action" | "move" | "reaction";

/** Reasons the engine moves the spotlight to the GM. */
export type MoveToGmReason = Extract<SpotlightReason, "rollWithFear" | "failedRoll" | "adversary" | "gmTook">;

/** The campaign's spotlight row, or null (the players hold it, nobody in particular). */
export async function spotlightOf(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"combatSpotlight"> | null> {
  return ctx.db
    .query("combatSpotlight")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .first();
}

/** Whether the GM holds the spotlight in the campaign now. */
export async function gmHoldsSpotlight(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  return (await spotlightOf(ctx, campaignId))?.holder.kind === "gm";
}

function sameHolder(a: SpotlightHolder, b: SpotlightHolder): boolean {
  if (a.kind === "gm" || b.kind === "gm") return a.kind === b.kind;
  return a.characterId === b.characterId;
}

/**
 * Writes the campaign's holder; returns false (and writes nothing) when it already holds it. `adversaryTokenId` (GM
 * holder only) names the adversary spotlighted: a different one while the GM already holds it is written (the GM's
 * turn goes on, `since` kept); without one, a GM who already holds it keeps the lit adversary.
 */
async function setHolder(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  holder: SpotlightHolder,
  reason: SpotlightReason,
  rollBy: Id<"characters"> | undefined,
  adversaryTokenId?: Id<"combatTokens">,
): Promise<boolean> {
  const row = await spotlightOf(ctx, campaignId);
  // Unchanged holder (and adversary): no write, so a run of Fear rolls does not re-run every reader (CD10).
  if (row !== null && sameHolder(row.holder, holder)) {
    if (adversaryTokenId === undefined || row.adversaryTokenId === adversaryTokenId) return false;
    await ctx.db.patch("combatSpotlight", row._id, { reason, rollBy: undefined, adversaryTokenId });
    return true;
  }
  const next = { holder, since: Date.now(), reason, rollBy, adversaryTokenId };
  if (row === null) await ctx.db.insert("combatSpotlight", { campaignId, ...next });
  else await ctx.db.replace("combatSpotlight", row._id, { campaignId, ...next });
  if (holder.kind === "pc") await countLiveSpotlight(ctx, campaignId, holder.characterId);
  return true;
}

/**
 * Adds one to the PC's spotlight count for the campaign's live session (plan journal JD1, user answer 2026-11-03:
 * spotlight per PC per live session). No live session: nothing is written. One indexed read for the session, one for
 * the (session, character) row.
 */
async function countLiveSpotlight(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">): Promise<void> {
  const session = await liveSession(ctx, campaignId);
  if (session === null) return;
  const row = await ctx.db
    .query("sessionSpotlights")
    .withIndex("by_session_character", (q) => q.eq("sessionId", session._id).eq("characterId", characterId))
    .unique();
  if (row !== null) await ctx.db.patch("sessionSpotlights", row._id, { count: row.count + 1 });
  else await ctx.db.insert("sessionSpotlights", { campaignId, sessionId: session._id, characterId, count: 1 });
}

/**
 * Moves the spotlight to the GM (CB p.100, p.149). `rollBy` names the PC whose roll moved it. Returns whether it moved
 * (false when the GM already held it: `since` and `reason` keep the first move).
 */
export async function moveToGm(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  reason: MoveToGmReason,
  rollBy?: Id<"characters">,
): Promise<boolean> {
  const fromRoll = reason === "rollWithFear" || reason === "failedRoll";
  return setHolder(ctx, campaign._id, { kind: "gm" }, reason, fromRoll ? rollBy : undefined);
}

/**
 * The GM spotlights one adversary (CB p.100: "the GM can make a move to spotlight an adversary"): the spotlight goes to
 * the GM with reason `adversary` and the row names the token, which the map lights (bead dcm-bxp.99.32.35).
 * COMBAT_TOKEN_NOT_FOUND for a token of another campaign, INVALID for a token that is not an adversary's,
 * ADVERSARY_DEFEATED for a defeated adversary (`adversaryDefeated`; also refused by `takeWithFear`). Returns
 * whether the row changed (false when this adversary is already lit).
 */
export async function spotlightAdversary(ctx: MutationCtx, campaign: Doc<"campaigns">, tokenId: string): Promise<boolean> {
  const token = await loadCombatToken(ctx, campaign._id, tokenId);
  if (token.ref.kind !== "adversary") throw appError("INVALID", "Only an adversary's token can be spotlighted.");
  await assertNotDefeated(ctx, campaign._id, token);
  return setHolder(ctx, campaign._id, { kind: "gm" }, "adversary", undefined, token._id);
}

/**
 * Whether an adversary instance is defeated (user 2026-11-04: "I shouldn't be allowed to take the spotlight of dead
 * NPCs"): marked defeated (a Minion group with every Minion gone included), or every HP marked (CB p.208).
 */
export function adversaryDefeated(instance: Pick<Doc<"encounterAdversaries">, "defeated" | "hp" | "stats">): boolean {
  return instance.defeated || isDefeated({ hp: instance.hp, hpMax: instance.stats.hpMax });
}

/** ADVERSARY_DEFEATED for an adversary token whose instance is defeated; a token without an instance passes. */
async function assertNotDefeated(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<void> {
  if (token.ref.kind !== "adversary") return;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  if (instance !== null && instance.campaignId === campaignId && adversaryDefeated(instance)) throw appError("ADVERSARY_DEFEATED");
}

/**
 * Hands the spotlight to one of the campaign's active PCs. NOT_FOUND for a character of another campaign, INVALID for
 * one that is not active (dead, retired, away). Returns whether it moved.
 */
export async function giveTo(ctx: MutationCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">): Promise<boolean> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaign._id) throw appError("NOT_FOUND");
  if (character.status !== "active") throw appError("INVALID", "Only an active character can take the spotlight.");
  return setHolder(ctx, campaign._id, { kind: "pc", characterId }, "handedBack", undefined);
}

/**
 * Hands the spotlight to the whole party with nobody chosen (plan combat-hud H9.S, user answer Q8 a: "The whole party
 * (players decide who acts)"): the campaign's row goes, which `combatSpotlight.state` reads as holder null, so every
 * player's controls unlock as with a PC holder. Returns whether it moved (false when nobody held it already).
 */
export async function giveToParty(ctx: MutationCtx, campaign: Doc<"campaigns">): Promise<boolean> {
  const row = await spotlightOf(ctx, campaign._id);
  if (row === null) return false;
  await ctx.db.delete("combatSpotlight", row._id);
  return true;
}

/** What the interrupt costs (CB p.155: "you can spend a Fear to interrupt the action and spotlight an adversary"). */
export const INTERRUPT_FEAR = 1;

/**
 * The adversary instance behind an adversary token when its encounter is running, else null (a token whose instance
 * is gone, of another campaign, or in a draft or ended encounter has no GM turn to count a spotlight in).
 */
async function runningInstance(ctx: MutationCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">) {
  if (token.ref.kind !== "adversary") return null;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  if (instance === null || instance.campaignId !== campaignId) return null;
  const encounter = await ctx.db.get("encounters", instance.encounterId);
  if (encounter === null || encounter.status !== "running") return null;
  return { instance, encounter };
}

/**
 * The GM spends 1 Fear to take the spotlight (plan combat-hud H9.S, user answer Q7 a; CB p.155 "When you spend a Fear,
 * you can: Interrupt the players to make a move", "you can spend a Fear to interrupt the action and spotlight an
 * adversary"). With `tokenId` the spotlight goes to that adversary (as `spotlightAdversary`), without it the GM takes it
 * generally (`gmTook`).
 *
 * - The Fear is checked before any write: NOT_ENOUGH_FEAR when the GM holds none. Spent through `spendFear` (a
 *   `history` row, kind fear, action spend) only when the spotlight moves: taking what the GM already holds costs nothing.
 * - Q7 (a), no double charge: the payment counts as the adversary's spotlight this GM turn. Its running encounter
 *   instance is marked spotlit for the current `gmTurn` (`applySpotlight`, the count `encounterTracking.spotlight` and
 *   the adversary actions read), unless it already is; the adversary's first action then finds it spotlit and asks no
 *   Fear (`spotlightFearFor`). No running encounter: only the Fear is spent.
 * - Logged as one undoable group (kind `adversary`): a GM row naming the adversary with `fearDelta` -1, and a public row
 *   that names no adversary ("The GM spent 1 Fear to interrupt"; players never learn an unseen adversary from it). The
 *   GM's undo (`actionLog.undo`) gives the Fear back; the spotlight stays where it is (moving it is the GM's next move)
 *   and so does the instance's spotlight count (`adversaryBefore` has no spotlight fields; bead dcm-iukg).
 *
 * Returns whether the spotlight moved and the Fear spent (0 or 1).
 */
export async function takeWithFear(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  actorId: Id<"users">,
  tokenId: string | undefined,
): Promise<{ moved: boolean; fearSpent: number }> {
  const token = tokenId === undefined ? null : await loadCombatToken(ctx, campaign._id, tokenId);
  if (token !== null && token.ref.kind !== "adversary") throw appError("INVALID", "Only an adversary's token can be spotlighted.");
  if (token !== null) await assertNotDefeated(ctx, campaign._id, token);
  if ((await campaignFearState(ctx, campaign._id)).fear < INTERRUPT_FEAR) throw appError("NOT_ENOUGH_FEAR");

  const moved =
    token === null
      ? await setHolder(ctx, campaign._id, { kind: "gm" }, "gmTook", undefined)
      : await setHolder(ctx, campaign._id, { kind: "gm" }, "adversary", undefined, token._id);
  if (!moved) return { moved: false, fearSpent: 0 };

  await spendFear(ctx, campaign._id, INTERRUPT_FEAR, "interrupt");
  const running = token === null ? null : await runningInstance(ctx, campaign._id, token);
  if (running !== null && spotlightsThisTurn(running.instance, running.encounter.gmTurn) === 0) {
    const { spotlights, spotlightTurn } = applySpotlight(running.instance, running.encounter.gmTurn);
    await ctx.db.patch("encounterAdversaries", running.instance._id, { spotlights, spotlightTurn, updatedAt: Date.now() });
  }

  const groupId = newGroupId();
  const who = running?.instance.label ?? (token === null ? null : "an adversary");
  const base = { campaignId: campaign._id, actorId, kind: "adversary" as const, groupId, undoable: true };
  await logAction(ctx, {
    ...base,
    visibility: "gm",
    summary: who === null ? `${INTERRUPT_FEAR} Fear: the GM interrupts` : `${INTERRUPT_FEAR} Fear: the GM interrupts and spotlights ${who}`,
    fearDelta: -INTERRUPT_FEAR,
  });
  await logAction(ctx, { ...base, visibility: "public", summary: `The GM spent ${INTERRUPT_FEAR} Fear to interrupt` });
  return { moved: true, fearSpent: INTERRUPT_FEAR };
}

/**
 * Refuses a player's non-reaction act while the GM holds the spotlight (answer 1c; user answer 2026-11-01: token
 * moves too). `character` is the PC acting; the GM (owner permission on the campaign, `permissionFor`) is never
 * refused, including while playing for a PC. Call it before any write, from a mutation whose ctx carries the caller.
 */
export async function assertMayAct(
  ctx: QueryCtx & { user: Doc<"users"> },
  campaign: Doc<"campaigns">,
  character: Pick<Doc<"characters">, "_id" | "campaignId">,
  kind: ActKind,
): Promise<void> {
  if (character.campaignId !== campaign._id) throw new Error("assertMayAct: the character is not in this campaign.");
  if (kind === "reaction") return;
  if (!(await gmHoldsSpotlight(ctx, campaign._id))) return;
  const permission = await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner");
  if (atLeast(permission, "owner")) return;
  throw appError("SPOTLIGHT_WITH_GM");
}
