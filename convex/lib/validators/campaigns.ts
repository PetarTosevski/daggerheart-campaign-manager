import { v } from "convex/values";

import {
  FEAR_AT_START_CHOICES,
  LOREKEEPER_ASK_CHOICES,
  OUT_OF_RANGE_CHOICES,
  SESSION_OPENS_ON_CHOICES,
} from "../../../src/lib/config/campaign-settings";
import { FRAME_IDS } from "../../../src/lib/frames/index";

export const frameIdValidator = v.union(...FRAME_IDS.map((id) => v.literal(id)));

export const customFrameValidator = v.object({
  pitch: v.string(),
  tones: v.array(v.string()),
  themes: v.string(),
  touchstones: v.string(),
  partySize: v.number(),
  startingTier: v.number(),
  background: v.string(),
});

export const tomeChapterValidator = v.union(v.literal("overview"), v.literal("incident"), v.literal("mechanics"));

export const tomeValidator = v.object({ overview: v.string(), incident: v.string(), mechanics: v.string() });

/** Every optional rule, resolved against the frame (`resolveOptions` in `src/lib/frames/options.ts`). */
export const campaignOptionsValidator = v.object({
  hopeAndFear: v.boolean(),
  lessLethal: v.boolean(),
  transformations: v.boolean(),
  enduranceCountdowns: v.boolean(),
  remnantCorruption: v.boolean(),
  witherPersists: v.boolean(),
});

export const outOfRangeValidator = v.union(...OUT_OF_RANGE_CHOICES.map((c) => v.literal(c)));
export const lorekeeperAskValidator = v.union(...LOREKEEPER_ASK_CHOICES.map((c) => v.literal(c)));
export const fearAtStartValidator = v.union(...FEAR_AT_START_CHOICES.map((c) => v.literal(c)));
export const sessionOpensOnValidator = v.union(...SESSION_OPENS_ON_CHOICES.map((c) => v.literal(c)));

/** Every table setting, resolved (`resolveTableSettings` in `src/lib/config/campaign-settings.ts`). */
export const tableSettingsValidator = v.object({
  playersSeeFear: v.boolean(),
  outOfRange: outOfRangeValidator,
  spotlightToPlayers: v.boolean(),
  lorekeeperWeb: v.boolean(),
  lorekeeperAsk: lorekeeperAskValidator,
  fearAtStart: fearAtStartValidator,
  sessionOpensOn: sessionOpensOnValidator,
  autoSessionLog: v.boolean(),
});

/**
 * `campaigns.tableSettings` as stored (config S0): a typed object of optional fields, so no `schemaVersion`; an unset
 * field uses `TABLE_SETTING_DEFAULTS`. Widen only (rule 7): a new setting is a new optional field here and above.
 */
export const storedTableSettingsValidator = v.object({
  playersSeeFear: v.optional(v.boolean()),
  outOfRange: v.optional(outOfRangeValidator),
  spotlightToPlayers: v.optional(v.boolean()),
  lorekeeperWeb: v.optional(v.boolean()),
  lorekeeperAsk: v.optional(lorekeeperAskValidator),
  fearAtStart: v.optional(fearAtStartValidator),
  sessionOpensOn: v.optional(sessionOpensOnValidator),
  autoSessionLog: v.optional(v.boolean()),
});

/** A co-GM (config Q8 b) on a `campaignMembers` row or a `campaignInvites` row; unset = a player. */
export const memberRoleValidator = v.literal("coGm");

/** What `campaigns.list` and `campaigns.get` return per campaign. */
export const campaignSummaryValidator = v.object({
  _id: v.id("campaigns"),
  frameId: frameIdValidator,
  name: v.string(),
  tier: v.number(),
  level: v.number(),
  custom: v.union(customFrameValidator, v.null()),
  tome: v.union(tomeValidator, v.null()),
  options: campaignOptionsValidator,
  createdAt: v.number(),
  /** When this user last opened it. */
  lastOpenedAt: v.number(),
  fear: v.number(),
  /** How many players have joined (member rows; invites not yet accepted don't count). */
  players: v.number(),
  role: v.union(v.literal("gm"), v.literal("player")),
  /** The resolved table settings (config S0): the live source for every member. */
  settings: tableSettingsValidator,
  /** Archived (`archivedAt` set): read-only for everyone (Q9 a). */
  archived: v.boolean(),
});
