import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: App admin · Overview (plan config AD2, docs/tasks/TASK-CONFIG-AD2.md). Every function is an
 * `appOwnerQuery`: only the app owner gets `ok`; signed out is UNAUTHENTICATED and every other role, the campaign's GM
 * and co-GM included, is FORBIDDEN (the class pins those rows).
 */
const area: Area = {
  area: "admin-overview",
  entries: [
    { fn: api.adminOverview.stats, access: "appOwner", args: () => ({ month: "2026-11" }) },
    { fn: api.adminOverview.alerts, access: "appOwner", args: () => ({ day: "2026-11-04", month: "2026-11" }) },
    { fn: api.adminOverview.campaigns, access: "appOwner" },
    { fn: api.adminOverview.audit, access: "appOwner" },
  ],
};
export default area;
