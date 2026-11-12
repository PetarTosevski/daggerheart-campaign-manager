import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_HIDEABLE_FIELDS,
  COUNTDOWN_STATUSES,
} from "../../src/lib/domain/countdowns/index";
import {
  COUNTDOWN_DICE_SIDES,
  COUNTDOWN_MODES,
  COUNTDOWN_REPEATS,
  COUNTDOWN_REST_MODES,
  CHASE_RESULTS,
} from "../../src/lib/domain/countdowns/advanced";

/** Who sees a dashboard countdown (CV1): private, or public with some fields hidden from players. */
export const countdownVisibilityValidator = v.union(
  v.object({ mode: v.literal("private") }),
  v.object({ mode: v.literal("public"), hidden: v.array(v.union(...COUNTDOWN_HIDEABLE_FIELDS.map((f) => v.literal(f)))) }),
);

const statusValidator = v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s)));

/** standard | progress | consequence | longTerm (countdowns-advanced D1); absent = standard. */
export const countdownModeValidator = v.union(...COUNTDOWN_MODES.map((m) => v.literal(m)));
/** loop | increasing | decreasing (R6, R7); absent = no repeat. */
export const countdownRepeatValidator = v.union(...COUNTDOWN_REPEATS.map((r) => v.literal(r)));
/** A rest setting's mode (Q3; rest-ticks RT1): auto (ticks by itself) | remind (the GM gets "Tick X?"). */
export const countdownRestModeValidator = v.union(...COUNTDOWN_REST_MODES.map((r) => v.literal(r)));
const diceSidesValidator = v.union(...COUNTDOWN_DICE_SIDES.map((n) => v.literal(n)));
/**
 * How much a rest ticks a countdown (plan rest-ticks, RT1): a fixed 1..20 (checked by restTickSchema), the PCs who took
 * part in the rest, a die, or a die plus those PCs (src/lib/domain/countdowns/rest-ticks.ts).
 */
export const countdownRestTickAmountValidator = v.union(
  v.object({ kind: v.literal("fixed"), n: v.number() }),
  v.object({ kind: v.literal("pcs") }),
  v.object({ kind: v.literal("die"), sides: diceSidesValidator }),
  v.object({ kind: v.literal("diePlusPcs"), sides: diceSidesValidator }),
);
/** One rest setting ("On long rest" / "On short rest"): the amount and Automatic or Reminder. */
export const countdownRestTickValidator = v.object({ amount: countdownRestTickAmountValidator, mode: countdownRestModeValidator });
/** The GM's call on a chase whose two sides reached 0 together (K6): caught | escaped. */
export const countdownChaseResultValidator = v.union(...CHASE_RESULTS.map((r) => v.literal(r)));
/** A randomized start (R5, D8): 1-4 dice of one size (counts checked by countdownDetailsSchema). */
export const countdownStartDiceValidator = v.object({
  count: v.number(),
  sides: diceSidesValidator,
});
/** One side of a chase pair (D9), linked to its partner row. */
export const countdownChaseValidator = v.object({
  partnerId: v.id("countdowns"),
  side: v.union(v.literal("party"), v.literal("rivals")),
  party: v.union(v.literal("pursuing"), v.literal("escaping")),
});
/** One box of a long-term track (D10); text at most 200 characters (validateSteps). */
export const countdownStepValidator = v.object({ value: v.number(), text: v.string(), news: v.optional(v.boolean()) });

/** A countdown's state before or after one tick (countdownTicks): what an undo restores (D11). */
export const countdownTickStateValidator = v.object({
  currentValue: v.number(),
  startingValue: v.number(),
  status: statusValidator,
  triggerCount: v.number(),
  completedAt: v.optional(v.number()),
  lastTriggeredAt: v.optional(v.number()),
});

/** What caused a recorded tick: a counted roll, the GM's feed button, a rest (its rest setting, rest-ticks RT1). */
export const countdownTickSourceValidator = v.union(v.literal("roll"), v.literal("feed"), v.literal("rest"));

export const countdownTables = {
  /** Countdowns, legacy rules; every change is recorded in `history` (dcm-bxp.26). */
  countdowns: defineTable({
    campaignId: v.id("campaigns"),
    name: v.string(),
    description: v.string(),
    category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c))),
    startingValue: v.number(),
    currentValue: v.number(),
    status: statusValidator,
    consequence: v.string(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    /**
     * Set when a frame tracker owns the countdown (e.g. a Five Banners nation's
     * objective, a PC's Lycanthropy); such countdowns stay off the dashboard list.
     */
    ownerKey: v.optional(v.string()),
    kind: v.optional(v.string()),
    /** Frame-owned countdowns are GM-only until revealed. */
    revealed: v.optional(v.boolean()),
    /** Dashboard countdowns only (frame-owned ones use `revealed`). Absent = everything public. */
    visibility: v.optional(countdownVisibilityValidator),
    // ---- countdowns-advanced (K0). Dashboard countdowns only; every field optional, absent = today's countdown.
    /** absent = standard (D1). */
    mode: v.optional(countdownModeValidator),
    /**
     * Ticks by itself on counted action rolls; absent = false (D4). Frame-owned rows never set it. Legacy (rest-ticks
     * RT1): on a long-term row it meant "ticks on long rests"; `restTicksOf` reads it that way until the migration
     * `moveLongTermRest` moved it to `onLongRest`. Nothing writes it on a long-term row any more.
     */
    armed: v.optional(v.boolean()),
    /** absent = does not repeat (R6, R7). */
    repeat: v.optional(countdownRepeatValidator),
    /** The first cycle's start ("Increasing 8"); `startingValue` is the current cycle's start. */
    initialValue: v.optional(v.number()),
    /** The randomized start's formula (R5); the value rolled at creation is reused on every reset (D8, Q4). */
    startDice: v.optional(countdownStartDiceValidator),
    /** How often it reached 0, and when last (D7). */
    triggerCount: v.optional(v.number()),
    lastTriggeredAt: v.optional(v.number()),
    /** Set on both rows of a chase pair (D9). */
    chase: v.optional(countdownChaseValidator),
    /** longTerm only: at most 21 steps, one per value from the start down to 0 (D10); bounded, so kept in the row. */
    steps: v.optional(v.array(countdownStepValidator)),
    /**
     * @deprecated longTerm only: absent = auto (Q3). Replaced by `onLongRest.mode` (rest-ticks RT1): read only through
     * `restTicksOf`, no longer written. Narrow once `moveLongTermRest` ran on every deployment.
     */
    restMode: v.optional(countdownRestModeValidator),
    /**
     * Rest ticks (plan rest-ticks, RT1; widened, absent = off): what a finished long rest / a short rest (and an
     * interrupted long rest, Q1) does to it. Dashboard countdowns of every type; a chase pair shares one setting.
     */
    onLongRest: v.optional(countdownRestTickValidator),
    onShortRest: v.optional(countdownRestTickValidator),
    /**
     * Chase rows only (K6, dcm-bxp.73): the GM's call when both sides reached 0 at once, set on both rows; cleared when
     * a side reopens. Absent while undecided or when only one side reached 0 (that side tells the outcome).
     */
    chaseResult: v.optional(countdownChaseResultValidator),
  })
    /** The dashboard list: `ownerKey` undefined, i.e. countdowns no frame tracker owns. */
    .index("by_campaign_owner", ["campaignId", "ownerKey"])
    /** The roll and rest paths read only armed countdowns. */
    .index("by_campaign_armed", ["campaignId", "armed"]),

  /**
   * One row per countdown change caused by an actionLog row (countdowns-advanced D5, D11), written only by
   * convex/lib/countdownTicks.ts: a (row, countdown) pair ticks once, and undoing the row takes the tick back while the
   * countdown still equals `after`. Grows with play; deleted with its campaign (convex/cleanup.ts), no TTL: it is the
   * undo record of live rows.
   * - `by_entry_countdown`: a row's ticks (eq entryId) and the double-tick check (eq both). A separate by_entry would be
   *   a field-prefix duplicate (CD15).
   * - `by_campaign_at`: the purge.
   */
  countdownTicks: defineTable({
    campaignId: v.id("campaigns"),
    countdownId: v.id("countdowns"),
    entryId: v.id("actionLog"),
    source: countdownTickSourceValidator,
    /** The ticks asked for (a clamped tick records the full amount; `after` holds where it stopped). */
    amount: v.number(),
    before: countdownTickStateValidator,
    after: countdownTickStateValidator,
    /** The GM-only feed notice of a trigger, marked undone on a revert. */
    noticeId: v.optional(v.id("actionLog")),
    revertedAt: v.optional(v.number()),
    at: v.number(),
  })
    .index("by_entry_countdown", ["entryId", "countdownId"])
    .index("by_campaign_at", ["campaignId", "at"]),

  /**
   * Campaign time: at most one row per campaign. Witherwild (frame mechanic `campaignTime`) gets it at creation and uses
   * the Day / Night cycle; since plan lanes-2 CT (dcm-ztb8) every other campaign gets it lazily on its first End day and
   * only counts `week` and `cycleDay` (its `cycle` stays "DAY").
   */
  campaignTime: defineTable({
    campaignId: v.id("campaigns"),
    week: v.number(),
    cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
    cycleDay: v.number(),
  }).index("by_campaign", ["campaignId"]),
};
