import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the Lorekeeper's campaign settings (config L1). docs/tasks/TASK-CONFIG-L1.md.
 *
 * `lorekeeper.access` is a campaign query with `need: "view"`: every member reads it (its `canAsk` / `webAllowed`
 * are covered in tests/convex/lorekeeper-campaign-settings.test.ts).
 */
const area: Area = {
  area: "config-lorekeeper",
  entries: [{ fn: api.lorekeeper.access, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } }],
};

export default area;
