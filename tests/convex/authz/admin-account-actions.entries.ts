import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";
import { WORLD_EMAILS } from "./world";

/**
 * Authz matrix: suspend and delete accounts (plan config AD14, docs/tasks/TASK-CONFIG-AD14.md). Every function is
 * `appOwner`: signed out UNAUTHENTICATED, every other role (the campaign's GM and co-GM included) FORBIDDEN, only the
 * app owner ok. The owner's rows act on the world's player, with its email typed to confirm.
 */
const confirmed = (userId: string) => ({ userId, reason: "Matrix check", confirmEmail: WORLD_EMAILS.player });

const area: Area = {
  area: "admin-account-actions",
  entries: [
    { fn: api.adminAccountActions.suspend, access: "appOwner", args: (w) => confirmed(w.users.player) },
    { fn: api.adminAccountActions.unsuspend, access: "appOwner", args: (w) => ({ userId: w.users.player }) },
    { fn: api.adminAccountActions.scheduleDelete, access: "appOwner", args: (w) => confirmed(w.users.player) },
    { fn: api.adminAccountActions.cancelDelete, access: "appOwner", args: (w) => ({ userId: w.users.player }) },
    { fn: api.adminAccountActions.statuses, access: "appOwner" },
  ],
};
export default area;
