import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: Export everything as JSON (plan config AD11, docs/tasks/TASK-CONFIG-AD11.md). Both functions are the
 * app owner's only: every other role, the campaign's GM included, is refused. The download itself is an HTTP action
 * (`GET /admin/export`, no matrix entry); tests/convex/admin-export.test.ts covers its owner check.
 */
const area: Area = {
  area: "admin-export",
  entries: [
    { fn: api.adminExport.start, access: "appOwner" },
    { fn: api.adminExport.status, access: "appOwner" },
  ],
};
export default area;
