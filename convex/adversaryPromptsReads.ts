import { v } from "convex/values";

import { encounterRunning, openRequests } from "./lib/combatRequests";
import { gmQuery } from "./lib/functions";
import { gmPromptKindValidator } from "./lib/validators/combatRequests";

/**
 * dcm-bxp.99.32.27 (plan combat-hud H5.1, board CmpPromptsGM): the GM queue's read of the open GM prompts of adversary
 * feature uses (`combatRequests` kind `gmPrompt`, stored by `adversaryActions.useFeature`). Kept apart from
 * `adversaryPrompts.ts` so the queue's subscription loads no mutation code. GM only (`gmQuery`); those of an ended
 * encounter are left out. Oldest first.
 */

const promptView = v.object({
  requestId: v.id("combatRequests"),
  instanceId: v.id("encounterAdversaries"),
  instanceLabel: v.string(),
  feature: v.string(),
  prompt: gmPromptKindValidator,
  text: v.string(),
  groupId: v.string(),
  createdAt: v.number(),
});

export const pending = gmQuery({
  args: {},
  returns: v.array(promptView),
  handler: async (ctx) => {
    const out = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      const p = row.payload;
      if (p.kind !== "gmPrompt" || !(await encounterRunning(ctx, row))) continue;
      out.push({ requestId: row._id, instanceId: p.instanceId, instanceLabel: p.instanceLabel, feature: p.feature, prompt: p.prompt, text: p.text, groupId: p.groupId, createdAt: row.createdAt });
    }
    return out;
  },
});
