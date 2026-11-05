import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { ruleDef, ruleInFrame, ruleOfParam, type RuleDef } from "../src/lib/rules/registry";
import { isRuleValue, resolveRuleModes, ruleBlockedBy } from "../src/lib/rules/resolve";
import { campaignQuery, gmMutation } from "./lib/functions";
import { assertRulesUnlocked, rulesLocked } from "./lib/ruleModes";
import { ruleChangeValidator, ruleModesValidator } from "./lib/validators/ruleModes";

/**
 * House rules, server side (plan rule-switches RS0): every member reads the campaign's rule modes; the GM and co-GMs
 * change one at a time, between sessions only (user 2026-11-05). Engine code never calls these: it reads
 * `ruleModesOf(campaign)` (convex/lib/ruleModes.ts).
 */

/**
 * The campaign's rule modes, resolved, for House rules (GM, co-GM and players: players read it, Q18 a). `locked`: a
 * session is live, so every switch is disabled. `canEdit`: the caller may change them (GM or co-GM, not archived, not
 * the app owner's read-only view).
 */
export const get = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({ modes: ruleModesValidator, locked: v.boolean(), canEdit: v.boolean() }),
  handler: async (ctx) => {
    const campaign = ctx.campaign;
    return {
      modes: resolveRuleModes(campaign.frameId, campaign.ruleModes),
      locked: await rulesLocked(ctx, campaign._id),
      canEdit: ctx.permission === "owner" && !ctx.ownerView && campaign.archivedAt === undefined,
    };
  },
});

/** The rule a change's key belongs to: the rule itself, or the rule whose row sets that number. */
function ruleOfKey(key: string): RuleDef | undefined {
  return ruleOfParam(key) ?? ruleDef(key);
}

/**
 * The GM or a co-GM changes one rule's mode, an optional rule, or a number in a rule's row (rule 12: one field per
 * call). Refused with RULES_LOCKED while a session is live; SETTING_INVALID when the rule isn't in the campaign's frame,
 * the row is read-only (X2 while X1 is Manual) or a number is not a whole number in its range; CAMPAIGN_ARCHIVED by the
 * wrapper. A value equal to the resolved one writes nothing.
 */
export const set = gmMutation({
  args: { change: ruleChangeValidator },
  returns: v.null(),
  handler: async (ctx, { change }) => {
    const campaign = ctx.campaign;
    await assertRulesUnlocked(ctx, campaign._id);
    const rule = ruleOfKey(change.key);
    if (rule === undefined || !ruleInFrame(rule, campaign.frameId)) {
      throw appError("SETTING_INVALID", "That rule isn't in this campaign's frame.");
    }
    const resolved = resolveRuleModes(campaign.frameId, campaign.ruleModes);
    if (change.key === rule.id) {
      if (!isRuleValue(rule, change.value)) throw appError("SETTING_INVALID");
      if (ruleBlockedBy(rule, resolved) !== null) throw appError("SETTING_INVALID", "This rule needs the death move prompt.");
    } else {
      const param = "param" in rule ? rule.param : undefined;
      const n = change.value;
      if (param === undefined || typeof n !== "number" || !Number.isInteger(n) || n < param.min || n > param.max) {
        throw appError("SETTING_INVALID", param ? `Pick a whole number from ${param.min} to ${param.max}.` : undefined);
      }
    }
    if (resolved[change.key] === change.value) return null;
    await ctx.db.patch("campaigns", campaign._id, { ruleModes: { ...(campaign.ruleModes ?? {}), [change.key]: change.value } });
    return null;
  },
});
