import { v, type Infer } from "convex/values";
import * as z from "../src/lib/zod";

import {
  applyCountdownAction,
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_STATUSES,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownForPlayer,
  CountdownRangeError,
  CountdownRuleError,
  MAX_COUNTDOWN_START,
  normaliseCountdownVisibility,
} from "../src/lib/domain/countdowns/index";
import {
  CHASE_LEADS,
  chaseNeedsDecision,
  chaseRowValues,
  COUNTDOWN_MODES,
  manualTickAmount,
  COUNTDOWN_REPEATS,
  COUNTDOWN_REST_MODES,
  startFromDice,
  validateSteps,
  type ChaseRole,
  type ChaseSide,
} from "../src/lib/domain/countdowns/advanced";
import { LEGACY_LONG_TERM_AMOUNT, restTicksOf, type RestTick } from "../src/lib/domain/countdowns/rest-ticks";
import { appError } from "../src/lib/errors/app-error";
import { countdownDetailsSchema, createCountdownSchema, restTickSchema } from "../src/lib/validation/countdowns";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { refuseArchived } from "./lib/archived";
import { campaignQuery, keyedGmMutation, keyedUserMutation } from "./lib/functions";
import { rollDice } from "./lib/dice";
import { applyTick, clearChaseResult } from "./lib/countdownTicks";
import { applyRule } from "./lib/mechanics";
import { atLeast, campaignAccess } from "./lib/permissions";
import {
  countdownChaseResultValidator,
  countdownChaseValidator,
  countdownModeValidator,
  countdownRepeatValidator,
  countdownRestModeValidator,
  countdownRestTickValidator,
  countdownStartDiceValidator,
  countdownStepValidator,
  countdownVisibilityValidator,
} from "./tables/countdowns";
import { recordHistory } from "./tables/history";

const orNull = <T extends Parameters<typeof v.union>[number]>(validator: T) => v.union(validator, v.null());

/**
 * A dashboard countdown as the caller may see it. The GM gets everything; a player gets `null` for each
 * field the GM hid (CV1), and never receives a private countdown.
 * Advanced fields (countdowns-advanced D12): mode, repeat, initialValue, triggerCount and lastTriggeredAt travel with
 * "progress"; armed, startDice, steps and restMode are GM-only (null for players); chase links a pair's rows.
 * For the GM: mode defaults to "standard", armed to false, triggerCount to 0; steps and restMode are set for longTerm only.
 * Rest ticks (rest-ticks RT1): onLongRest / onShortRest are the effective settings (`restTicksOf`), GM-only (null for
 * players and when off). Transition for installed phone builds: on a long-term row `armed` (= has a long-rest setting)
 * and `restMode` (= its mode, "auto" when off) are derived from the effective onLongRest; both go at the narrow step.
 */
const countdownView = v.object({
  _id: v.id("countdowns"),
  name: v.union(v.string(), v.null()),
  description: v.union(v.string(), v.null()),
  category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c)), v.null()),
  startingValue: v.union(v.number(), v.null()),
  currentValue: v.union(v.number(), v.null()),
  status: v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s))),
  consequence: v.union(v.string(), v.null()),
  completedAt: v.union(v.number(), v.null()),
  visibility: countdownVisibilityValidator,
  mode: orNull(v.union(...COUNTDOWN_MODES.map((m) => v.literal(m)))),
  armed: orNull(v.boolean()),
  repeat: orNull(v.union(...COUNTDOWN_REPEATS.map((r) => v.literal(r)))),
  initialValue: orNull(v.number()),
  startDice: orNull(countdownStartDiceValidator),
  triggerCount: orNull(v.number()),
  lastTriggeredAt: orNull(v.number()),
  chase: orNull(countdownChaseValidator),
  steps: orNull(v.array(countdownStepValidator)),
  restMode: orNull(v.union(...COUNTDOWN_REST_MODES.map((r) => v.literal(r)))),
  /** A chase row: the GM's call when both sides reached 0 together (K6); travels with "progress". */
  chaseResult: orNull(countdownChaseResultValidator),
  /** GM only (rest-ticks RT1): "On long rest" / "On short rest"; null when off. */
  onLongRest: orNull(countdownRestTickValidator),
  onShortRest: orNull(countdownRestTickValidator),
});

export type CountdownView = Infer<typeof countdownView>;

const toClient = (c: Doc<"countdowns">) => {
  const rests = restTicksOf(c);
  const longTerm = c.mode === "longTerm";
  return {
    _id: c._id,
    name: c.name,
    description: c.description,
    category: c.category,
    startingValue: c.startingValue,
    currentValue: c.currentValue,
    status: c.status,
    consequence: c.consequence,
    completedAt: c.completedAt ?? null,
    visibility: c.visibility ?? COUNTDOWN_VISIBILITY_PRESETS.public,
    mode: c.mode ?? "standard",
    armed: longTerm ? rests.long !== null : (c.armed ?? false),
    repeat: c.repeat ?? null,
    initialValue: c.initialValue ?? null,
    startDice: c.startDice ?? null,
    triggerCount: c.triggerCount ?? 0,
    lastTriggeredAt: c.lastTriggeredAt ?? null,
    chase: c.chase ?? null,
    steps: longTerm ? (c.steps ?? []) : null,
    restMode: longTerm ? (rests.long?.mode ?? "auto") : null,
    chaseResult: c.chaseResult ?? null,
    onLongRest: rests.long,
    onShortRest: rests.short,
  };
};

/**
 * The campaign's countdowns that are not cancelled, oldest first. Countdowns are core; players see them
 * read-only, without private countdowns and with hidden fields blanked here on the server.
 */
export const listByCampaign = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(countdownView),
  handler: async (ctx): Promise<CountdownView[]> => {
    // Frame-owned countdowns (objectives, Lycanthropy…) belong to their tracker panels, so
    // the index range reads only the dashboard's own (ownerKey unset); a campaign has few.
    const rows = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", ctx.campaign._id).eq("ownerKey", undefined))
      .collect();
    const views = rows.filter((c) => c.status !== "cancelled").map(toClient);
    if (atLeast(ctx.permission, "owner")) return views;
    // Rest settings are GM-only like `armed` (D12); countdownForPlayer doesn't know them, so they are blanked here.
    return views.flatMap((c) => {
      const seen = countdownForPlayer(c, c.visibility);
      return seen === null ? [] : [{ ...seen, onLongRest: null, onShortRest: null }];
    });
  },
});

/**
 * Creates a dashboard countdown. GM only. Without the advanced args this is today's countdown (unarmed standard, D4).
 * `startDice` instead of `startingValue` is rolled here (R5, D8), capped 1..MAX_COUNTDOWN_START, and kept as the
 * start every reset reuses (Q4); `repeat` keeps the first start as `initialValue`; `steps` belong to a longTerm
 * countdown (D10). `onLongRest` / `onShortRest` (rest-ticks RT1) on any type. Compatibility for installed phone builds
 * (goes at the narrow step): a long-term `armed: true` + `restMode` without `onLongRest` is stored as `onLongRest`
 * (fixed 1, that mode, absent = auto); neither `armed` nor `restMode` is stored on a long-term row. Shape errors are
 * INVALID (countdownDetailsSchema).
 */
export const create = keyedGmMutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c))),
    /** Exactly one of startingValue and startDice. */
    startingValue: v.optional(v.number()),
    consequence: v.string(),
    /** Who sees it; absent = everything public. */
    visibility: v.optional(countdownVisibilityValidator),
    mode: v.optional(countdownModeValidator),
    repeat: v.optional(countdownRepeatValidator),
    startDice: v.optional(countdownStartDiceValidator),
    /** Ticks by itself on counted action rolls; absent = unarmed. Legacy on longTerm: "on long rests" (see above). */
    armed: v.optional(v.boolean()),
    steps: v.optional(v.array(countdownStepValidator)),
    /** @deprecated longTerm only; see above. */
    restMode: v.optional(countdownRestModeValidator),
    onLongRest: v.optional(countdownRestTickValidator),
    onShortRest: v.optional(countdownRestTickValidator),
  },
  returns: v.object({ countdownId: v.id("countdowns") }),
  handler: async (ctx, { visibility, ...raw }) => {
    const { startingValue: fixed, startDice, steps, armed, restMode, onLongRest, ...rest } = countdownDetailsSchema.parse(raw);
    const longTerm = rest.mode === "longTerm";
    const legacyLong: RestTick | undefined = longTerm && armed === true ? { amount: LEGACY_LONG_TERM_AMOUNT, mode: restMode ?? "auto" } : undefined;
    const input = {
      ...rest,
      ...(!longTerm && armed !== undefined ? { armed } : {}),
      ...((onLongRest ?? legacyLong) !== undefined ? { onLongRest: onLongRest ?? legacyLong } : {}),
    };
    const campaignId = ctx.campaign._id;
    const shown = visibility === undefined ? undefined : normaliseCountdownVisibility(visibility);
    return ctx.once("countdown_create", { ...input, startingValue: fixed, startDice, steps, visibility: shown }, async () => {
      // The schema guarantees exactly one of the two; the server rolls every die.
      const startingValue = fixed ?? startFromDice(rollDice(startDice?.count ?? 1, startDice?.sides ?? 6), MAX_COUNTDOWN_START);
      const track = steps === undefined ? undefined : applyRule("INVALID", CountdownRuleError, () => validateSteps(startingValue, steps));
      const countdownId = await ctx.db.insert("countdowns", {
        ...input,
        campaignId,
        startingValue,
        currentValue: startingValue,
        status: "active",
        createdAt: Date.now(),
        visibility: shown,
        ...(startDice !== undefined ? { startDice } : {}),
        ...(input.repeat !== undefined ? { initialValue: startingValue } : {}),
        ...(track !== undefined ? { steps: track } : {}),
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId,
        kind: "countdown",
        action: "create",
        countdownId,
        before: null,
        after: { currentValue: startingValue, status: "active" },
      });
      return { countdownId };
    });
  },
});

/** The party's track of a chase is always this row's name; the rivals' row carries the name the GM typed. */
export const CHASE_PARTY_NAME = "The party";

const CHASE_LEAD_SIZES = Object.keys(CHASE_LEADS) as (keyof typeof CHASE_LEADS)[];

/** createChase's details (countdowns-advanced K3): the rivals' name, notes, the shared start 2..20 and a lead. */
const chaseSchema = createCountdownSchema.pick({ name: true, description: true }).extend({
  startingValue: z
    .number("Pick a die size.")
    .int("The start must be a whole number.")
    .min(2, "A chase starts at 2 or more.")
    .max(MAX_COUNTDOWN_START, `A chase starts at ${MAX_COUNTDOWN_START} at most.`),
  lead: z.union([z.enum(CHASE_LEAD_SIZES), z.number().int("The lead must be a whole number.").min(1, "The lead must be at least 1.")]),
});

/** What happens when each side reaches 0 (CB p.163): the pursuers catch up, or the escapee gets away. */
function chaseConsequence(side: ChaseSide, role: ChaseRole, rivals: string): string {
  const pursuer = (side === "party") === (role === "pursuing");
  if (side === "party") return pursuer ? `The party catches ${rivals}` : "The party gets away";
  return pursuer ? `${rivals} catches the party` : `${rivals} gets away`;
}

/**
 * Starts a chase (CB p.163, countdowns-advanced D9): two linked dashboard countdowns with the same start N, the
 * pursuers' at N and the escapee's at N - lead (small 1, decent 3, substantial 5, or a typed 1..N-1). The PCs' row is a
 * progress countdown, the rivals' a consequence countdown, whether the PCs pursue or escape, so one counted roll ticks
 * both by the Dynamic Countdown Advancement table (K1). Both rows share the visibility and the armed flag; chase rows
 * never repeat. GM only; INVALID for a lead not below N or a start outside 2..20. Two history "create" rows.
 */
export const createChase = keyedGmMutation({
  args: {
    /** The rivals: who the party chases or flees ("The thief"). */
    name: v.string(),
    description: v.string(),
    /** The die size both countdowns share (2..20). */
    startingValue: v.number(),
    lead: v.union(...CHASE_LEAD_SIZES.map((l) => v.literal(l)), v.number()),
    party: v.union(v.literal("pursuing"), v.literal("escaping")),
    visibility: v.optional(countdownVisibilityValidator),
    /** Ticks by itself on counted action rolls; absent = unarmed (as `create`, D4). */
    armed: v.optional(v.boolean()),
    /** Rest ticks (rest-ticks RT1), shared by the pair: both rows store them. */
    onLongRest: v.optional(countdownRestTickValidator),
    onShortRest: v.optional(countdownRestTickValidator),
  },
  returns: v.object({ partyId: v.id("countdowns"), rivalsId: v.id("countdowns") }),
  handler: async (ctx, { party: role, visibility, armed, onLongRest: long, onShortRest: short, ...raw }) => {
    const { name, description, startingValue, lead } = chaseSchema.parse(raw);
    const onLongRest = long === undefined ? undefined : restTickSchema.parse(long);
    const onShortRest = short === undefined ? undefined : restTickSchema.parse(short);
    const values = applyRule("INVALID", CountdownRuleError, () => chaseRowValues(startingValue, lead, role));
    const shown = visibility === undefined ? undefined : normaliseCountdownVisibility(visibility);
    const campaignId = ctx.campaign._id;
    const request = { name, description, startingValue, lead, role, visibility: shown, armed, onLongRest, onShortRest };
    return ctx.once("countdown_chase", request, async () => {
      const now = Date.now();
      const row = (side: ChaseSide) => ({
        campaignId,
        name: side === "party" ? CHASE_PARTY_NAME : name,
        description,
        category: "threat" as const,
        startingValue,
        currentValue: values[side],
        status: "active" as const,
        consequence: chaseConsequence(side, role, name),
        createdAt: now,
        visibility: shown,
        mode: side === "party" ? ("progress" as const) : ("consequence" as const),
        armed: armed ?? false,
        ...(onLongRest !== undefined ? { onLongRest } : {}),
        ...(onShortRest !== undefined ? { onShortRest } : {}),
      });
      const partyId = await ctx.db.insert("countdowns", row("party"));
      const rivalsId = await ctx.db.insert("countdowns", { ...row("rivals"), chase: { partnerId: partyId, side: "rivals", party: role } });
      await ctx.db.patch("countdowns", partyId, { chase: { partnerId: rivalsId, side: "party", party: role } });
      for (const [countdownId, side] of [
        [partyId, "party"],
        [rivalsId, "rivals"],
      ] as const) {
        await recordHistory(ctx, ctx.user._id, {
          campaignId,
          kind: "countdown",
          action: "create",
          countdownId,
          before: null,
          after: { currentValue: values[side], status: "active" },
        });
      }
      return { partyId, rivalsId };
    });
  },
});

/** A chase row's partner (D9) when it is a dashboard countdown of the same campaign, else null. */
async function chasePartner(ctx: MutationCtx, countdown: Doc<"countdowns">): Promise<Doc<"countdowns"> | null> {
  const partnerId: Id<"countdowns"> | undefined = countdown.chase?.partnerId;
  if (partnerId === undefined) return null;
  const partner = await ctx.db.get("countdowns", partnerId);
  if (partner === null || partner.campaignId !== countdown.campaignId || partner.ownerKey !== undefined) return null;
  return partner;
}

/**
 * Changes who sees a dashboard countdown (private / public with hidden fields / public). GM only. A chase pair shares
 * one visibility (D9, D12): its partner row changes too.
 */
export const setVisibility = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), visibility: countdownVisibilityValidator },
  returns: v.object({ visibility: countdownVisibilityValidator }),
  handler: async (ctx, { countdownId, visibility }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    // Frame-owned countdowns keep their own `revealed` flag; another campaign's countdown is not found.
    if (countdown === null || countdown.campaignId !== ctx.campaign._id || countdown.ownerKey !== undefined) {
      throw appError("NOT_FOUND");
    }
    const next = normaliseCountdownVisibility(visibility);
    return ctx.once("countdown_visibility", { countdownId, visibility: next }, async () => {
      await ctx.db.patch("countdowns", countdownId, { visibility: next });
      const partner = await chasePartner(ctx, countdown);
      if (partner !== null) await ctx.db.patch("countdowns", partner._id, { visibility: next });
      return { visibility: next };
    });
  },
});

/**
 * Arms or disarms a dashboard countdown (countdowns-advanced D4): an armed countdown ticks by itself on counted action
 * rolls. GM only; NOT_FOUND for a frame-owned or another campaign's countdown, COUNTDOWN_RULE for a cancelled one. A
 * chase row arms its partner too (D9). Arming changes no value, so it writes no history row.
 * Compatibility shim for installed phone builds (rest-ticks RT1; the long-term branch goes at the narrow step): on a
 * long-term countdown, which never ticks on rolls, "armed" meant "ticks on long rests", so arming sets `onLongRest`
 * (the current setting, else fixed 1 Automatic) and disarming clears it; only `onLongRest` is written (and the legacy
 * `armed` / `restMode` unset).
 */
export const setArmed = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), armed: v.boolean() },
  returns: v.object({ armed: v.boolean() }),
  handler: async (ctx, { countdownId, armed }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    if (countdown === null || countdown.campaignId !== ctx.campaign._id || countdown.ownerKey !== undefined) {
      throw appError("NOT_FOUND");
    }
    if (countdown.status === "cancelled") throw appError("COUNTDOWN_RULE", "A cancelled countdown can't be armed.");
    if (countdown.mode === "longTerm") {
      return ctx.once("countdown_armed", { countdownId, armed }, async () => {
        const onLongRest = armed ? (restTicksOf(countdown).long ?? { amount: LEGACY_LONG_TERM_AMOUNT, mode: "auto" as const }) : undefined;
        await ctx.db.patch("countdowns", countdownId, { onLongRest, armed: undefined, restMode: undefined });
        return { armed };
      });
    }
    return ctx.once("countdown_armed", { countdownId, armed }, async () => {
      await ctx.db.patch("countdowns", countdownId, { armed });
      const partnerId = countdown.chase?.partnerId;
      const partner = partnerId === undefined ? null : await ctx.db.get("countdowns", partnerId);
      if (partner !== null && partner.campaignId === countdown.campaignId && partner.ownerKey === undefined && partner.status !== "cancelled") {
        await ctx.db.patch("countdowns", partner._id, { armed });
      }
      return { armed };
    });
  },
});

const restTickRestValidator = v.union(v.literal("long"), v.literal("short"));

/**
 * Sets one rest setting of a dashboard countdown (plan rest-ticks, RT1): `rest` "long" = "On long rest" (a finished
 * long rest), "short" = "On short rest" (a short rest, and an interrupted long rest, Q1); `setting` the amount and
 * Automatic / Reminder, or null = off. Any countdown type. A chase pair shares the setting (D9): its partner row changes
 * too. On a long-term row the long-rest setting replaces the legacy `armed` / `restMode`, which are unset. GM only;
 * NOT_FOUND for a frame-owned or another campaign's countdown, COUNTDOWN_RULE for a cancelled one, INVALID for a fixed
 * amount outside 1..20. Changes no value, so no history row.
 */
export const setRestTick = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), rest: restTickRestValidator, setting: v.union(countdownRestTickValidator, v.null()) },
  returns: v.object({ rest: restTickRestValidator, setting: v.union(countdownRestTickValidator, v.null()) }),
  handler: async (ctx, { countdownId, rest, setting }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    if (countdown === null || countdown.campaignId !== ctx.campaign._id || countdown.ownerKey !== undefined) {
      throw appError("NOT_FOUND");
    }
    if (countdown.status === "cancelled") throw appError("COUNTDOWN_RULE", "A cancelled countdown can't be edited.");
    const next = setting === null ? null : restTickSchema.parse(setting);
    return ctx.once("countdown_rest_tick_setting", { countdownId, rest, setting: next }, async () => {
      const value = next ?? undefined;
      const patch = rest === "long" ? { onLongRest: value } : { onShortRest: value };
      const legacy = rest === "long" && countdown.mode === "longTerm" ? { armed: undefined, restMode: undefined } : {};
      await ctx.db.patch("countdowns", countdownId, { ...patch, ...legacy });
      const partner = await chasePartner(ctx, countdown);
      if (partner !== null && partner.status !== "cancelled") await ctx.db.patch("countdowns", partner._id, patch);
      return { rest, setting: next };
    });
  },
});

/**
 * The GM's call on a chase whose two sides both reached 0 (a success with Fear on two sides at 1, say): "caught" or
 * "escaped" (K6, dcm-bxp.73; the book doesn't say who wins, the user answered "gm decides"). Stored on both rows; the
 * card then shows that banner, players see "The GM is deciding" until then. GM only: NOT_FOUND for a frame-owned or
 * another campaign's countdown; COUNTDOWN_RULE for a row that isn't part of a chase or a chase that isn't at 0 on both
 * sides. The GM may change the call; a side that reopens clears it. One history row "decide" per row (the values don't
 * move; the row records who called it), with no undo path, like the other manual countdown operations.
 */
export const decideChase = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), result: countdownChaseResultValidator },
  returns: v.object({ result: countdownChaseResultValidator }),
  handler: async (ctx, { countdownId, result }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    if (countdown === null || countdown.campaignId !== ctx.campaign._id || countdown.ownerKey !== undefined) {
      throw appError("NOT_FOUND");
    }
    const partner = await chasePartner(ctx, countdown);
    if (partner === null) throw appError("COUNTDOWN_RULE", "Only a chase needs that call.");
    const [party, rivals] = countdown.chase?.side === "party" ? [countdown, partner] : [partner, countdown];
    if (!chaseNeedsDecision({ party, rivals })) throw appError("COUNTDOWN_RULE", "Both sides must have reached 0.");
    return ctx.once("countdown_chase_decide", { countdownId, result }, async () => {
      for (const row of [party, rivals]) {
        await ctx.db.patch("countdowns", row._id, { chaseResult: result });
        await recordHistory(ctx, ctx.user._id, {
          campaignId: row.campaignId,
          kind: "countdown",
          action: "decide",
          countdownId: row._id,
          before: { currentValue: row.currentValue, status: row.status },
          after: { currentValue: row.currentValue, status: row.status },
        });
      }
      return { result };
    });
  },
});

/** Writes a move `applyCountdownAction` computed (no tick path) and its history row; returns the new value and status. */
async function moveByRules(
  ctx: MutationCtx & { user: Doc<"users"> },
  countdown: Doc<"countdowns">,
  action: string,
  next: ReturnType<typeof applyCountdownAction>,
): Promise<{ currentValue: number; status: Doc<"countdowns">["status"] }> {
  await ctx.db.patch("countdowns", countdown._id, {
    currentValue: next.currentValue,
    status: next.status,
    completedAt: next.completedNow ? Date.now() : next.reopened ? undefined : countdown.completedAt,
  });
  await recordHistory(ctx, ctx.user._id, {
    campaignId: countdown.campaignId,
    kind: "countdown",
    action,
    countdownId: countdown._id,
    before: { currentValue: countdown.currentValue, status: countdown.status },
    after: { currentValue: next.currentValue, status: next.status },
  });
  return { currentValue: next.currentValue, status: next.status };
}

/**
 * advance / reverse / pause / resume / cancel, or a correction by `amount`,
 * following the legacy SQL rules in `applyCountdownAction`. GM only.
 * A Tick -1 or a downward correction then moves the countdown through K0's `applyTick` (source "advance" /
 * "correction", no entryId: nothing for a roll's undo), so a manual tick to 0 triggers, resets a repeating countdown
 * and writes the GM's notice exactly like a roll (countdowns-advanced D7, Q2); see `manualTickAmount`.
 * The client sends no `campaignId`, so the campaign comes from the countdown and
 * is authorized here through `campaignAccess` (permissionFor); the idempotency
 * key is scoped to the caller.
 */
export const operate = keyedUserMutation({
  args: {
    countdownId: v.id("countdowns"),
    action: v.union(
      v.literal("advance"),
      v.literal("reverse"),
      v.literal("pause"),
      v.literal("resume"),
      v.literal("cancel"),
      v.literal("correction"),
    ),
    amount: v.optional(v.number()),
  },
  returns: v.object({
    previousValue: v.number(),
    newValue: v.number(),
    status: v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s))),
  }),
  handler: async (ctx, { countdownId, action, amount }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    // Frame-owned countdowns (objectives, Lycanthropy…) follow their tracker's rules.
    if (countdown === null || countdown.ownerKey !== undefined) throw appError("NOT_FOUND");
    const access = await campaignAccess(ctx, ctx.user, countdown.campaignId, "owner");
    if (access === null) throw appError("NOT_FOUND");
    if (!atLeast(access.permission, "owner")) throw appError("FORBIDDEN");
    refuseArchived(access.campaign); // Q9 a (dcm-jh6d.64)
    if ((action === "correction") !== (amount !== undefined)) {
      throw appError("INVALID", "Only a correction takes an amount.");
    }
    // A chase is cancelled as a pair (D9), also once one side has reached 0 (completed), so the ended chase leaves the
    // board in one click; a row that doesn't belong to a chase keeps today's rule (E1).
    if (action === "cancel" && countdown.chase !== undefined) {
      if (countdown.status === "cancelled") throw appError("COUNTDOWN_RULE", "Cancelled countdowns cannot be changed.");
      return ctx.once("countdown_operate", { countdownId, action, amount }, async () => {
        const partner = await chasePartner(ctx, countdown);
        for (const row of [countdown, partner]) {
          if (row === null || row.status === "cancelled") continue;
          await ctx.db.patch("countdowns", row._id, { status: "cancelled" });
          await recordHistory(ctx, ctx.user._id, {
            campaignId: row.campaignId,
            kind: "countdown",
            action: "cancel",
            countdownId: row._id,
            before: { currentValue: row.currentValue, status: row.status },
            after: { currentValue: row.currentValue, status: "cancelled" },
          });
        }
        return { previousValue: countdown.currentValue, newValue: countdown.currentValue, status: "cancelled" as const };
      });
    }
    return ctx.once("countdown_operate", { countdownId, action, amount }, async () => {
      // Both expected domain errors (a rule, or a value out of range) become COUNTDOWN_RULE. The legacy rules check
      // every move first, also the ones that then go through applyTick, so a refused move is refused as before (E1).
      const next = applyRule("COUNTDOWN_RULE", CountdownRangeError, () =>
        applyRule("COUNTDOWN_RULE", CountdownRuleError, () => applyCountdownAction(countdown, action, amount ?? 0)),
      );
      const tick = manualTickAmount(countdown, action, amount ?? 0);
      if (tick > 0) {
        const source = action === "correction" ? "correction" : "advance";
        const ticked = await applyTick(ctx, countdown, tick, { source, actorId: ctx.user._id });
        return { previousValue: countdown.currentValue, newValue: ticked.after.currentValue, status: ticked.after.status };
      }
      // Nothing triggers while paused (K6, dcm-bxp.74): a countdown corrected to 0 while paused stays paused at 0, and
      // Resume brings its trigger now (a repeating one resets, one that doesn't repeat completes), through applyTick so a
      // trigger writes its history row and GM notice like any other.
      const result =
        action === "resume" && countdown.currentValue === 0
          ? (await applyTick(ctx, countdown, 0, { source: "resume", actorId: ctx.user._id }, { resume: true })).after
          : await moveByRules(ctx, countdown, action, next);
      if (countdown.chase !== undefined && countdown.currentValue === 0 && result.currentValue > 0) await clearChaseResult(ctx, countdown);
      // A chase pauses and resumes as a pair (D9): the partner follows when its own state allows it (a side that already
      // reached 0 stays completed).
      if (action === "pause" || action === "resume") {
        const partner = await chasePartner(ctx, countdown);
        const from = action === "pause" ? "active" : "paused";
        if (partner !== null && partner.status === from) {
          if (action === "resume" && partner.currentValue === 0) {
            await applyTick(ctx, partner, 0, { source: "resume", actorId: ctx.user._id }, { resume: true });
          } else {
            const status = action === "pause" ? "paused" : "active";
            await ctx.db.patch("countdowns", partner._id, { status });
            await recordHistory(ctx, ctx.user._id, {
              campaignId: partner.campaignId,
              kind: "countdown",
              action,
              countdownId: partner._id,
              before: { currentValue: partner.currentValue, status: partner.status },
              after: { currentValue: partner.currentValue, status },
            });
          }
        }
      }
      return { previousValue: countdown.currentValue, newValue: result.currentValue, status: result.status };
    });
  },
});
