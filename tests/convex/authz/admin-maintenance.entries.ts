import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: Maintenance (plan config AD10, docs/tasks/TASK-CONFIG-AD10.md). `appStatus.get` is the read-only
 * banner, read by everyone (null while the mode is off, which it is in the matrix world). The `adminMaintenance`
 * functions are the app owner's only: every other role, the campaign's GM included, is refused.
 */
const area: Area = {
  area: "admin-maintenance",
  entries: [
    { fn: api.appStatus.get, access: "maybe", expect: { appOwner: "ok" } },
    { fn: api.adminMaintenance.setReadOnly, access: "appOwner", args: () => ({ on: false }) },
    { fn: api.adminMaintenance.keys, access: "appOwner" },
    { fn: api.adminMaintenance.backups, access: "appOwner" },
  ],
};
export default area;
