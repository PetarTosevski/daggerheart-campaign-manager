import { v } from "convex/values";

import { encounterRunning, openRequests } from "./lib/combatRequests";
import { gmQuery } from "./lib/functions";
import { groupUndone, isHitRow, keywordAskView, partyMembers, type KeywordAskView } from "./lib/incomingHits";
import { damageKeywordValidator } from "./lib/validators/combatRequests";

/**
 * The GM queue's read of the keyword asks on incoming hits (plan lanes-2, tracer E2.4, dcm-sk4r; moved out of
 * `hitKeywords.ts` by dcm-uh6r so the queue's subscription does not load the hit resolver `hitKeywords.answer` needs).
 * Same wrapper, arguments and returns as before.
 */

const damageTypeValidator = v.union(v.literal("physical"), v.literal("magic"), v.literal("both"));

/**
 * The open keyword asks of the campaign's running encounters (GM only): "Bandit 2 → Ember: Was this hit fire?
 * (Fireproof)". Hits whose action the GM undid or whose encounter ended are left out. Bounded by the open-request scan.
 */
export const asks = gmQuery({
  args: {},
  returns: v.array(
    v.object({
      requestId: v.id("combatRequests"),
      attackerLabel: v.string(),
      feature: v.optional(v.string()),
      targetCharacterId: v.id("characters"),
      targetName: v.string(),
      keyword: damageKeywordValidator,
      guard: v.string(),
      question: v.string(),
      damage: v.number(),
      damageType: damageTypeValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const out: KeywordAskView[] = [];
    let names: Map<string, string> | null = null;
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      if (!isHitRow(row) || row.payload.keywordAsk === undefined) continue;
      if (!(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) continue;
      names ??= new Map((await partyMembers(ctx, ctx.campaign._id)).map((m) => [m.character._id as string, m.sheet.name]));
      const view = keywordAskView(row, names.get(row.payload.keywordAsk.characterId) ?? "Unknown");
      if (view) out.push(view);
    }
    return out;
  },
});
