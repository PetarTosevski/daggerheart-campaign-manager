import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: the scene's environment and the Underwater optional rule (CB p.168; plan rule-switches OE,
 * docs/tasks/TASK-RULES-OE.md). `combatScenes.environment` is every member's (the HUD title's chips); `setUnderwater`,
 * `setFightsUnderwater` and `setBreathesUnderwater` (OE2) are keyed GM mutations: player, other player and grantee
 * FORBIDDEN; GM and co-GM ok. The setup turns the optional rule on (off, they refuse with MECHANIC_DISABLED) and puts
 * characterA's token on a live map.
 * What they do: tests/convex/rules-environment.test.ts.
 */
const area: Area = {
  area: "rules-underwater",
  setup: async (w) => {
    const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
    const tokenId = await w.t.run(async (ctx) => {
      await ctx.db.patch("campaigns", w.campaignId as Id<"campaigns">, { ruleModes: { underwater: true } });
      await ctx.db.patch("combatMaps", mapId, { live: true });
      return ctx.db.insert("combatTokens", { campaignId: w.campaignId as Id<"campaigns">, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA as Id<"characters"> }, side: "pc", x: 5, y: 10 });
    });
    w.use("combatMaps", mapId);
    w.use("combatTokens", tokenId);
  },
  entries: [
    { fn: api.combatScenes.environment, access: "view" },
    {
      fn: api.combatScenes.setUnderwater,
      access: "gm",
      args: () => ({ underwater: true, breath: 3 }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
    {
      fn: api.combatScenes.setFightsUnderwater,
      access: "gm",
      args: () => ({ fightsUnderwater: true }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
    // Plan OE2: a PC's token "breathes underwater" (the setup's token is characterA's PC).
    {
      fn: api.combatScenes.setBreathesUnderwater,
      access: "gm",
      args: () => ({ breathesUnderwater: true }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
  ],
};

export default area;
