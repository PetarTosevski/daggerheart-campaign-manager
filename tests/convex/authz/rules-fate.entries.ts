import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: Fate rolls (plan rule-switches OFT, CB p.168). docs/tasks/TASK-RULES-OFT.md.
 *
 * The area turns the optional rule on first, so the allowed rows roll. `fateRolls.status` is every member's (each sees
 * the PCs they may roll for); `fateRolls.roll` needs edit on the PC (its player or the GM), like `rolls.actionRoll`.
 */
const area: Area = {
  area: "rules-fate",
  setup: async (w) => {
    await w.as("gm").mutation(api.ruleSettings.set, { campaignId: w.campaignId, change: { key: "fateRolls", value: true } });
  },
  entries: [
    { fn: api.fateRolls.status, access: "view" },
    { fn: api.fateRolls.roll, access: "own", args: () => ({ die: "fear", note: "On a 4 or lower, the fire spreads" }) },
  ],
};

export default area;
