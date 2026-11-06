import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the account's preferences and hand folds (plan config P1, docs/tasks/TASK-CONFIG-P1.md). `get`, `set`
 * and `importLegacy` act on the caller's own row (class user); `folds` and `setFold` need view on the campaign and
 * touch only the caller's fold rows (class view).
 */
const area: Area = {
  area: "config-prefs",
  entries: [
    { fn: api.preferences.get, access: "user" },
    {
      fn: api.preferences.set,
      access: "user",
      args: () => ({ change: { key: "diceSound", value: true } }),
    },
    {
      fn: api.preferences.importLegacy,
      access: "user",
      args: (w) => ({
        dice3d: false,
        folds: [{ campaignId: w.campaignId, characterId: w.characterA }],
      }),
    },
    { fn: api.preferences.folds, access: "view" },
    {
      fn: api.preferences.setFold,
      access: "view",
      args: (w) => ({ characterId: w.characterA, folded: true }),
    },
  ],
};
export default area;
