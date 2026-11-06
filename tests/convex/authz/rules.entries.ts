import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: House rules' rule switches (plan rule-switches RS0). docs/tasks/TASK-RULES-RS0.md.
 *
 * `ruleSettings.get` is every member's (players read the list, Q18 a); `ruleSettings.set` is the GM's and co-GMs'
 * (a `gmMutation`): a campaign edit grant does not reach it.
 */
const area: Area = {
  area: "rules",
  entries: [
    { fn: api.ruleSettings.get, access: "view" },
    {
      fn: api.ruleSettings.set,
      access: "gm",
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
      // A value off the default, so the GM row writes.
      args: () => ({ change: { key: "massiveDamage", value: true } }),
    },
  ],
};

export default area;
