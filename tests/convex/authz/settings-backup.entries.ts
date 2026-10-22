import { api } from "../../../convex/_generated/api";
import { settingsBackupText } from "../../../src/lib/validation/settings-backup";
import type { Area } from "./harness";

/**
 * Authz matrix: settings backup, restore and reset (TitleMenu "Saved data"). Tracer H17
 * (.omc/plans/d12-hardening.yaml), docs/tasks/TASK-D12-H17.md. Both act on the caller's own settings row (class user):
 * signed out is UNAUTHENTICATED, every signed-in role may call them for itself.
 */
const area: Area = {
  area: "settings-backup",
  entries: [
    {
      fn: api.settings.restore,
      access: "user",
      args: () => ({
        text: settingsBackupText({ tableName: "Restored", gmName: "Ana", accent: "#8f78d8", expansions: {} }),
      }),
    },
    { fn: api.settings.reset, access: "user" },
  ],
};
export default area;
