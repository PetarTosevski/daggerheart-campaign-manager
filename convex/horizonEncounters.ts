import { v } from "convex/values";

import { applyResourceDelta } from "../src/lib/domain/characters/index";
import { encounterBonus, GOOD_FORTUNE_ENTRY, SETBACK_ENTRY } from "../src/lib/domain/frames/horizon";
import { appError } from "../src/lib/errors/app-error";
import { regionKey, regionSchema, setEncounterUsed } from "../src/lib/world/hex-crawl";
import { HORIZON_FRAME } from "../src/lib/world/map-state";
import { logAction, newGroupId } from "./lib/actionLog";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { MAX_PCS } from "./lib/encounters";
import { gainFear } from "./lib/fear";
import { keyedGmMutation } from "./lib/functions";
import { ruleMode } from "./lib/ruleModes";
import { readTracker, TRACKER_SCHEMA_VERSION, writeTracker } from "./lib/trackers";

/**
 * Horizon encounter bonuses (optional rule, HF p.171; plan rule-switches OH, Q15 a). With the campaign's
 * `horizonEncounterBonuses` switch on, the GM runs (activates) a region's Encounter-table entry 4 or 12 and the app
 * applies the entry's optional bonus by itself: 4 "temporary setback": the GM gains 1 Fear for each active PC (12 cap);
 * 12 "a bit of good fortune": each active PC gains 1 Hope (their Hope maximum caps it). The GM runs the rest of the
 * encounter. docs/tasks/TASK-RULES-OH.md.
 */

const resultValidator = v.object({
  entry: v.number(),
  /** Fear the GM actually gained (after the cap); 0 for entry 12. */
  fearGained: v.number(),
  /** PCs whose Hope rose; 0 for entry 4. */
  hopeGained: v.number(),
});

/**
 * Runs a region's encounter 4 or 12 (marks it used) and applies its optional bonus, in one undo group: undoing it from
 * the feed takes the Fear and the Hope back (the encounter stays marked used; the GM can untick it). MECHANIC_DISABLED
 * outside Journey to Horizon or while the switch is off; TRACKER_RULE when the region or encounter is gone or the
 * encounter already ran; INVALID for any other entry. Keyed: a retried call applies once.
 */
export const activate = keyedGmMutation({
  args: { regionId: v.number(), index: v.number() },
  returns: resultValidator,
  handler: (ctx, { regionId, index }) => {
    const campaign = ctx.campaign;
    if (campaign.frameId !== HORIZON_FRAME || !ruleMode(campaign, "horizonEncounterBonuses")) throw appError("MECHANIC_DISABLED");
    return ctx.once("horizon_encounter_bonus", { regionId, index }, async () => {
      const key = regionKey(regionId);
      const region = Number.isInteger(regionId) && regionId > 0 ? await readTracker(ctx, campaign._id, key, regionSchema) : null;
      if (region === null) throw appError("TRACKER_RULE", "That region is gone.");
      const encounter = Number.isInteger(index) ? region.encounters[index] : undefined;
      if (encounter === undefined) throw appError("TRACKER_RULE", "That encounter is gone.");
      if (encounter.used) throw appError("TRACKER_RULE", "That encounter already ran.");

      // One party: at most MAX_PCS characters.
      const characters = await ctx.db
        .query("characters")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .take(MAX_PCS * 4);
      const pcs = characters.filter((c) => c.status === "active").slice(0, MAX_PCS);
      const bonus = encounterBonus(encounter.total, pcs.length, true);
      if (bonus === null) throw appError("INVALID", `Only entries ${SETBACK_ENTRY} and ${GOOD_FORTUNE_ENTRY} of the Encounter table have an optional bonus (HF p.171).`);

      await writeTracker(ctx, campaign._id, key, regionSchema.parse(setEncounterUsed(region, index, true)), TRACKER_SCHEMA_VERSION);
      const groupId = newGroupId();
      const actorId = ctx.user._id;

      if (bonus.kind === "fear") {
        const { gained } = await gainFear(ctx, campaign._id, bonus.amount);
        await logAction(ctx, {
          campaignId: campaign._id,
          actorId,
          kind: "roll",
          visibility: "public",
          summary: `Encounter ${SETBACK_ENTRY}, a temporary setback (HF 171): GM gains ${gained} Fear (1 per PC${gained < bonus.amount ? ", capped at 12" : ""})`,
          groupId,
          fearDelta: gained,
          undoable: true,
        });
        return { entry: encounter.total, fearGained: gained, hopeGained: 0 };
      }

      let hopeGained = 0;
      const atMax: string[] = [];
      for (const pc of pcs) {
        const before = readSheet(pc.sheet);
        const after = applyResourceDelta(before, "hope", 1);
        if (after.hope === before.hope) {
          atMax.push(before.name);
          continue;
        }
        hopeGained += 1;
        await saveSheet(ctx, pc._id, after);
        await logAction(ctx, {
          campaignId: campaign._id,
          characterId: pc._id,
          actorId,
          kind: "roll",
          visibility: "public",
          summary: `${before.name} gains a Hope (good fortune, HF 171): Hope ${after.hope}`,
          groupId,
          before,
          undoable: true,
        });
      }
      await logAction(ctx, {
        campaignId: campaign._id,
        actorId,
        kind: "roll",
        visibility: "public",
        summary: `Encounter ${GOOD_FORTUNE_ENTRY}, a bit of good fortune (HF 171): each PC gains a Hope${atMax.length ? ` (${atMax.join(", ")} already at max)` : ""}`,
        groupId,
        undoable: true,
      });
      return { entry: encounter.total, fearGained: 0, hopeGained };
    });
  },
});
