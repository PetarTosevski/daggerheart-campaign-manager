import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the owner's Lorekeeper budget (plan config AD6, docs/tasks/TASK-CONFIG-AD6.md). Both functions are
 * `appOwner`: every role but the app owner is refused (UNAUTHENTICATED signed out, FORBIDDEN otherwise, the
 * campaign's GM included), and the class keeps those rows pinned.
 */
const area: Area = {
  area: "admin-lorekeeper",
  entries: [
    { fn: api.adminLorekeeper.setLimit, access: "appOwner", args: () => ({ change: { field: "atLimit", value: "gmOnly" } }) },
    { fn: api.adminLorekeeper.useByCampaign, access: "appOwner", args: () => ({ month: "2026-10" }) },
  ],
};
export default area;
