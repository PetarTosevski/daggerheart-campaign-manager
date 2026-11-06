import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { RollRecord } from "../src/lib/domain/duality";
import type { Doc } from "./_generated/dataModel";
import { logAction } from "./lib/actionLog";
import { CHARACTER_READ_BOUND, loadCharacter, partyOf, readSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { campaignQuery, keyedUserMutation } from "./lib/functions";
import { ruleMode } from "./lib/ruleModes";
import { damageResult } from "./lib/rolls";

/**
 * Fate rolls, an optional GM mechanic (CB p.168; plan rule-switches OFT, docs/tasks/TASK-RULES-OFT.md). With the
 * campaign's `fateRolls` switch on, a player rolls their PC's Hope Die or Fear Die alone from their dice box (user
 * answer Q13 c, 2026-11-05: no GM step); the GM may roll one for any PC. The row is public, belongs to the PC, and
 * changes nothing: "nor does the roll result grant Hope or Fear" (CB p.168). No Hope, Stress, Fear, countdown tick or
 * spotlight move; its roll kind is `free`, so it is never a counted action roll. Off (the default): MECHANIC_DISABLED.
 */

/** The die every Fate roll uses: the Duality Dice are d12s (CB p.90); no SRD feature changes the Hope Die outside a Duality roll. */
const FATE_SIDES = 12;
const NOTE_MAX = 80;
const DIE_LABEL = { hope: "Hope Die", fear: "Fear Die" } as const;

const dieValidator = v.union(v.literal("hope"), v.literal("fear"));

/** The feed line: "Fate roll for Mira (Fear Die): 4 · On a 4 or lower, the fire spreads". */
export function fateLine(name: string, die: "hope" | "fear", value: number, note: string | undefined): string {
  const text = note?.trim().slice(0, NOTE_MAX);
  return `Fate roll for ${name} (${DIE_LABEL[die]}): ${value}${text ? ` · ${text}` : ""}`;
}

function assertFateRolls(campaign: Pick<Doc<"campaigns">, "frameId" | "ruleModes">): void {
  if (!ruleMode(campaign, "fateRolls")) throw appError("MECHANIC_DISABLED", "Fate rolls are off in this campaign.");
}

/**
 * What the dice box needs: whether Fate rolls are on, and the active PCs the caller rolls them for (a player: their
 * own; the GM and co-GMs: every PC). Empty while the rule is off.
 */
export const status = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({ enabled: v.boolean(), characters: v.array(v.object({ _id: v.id("characters"), name: v.string() })) }),
  handler: async (ctx) => {
    if (!ruleMode(ctx.campaign, "fateRolls")) return { enabled: false, characters: [] };
    const campaignId = ctx.campaign._id;
    const rows =
      ctx.permission === "owner"
        ? await partyOf(ctx, campaignId)
        : await ctx.db
            .query("characters")
            .withIndex("by_owner_campaign", (q) => q.eq("ownerId", ctx.user._id).eq("campaignId", campaignId))
            .take(CHARACTER_READ_BOUND);
    const characters = rows.filter((c) => c.status === "active").map((c) => ({ _id: c._id, name: readSheet(c.sheet).name || "Unnamed" }));
    return { enabled: true, characters };
  },
});

/**
 * A Fate roll for a PC the caller edits (its player or the GM): one d12 as the Hope or Fear Die, an optional note
 * (what the result decides). Logged as a public row of the PC; undo is the GM's (a rolled row, `groupGmOnly`).
 */
export const roll = keyedUserMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), die: dieValidator, note: v.optional(v.string()) },
  returns: damageResult,
  handler: async (ctx, { characterId, die, note }) =>
    ctx.once("roll_fate", { characterId, die, note }, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      assertFateRolls(campaign);
      const value = rollDie(FATE_SIDES);
      const roll: RollRecord = { kind: "free", dice: [{ sides: FATE_SIDES, value, role: die }], modifier: 0, total: value, outcome: "none", manual: false };
      const entryId = await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "roll",
        visibility: "public",
        summary: fateLine(readSheet(character.sheet).name || "Unnamed", die, value, note),
        roll,
        undoable: true,
      });
      return { entryId, roll };
    }),
});
