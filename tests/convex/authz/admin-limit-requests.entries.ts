import { api } from "../../../convex/_generated/api";
import type { Area, World } from "./harness";

/**
 * Authz matrix: Lorekeeper limit requests (plan config AD12, docs/tasks/TASK-CONFIG-AD12.md). The GM side (`request`,
 * `cancel`, `forCampaign`) is `gm` (the GM and co-GMs; players FORBIDDEN, outsiders NOT_FOUND); the owner side (`list`,
 * `decide`, `setCampaignLimits`) is `appOwner` (everyone else FORBIDDEN, the campaign's GM included).
 */

/** The owner takes requests (AD6's `allowGmRequests`; off by default, when `request` answers LIMIT_REQUESTS_OFF). */
async function openRequests(w: World): Promise<void> {
  await w.as("appOwner").mutation(api.adminLorekeeper.setLimit, { change: { field: "allowGmRequests", value: true } });
}

/** One pending request of the world's campaign, asked by its GM. */
async function pendingRequest(w: World): Promise<void> {
  const id = await w.t.run((ctx) =>
    ctx.db.insert("lorekeeperLimitRequests", {
      campaignId: w.campaignId,
      requestedBy: w.users.gm,
      wants: { dailyQuestions: 60 },
      reason: "A long session",
      status: "pending",
      createdAt: 1,
    }),
  );
  w.use("lorekeeperLimitRequests", id);
}

const area: Area = {
  area: "admin-limit-requests",
  entries: [
    {
      fn: api.lorekeeperLimitRequests.request,
      access: "gm",
      setup: openRequests,
      args: () => ({ wants: { dailyQuestions: 60 }, reason: "A long session" }),
    },
    { fn: api.lorekeeperLimitRequests.cancel, access: "gm", setup: pendingRequest },
    { fn: api.lorekeeperLimitRequests.forCampaign, access: "gm", setup: pendingRequest },
    {
      fn: api.lorekeeperLimitRequests.list,
      access: "appOwner",
      setup: pendingRequest,
      args: () => ({ status: "pending", paginationOpts: { numItems: 10, cursor: null } }),
    },
    {
      fn: api.lorekeeperLimitRequests.decide,
      access: "appOwner",
      setup: pendingRequest,
      args: () => ({ approve: true, numbers: { dailyQuestions: 50 } }),
    },
    {
      fn: api.lorekeeperLimitRequests.setCampaignLimits,
      access: "appOwner",
      args: (w) => ({ campaignId: w.campaignId, change: { field: "dailyQuestions", value: 50 } }),
    },
  ],
};
export default area;
