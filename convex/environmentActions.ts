import { v } from "convex/values";

import { COUNTDOWN_VISIBILITY_PRESETS, MAX_COUNTDOWN_START } from "../src/lib/domain/countdowns/index";
import {
  environmentCountdownCategory,
  environmentCountdownName,
  environmentCountdownStart,
  featureCountdownLabels,
  environmentsFor,
} from "../src/lib/domain/environments/index";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import { ENVIRONMENTS } from "../src/lib/srd/environments";
import type { EnvironmentDef, EnvironmentFeature } from "../src/lib/srd/types";
import { COUNTDOWN_DETAILS_MAX_LENGTH } from "../src/lib/validation/countdowns";
import type { Doc } from "./_generated/dataModel";
import { logAction } from "./lib/actionLog";
import { rollDice } from "./lib/dice";
import { spendFear as spendCampaignFear } from "./lib/fear";
import { keyedGmMutation } from "./lib/functions";
import { recordHistory } from "./tables/history";

/**
 * The Environment tab's actions (EF1, user 2026-10-19: "let me spend fear for the effects / start the countdowns for
 * the selected environments"). GM only (GM wrappers: player FORBIDDEN, outsider NOT_FOUND), keyed so a retried click
 * applies once. The feature is named by its environment's id and its own name; an environment the campaign does not
 * see (a Hope & Fear one with the switch off) or an unknown feature is NOT_FOUND.
 */

const ENVIRONMENT_BY_ID = new Map<string, EnvironmentDef>(ENVIRONMENTS.map((e) => [e.id, e]));

const featureArgs = { environmentId: v.string(), featureName: v.string() };

/** The environment (if this campaign sees it) and its feature, else NOT_FOUND. */
function findFeature(campaign: Doc<"campaigns">, environmentId: string, featureName: string): { environment: EnvironmentDef; feature: EnvironmentFeature } {
  const environment = ENVIRONMENT_BY_ID.get(environmentId);
  const { hopeAndFear } = resolveOptions(campaign.frameId, campaign.options);
  if (!environment || environmentsFor([environment], { hopeAndFear, frameId: campaign.frameId }).length !== 1) throw appError("NOT_FOUND");
  const feature = environment.features.find((f) => f.name === featureName);
  if (!feature) throw appError("NOT_FOUND");
  return { environment, feature };
}

/**
 * Spends the feature's Fear cost ("Spend a Fear to ...", CB p.154 Fear Features) from GM Fear (FEAR_EMPTY when the GM
 * holds less) and logs which environment feature it was in the GM's feed. A feature without a Fear cost is INVALID.
 */
export const spendFear = keyedGmMutation({
  args: featureArgs,
  returns: v.object({ fear: v.number(), spent: v.number() }),
  handler: async (ctx, { environmentId, featureName }) => {
    const { environment, feature } = findFeature(ctx.campaign, environmentId, featureName);
    const cost = feature.fearCost;
    if (cost === undefined) throw appError("INVALID", "That feature doesn't cost Fear.");
    return ctx.once("environment_spend_fear", { environmentId, featureName }, async () => {
      const { newValue } = await spendCampaignFear(ctx, ctx.campaign._id, cost, "feature");
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "gm",
        summary: `Spent ${cost} Fear: ${feature.name} (${environment.name})`,
        undoable: false,
      });
      return { fear: newValue, spent: cost };
    });
  },
});

/**
 * Starts the feature's countdown on the dashboard: named "<Environment>: <Feature>", the feature text as its
 * description, a category from the label, the label's starting value (dice like "Loop 1d4" are rolled here), and
 * Private (the user's answer: only the GM sees it until they change it). A feature without a countdown is INVALID.
 */
export const startCountdown = keyedGmMutation({
  /** `label`: which of the feature's countdowns (its own label or one written in its text); the first when omitted. */
  args: { ...featureArgs, label: v.optional(v.string()) },
  returns: v.object({ countdownId: v.id("countdowns"), name: v.string(), startingValue: v.number() }),
  handler: async (ctx, { environmentId, featureName, label: wanted }) => {
    const { environment, feature } = findFeature(ctx.campaign, environmentId, featureName);
    const labels = featureCountdownLabels(feature);
    const label = wanted === undefined ? labels[0] : labels.find((l) => l === wanted);
    const start = label === undefined ? null : environmentCountdownStart(label);
    if (label === undefined || start === null) throw appError("INVALID", "That feature has no such countdown.");
    const campaignId = ctx.campaign._id;
    return ctx.once("environment_start_countdown", { environmentId, featureName, label }, async () => {
      const rolled = start.kind === "fixed" ? start.value : rollDice(start.count, start.sides).reduce((a, b) => a + b, 0);
      const startingValue = Math.min(MAX_COUNTDOWN_START, Math.max(1, rolled));
      const name = environmentCountdownName(environment, feature.name, labels.length > 1 ? label : undefined);
      const countdownId = await ctx.db.insert("countdowns", {
        campaignId,
        name,
        description: feature.text.slice(0, COUNTDOWN_DETAILS_MAX_LENGTH),
        category: environmentCountdownCategory(label),
        startingValue,
        currentValue: startingValue,
        consequence: "",
        status: "active",
        createdAt: Date.now(),
        visibility: COUNTDOWN_VISIBILITY_PRESETS.private,
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId,
        kind: "countdown",
        action: "create",
        countdownId,
        before: null,
        after: { currentValue: startingValue, status: "active" },
      });
      return { countdownId, name, startingValue };
    });
  },
});
