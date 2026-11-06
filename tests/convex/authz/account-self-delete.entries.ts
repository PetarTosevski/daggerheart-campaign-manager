import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: self-service account deletion (plan account-deletion DEL1, docs/tasks/TASK-DEL1.md). A `user` mutation:
 * signed out UNAUTHENTICATED, every signed-in account may delete itself (each row runs on a fresh world). The app owner
 * (its row is the outsider's, as for every write) reaches the handler and is refused there with
 * OWNER_ACCOUNT_UNDELETABLE, a domain code, so it still counts as access granted.
 */
const area: Area = {
  area: "account-self-delete",
  entries: [{ fn: api.accountSelfDelete.deleteMyAccount, access: "user", okCodes: ["OWNER_ACCOUNT_UNDELETABLE"] }],
};
export default area;
