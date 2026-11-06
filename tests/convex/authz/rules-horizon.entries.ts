import { api } from "../../../convex/_generated/api";
import { regionKey } from "../../../src/lib/world/hex-crawl";
import { key } from "../helpers";
import type { Area, World } from "./harness";

/**
 * Authz matrix: Horizon encounter bonuses (plan rule-switches OH, HF p.171). docs/tasks/TASK-RULES-OH.md.
 *
 * `horizonEncounters.activate` is the GM's and co-GMs' (a `keyedGmMutation`): a campaign edit grant does not reach it.
 * The setup turns the switch on and gives the region an unused entry 4, so the GM's row applies the bonus.
 */
async function setbackRegion(w: World) {
  await w.as("gm").mutation(api.ruleSettings.set, { campaignId: w.campaignId, change: { key: "horizonEncounterBonuses", value: true } });
  const { id } = await w.as("gm").mutation(api.trackers.horizon.generateRegion, { campaignId: w.campaignId, idempotencyKey: key() });
  const campaignId = w.campaignId;
  await w.t.run(async (ctx) => {
    const row = (await ctx.db
      .query("frameTrackers")
      .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", regionKey(id)))
      .unique())!;
    await ctx.db.patch("frameTrackers", row._id, { data: { ...(row.data as object), encounters: [{ dice: [2, 2], total: 4, used: false }] } });
  });
  w.set("regionId", String(id));
}

const area: Area = {
  area: "rules-horizon",
  world: { frameId: "journey-to-horizon" },
  entries: [
    {
      fn: api.horizonEncounters.activate,
      access: "gm",
      setup: setbackRegion,
      args: (w) => ({ regionId: Number(w.ids.regionId), index: 0 }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
  ],
};

export default area;
