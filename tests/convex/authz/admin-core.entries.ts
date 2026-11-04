import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the App admin foundation (plan config AD0, docs/tasks/TASK-CONFIG-AD0.md). `appAdmin.me` answers only
 * for the caller (null signed out, `{ isOwner }` otherwise; the owner's row is `ok` too). `appAdmin.settings` is the
 * first `appOwner` function: every role but the app owner is refused (UNAUTHENTICATED / FORBIDDEN, the campaign's GM
 * included), and the class keeps those rows pinned.
 */
const area: Area = {
  area: "admin-core",
  entries: [
    { fn: api.appAdmin.me, access: "maybe", expect: { appOwner: "ok" } },
    { fn: api.appAdmin.settings, access: "appOwner" },
  ],
};
export default area;
