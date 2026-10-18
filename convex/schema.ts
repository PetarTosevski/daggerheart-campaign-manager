import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";

import { actionLogTables } from "./tables/actionLog";
import { campaignTables } from "./tables/campaigns";
import { characterTables } from "./tables/characters";
import { codexTables } from "./tables/codex";
import { countdownTables } from "./tables/countdowns";
import { fileTables } from "./tables/files";
import { historyTables } from "./tables/history";
import { mapTables } from "./tables/maps";
import { operationTables } from "./tables/operations";
import { restTables } from "./tables/rests";
import { trackerTables } from "./tables/trackers";

export { customFrameValidator, frameIdValidator } from "./tables/campaigns";

/** Each domain's tables live in `convex/tables/<domain>.ts`; this file only combines them. */
export default defineSchema({
  ...authTables,
  ...campaignTables,
  ...countdownTables,
  ...trackerTables,
  ...characterTables,
  ...mapTables,
  ...codexTables,
  ...fileTables,
  ...operationTables,
  ...historyTables,
  ...actionLogTables,
  ...restTables,
});
