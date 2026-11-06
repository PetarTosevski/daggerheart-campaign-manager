import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: feature switches (plan config AD9, docs/tasks/TASK-CONFIG-AD9.md). `features.mine` answers for every
 * caller, signed out included (the Everyone features), and only about the caller. `features.list` and
 * `features.setMode` are owner-only: every other role, the campaign's GM included, is refused.
 */
const area: Area = {
  area: "admin-features",
  entries: [
    { fn: api.features.mine, access: "maybe", expect: { anon: "ok", appOwner: "ok" }, note: "signed out: the Everyone features" },
    { fn: api.features.list, access: "appOwner" },
    { fn: api.features.setMode, access: "appOwner", args: () => ({ key: "dice3d", mode: "testers" }) },
  ],
};
export default area;
