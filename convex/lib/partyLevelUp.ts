import { MAX_LEVEL } from "../../src/lib/domain/characters/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { readSheet, saveSheet } from "./characterSheet";

/**
 * "Party levels up" (CB 109, decision 5): flags every active character below level 10 and writes one public,
 * non-undoable `levelUp` log row per flagged character, in one group. Dead, retired and away characters and
 * unreadable sheets are left out. The body of `levelUp.partyLevelUp`, shared with D10's milestone (S6 `callMilestone`,
 * Q5). The caller authorizes (GM wrappers) and wraps it in its own `ctx.once`.
 */
export async function partyLevelUp(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  actorId: Id<"users">,
): Promise<{ flagged: number }> {
  // One party: a handful of characters.
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
  const groupId = newGroupId();
  let flagged = 0;
  for (const character of rows) {
    if (character.status !== "active") continue;
    let sheet: CharacterSheet;
    try {
      sheet = readSheet(character.sheet);
    } catch {
      continue; // An unreadable sheet can't level up; the roster shows it as corrupt.
    }
    if (sheet.level >= MAX_LEVEL) continue;
    if (!sheet.levelUpPending) await saveSheet(ctx, character._id, { ...sheet, levelUpPending: true });
    await logAction(ctx, {
      campaignId,
      characterId: character._id,
      actorId,
      kind: "levelUp",
      visibility: "public",
      summary: `${sheet.name} can level up to ${sheet.level + 1}.`,
      groupId,
      undoable: false,
    });
    flagged += 1;
  }
  return { flagged };
}
