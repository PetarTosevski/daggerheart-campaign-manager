import { v } from "convex/values";

import {
  applyCountdownAction,
  COUNTDOWN_STATUSES,
  CountdownRangeError,
  CountdownRuleError,
} from "../../src/lib/domain/countdowns/index";
import { appError } from "../../src/lib/errors/app-error";
import {
  createObjectiveSchema,
  FIVE_BANNERS_FRAME_ID,
  FIVE_BANNERS_KEY,
  fiveBannersStateSchema,
  formatRating,
  holdsSlot,
  isObjectiveKind,
  loadState,
  NATION_IDS,
  NATION_NAMES,
  NATION_PAIRS,
  nationFromOwnerKey,
  nationOwnerKey,
  nationSheetSchema,
  objectiveLimitError,
  OBJECTIVE_KINDS,
  pairKey,
  planWeekAdvance,
  relationshipLabel,
  relationshipRatingSchema,
  setRelationship as applyRelationship,
  setReveal,
  type FiveBannersState,
  type NationId,
  type ObjectiveKind,
} from "../../src/lib/frames/trackers/five-banners";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { campaignQuery, keyedGmMutation, keyedUserMutation } from "../lib/functions";
import { applyRule } from "../lib/mechanics";
import { atLeast, campaignAccess } from "../lib/permissions";
import { applyTrackerRule, assertTrackerFrame, readTracker, TRACKER_SCHEMA_VERSION, writeTracker } from "../lib/trackers";
import { recordHistory } from "../tables/history";

const FRAME = { frameId: FIVE_BANNERS_FRAME_ID };
const nationValidator = v.union(...NATION_IDS.map((n) => v.literal(n)));
const statusValidator = v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s)));

type Objective = Doc<"countdowns"> & { kind: ObjectiveKind; nation: NationId };

/** The stored state checked against its schema (`TRACKER_CORRUPT` otherwise); the book's seed when never saved. */
async function readState(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<FiveBannersState> {
  return loadState(await readTracker(ctx, campaignId, FIVE_BANNERS_KEY, fiveBannersStateSchema));
}

async function writeState(ctx: MutationCtx, campaignId: Id<"campaigns">, state: FiveBannersState): Promise<void> {
  await writeTracker(ctx, campaignId, FIVE_BANNERS_KEY, state, TRACKER_SCHEMA_VERSION);
}

function asObjective(row: Doc<"countdowns">): Objective | null {
  const nation = nationFromOwnerKey(row.ownerKey);
  return nation && isObjectiveKind(row.kind) ? { ...row, kind: row.kind, nation } : null;
}

/**
 * The campaign's objective countdowns (any status), oldest first: the
 * `nation:*` range of `by_campaign_owner`. At most three per nation hold a
 * slot; finished ones stay as the nation's record, so the range stays small.
 */
async function listObjectives(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Objective[]> {
  const rows = await ctx.db
    .query("countdowns")
    // "nation;" is the first key after every "nation:<id>".
    .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaignId).gte("ownerKey", "nation:").lt("ownerKey", "nation;"))
    .collect();
  return rows.flatMap((row) => asObjective(row) ?? []).sort((a, b) => a._creationTime - b._creationTime);
}

function invalidPair(): never {
  throw appError("INVALID", "Pick two different nations.");
}

const relationshipView = v.object({
  a: nationValidator,
  b: nationValidator,
  value: v.number(),
  label: v.string(),
  rating: v.string(),
  revealed: v.boolean(),
});
const sheet = v.object({ assets: v.array(v.string()), problems: v.array(v.string()) });
const objectiveView = v.object({
  _id: v.id("countdowns"),
  name: v.string(),
  kind: v.union(...OBJECTIVE_KINDS.map((k) => v.literal(k))),
  startingValue: v.number(),
  currentValue: v.number(),
  status: statusValidator,
  revealed: v.boolean(),
  notes: v.string(),
});
const nationView = v.object({
  id: nationValidator,
  name: v.string(),
  sheet: v.union(sheet, v.null()),
  sheetRevealed: v.boolean(),
  objectives: v.array(objectiveView),
});
const view = { week: v.number(), relationships: v.array(relationshipView), nations: v.array(nationView) };

/**
 * The Five Banners tracker as this viewer may see it: the GM gets everything
 * with reveal flags; a player only the week counter and revealed items.
 * Null for campaigns in other frames.
 */
export const state = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.union(v.object({ role: v.literal("gm"), ...view }), v.object({ role: v.literal("player"), ...view }), v.null()),
  handler: async (ctx) => {
    if (ctx.campaign.frameId !== FIVE_BANNERS_FRAME_ID) return null;
    const campaignId = ctx.campaign._id;
    const gm = ctx.permission === "owner";
    const data = await readState(ctx, campaignId);
    const objectives = await listObjectives(ctx, campaignId);

    const relationships = NATION_PAIRS.flatMap(([a, b]) => {
      const key = pairKey(a, b);
      const revealed = data.revealedPairs.includes(key);
      if (!gm && !revealed) return [];
      const value = data.relationships[key];
      return [{ a, b, value, label: relationshipLabel(value), rating: formatRating(value), revealed }];
    });

    const nations = NATION_IDS.map((nation) => {
      const sheetRevealed = data.revealedSheets.includes(nation);
      return {
        id: nation,
        name: NATION_NAMES[nation],
        sheet: gm || sheetRevealed ? data.sheets[nation] : null,
        sheetRevealed,
        objectives: objectives
          .filter((o) => o.nation === nation && o.status !== "cancelled" && (gm || o.revealed === true))
          .map((o) => ({
            _id: o._id,
            name: o.name,
            kind: o.kind,
            startingValue: o.startingValue,
            currentValue: o.currentValue,
            status: o.status,
            revealed: o.revealed === true,
            notes: gm ? o.description : "",
          })),
      };
    });

    return { role: gm ? ("gm" as const) : ("player" as const), week: data.week, relationships, nations };
  },
});

export const setRelationship = keyedGmMutation({
  args: { a: nationValidator, b: nationValidator, value: v.number() },
  returns: v.object({ previousValue: v.number(), newValue: v.number() }),
  handler: async (ctx, { a, b, value }) => {
    assertTrackerFrame(ctx.campaign, FRAME);
    if (a === b) invalidPair();
    // The wrapper sends a ZodError as INVALID with its first message.
    const parsed = relationshipRatingSchema.safeParse(value);
    if (!parsed.success) throw parsed.error;
    const campaignId = ctx.campaign._id;
    return ctx.once("five_banners_relationship", { pair: pairKey(a, b), value }, async () => {
      const current = await readState(ctx, campaignId);
      await writeState(ctx, campaignId, applyRelationship(current, a, b, parsed.data));
      return { previousValue: current.relationships[pairKey(a, b)], newValue: parsed.data };
    });
  },
});

export const setNationSheet = keyedGmMutation({
  args: { nation: nationValidator, assets: v.array(v.string()), problems: v.array(v.string()) },
  returns: sheet,
  handler: async (ctx, { nation, assets, problems }) => {
    assertTrackerFrame(ctx.campaign, FRAME);
    const parsed = nationSheetSchema.safeParse({ assets, problems });
    if (!parsed.success) throw parsed.error;
    const next = parsed.data;
    const campaignId = ctx.campaign._id;
    return ctx.once("five_banners_sheet", { nation, ...next }, async () => {
      const current = await readState(ctx, campaignId);
      await writeState(ctx, campaignId, { ...current, sheets: { ...current.sheets, [nation]: next } });
      return next;
    });
  },
});

/** Shows or hides one relationship, nation sheet or objective from players. */
export const toggleReveal = keyedGmMutation({
  args: {
    target: v.union(
      v.object({ type: v.literal("relationship"), a: nationValidator, b: nationValidator }),
      v.object({ type: v.literal("sheet"), nation: nationValidator }),
      v.object({ type: v.literal("objective"), countdownId: v.id("countdowns") }),
    ),
    revealed: v.boolean(),
  },
  returns: v.object({ revealed: v.boolean() }),
  handler: async (ctx, { target, revealed }) => {
    assertTrackerFrame(ctx.campaign, FRAME);
    if (target.type === "relationship" && target.a === target.b) invalidPair();
    const campaignId = ctx.campaign._id;
    return ctx.once("five_banners_reveal", { target, revealed }, async () => {
      if (target.type === "objective") {
        const row = await ctx.db.get("countdowns", target.countdownId);
        const objective = row && asObjective(row);
        if (!objective || objective.campaignId !== campaignId) throw appError("NOT_FOUND");
        await ctx.db.patch("countdowns", objective._id, { revealed });
        return { revealed };
      }
      const current = await readState(ctx, campaignId);
      const next =
        target.type === "relationship"
          ? { ...current, revealedPairs: setReveal(current.revealedPairs, pairKey(target.a, target.b), revealed) }
          : { ...current, revealedSheets: setReveal(current.revealedSheets, target.nation, revealed) };
      await writeState(ctx, campaignId, next);
      return { revealed };
    });
  },
});

/** Starts a nation's objective countdown: one major (10 steps) and up to two minor (4–6 steps) at a time. */
export const createObjective = keyedGmMutation({
  args: {
    nation: nationValidator,
    kind: v.union(v.literal("objective-major"), v.literal("objective-minor")),
    name: v.string(),
    notes: v.string(),
    steps: v.number(),
  },
  returns: v.object({ countdownId: v.id("countdowns") }),
  handler: async (ctx, raw) => {
    assertTrackerFrame(ctx.campaign, FRAME);
    const parsed = createObjectiveSchema.safeParse(raw);
    if (!parsed.success) throw parsed.error;
    const input = parsed.data;
    const campaignId = ctx.campaign._id;
    return ctx.once("five_banners_objective_create", input, async () => {
      const existing = (await listObjectives(ctx, campaignId)).filter((o) => o.nation === input.nation);
      const limit = objectiveLimitError(existing, input.kind);
      if (limit) throw appError("OBJECTIVE_LIMIT", limit);
      const countdownId = await ctx.db.insert("countdowns", {
        campaignId,
        name: input.name,
        description: input.notes,
        category: "project",
        startingValue: input.steps,
        currentValue: input.steps,
        status: "active",
        consequence: "",
        createdAt: Date.now(),
        ownerKey: nationOwnerKey(input.nation),
        kind: input.kind,
        revealed: false,
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId,
        kind: "countdown",
        action: "create",
        countdownId,
        before: null,
        after: { currentValue: input.steps, status: "active" },
      });
      return { countdownId };
    });
  },
});

/**
 * Ticks an objective down (advance) or up (reverse) as the fiction moves it,
 * pauses, resumes or cancels it, or dismisses a completed one so it leaves
 * the panel. Reopening a completed objective must still fit the nation's limits.
 * The client sends no `campaignId`, so the campaign comes from the countdown and
 * is authorized here through `campaignAccess` (permissionFor); the idempotency
 * key is scoped to the caller.
 */
export const operateObjective = keyedUserMutation({
  args: {
    countdownId: v.id("countdowns"),
    action: v.union(
      v.literal("advance"),
      v.literal("reverse"),
      v.literal("pause"),
      v.literal("resume"),
      v.literal("cancel"),
      v.literal("dismiss"),
    ),
  },
  returns: v.object({ previousValue: v.number(), newValue: v.number(), status: statusValidator }),
  handler: async (ctx, { countdownId, action }) => {
    const row = await ctx.db.get("countdowns", countdownId);
    if (row === null) throw appError("NOT_FOUND");
    const access = await campaignAccess(ctx, ctx.user, row.campaignId, "owner");
    if (access === null) throw appError("NOT_FOUND");
    if (!atLeast(access.permission, "owner")) throw appError("FORBIDDEN");
    assertTrackerFrame(access.campaign, FRAME);
    const objective = asObjective(row);
    if (objective === null) throw appError("NOT_FOUND");
    const campaignId = objective.campaignId;
    return ctx.once("five_banners_objective_operate", { countdownId, action }, async () => {
      const before = { currentValue: objective.currentValue, status: objective.status };
      if (action === "dismiss") {
        if (objective.status !== "completed") {
          throw appError("COUNTDOWN_RULE", "Only a completed objective can be dismissed.");
        }
        await ctx.db.patch("countdowns", countdownId, { status: "cancelled" });
        await recordHistory(ctx, ctx.user._id, {
          campaignId,
          kind: "countdown",
          action,
          countdownId,
          before,
          after: { currentValue: objective.currentValue, status: "cancelled" },
        });
        return { previousValue: objective.currentValue, newValue: objective.currentValue, status: "cancelled" as const };
      }
      // Both expected domain errors (a rule, or a value out of range) become COUNTDOWN_RULE.
      const next = applyRule("COUNTDOWN_RULE", CountdownRangeError, () =>
        applyRule("COUNTDOWN_RULE", CountdownRuleError, () => applyCountdownAction(objective, action)),
      );
      if (next.reopened || (holdsSlot(next.status) && !holdsSlot(objective.status))) {
        const others = (await listObjectives(ctx, campaignId)).filter((o) => o.nation === objective.nation && o._id !== countdownId);
        const limit = objectiveLimitError(others, objective.kind);
        if (limit) throw appError("OBJECTIVE_LIMIT", limit);
      }
      await ctx.db.patch("countdowns", countdownId, {
        currentValue: next.currentValue,
        status: next.status,
        completedAt: next.completedNow ? Date.now() : next.reopened ? undefined : objective.completedAt,
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId,
        kind: "countdown",
        action,
        countdownId,
        before,
        after: { currentValue: next.currentValue, status: next.status },
      });
      return { previousValue: objective.currentValue, newValue: next.currentValue, status: next.status };
    });
  },
});

/**
 * Ends an in-game week: advances the week counter and ticks down one chosen
 * objective per nation ("Each in-game week, pick one countdown for each
 * nation to advance", p.269). A nation may be skipped.
 */
export const advanceWeek = keyedGmMutation({
  args: { picks: v.array(v.object({ nation: nationValidator, objectiveId: v.id("countdowns") })) },
  returns: v.object({
    week: v.number(),
    advanced: v.array(v.id("countdowns")),
    completed: v.array(v.object({ nation: nationValidator, name: v.string() })),
    warning: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { picks }) => {
    assertTrackerFrame(ctx.campaign, FRAME);
    const campaignId = ctx.campaign._id;
    return ctx.once("five_banners_advance_week", { picks }, async () => {
      const objectives = await listObjectives(ctx, campaignId);
      const plan = await applyTrackerRule("WEEK_RULE", () =>
        planWeekAdvance(
          objectives.map((o) => ({ id: o._id, nation: o.nation, name: o.name, status: o.status, currentValue: o.currentValue })),
          picks,
        ),
      );
      const now = Date.now();
      const advanced: Id<"countdowns">[] = [];
      for (const pick of plan.advance) {
        // The plan hands back the string ids it was given (CD7).
        const id = ctx.db.normalizeId("countdowns", pick.id);
        if (id === null) throw new Error(`advanceWeek: planned id ${pick.id} is not a countdown id`);
        const value = pick.currentValue - 1;
        const status = value === 0 ? ("completed" as const) : pick.status;
        await ctx.db.patch("countdowns", id, { currentValue: value, ...(value === 0 ? { status, completedAt: now } : {}) });
        await recordHistory(ctx, ctx.user._id, {
          campaignId,
          kind: "countdown",
          action: "week",
          countdownId: id,
          before: { currentValue: pick.currentValue, status: pick.status },
          after: { currentValue: value, status },
        });
        advanced.push(id);
      }
      const current = await readState(ctx, campaignId);
      const week = current.week + 1;
      await writeState(ctx, campaignId, { ...current, week });
      return {
        week,
        advanced,
        completed: plan.completing.map((o) => ({ nation: o.nation, name: o.name })),
        warning: plan.warning,
      };
    });
  },
});
