import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { findCharacter, readSheet } from "./lib/characterSheet";
import { atLeast } from "./lib/permissions";
import { encounterRunning, openRequests } from "./lib/combatRequests";
import { campaignQuery, gmQuery } from "./lib/functions";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import { cardEffect } from "../src/lib/srd/card-effects/index";
import { costText } from "./lib/badges";
import { rangeBandValidator } from "./lib/validators/combatRequests";
import { rollValidator } from "./lib/validators/actionLog";
import { withdrawalUseName, withdrawable } from "./lib/withdrawals";

/**
 * The Combat HUD's request reads (plan combat-actions; table AA0, CA3; moved out of `combatRequests.ts` by dcm-uh6r so
 * the HUD's subscriptions do not load the attack resolver `combatRequests.sanction` needs). Same wrappers, arguments and
 * returns as before.
 * - `mine`: the open requests waiting on the caller: a player's own sanctions, Minion offers and held attacks (SD5,
 *   Q1: an attack waiting for an after-roll feature's Use / Pass); for the GM every open one of the campaign (the GM's
 *   queue, with Resolve now). Requests whose encounter is no longer running are left out.
 * - `difficulties` (plan lanes B2): the rolls waiting for the GM's Difficulty (a player's Charge, a Cloaked rogue seen
 *   dimly by enemies without one); the GM answers them with `featurePrompts.answerDifficulty`.
 * - `forcedAttacks` (plan lanes-2 wave 10, E1.4b; dcm-uxsd): the forced PC attacks waiting on the caller's characters
 *   (Beguiled, HF p.75); the player answers one with `combatActions.attack` and its `forcedRequestId`.
 * - `withdrawn` (dcm-bxp.99.32.40): the GM's latest withdrawn requests, for the "Vex withdrew Bolt Beacon" toast.
 */

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

/** A withdrawn request as the GM's toast shows it ("Vex withdrew Bolt Beacon"): names only. */
const withdrawnView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  /** The use's printed name, "a Charge" or "an attack" (as the feed line says it). */
  useName: v.string(),
  /** When it was withdrawn (`resolvedAt`). The client toasts only rows newer than when it started listening (CF10). */
  withdrawnAt: v.number(),
});

/** The most withdrawn requests `withdrawn` returns. */
const WITHDRAWN_TAKE = 5;

/**
 * dcm-bxp.99.32.40 (user 2026-11-02): the campaign's latest withdrawn requests (`combatRequests` status `withdrawn`,
 * dcm-bxp.99.32.17), newest first, for the GM's short toast besides the feed line. GM only. Rows are swept a day after
 * they close (`expireCombatRequests`); the HUD remembers which it already toasted.
 */
export const withdrawn = gmQuery({
  args: {},
  returns: v.array(withdrawnView),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("combatRequests")
      .withIndex("by_campaign_status", (q) => q.eq("campaignId", ctx.campaign._id).eq("status", "withdrawn"))
      .order("desc")
      .take(WITHDRAWN_TAKE);
    const views = [];
    for (const row of rows) {
      const use = withdrawable(row.payload);
      if (use === null) continue;
      const character = await ctx.db.get("characters", use.characterId);
      let sheet: ReturnType<typeof readSheet> | null = null;
      if (character !== null && character.campaignId === ctx.campaign._id) {
        try {
          sheet = readSheet(character.sheet);
        } catch {
          sheet = null;
        }
      }
      views.push({ requestId: row._id, characterId: use.characterId, characterName: sheet?.name ?? "A character", useName: withdrawalUseName(use.action, sheet, ctx.campaign), withdrawnAt: row.resolvedAt ?? row.createdAt });
    }
    return views.sort((a, b) => b.withdrawnAt - a.withdrawnAt);
  },
});
