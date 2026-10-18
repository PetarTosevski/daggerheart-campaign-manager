/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as actionLog from "../actionLog.js";
import type * as auth from "../auth.js";
import type * as campaignTime from "../campaignTime.js";
import type * as campaigns from "../campaigns.js";
import type * as characterExtras from "../characterExtras.js";
import type * as characters from "../characters.js";
import type * as cleanup from "../cleanup.js";
import type * as codex from "../codex.js";
import type * as countdowns from "../countdowns.js";
import type * as crons from "../crons.js";
import type * as deathMoves from "../deathMoves.js";
import type * as fear from "../fear.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as lib_actionLog from "../lib/actionLog.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_blobs from "../lib/blobs.js";
import type * as lib_characterSheet from "../lib/characterSheet.js";
import type * as lib_codex from "../lib/codex.js";
import type * as lib_dice from "../lib/dice.js";
import type * as lib_fear from "../lib/fear.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_maps from "../lib/maps.js";
import type * as lib_mechanics from "../lib/mechanics.js";
import type * as lib_migrations from "../lib/migrations.js";
import type * as lib_operations from "../lib/operations.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_trackers from "../lib/trackers.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_validators_actionLog from "../lib/validators/actionLog.js";
import type * as lib_validators_campaigns from "../lib/validators/campaigns.js";
import type * as lib_validators_characterExtras from "../lib/validators/characterExtras.js";
import type * as lib_validators_characters from "../lib/validators/characters.js";
import type * as lib_validators_codex from "../lib/validators/codex.js";
import type * as lib_validators_maps from "../lib/validators/maps.js";
import type * as lib_validators_rests from "../lib/validators/rests.js";
import type * as maps from "../maps.js";
import type * as members from "../members.js";
import type * as migrations_characterExtras from "../migrations/characterExtras.js";
import type * as migrations_characters from "../migrations/characters.js";
import type * as migrations_codex from "../migrations/codex.js";
import type * as migrations_maps from "../migrations/maps.js";
import type * as migrations_run from "../migrations/run.js";
import type * as migrations_trackers from "../migrations/trackers.js";
import type * as migrations_uploads from "../migrations/uploads.js";
import type * as settings from "../settings.js";
import type * as tables_actionLog from "../tables/actionLog.js";
import type * as tables_campaigns from "../tables/campaigns.js";
import type * as tables_characters from "../tables/characters.js";
import type * as tables_codex from "../tables/codex.js";
import type * as tables_countdowns from "../tables/countdowns.js";
import type * as tables_files from "../tables/files.js";
import type * as tables_history from "../tables/history.js";
import type * as tables_maps from "../tables/maps.js";
import type * as tables_operations from "../tables/operations.js";
import type * as tables_rests from "../tables/rests.js";
import type * as tables_trackers from "../tables/trackers.js";
import type * as trackers_ageOfUmbra from "../trackers/ageOfUmbra.js";
import type * as trackers_andaluria from "../trackers/andaluria.js";
import type * as trackers_colossus from "../trackers/colossus.js";
import type * as trackers_fiveBanners from "../trackers/fiveBanners.js";
import type * as trackers_horizon from "../trackers/horizon.js";
import type * as trackers_weredragon from "../trackers/weredragon.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  actionLog: typeof actionLog;
  auth: typeof auth;
  campaignTime: typeof campaignTime;
  campaigns: typeof campaigns;
  characterExtras: typeof characterExtras;
  characters: typeof characters;
  cleanup: typeof cleanup;
  codex: typeof codex;
  countdowns: typeof countdowns;
  crons: typeof crons;
  deathMoves: typeof deathMoves;
  fear: typeof fear;
  history: typeof history;
  http: typeof http;
  "lib/actionLog": typeof lib_actionLog;
  "lib/allowlist": typeof lib_allowlist;
  "lib/auth": typeof lib_auth;
  "lib/blobs": typeof lib_blobs;
  "lib/characterSheet": typeof lib_characterSheet;
  "lib/codex": typeof lib_codex;
  "lib/dice": typeof lib_dice;
  "lib/fear": typeof lib_fear;
  "lib/files": typeof lib_files;
  "lib/functions": typeof lib_functions;
  "lib/maps": typeof lib_maps;
  "lib/mechanics": typeof lib_mechanics;
  "lib/migrations": typeof lib_migrations;
  "lib/operations": typeof lib_operations;
  "lib/permissions": typeof lib_permissions;
  "lib/trackers": typeof lib_trackers;
  "lib/users": typeof lib_users;
  "lib/validators/actionLog": typeof lib_validators_actionLog;
  "lib/validators/campaigns": typeof lib_validators_campaigns;
  "lib/validators/characterExtras": typeof lib_validators_characterExtras;
  "lib/validators/characters": typeof lib_validators_characters;
  "lib/validators/codex": typeof lib_validators_codex;
  "lib/validators/maps": typeof lib_validators_maps;
  "lib/validators/rests": typeof lib_validators_rests;
  maps: typeof maps;
  members: typeof members;
  "migrations/characterExtras": typeof migrations_characterExtras;
  "migrations/characters": typeof migrations_characters;
  "migrations/codex": typeof migrations_codex;
  "migrations/maps": typeof migrations_maps;
  "migrations/run": typeof migrations_run;
  "migrations/trackers": typeof migrations_trackers;
  "migrations/uploads": typeof migrations_uploads;
  settings: typeof settings;
  "tables/actionLog": typeof tables_actionLog;
  "tables/campaigns": typeof tables_campaigns;
  "tables/characters": typeof tables_characters;
  "tables/codex": typeof tables_codex;
  "tables/countdowns": typeof tables_countdowns;
  "tables/files": typeof tables_files;
  "tables/history": typeof tables_history;
  "tables/maps": typeof tables_maps;
  "tables/operations": typeof tables_operations;
  "tables/rests": typeof tables_rests;
  "tables/trackers": typeof tables_trackers;
  "trackers/ageOfUmbra": typeof trackers_ageOfUmbra;
  "trackers/andaluria": typeof trackers_andaluria;
  "trackers/colossus": typeof trackers_colossus;
  "trackers/fiveBanners": typeof trackers_fiveBanners;
  "trackers/horizon": typeof trackers_horizon;
  "trackers/weredragon": typeof trackers_weredragon;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
