import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: campaign table settings (config S2). docs/tasks/TASK-CONFIG-S2.md.
 *
 * `campaignSettings.set` is the GM's (a `gmMutation`): a campaign edit grant does not reach it. Config G1 adds the
 * co-GM row to every `gm` entry.
 */
const area: Area = {
  area: "config-settings",
  entries: [
    {
      fn: api.campaignSettings.set,
      access: "gm",
      expect: { grantee: "FORBIDDEN", otherPlayer: "FORBIDDEN" },
      // A value off the default, so the GM row writes.
      args: () => ({ change: { key: "playersSeeFear", value: false } }),
    },
  ],
};

export default area;
