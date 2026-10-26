import { v } from "convex/values";

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
});
