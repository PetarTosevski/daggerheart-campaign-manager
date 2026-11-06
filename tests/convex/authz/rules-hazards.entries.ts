import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: falling and collision damage (optional rule, CB p.168; plan rule-switches OFA,
 * docs/tasks/TASK-RULES-OFA.md). `combatHazards.fall` is a keyed GM mutation: player, other player and grantee
 * FORBIDDEN; GM and co-GM ok. The setup turns the optional rule on (off, the handler refuses with MECHANIC_DISABLED) and
 * puts characterA's token on a live map. What it does: tests/convex/rules-falling.test.ts.
 */
const area: Area = {
  area: "rules-hazards",
  setup: async (w) => {
    const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
    const tokenId = await w.t.run(async (ctx) => {
      await ctx.db.patch("campaigns", w.campaignId as Id<"campaigns">, { ruleModes: { fallingDamage: true } });
      await ctx.db.patch("combatMaps", mapId, { live: true });
      return ctx.db.insert("combatTokens", { campaignId: w.campaignId as Id<"campaigns">, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA as Id<"characters"> }, side: "pc", x: 5, y: 10 });
    });
    w.use("combatTokens", tokenId);
  },
  entries: [
    {
      fn: api.combatHazards.fall,
      access: "gm",
      args: () => ({ kind: "close" }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
  ],
};

export default area;
