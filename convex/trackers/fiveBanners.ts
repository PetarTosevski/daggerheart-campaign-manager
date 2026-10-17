import { ConvexError, v } from "convex/values";
import type { z } from "zod";

import { applyCountdownAction } from "../../src/lib/domain/countdowns/index";
import {
  createObjectiveSchema,
  FIVE_BANNERS_FRAME_ID,
  FIVE_BANNERS_KEY,
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
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { loadCampaign, loadGmCampaign } from "../lib/access";
import { requireUser } from "../lib/auth";
import { ruleError } from "../lib/mechanics";
import { campaignScope, withIdempotency } from "../lib/operations";
import { readTracker, writeTracker } from "../lib/trackers";

const nationValidator = v.union(...NATION_IDS.map((n) => v.literal(n)));

type Objective = Doc<"countdowns"> & { kind: ObjectiveKind; nation: NationId };

async function readState(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<FiveBannersState> {
  const raw = await readTracker<unknown>(ctx, campaignId, FIVE_BANNERS_KEY);
  try {
    return loadState(raw);
  } catch {
    throw new ConvexError("TRACKER_CORRUPT");
  }
}

/** The campaign's objective countdowns (any status), oldest first. */
async function listObjectives(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Objective[]> {
  const rows = await ctx.db
    .query("countdowns")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
  return rows.flatMap((row) => {
    const nation = nationFromOwnerKey(row.ownerKey);
    return nation && isObjectiveKind(row.kind) ? [{ ...row, kind: row.kind, nation }] : [];
  });
}

/** GM-only and frame-gated: every Five Banners mutation starts here. */
async function loadFiveBannersGm(ctx: MutationCtx, campaignId: Id<"campaigns">) {
  const user = await requireUser(ctx);
  const campaign = await loadGmCampaign(ctx, user, campaignId);
  if (campaign.frameId !== FIVE_BANNERS_FRAME_ID) throw new ConvexError("MECHANIC_DISABLED");
  return { user, campaign };
}

async function loadObjective(ctx: MutationCtx, countdownId: Id<"countdowns">): Promise<Objective> {
  const row = await ctx.db.get(countdownId);
  const nation = nationFromOwnerKey(row?.ownerKey);
  if (row === null || nation === null || !isObjectiveKind(row.kind)) throw new ConvexError("NOT_FOUND");
  return { ...row, kind: row.kind, nation };
}

function invalid(error: z.ZodError): never {
  throw new ConvexError({ code: "INVALID", message: error.issues[0]?.message ?? "Invalid input." });
}

/**
 * The Five Banners tracker as this viewer may see it: the GM gets everything
 * with reveal flags; a player only the week counter and revealed items.
 * Null for campaigns in other frames.
 */
export const state = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    if (campaign.frameId !== FIVE_BANNERS_FRAME_ID) return null;
    const gm = role === "gm";
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

    return { role, week: data.week, relationships, nations };
  },
});

export const setRelationship = mutation({
  args: { campaignId: v.id("campaigns"), a: nationValidator, b: nationValidator, value: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, a, b, value, idempotencyKey }) => {
    const { user } = await loadFiveBannersGm(ctx, campaignId);
    if (a === b) throw new ConvexError({ code: "INVALID", message: "Pick two different nations." });
    const parsed = relationshipRatingSchema.safeParse(value);
    if (!parsed.success) invalid(parsed.error);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "five_banners_relationship",
        request: { pair: pairKey(a, b), value },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const current = await readState(ctx, campaignId);
        await writeTracker(ctx, campaignId, FIVE_BANNERS_KEY, applyRelationship(current, a, b, value));
        return { previousValue: current.relationships[pairKey(a, b)], newValue: value };
      },
    );
  },
});

export const setNationSheet = mutation({
  args: {
    campaignId: v.id("campaigns"),
    nation: nationValidator,
    assets: v.array(v.string()),
    problems: v.array(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, nation, assets, problems, idempotencyKey }) => {
    const { user } = await loadFiveBannersGm(ctx, campaignId);
    const parsed = nationSheetSchema.safeParse({ assets, problems });
    if (!parsed.success) invalid(parsed.error);
    const sheet = parsed.data;
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "five_banners_sheet",
        request: { nation, ...sheet },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const current = await readState(ctx, campaignId);
        await writeTracker(ctx, campaignId, FIVE_BANNERS_KEY, { ...current, sheets: { ...current.sheets, [nation]: sheet } });
        return sheet;
      },
    );
  },
});

/** Shows or hides one relationship, nation sheet or objective from players. */
export const toggleReveal = mutation({
  args: {
    campaignId: v.id("campaigns"),
    target: v.union(
      v.object({ type: v.literal("relationship"), a: nationValidator, b: nationValidator }),
      v.object({ type: v.literal("sheet"), nation: nationValidator }),
      v.object({ type: v.literal("objective"), countdownId: v.id("countdowns") }),
    ),
    revealed: v.boolean(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, target, revealed, idempotencyKey }) => {
    const { user } = await loadFiveBannersGm(ctx, campaignId);
    if (target.type === "relationship" && target.a === target.b) {
      throw new ConvexError({ code: "INVALID", message: "Pick two different nations." });
    }
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "five_banners_reveal",
        request: { target, revealed },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        if (target.type === "objective") {
          const objective = await loadObjective(ctx, target.countdownId);
          if (objective.campaignId !== campaignId) throw new ConvexError("NOT_FOUND");
          await ctx.db.patch(objective._id, { revealed });
          return { revealed };
        }
        const current = await readState(ctx, campaignId);
        const next =
          target.type === "relationship"
            ? { ...current, revealedPairs: setReveal(current.revealedPairs, pairKey(target.a, target.b), revealed) }
            : { ...current, revealedSheets: setReveal(current.revealedSheets, target.nation, revealed) };
        await writeTracker(ctx, campaignId, FIVE_BANNERS_KEY, next);
        return { revealed };
      },
    );
  },
});

/** Starts a nation's objective countdown: one major (10 steps) and up to two minor (4–6 steps) at a time. */
export const createObjective = mutation({
  args: {
    campaignId: v.id("campaigns"),
    nation: nationValidator,
    kind: v.union(v.literal("objective-major"), v.literal("objective-minor")),
    name: v.string(),
    notes: v.string(),
    steps: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, idempotencyKey, ...raw }) => {
    const { user } = await loadFiveBannersGm(ctx, campaignId);
    const parsed = createObjectiveSchema.safeParse(raw);
    if (!parsed.success) invalid(parsed.error);
    const input = parsed.data;
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "five_banners_objective_create",
        request: input,
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const existing = (await listObjectives(ctx, campaignId)).filter((o) => o.nation === input.nation);
        const limit = objectiveLimitError(existing, input.kind);
        if (limit) throw new ConvexError({ code: "OBJECTIVE_LIMIT", message: limit });
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
        return { countdownId };
      },
    );
  },
});

/**
 * Ticks an objective down (advance) or up (reverse) as the fiction moves it,
 * pauses, resumes or cancels it, or dismisses a completed one so it leaves
 * the panel. Reopening a completed objective must still fit the nation's limits.
 */
export const operateObjective = mutation({
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
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { countdownId, action, idempotencyKey }) => {
    const row = await ctx.db.get(countdownId);
    if (row === null) throw new ConvexError("NOT_FOUND");
    const { user } = await loadFiveBannersGm(ctx, row.campaignId);
    const objective = await loadObjective(ctx, countdownId);
    const campaignId = objective.campaignId;
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "five_banners_objective_operate",
        request: { countdownId, action },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        if (action === "dismiss") {
          if (objective.status !== "completed") {
            throw new ConvexError({ code: "COUNTDOWN_RULE", message: "Only a completed objective can be dismissed." });
          }
          await ctx.db.patch(countdownId, { status: "cancelled" });
          return { previousValue: objective.currentValue, newValue: objective.currentValue, status: "cancelled" as const };
        }
        let next: ReturnType<typeof applyCountdownAction>;
        try {
          next = applyCountdownAction(objective, action);
        } catch (error) {
          ruleError("COUNTDOWN_RULE", error);
        }
        if (next.reopened || (holdsSlot(next.status) && !holdsSlot(objective.status))) {
          const others = (await listObjectives(ctx, campaignId)).filter(
            (o) => o.nation === objective.nation && o._id !== countdownId,
          );
          const limit = objectiveLimitError(others, objective.kind);
          if (limit) throw new ConvexError({ code: "OBJECTIVE_LIMIT", message: limit });
        }
        await ctx.db.patch(countdownId, {
          currentValue: next.currentValue,
          status: next.status,
          completedAt: next.completedNow ? Date.now() : next.reopened ? undefined : objective.completedAt,
        });
        return { previousValue: objective.currentValue, newValue: next.currentValue, status: next.status };
      },
    );
  },
});

/**
 * Ends an in-game week: advances the week counter and ticks down one chosen
 * objective per nation ("Each in-game week, pick one countdown for each
 * nation to advance", p.269). A nation may be skipped.
 */
export const advanceWeek = mutation({
  args: {
    campaignId: v.id("campaigns"),
    picks: v.array(v.object({ nation: nationValidator, objectiveId: v.id("countdowns") })),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, picks, idempotencyKey }) => {
    const { user } = await loadFiveBannersGm(ctx, campaignId);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "five_banners_advance_week",
        request: { picks },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const objectives = await listObjectives(ctx, campaignId);
        let plan: ReturnType<typeof planWeekAdvance>;
        try {
          plan = planWeekAdvance(
            objectives.map((o) => ({ id: o._id, nation: o.nation, name: o.name, status: o.status, currentValue: o.currentValue })),
            picks,
          );
        } catch (error) {
          ruleError("WEEK_RULE", error);
        }
        const now = Date.now();
        for (const pick of plan.advance) {
          const value = pick.currentValue - 1;
          await ctx.db.patch(pick.id as Id<"countdowns">, {
            currentValue: value,
            ...(value === 0 ? { status: "completed" as const, completedAt: now } : {}),
          });
        }
        const current = await readState(ctx, campaignId);
        const week = current.week + 1;
        await writeTracker(ctx, campaignId, FIVE_BANNERS_KEY, { ...current, week });
        return {
          week,
          advanced: plan.advance.map((o) => o.id),
          completed: plan.completing.map((o) => ({ nation: o.nation, name: o.name })),
          warning: plan.warning,
        };
      },
    );
  },
});
