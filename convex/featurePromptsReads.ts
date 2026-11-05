import { v, type Infer } from "convex/values";

import { pickUse } from "../src/lib/domain/card-effects/run";
import { rangeCheck } from "../src/lib/domain/combat-actions/distance";
import { asCardEffect } from "../src/lib/domain/feature-effects/run";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { Creatures, extraSpecs } from "./lib/cardRunner";
import { readSheet } from "./lib/characterSheet";
import { attackScene } from "./lib/combatActions";
import { characterName, editableHere, featureName, liveAllyRolls, rollerUse, tokenName, type AllyRollRow } from "./lib/featurePrompts";
import { campaignQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";

/**
 * The drawer's and the GM queue's read of the uses an ally rolls (plan drawer-answers, DA13; CB p.33 Cannonball; moved
 * out of `featurePrompts.ts` by dcm-uh6r so these subscriptions do not load the Charge and ally-roll mutations' runners).
 * Same wrapper, arguments and returns as before. The ally answers with `featurePrompts.allyRoll`, the GM cancels with
 * `featurePrompts.cancelAllyRoll`.
 */

const enemyChoice = v.object({
  tokenId: v.id("combatTokens"),
  name: v.string(),
  /** Within the throw's range of the ally (Close for Cannonball). */
  inRange: v.boolean(),
  /** The other enemies the second target may be (Very Close of this one, for Cannonball's Hope). */
  near: v.array(v.id("combatTokens")),
});

const askView = v.object({
  requestId: v.id("combatRequests"),
  /** Who is thrown (the druid) and the feature. */
  characterName: v.string(),
  featureName: v.string(),
  /** The druid's Hope now: the second target spends one of it. */
  hope: v.number(),
  /** The optional step that adds the second target, or null. */
  secondLabel: v.union(v.null(), v.string()),
  enemies: v.array(enemyChoice),
});

const allyRollsView = v.object({
  /** Rolls this character is asked to make (their drawer's prompt). */
  asks: v.array(askView),
  /** This character's own throws waiting for an ally. */
  waiting: v.array(v.object({ requestId: v.id("combatRequests"), rollerName: v.string(), featureName: v.string() })),
  /** The PCs on the map this character can ask (for the druid's throw); empty without a map or a token. */
  allies: v.array(v.object({ tokenId: v.id("combatTokens"), name: v.string() })),
  /** GM: every open ally roll of the campaign (the pending list, with Cancel). Empty for a player. */
  pending: v.array(v.object({ requestId: v.id("combatRequests"), characterName: v.string(), rollerName: v.string(), featureName: v.string(), createdAt: v.number() })),
});

/** The enemies the roller sees on the map, with the throw's range and which may be the second target (U1: names only). */
async function enemyChoices(ctx: QueryCtx, campaign: Doc<"campaigns">, roller: Doc<"characters">, row: AllyRollRow): Promise<Infer<typeof enemyChoice>[]> {
  if (row.mapId === undefined) return [];
  const use = pickUse(asCardEffect(featureEffect(row.payload.featureId)!), row.payload.useId);
  if (use?.rolledBy === undefined) return [];
  let scene;
  try {
    scene = await attackScene(ctx, campaign, roller, row.mapId);
  } catch {
    return [];
  }
  const enemies = await new Creatures(ctx, campaign._id, scene, readSheet(roller.sheet)).visibleEnemies();
  const second = extraSpecs(rollerUse(use)).picked;
  const nearRange = second?.areaRange ?? second?.range ?? "veryClose";
  return enemies.map((e) => ({
    tokenId: e.tokenId,
    name: e.instance.label,
    inRange: rangeCheck(scene.attacker, e.token, use.rolledBy!.targets.range === "weapon" ? "melee" : use.rolledBy!.targets.range).inRange,
    near: enemies.filter((o) => o.tokenId !== e.tokenId && rangeCheck(e.token, o.token, nearRange === "weapon" ? "melee" : nearRange).inRange).map((o) => o.tokenId),
  }));
}

/**
 * DA13: the ally rolls of a character the caller edits (their own; the GM any): the rolls they are asked to make, their
 * own throws waiting for an ally, the PCs on `mapId` they can ask, and for the GM every open one. Names and bands only
 * (U1): no adversary numbers.
 */
export const allyRolls = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), mapId: v.optional(v.id("combatMaps")) },
  returns: allyRollsView,
  handler: async (ctx, args) => {
    const { campaign, character } = await editableHere(ctx, args.characterId);
    const rows = await liveAllyRolls(ctx, campaign._id);
    const asks = [];
    const waiting = [];
    for (const row of rows) {
      const p = row.payload;
      if (p.rollerCharacterId === character._id) {
        const druid = await ctx.db.get("characters", p.characterId);
        if (druid === null || druid.campaignId !== campaign._id) continue;
        const use = pickUse(asCardEffect(featureEffect(p.featureId)!), p.useId);
        const second = use?.steps.find((s) => s.kind === "optional");
        const druidSheet = readSheet(druid.sheet);
        asks.push({
          requestId: row._id,
          characterName: druidSheet.name,
          featureName: featureName(p.featureId),
          hope: druidSheet.hope,
          secondLabel: second?.kind === "optional" ? second.label : null,
          enemies: await enemyChoices(ctx, campaign, character, row),
        });
      }
      if (p.characterId === character._id) waiting.push({ requestId: row._id, rollerName: await characterName(ctx, campaign._id, p.rollerCharacterId), featureName: featureName(p.featureId) });
    }
    const allies = [];
    if (args.mapId !== undefined) {
      try {
        const scene = await attackScene(ctx, campaign, character, args.mapId);
        for (const t of scene.scene.tokens) {
          if (t._id === scene.attacker._id || t.side !== "pc" || t.ref.kind !== "pc") continue;
          allies.push({ tokenId: t._id, name: await tokenName(ctx, campaign._id, t) });
        }
      } catch {
        // no live map or no token of this character: nobody to ask
      }
    }
    const pending = [];
    if (atLeast(ctx.permission, "owner")) {
      for (const row of rows) {
        pending.push({
          requestId: row._id,
          characterName: await characterName(ctx, campaign._id, row.payload.characterId),
          rollerName: await characterName(ctx, campaign._id, row.payload.rollerCharacterId),
          featureName: featureName(row.payload.featureId),
          createdAt: row.createdAt,
        });
      }
    }
    return { asks, waiting, allies, pending };
  },
});
