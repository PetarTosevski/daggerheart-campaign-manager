import { v } from "convex/values";

/** What a Wither token gain reports (T5); shared by wither.ts and characters.applyDamage. */
export const witherGainValidator = v.object({
  /** Tokens after the gain, before clearing: what the Fear Die was compared with. */
  tokens: v.number(),
  fearDie: v.number(),
  scarred: v.boolean(),
  /** The scar crossed out the last Hope slot (CB 106). */
  journeyEnds: v.boolean(),
  entryId: v.id("actionLog"),
});
