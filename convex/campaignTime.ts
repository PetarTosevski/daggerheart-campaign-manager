/**
 * Campaign time (dcm-bxp.26, plan lanes-2 CT). Witherwild keeps its Day / Night weeks (`get`, `advance`, `setDay`: the
 * frame mechanic `campaignTime`, MECHANIC_DISABLED elsewhere). Since the user's answer of 2026-10-31 (dcm-ztb8) every
 * campaign also counts days of a week in the same `campaignTime` row (created lazily; other frames keep `cycle` "DAY"):
 * - `calendar` (view): the week and day, for every frame;
 * - `endDay` (GM): one day passes; every once-per-day feature use ends (`expire(sheet, "day")` for the party, `day`
 *   entries on the instances of running encounters); after day 7 a week passes and weekly uses end too ("week");
 * - `expireParty` is shared with the GM turn's end (`encounterTracking.endGmTurn` fires "gmTurn").
 * Sheet and instance changes are one undoable `actionLog` group (kind `session`, like the scene end); the time change
 * itself is recorded in `history` (recordHistory), as every time change is.
 */
import { v } from "convex/values";

import {
  getNextCampaignTime,
  passDay,
  toCampaignCycleDay,
  withCycleDay,
  type CampaignTime,
} from "../src/lib/domain/campaign-time/index";
import { expire } from "../src/lib/domain/characters/expiry";
import { appError } from "../src/lib/errors/app-error";
import { frameHasMechanic } from "../src/lib/frames/index";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { MAX_CHARACTERS_PER_CAMPAIGN, readSheet, saveSheet } from "./lib/characterSheet";
import { MAX_INSTANCES } from "./lib/encounters";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { applyRule, assertMechanicEnabled } from "./lib/mechanics";
import type { AdversaryBefore } from "./lib/validators/actionLog";
import type { InstanceFeatureUse } from "./lib/validators/encounters";
import { recordHistory } from "./tables/history";

type TimeView = { week: number; cycle: "DAY" | "NIGHT"; cycleDay: number };

const timeView = v.object({
  week: v.number(),
  cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
  cycleDay: v.number(),
});

const toDomain = (row: Doc<"campaignTime">): CampaignTime => ({
  currentWeek: row.week,
  currentCycle: row.cycle,
  currentCycleDay: toCampaignCycleDay(row.cycleDay),
});

const toView = (t: CampaignTime): TimeView => ({
  week: t.currentWeek,
  cycle: t.currentCycle,
  cycleDay: t.currentCycleDay,
});

const INITIAL_TIME: TimeView = { week: 1, cycle: "DAY", cycleDay: 1 };

/**
 * The campaign's time row after the Witherwild-frame check, or null for a
 * Witherwild campaign created before campaign time existed (D1); such a
 * campaign is at the initial time until its first change.
 */
async function findTime(ctx: QueryCtx, campaign: Doc<"campaigns">) {
  assertMechanicEnabled(campaign, "campaignTime");
  return findRow(ctx, campaign);
}

/** The campaign's time row for any frame (CT: every campaign counts days), or null before its first day ends. */
function findRow(ctx: QueryCtx, campaign: Doc<"campaigns">) {
  return ctx.db
    .query("campaignTime")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .unique();
}

/** For changes (the wrapper has already checked GM access). `anyFrame`: End day, which every frame has. */
async function loadTime(ctx: MutationCtx, campaign: Doc<"campaigns">, anyFrame = false) {
  const row = anyFrame ? await findRow(ctx, campaign) : await findTime(ctx, campaign);
  if (row !== null) return row;
  const id = await ctx.db.insert("campaignTime", { campaignId: campaign._id, ...INITIAL_TIME });
  return (await ctx.db.get("campaignTime", id))!;
}

/** Applies `next` and records the change in `history`. */
async function changeTime(
  ctx: MutationCtx & { user: Doc<"users"> },
  row: Doc<"campaignTime">,
  action: string,
  next: CampaignTime,
): Promise<TimeView> {
  const before = toView(toDomain(row));
  const after = toView(next);
  await ctx.db.patch("campaignTime", row._id, after);
  await recordHistory(ctx, ctx.user._id, { campaignId: row.campaignId, kind: "campaignTime", action, before, after });
  return after;
}

export const get = campaignQuery({
  need: "view",
  args: {},
  returns: timeView,
  handler: async (ctx): Promise<TimeView> => {
    const row = await findTime(ctx, ctx.campaign);
    return row ? toView(toDomain(row)) : INITIAL_TIME;
  },
});

/** One campaign day forward; after day 7 a new week starts in the other cycle. */
export const advance = keyedGmMutation({
  args: {},
  returns: timeView,
  handler: async (ctx): Promise<TimeView> => {
    const row = await loadTime(ctx, ctx.campaign);
    return ctx.once("campaign_time_advance", {}, async () =>
      changeTime(ctx, row, "advance", getNextCampaignTime(toDomain(row))),
    );
  },
});

/** Sets the day within the current week (the arc's icons). Must change the day. */
export const setDay = keyedGmMutation({
  args: { cycleDay: v.number() },
  returns: timeView,
  handler: async (ctx, { cycleDay }): Promise<TimeView> => {
    const row = await loadTime(ctx, ctx.campaign);
    return ctx.once("campaign_time_set_day", { cycleDay }, async () => {
      const current = toDomain(row);
      const next = applyRule("TIME_RULE", RangeError, () => withCycleDay(current, cycleDay));
      const after = await changeTime(ctx, row, "setDay", next);
      // User answer 2026-10-31 (CT Q3): a jump forward by N days counts as N ended days (within the week, so once-per-day
      // uses end; a week only passes through End day on day 7). A jump back ends nothing.
      const from = current.currentCycleDay;
      if (next.currentCycleDay > from) {
        const label = next.currentCycleDay - from === 1 ? `Day ${from} ended` : `Days ${from}-${next.currentCycleDay - 1} ended`;
        await expireParty(ctx, ctx.campaign, ctx.user._id, "day", label);
      }
      return after;
    });
  },
});

// ---------------------------------------------------------------- every frame: days, weeks, End day (plan lanes-2 CT)

/** What a period's end clears (src/lib/domain/characters/expiry.ts lists the sheet side). */
export type PeriodEnd = "gmTurn" | "day" | "week";

/** Instance featureUses each event ends. `gmTurn` ones are bound to their turn lazily (E7: "@gmTurn<N>"), so none here. */
const INSTANCE_UNTIL: Record<PeriodEnd, readonly InstanceFeatureUse["until"][]> = {
  gmTurn: [],
  day: ["day"],
  week: ["day", "week"],
};

/** Sheets one period end may change: an undo group holds at most 50 rows (convex/lib/actionLog.ts), one is the campaign's. */
const PARTY_MAX = 49;
/** Running encounters whose instances a day's end reads (a campaign runs one or two at a time). */
const RUNNING_MAX = 10;

export type PartyExpiry = {
  /** Feature uses ended across the party and the running encounters' instances. */
  ended: number;
  /** The campaign row of the undo group, or null when nothing ended. */
  entryId: Id<"actionLog"> | null;
};

/** The instances of the campaign's running encounters whose featureUses `until` ends, with what stays. */
async function instanceEnds(ctx: MutationCtx, campaignId: Id<"campaigns">, until: readonly InstanceFeatureUse["until"][]) {
  if (until.length === 0) return [];
  const running = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", "running"))
    .take(RUNNING_MAX);
  const out: { instance: Doc<"encounterAdversaries">; kept: InstanceFeatureUse[]; ended: number }[] = [];
  for (const encounter of running) {
    const rows = await ctx.db
      .query("encounterAdversaries")
      .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
      .take(MAX_INSTANCES);
    for (const instance of rows) {
      const uses = instance.featureUses ?? [];
      const kept = uses.filter((u) => !until.includes(u.until));
      if (kept.length < uses.length) out.push({ instance, kept, ended: uses.length - kept.length });
    }
  }
  return out;
}

/**
 * Ends the party's feature uses of a period (`expire(sheet, event)` for every active PC) and, for a day or a week, the
 * running encounters' instance uses of that period. One undoable `actionLog` group: a row per changed PC (`before`) and
 * a campaign row `summary` carrying the instances' `adversaryBefore`. Nothing to end writes nothing.
 */
export async function expireParty(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  actorId: Id<"users">,
  event: PeriodEnd,
  summary: string,
): Promise<PartyExpiry> {
  const campaignId = campaign._id;
  const characters = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  const sheets = characters
    .filter((c) => c.status === "active")
    .flatMap((character) => {
      let sheet: CharacterSheet;
      try {
        sheet = readSheet(character.sheet);
      } catch {
        return []; // a corrupt sheet is left alone (as the scene end does)
      }
      const next = expire(sheet, event);
      const ended = (sheet.featureUses?.length ?? 0) - (next.featureUses?.length ?? 0);
      return ended > 0 ? [{ character, sheet, next, ended }] : [];
    });
  if (sheets.length > PARTY_MAX) throw appError("INVALID", `At most ${PARTY_MAX} characters can be updated at once; remove some from the campaign.`);
  const instances = await instanceEnds(ctx, campaignId, INSTANCE_UNTIL[event]);
  if (sheets.length === 0 && instances.length === 0) return { ended: 0, entryId: null };

  const groupId = newGroupId();
  const now = Date.now();
  for (const { character, sheet, next } of sheets) {
    await saveSheet(ctx, character._id, next);
    await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "session", visibility: "public", summary: `${sheet.name}: ${summary}`, groupId, before: sheet, undoable: true });
  }
  const adversaryBefore: AdversaryBefore[] = [];
  for (const { instance, kept } of instances) {
    adversaryBefore.push({
      instanceId: instance._id,
      hp: instance.hp,
      stress: instance.stress,
      defeated: instance.defeated,
      ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}),
      featureUses: instance.featureUses ?? [],
    });
    await ctx.db.patch("encounterAdversaries", instance._id, { featureUses: kept.length > 0 ? kept : undefined, updatedAt: now });
  }
  const ended = sheets.reduce((n, s) => n + s.ended, 0) + instances.reduce((n, i) => n + i.ended, 0);
  const entryId = await logAction(ctx, {
    campaignId,
    actorId,
    kind: "session",
    visibility: "public",
    summary: `${summary}; ${ended} limit${ended === 1 ? "" : "s"} refreshed`,
    groupId,
    ...(adversaryBefore.length > 0 ? { adversaryBefore } : {}),
    undoable: true,
  });
  return { ended, entryId };
}

const calendarView = v.object({
  week: v.number(),
  day: v.number(),
  /** The frame keeps Witherwild's Day / Night weeks (its arc shows them; `get` has the cycle). */
  cycles: v.boolean(),
});

/** The campaign's week and day, for every frame (a campaign whose first day has not ended is on week 1, day 1). */
export const calendar = campaignQuery({
  need: "view",
  args: {},
  returns: calendarView,
  handler: async (ctx) => {
    const row = await findRow(ctx, ctx.campaign);
    return { week: row?.week ?? 1, day: row?.cycleDay ?? 1, cycles: frameHasMechanic(ctx.campaign.frameId, "campaignTime") };
  },
});

/**
 * The GM's End day (dcm-ztb8, every frame): the next day starts, once-per-day uses end, and when day 7 ends a week passes
 * and weekly uses end too (Summon Tormentors CB p.237 "Once per day"; Resurrection CB p.341 "for a week"). Witherwild's
 * new week flips its cycle as `advance` does.
 */
export const endDay = keyedGmMutation({
  args: {},
  returns: v.object({
    week: v.number(),
    day: v.number(),
    cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
    newWeek: v.boolean(),
    ended: v.number(),
    entryId: v.union(v.id("actionLog"), v.null()),
  }),
  handler: async (ctx) => {
    const row = await loadTime(ctx, ctx.campaign, true);
    return ctx.once("campaign_time_end_day", {}, async () => {
      const current = toDomain(row);
      const cycles = frameHasMechanic(ctx.campaign.frameId, "campaignTime");
      const { next, newWeek } = passDay(current, cycles);
      const after = await changeTime(ctx, row, "endDay", next);
      // User answer 2026-10-31 (CT Q2): a new day starts in daylight. In the Witherwild the time phase sets the light.
      if (!cycles && (ctx.campaign.timeOfDay ?? "day") !== "day") {
        await ctx.db.patch("campaigns", ctx.campaign._id, { timeOfDay: "day" });
      }
      const label = newWeek ? `Week ${current.currentWeek} ended` : `Day ${current.currentCycleDay} ended`;
      const { ended, entryId } = await expireParty(ctx, ctx.campaign, ctx.user._id, newWeek ? "week" : "day", label);
      return { week: after.week, day: after.cycleDay, cycle: after.cycle, newWeek, ended, entryId };
    });
  },
});
