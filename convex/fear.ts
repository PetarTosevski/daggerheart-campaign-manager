import { v } from "convex/values";

import {
  amountForFearDirection,
  assertFearValue,
  calculateFearAfterAdjustment,
  FearRangeError,
} from "../src/lib/domain/fear/index";
import { campaignFearState } from "./lib/fear";
import { keyedGmMutation } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { recordHistory } from "./tables/history";

export type FearChange = { previousValue: number; newValue: number };

/** Raises or lowers GM Fear by one (0–12). GM only; Fear is core: every frame has it. */
export const adjust = keyedGmMutation({
  args: { direction: v.union(v.literal("increase"), v.literal("decrease")) },
  handler: async (ctx, { direction }): Promise<FearChange> =>
    ctx.once("fear_adjust", { direction }, async () => {
      const state = await campaignFearState(ctx, ctx.campaign._id);
      const newValue = applyRule("FEAR_RANGE", FearRangeError, () =>
        calculateFearAfterAdjustment(state.fear, amountForFearDirection(direction)),
      );
      await ctx.db.patch("campaignState", state._id, { fear: newValue });
      await recordHistory(ctx, ctx.user._id, {
        campaignId: ctx.campaign._id,
        kind: "fear",
        action: "adjust",
        before: state.fear,
        after: newValue,
      });
      return { previousValue: state.fear, newValue };
    }),
});

/** Sets GM Fear to a value 0–12 (the dashboard's tokens). GM only. Setting the current value records nothing. */
export const set = keyedGmMutation({
  args: { value: v.number() },
  handler: async (ctx, { value }): Promise<FearChange> => {
    applyRule("FEAR_RANGE", FearRangeError, () => assertFearValue(value));
    return ctx.once("fear_set", { value }, async () => {
      const state = await campaignFearState(ctx, ctx.campaign._id);
      if (state.fear !== value) {
        await ctx.db.patch("campaignState", state._id, { fear: value });
        await recordHistory(ctx, ctx.user._id, {
          campaignId: ctx.campaign._id,
          kind: "fear",
          action: "set",
          before: state.fear,
          after: value,
        });
      }
      return { previousValue: state.fear, newValue: value };
    });
  },
});
