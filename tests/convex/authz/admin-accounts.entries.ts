import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: App admin accounts (plan config AD3, docs/tasks/TASK-CONFIG-AD3.md). Every function is `appOwner`:
 * signed out UNAUTHENTICATED, every other role (the campaign's GM and co-GM included) FORBIDDEN, only the app owner ok.
 * The class pins every non-owner row, so none can be loosened here.
 */
const area: Area = {
  area: "admin-accounts",
  entries: [
    { fn: api.adminAccounts.setSignUpMode, access: "appOwner", args: () => ({ mode: "invite" }) },
    { fn: api.adminAccounts.setCap, access: "appOwner", args: () => ({ cap: "playersPerCampaign", value: 6 }) },
    { fn: api.adminAccounts.accounts, access: "appOwner", args: () => ({ paginationOpts: { cursor: null, numItems: 10 } }) },
    { fn: api.adminAccounts.addTester, access: "appOwner", args: (w) => ({ userId: w.users.player }) },
    { fn: api.adminAccounts.removeTester, access: "appOwner", args: (w) => ({ userId: w.users.player }) },
  ],
};
export default area;
