import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area } from "./harness";

/**
 * Authz matrix: the optional rule "Conflict between PCs" (CB p.168; plan rule-switches OP, docs/tasks/TASK-RULES-OP.md).
 * `combatActions.contest` is the GM's Contest between two PCs, a keyed GM mutation: player, other player and grantee
 * FORBIDDEN; GM and co-GM ok. The setup turns the rule on (off, it refuses with MECHANIC_DISABLED). The attack on a PC
 * goes through `combatActions.attack` (its entry is the combat area's). What they do: tests/convex/rules-pc-conflict.test.ts.
 */
const area: Area = {
  area: "rules-pc-conflict",
  setup: async (w) => {
    await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId as Id<"campaigns">, { ruleModes: { pcConflict: true } }));
  },
  entries: [
    {
      fn: api.combatActions.contest,
      access: "gm",
      args: (w) => ({
        instigator: { characterId: w.characterA, trait: "presence", modifier: 0 },
        target: { characterId: w.characterB, trait: "instinct", modifier: 0 },
      }),
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
    },
  ],
};

export default area;
