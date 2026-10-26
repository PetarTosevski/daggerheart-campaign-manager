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
import type * as adversaryActions from "../adversaryActions.js";
import type * as auth from "../auth.js";
import type * as campaignTime from "../campaignTime.js";
import type * as campaigns from "../campaigns.js";
import type * as characterExtras from "../characterExtras.js";
import type * as characters from "../characters.js";
import type * as classFeatures from "../classFeatures.js";
import type * as cleanup from "../cleanup.js";
import type * as codex from "../codex.js";
import type * as combatActions from "../combatActions.js";
import type * as combatCards from "../combatCards.js";
import type * as combatFeatures from "../combatFeatures.js";
import type * as combatMapEdit from "../combatMapEdit.js";
import type * as combatMapGenerate from "../combatMapGenerate.js";
import type * as combatMapStyle from "../combatMapStyle.js";
import type * as combatMaps from "../combatMaps.js";
import type * as combatRequests from "../combatRequests.js";
import type * as combatTokens from "../combatTokens.js";
import type * as combatVision from "../combatVision.js";
import type * as countdownRolls from "../countdownRolls.js";
import type * as countdownTracks from "../countdownTracks.js";
import type * as countdowns from "../countdowns.js";
import type * as crons from "../crons.js";
import type * as customAdversaries from "../customAdversaries.js";
import type * as deathMoves from "../deathMoves.js";
import type * as encounterTracking from "../encounterTracking.js";
import type * as encounters from "../encounters.js";
import type * as environmentActions from "../environmentActions.js";
import type * as fear from "../fear.js";
import type * as feed from "../feed.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as levelUp from "../levelUp.js";
import type * as lib_actionLog from "../lib/actionLog.js";
import type * as lib_adversaryActions from "../lib/adversaryActions.js";
import type * as lib_adversaryFeatures from "../lib/adversaryFeatures.js";
import type * as lib_adversaryHits from "../lib/adversaryHits.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_authEmail from "../lib/authEmail.js";
import type * as lib_blobs from "../lib/blobs.js";
import type * as lib_cardChoices from "../lib/cardChoices.js";
import type * as lib_cardHand from "../lib/cardHand.js";
import type * as lib_cardRows from "../lib/cardRows.js";
import type * as lib_cardRunner from "../lib/cardRunner.js";
import type * as lib_characterSheet from "../lib/characterSheet.js";
import type * as lib_classFeatureCost from "../lib/classFeatureCost.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_codex from "../lib/codex.js";
import type * as lib_combatActions from "../lib/combatActions.js";
import type * as lib_combatMaps from "../lib/combatMaps.js";
import type * as lib_combatMovement from "../lib/combatMovement.js";
import type * as lib_combatRequests from "../lib/combatRequests.js";
import type * as lib_combatVision from "../lib/combatVision.js";
import type * as lib_countdownTicks from "../lib/countdownTicks.js";
import type * as lib_dice from "../lib/dice.js";
import type * as lib_encounters from "../lib/encounters.js";
import type * as lib_fear from "../lib/fear.js";
import type * as lib_featureDrawer from "../lib/featureDrawer.js";
import type * as lib_featureRunner from "../lib/featureRunner.js";
import type * as lib_featureScope from "../lib/featureScope.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_incomingHits from "../lib/incomingHits.js";
import type * as lib_journalState from "../lib/journalState.js";
import type * as lib_lorekeeper_caps from "../lib/lorekeeper/caps.js";
import type * as lib_lorekeeper_context from "../lib/lorekeeper/context.js";
import type * as lib_lorekeeper_retrieve from "../lib/lorekeeper/retrieve.js";
import type * as lib_lorekeeper_web from "../lib/lorekeeper/web.js";
import type * as lib_maps from "../lib/maps.js";
import type * as lib_mechanics from "../lib/mechanics.js";
import type * as lib_migrations from "../lib/migrations.js";
import type * as lib_notes from "../lib/notes.js";
import type * as lib_operations from "../lib/operations.js";
import type * as lib_partyLevelUp from "../lib/partyLevelUp.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_restHooks from "../lib/restHooks.js";
import type * as lib_rolls from "../lib/rolls.js";
import type * as lib_sessions from "../lib/sessions.js";
import type * as lib_spriteSources from "../lib/spriteSources.js";
import type * as lib_trackers from "../lib/trackers.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_validators_actionLog from "../lib/validators/actionLog.js";
import type * as lib_validators_campaigns from "../lib/validators/campaigns.js";
import type * as lib_validators_characterExtras from "../lib/validators/characterExtras.js";
import type * as lib_validators_characters from "../lib/validators/characters.js";
import type * as lib_validators_codex from "../lib/validators/codex.js";
import type * as lib_validators_combatMaps from "../lib/validators/combatMaps.js";
import type * as lib_validators_combatRequests from "../lib/validators/combatRequests.js";
import type * as lib_validators_encounters from "../lib/validators/encounters.js";
import type * as lib_validators_lorekeeper from "../lib/validators/lorekeeper.js";
import type * as lib_validators_maps from "../lib/validators/maps.js";
import type * as lib_validators_notes from "../lib/validators/notes.js";
import type * as lib_validators_rests from "../lib/validators/rests.js";
import type * as lib_validators_sessions from "../lib/validators/sessions.js";
import type * as lib_validators_spritePacks from "../lib/validators/spritePacks.js";
import type * as lib_validators_wither from "../lib/validators/wither.js";
import type * as lorekeeper from "../lorekeeper.js";
import type * as lorekeeperAsks from "../lorekeeperAsks.js";
import type * as lorekeeperLibrary from "../lorekeeperLibrary.js";
import type * as lorekeeperRetention from "../lorekeeperRetention.js";
import type * as lorekeeperRulings from "../lorekeeperRulings.js";
import type * as lorekeeperRun from "../lorekeeperRun.js";
import type * as lorekeeperUsage from "../lorekeeperUsage.js";
import type * as maps from "../maps.js";
import type * as members from "../members.js";
import type * as migrations_characterExtras from "../migrations/characterExtras.js";
import type * as migrations_characters from "../migrations/characters.js";
import type * as migrations_codex from "../migrations/codex.js";
import type * as migrations_handSharing from "../migrations/handSharing.js";
import type * as migrations_mapTrailMode from "../migrations/mapTrailMode.js";
import type * as migrations_maps from "../migrations/maps.js";
import type * as migrations_motherboardEconomy from "../migrations/motherboardEconomy.js";
import type * as migrations_run from "../migrations/run.js";
import type * as migrations_sessions from "../migrations/sessions.js";
import type * as migrations_slotBonuses from "../migrations/slotBonuses.js";
import type * as migrations_trackers from "../migrations/trackers.js";
import type * as notes from "../notes.js";
import type * as notesBin from "../notesBin.js";
import type * as notesEntries from "../notesEntries.js";
import type * as notesJournals from "../notesJournals.js";
import type * as notesSharing from "../notesSharing.js";
import type * as notesThreads from "../notesThreads.js";
import type * as photoImport from "../photoImport.js";
import type * as rests from "../rests.js";
import type * as rolls from "../rolls.js";
import type * as scenes from "../scenes.js";
import type * as sessionFeatures from "../sessionFeatures.js";
import type * as sessionPlay from "../sessionPlay.js";
import type * as sessionPrep from "../sessionPrep.js";
import type * as sessionRecords from "../sessionRecords.js";
import type * as sessionWrap from "../sessionWrap.js";
import type * as sessions from "../sessions.js";
import type * as settings from "../settings.js";
import type * as spritePacks from "../spritePacks.js";
import type * as tables_actionLog from "../tables/actionLog.js";
import type * as tables_campaigns from "../tables/campaigns.js";
import type * as tables_characters from "../tables/characters.js";
import type * as tables_codex from "../tables/codex.js";
import type * as tables_combatAreas from "../tables/combatAreas.js";
import type * as tables_combatMaps from "../tables/combatMaps.js";
import type * as tables_combatRequests from "../tables/combatRequests.js";
import type * as tables_countdowns from "../tables/countdowns.js";
import type * as tables_encounters from "../tables/encounters.js";
import type * as tables_files from "../tables/files.js";
import type * as tables_history from "../tables/history.js";
import type * as tables_lorekeeper from "../tables/lorekeeper.js";
import type * as tables_maps from "../tables/maps.js";
import type * as tables_notes from "../tables/notes.js";
import type * as tables_operations from "../tables/operations.js";
import type * as tables_rests from "../tables/rests.js";
import type * as tables_sessions from "../tables/sessions.js";
import type * as tables_spritePacks from "../tables/spritePacks.js";
import type * as tables_trackers from "../tables/trackers.js";
import type * as trackers_ageOfUmbra from "../trackers/ageOfUmbra.js";
import type * as trackers_andaluria from "../trackers/andaluria.js";
import type * as trackers_colossus from "../trackers/colossus.js";
import type * as trackers_fiveBanners from "../trackers/fiveBanners.js";
import type * as trackers_horizon from "../trackers/horizon.js";
import type * as trackers_weredragon from "../trackers/weredragon.js";
import type * as users from "../users.js";
import type * as wither from "../wither.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  actionLog: typeof actionLog;
  adversaryActions: typeof adversaryActions;
  auth: typeof auth;
  campaignTime: typeof campaignTime;
  campaigns: typeof campaigns;
  characterExtras: typeof characterExtras;
  characters: typeof characters;
  classFeatures: typeof classFeatures;
  cleanup: typeof cleanup;
  codex: typeof codex;
  combatActions: typeof combatActions;
  combatCards: typeof combatCards;
  combatFeatures: typeof combatFeatures;
  combatMapEdit: typeof combatMapEdit;
  combatMapGenerate: typeof combatMapGenerate;
  combatMapStyle: typeof combatMapStyle;
  combatMaps: typeof combatMaps;
  combatRequests: typeof combatRequests;
  combatTokens: typeof combatTokens;
  combatVision: typeof combatVision;
  countdownRolls: typeof countdownRolls;
  countdownTracks: typeof countdownTracks;
  countdowns: typeof countdowns;
  crons: typeof crons;
  customAdversaries: typeof customAdversaries;
  deathMoves: typeof deathMoves;
  encounterTracking: typeof encounterTracking;
  encounters: typeof encounters;
  environmentActions: typeof environmentActions;
  fear: typeof fear;
  feed: typeof feed;
  history: typeof history;
  http: typeof http;
  levelUp: typeof levelUp;
  "lib/actionLog": typeof lib_actionLog;
  "lib/adversaryActions": typeof lib_adversaryActions;
  "lib/adversaryFeatures": typeof lib_adversaryFeatures;
  "lib/adversaryHits": typeof lib_adversaryHits;
  "lib/allowlist": typeof lib_allowlist;
  "lib/auth": typeof lib_auth;
  "lib/authEmail": typeof lib_authEmail;
  "lib/blobs": typeof lib_blobs;
  "lib/cardChoices": typeof lib_cardChoices;
  "lib/cardHand": typeof lib_cardHand;
  "lib/cardRows": typeof lib_cardRows;
  "lib/cardRunner": typeof lib_cardRunner;
  "lib/characterSheet": typeof lib_characterSheet;
  "lib/classFeatureCost": typeof lib_classFeatureCost;
  "lib/claude": typeof lib_claude;
  "lib/codex": typeof lib_codex;
  "lib/combatActions": typeof lib_combatActions;
  "lib/combatMaps": typeof lib_combatMaps;
  "lib/combatMovement": typeof lib_combatMovement;
  "lib/combatRequests": typeof lib_combatRequests;
  "lib/combatVision": typeof lib_combatVision;
  "lib/countdownTicks": typeof lib_countdownTicks;
  "lib/dice": typeof lib_dice;
  "lib/encounters": typeof lib_encounters;
  "lib/fear": typeof lib_fear;
  "lib/featureDrawer": typeof lib_featureDrawer;
  "lib/featureRunner": typeof lib_featureRunner;
  "lib/featureScope": typeof lib_featureScope;
  "lib/files": typeof lib_files;
  "lib/functions": typeof lib_functions;
  "lib/incomingHits": typeof lib_incomingHits;
  "lib/journalState": typeof lib_journalState;
  "lib/lorekeeper/caps": typeof lib_lorekeeper_caps;
  "lib/lorekeeper/context": typeof lib_lorekeeper_context;
  "lib/lorekeeper/retrieve": typeof lib_lorekeeper_retrieve;
  "lib/lorekeeper/web": typeof lib_lorekeeper_web;
  "lib/maps": typeof lib_maps;
  "lib/mechanics": typeof lib_mechanics;
  "lib/migrations": typeof lib_migrations;
  "lib/notes": typeof lib_notes;
  "lib/operations": typeof lib_operations;
  "lib/partyLevelUp": typeof lib_partyLevelUp;
  "lib/permissions": typeof lib_permissions;
  "lib/restHooks": typeof lib_restHooks;
  "lib/rolls": typeof lib_rolls;
  "lib/sessions": typeof lib_sessions;
  "lib/spriteSources": typeof lib_spriteSources;
  "lib/trackers": typeof lib_trackers;
  "lib/users": typeof lib_users;
  "lib/validators/actionLog": typeof lib_validators_actionLog;
  "lib/validators/campaigns": typeof lib_validators_campaigns;
  "lib/validators/characterExtras": typeof lib_validators_characterExtras;
  "lib/validators/characters": typeof lib_validators_characters;
  "lib/validators/codex": typeof lib_validators_codex;
  "lib/validators/combatMaps": typeof lib_validators_combatMaps;
  "lib/validators/combatRequests": typeof lib_validators_combatRequests;
  "lib/validators/encounters": typeof lib_validators_encounters;
  "lib/validators/lorekeeper": typeof lib_validators_lorekeeper;
  "lib/validators/maps": typeof lib_validators_maps;
  "lib/validators/notes": typeof lib_validators_notes;
  "lib/validators/rests": typeof lib_validators_rests;
  "lib/validators/sessions": typeof lib_validators_sessions;
  "lib/validators/spritePacks": typeof lib_validators_spritePacks;
  "lib/validators/wither": typeof lib_validators_wither;
  lorekeeper: typeof lorekeeper;
  lorekeeperAsks: typeof lorekeeperAsks;
  lorekeeperLibrary: typeof lorekeeperLibrary;
  lorekeeperRetention: typeof lorekeeperRetention;
  lorekeeperRulings: typeof lorekeeperRulings;
  lorekeeperRun: typeof lorekeeperRun;
  lorekeeperUsage: typeof lorekeeperUsage;
  maps: typeof maps;
  members: typeof members;
  "migrations/characterExtras": typeof migrations_characterExtras;
  "migrations/characters": typeof migrations_characters;
  "migrations/codex": typeof migrations_codex;
  "migrations/handSharing": typeof migrations_handSharing;
  "migrations/mapTrailMode": typeof migrations_mapTrailMode;
  "migrations/maps": typeof migrations_maps;
  "migrations/motherboardEconomy": typeof migrations_motherboardEconomy;
  "migrations/run": typeof migrations_run;
  "migrations/sessions": typeof migrations_sessions;
  "migrations/slotBonuses": typeof migrations_slotBonuses;
  "migrations/trackers": typeof migrations_trackers;
  notes: typeof notes;
  notesBin: typeof notesBin;
  notesEntries: typeof notesEntries;
  notesJournals: typeof notesJournals;
  notesSharing: typeof notesSharing;
  notesThreads: typeof notesThreads;
  photoImport: typeof photoImport;
  rests: typeof rests;
  rolls: typeof rolls;
  scenes: typeof scenes;
  sessionFeatures: typeof sessionFeatures;
  sessionPlay: typeof sessionPlay;
  sessionPrep: typeof sessionPrep;
  sessionRecords: typeof sessionRecords;
  sessionWrap: typeof sessionWrap;
  sessions: typeof sessions;
  settings: typeof settings;
  spritePacks: typeof spritePacks;
  "tables/actionLog": typeof tables_actionLog;
  "tables/campaigns": typeof tables_campaigns;
  "tables/characters": typeof tables_characters;
  "tables/codex": typeof tables_codex;
  "tables/combatAreas": typeof tables_combatAreas;
  "tables/combatMaps": typeof tables_combatMaps;
  "tables/combatRequests": typeof tables_combatRequests;
  "tables/countdowns": typeof tables_countdowns;
  "tables/encounters": typeof tables_encounters;
  "tables/files": typeof tables_files;
  "tables/history": typeof tables_history;
  "tables/lorekeeper": typeof tables_lorekeeper;
  "tables/maps": typeof tables_maps;
  "tables/notes": typeof tables_notes;
  "tables/operations": typeof tables_operations;
  "tables/rests": typeof tables_rests;
  "tables/sessions": typeof tables_sessions;
  "tables/spritePacks": typeof tables_spritePacks;
  "tables/trackers": typeof tables_trackers;
  "trackers/ageOfUmbra": typeof trackers_ageOfUmbra;
  "trackers/andaluria": typeof trackers_andaluria;
  "trackers/colossus": typeof trackers_colossus;
  "trackers/fiveBanners": typeof trackers_fiveBanners;
  "trackers/horizon": typeof trackers_horizon;
  "trackers/weredragon": typeof trackers_weredragon;
  users: typeof users;
  wither: typeof wither;
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
