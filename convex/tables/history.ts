import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

import { COUNTDOWN_STATUSES } from "../../src/lib/domain/countdowns/index";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const countdownValue = v.object({
  currentValue: v.number(),
  status: v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s))),
});

const timeValue = v.object({
  week: v.number(),
  cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
  cycleDay: v.number(),
});

const common = {
  campaignId: v.id("campaigns"),
  /** What caused the change, e.g. "adjust", "set", "gain", "advance", "correction". */
  action: v.string(),
  /** Who made it; null for a change without a signed-in user (a scheduled function). */
  by: v.union(v.id("users"), v.null()),
  at: v.number(),
};

const fearChange = { kind: v.literal("fear"), before: v.number(), after: v.number() };
const countdownChange = {
  kind: v.literal("countdown"),
  countdownId: v.id("countdowns"),
  /** null when the countdown was created. */
  before: v.union(countdownValue, v.null()),
  after: countdownValue,
};
const timeChange = { kind: v.literal("campaignTime"), before: timeValue, after: timeValue };

/** One change, by kind: `before`/`after` are typed per kind (no `v.any`). */
export const historyEvent = v.union(
  v.object({ ...common, ...fearChange }),
  v.object({ ...common, ...countdownChange }),
  v.object({ ...common, ...timeChange }),
);

/** A stored history row, as `history.list` returns it. */
const system = { _id: v.id("history"), _creationTime: v.number() };
export const historyRow = v.union(
  v.object({ ...system, ...common, ...fearChange }),
  v.object({ ...system, ...common, ...countdownChange }),
  v.object({ ...system, ...common, ...timeChange }),
);

export type HistoryEvent = Infer<typeof historyEvent>;

export const historyTables = {
  /**
   * The change history of Fear, countdowns and campaign time (dcm-bxp.26),
   * kept apart from `operations`, which is only an idempotency cache with a TTL.
   * Grows with play; read newest first, paginated, by the GM.
   */
  history: defineTable(historyEvent).index("by_campaign_at", ["campaignId", "at"]),
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Appends one history row, stamped with the current time. */
export async function recordHistory(
  ctx: MutationCtx,
  by: Id<"users"> | null,
  event: DistributiveOmit<HistoryEvent, "by" | "at">,
): Promise<void> {
  await ctx.db.insert("history", { ...event, by, at: Date.now() });
}
