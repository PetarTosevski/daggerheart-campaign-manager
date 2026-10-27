import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";

import { actionLogTables } from "./tables/actionLog";
import { campaignTables } from "./tables/campaigns";
import { characterTables } from "./tables/characters";
import { codexTables } from "./tables/codex";
import { combatAreaTables } from "./tables/combatAreas";
import { combatMapTables } from "./tables/combatMaps";
import { combatRequestTables } from "./tables/combatRequests";
import { e2eTables } from "./tables/e2e";
import { encounterTables } from "./tables/encounters";
import { countdownTables } from "./tables/countdowns";
import { fileTables } from "./tables/files";
import { historyTables } from "./tables/history";
import { lorekeeperTables } from "./tables/lorekeeper";
import { mapTables } from "./tables/maps";
import { notesTables } from "./tables/notes";
import { operationTables } from "./tables/operations";
import { restTables } from "./tables/rests";
import { sessionTables } from "./tables/sessions";
import { spritePackTables } from "./tables/spritePacks";
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
  ...encounterTables,
  ...combatMapTables,
  ...combatRequestTables,
  ...combatAreaTables,
  ...sessionTables,
  ...spritePackTables,
  ...notesTables,
  ...lorekeeperTables,
  ...e2eTables,
});
