import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area } from "./harness";

/**
 * Authz matrix: the Spotlight Tracker's refill (plan rule-switches RT, docs/tasks/TASK-RULES-RT.md) and the GM's spend
 * (RFB, docs/tasks/TASK-RULES-RFB.md). `combatSpotlight.refillTokens` and `combatSpotlight.spendToken` are keyed GM
 * mutations: player, other player and grantee FORBIDDEN; GM and co-GM ok.
 * The setup turns the optional rule on (off, the handler refuses with MECHANIC_DISABLED). What it does:
 * tests/convex/rules-action-tokens.test.ts.
 */
const area: Area = {
  area: "rules-tokens",
  setup: (w) => w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId as Id<"campaigns">, { ruleModes: { spotlightTracker: true } })),
  entries: [
    { fn: api.combatSpotlight.refillTokens, access: "gm", expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" } },
    // Plan rule-switches RFB: the GM spends a PC's token for a significant action without a roll (same access).
    {
      fn: api.combatSpotlight.spendToken,
      access: "gm",
      args: (w) => ({ characterId: w.characterA }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
  ],
};

export default area;
