import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the Lorekeeper's cost caps as the composer reads them. Tracer L5 (.omc/plans/d13-lorekeeper.yaml),
 * docs/tasks/TASK-D13-L5.md. `lorekeeperUsage.mine` is a campaign view query: every member reads their own
 * allowance (otherPlayer too, for themselves); an outsider gets NOT_FOUND, signed out UNAUTHENTICATED.
 */
const area: Area = {
  area: "lorekeeper-usage",
  entries: [
    {
      fn: api.lorekeeperUsage.mine,
      access: "view",
      args: () => ({ day: "2026-10-21", month: "2026-10" }),
      expect: { otherPlayer: "ok", grantee: "ok" },
    },
  ],
};
export default area;
