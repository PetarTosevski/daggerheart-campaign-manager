import { v, type Infer } from "convex/values";

import { appError } from "../../src/lib/errors/app-error";
import {
  FIRST_ECHO,
  HORIZON_TRACKER_KEY,
  INITIAL_HORIZON_STATE,
  MAX_ECHOES,
  REFUSAL_MESSAGES,
  fearForMark,
  horizonStateSchema,
  markRefusal,
  occurredEvents,
  unmarkRefusal,
  withMark,
  withoutMark,
} from "../../src/lib/frames/trackers/horizon";
import { gainFear } from "../lib/fear";
import { campaignQuery, keyedGmMutation } from "../lib/functions";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, type FrameTracker } from "../lib/trackers";

/** Journey to Horizon only; enforced here, not only in the UI. */
export const horizonTracker: FrameTracker<typeof horizonStateSchema> = {
  frameId: "journey-to-horizon",
  key: HORIZON_TRACKER_KEY,
  schema: horizonStateSchema,
  initial: () => INITIAL_HORIZON_STATE,
  ruleCode: "DOOM_RULE",
};

const horizonView = v.union(
  v.object({
    role: v.literal("gm"),
    partyTier: v.number(),
    echoesCollected: v.number(),
    boxes: v.record(
      v.string(),
      v.object({ marked: v.boolean(), session: v.optional(v.number()), occurred: v.boolean(), markedAt: v.number() }),
    ),
  }),
  v.object({
    role: v.literal("player"),
    echoesCollected: v.number(),
    occurred: v.array(
      v.object({ id: v.string(), tier: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)), text: v.string() }),
    ),
  }),
);

export type HorizonView = Infer<typeof horizonView>;

const markResult = v.object({
  boxId: v.string(),
  fear: v.union(v.object({ gained: v.number(), lost: v.number(), newValue: v.number() }), v.null()),
});
const echoesChange = v.object({ previousValue: v.number(), newValue: v.number(), levelUps: v.number(), horizonUnlocked: v.boolean() });

export type MarkResult = Infer<typeof markResult>;
export type EchoesChange = Infer<typeof echoesChange>;

function refuse(reason: keyof typeof REFUSAL_MESSAGES): never {
  throw appError("DOOM_RULE", REFUSAL_MESSAGES[reason]);
}

/** The GM sees the whole track; players see the Echo count and occurred events only. */
export const get = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: horizonView,
  handler: async (ctx): Promise<HorizonView> => {
    assertTrackerFrame(ctx.campaign, horizonTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, horizonTracker);
    if (ctx.permission === "owner") {
      return { role: "gm", partyTier: ctx.campaign.tier, echoesCollected: state.echoesCollected, boxes: state.boxes };
    }
    return { role: "player", echoesCollected: state.echoesCollected, occurred: occurredEvents(state) };
  },
});

/**
 * Marks a Doom Track box in the party's tier (campaign.tier) or below, after
 * its parent. A Tier 4 mark gains Fear equal to the marked Tier 4 boxes.
 */
export const markBox = keyedGmMutation({
  args: { boxId: v.string(), session: v.optional(v.number()) },
  returns: markResult,
  handler: (ctx, { boxId, session }) => {
    const { _id: campaignId, tier } = ctx.campaign;
    return frameTrackerMutation<typeof horizonStateSchema, MarkResult>(ctx, horizonTracker, { kind: "horizon_mark", request: { boxId, session } }, async (state) => {
      const reason = markRefusal(state, boxId, tier);
      if (reason) refuse(reason);
      if (session !== undefined && (!Number.isInteger(session) || session < 1)) {
        throw appError("DOOM_RULE", "Session must be a whole number from 1.");
      }
      const next = withMark(state, boxId, Date.now(), session);
      const amount = fearForMark(next, boxId);
      if (amount === 0) return { state: next, result: { boxId, fear: null } };
      const { gained, lost, newValue } = await gainFear(ctx, campaignId, amount);
      return { state: next, result: { boxId, fear: { gained, lost, newValue } } };
    });
  },
});

/** GM correction. Fear already gained from a Tier 4 mark is not refunded. */
export const unmarkBox = keyedGmMutation({
  args: { boxId: v.string() },
  returns: v.object({ boxId: v.string() }),
  handler: (ctx, { boxId }) =>
    frameTrackerMutation(ctx, horizonTracker, { kind: "horizon_unmark", request: { boxId } }, (state) => {
      const reason = unmarkRefusal(state, boxId);
      if (reason) refuse(reason);
      return { state: withoutMark(state, boxId), result: { boxId } };
    }),
});

/** Once a marked event has occurred in play, its text becomes visible to players. */
export const setOccurred = keyedGmMutation({
  args: { boxId: v.string(), occurred: v.boolean() },
  returns: v.object({ boxId: v.string(), occurred: v.boolean() }),
  handler: (ctx, { boxId, occurred }) =>
    frameTrackerMutation(ctx, horizonTracker, { kind: "horizon_occurred", request: { boxId, occurred } }, (state) => {
      const entry = state.boxes[boxId];
      if (!entry?.marked) refuse("NOT_MARKED_OCCURRED");
      return { state: { ...state, boxes: { ...state.boxes, [boxId]: { ...entry, occurred } } }, result: { boxId, occurred } };
    }),
});

/** Sets the Soul Echoes collected (1–10). Each new Echo levels the party up; 10 unlocks Horizon. */
export const setEchoes = keyedGmMutation({
  args: { value: v.number() },
  returns: echoesChange,
  handler: (ctx, { value }) => {
    assertTrackerFrame(ctx.campaign, horizonTracker);
    if (!Number.isInteger(value) || value < FIRST_ECHO || value > MAX_ECHOES) {
      throw appError("ECHO_RANGE", `Soul Echoes run from ${FIRST_ECHO} to ${MAX_ECHOES}.`);
    }
    return frameTrackerMutation(ctx, horizonTracker, { kind: "horizon_echoes", request: { value } }, (state) => {
      const previousValue = state.echoesCollected;
      return {
        state: { ...state, echoesCollected: value },
        result: {
          previousValue,
          newValue: value,
          levelUps: Math.max(0, value - previousValue),
          horizonUnlocked: value === MAX_ECHOES,
        },
      };
    });
  },
});
