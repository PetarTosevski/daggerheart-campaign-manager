import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: archive a campaign (plan `.omc/plans/config.yaml`, tracer S3; docs/tasks/TASK-CONFIG-S3.md). Archiving
 * and restoring are the creator's alone (Q7 a): a co-GM, who passes every GM wrapper, is FORBIDDEN. Both are idempotent,
 * so each row runs on a fresh world either way. Behaviour is in tests/convex/campaign-archive.test.ts.
 */
const area: Area = {
  area: "config-archive",
  entries: [
    { fn: api.campaignSettings.archive, access: "creator", args: () => ({}) },
    { fn: api.campaignSettings.unarchive, access: "creator", args: () => ({}) },
  ],
};

export default area;
