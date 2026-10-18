import { v } from "convex/values";

import { MAX_LEVEL } from "../src/lib/domain/characters/index";
import { applyLevelUp, LevelUpRuleError, revertLevelUp } from "../src/lib/domain/level-up/index";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import { ADVANCEMENT_OPTIONS, type CharacterSheet } from "../src/lib/validation/characters";
import { logAction, newGroupId } from "./lib/actionLog";
import { loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { keyedGmMutation, keyedUserMutation } from "./lib/functions";
import { applyRule } from "./lib/mechanics";

/**
 * Leveling up (D5 T2, CB 109-111). The GM flags the party; each owner then
 * levels up their own character one level at a time (decision 5). Undo takes
 * back only the latest level and can be repeated (decision 4); the GM can also
 * set a level directly with no automation. Every call writes a public action
 * log row with `undoable: false`: level undo is its own path, and the row
 * stops `actionLog.undo` from restoring a sheet from before the level-up.
 */

const pickValidator = v.object({
  option: v.union(...ADVANCEMENT_OPTIONS.map((o) => v.literal(o))),
  tier: v.number(),
  targets: v.optional(v.array(v.string())),
});

const choiceValidator = v.object({
  picks: v.array(pickValidator),
  experienceName: v.optional(v.string()),
  cardId: v.string(),
  trade: v.optional(v.object({ out: v.string(), in: v.string() })),
  multiclass: v.optional(v.object({ classId: v.string(), domainId: v.string(), subclassId: v.string() })),
});

const levelResult = v.object({ level: v.number() });

/** The longest the choice's free text and lists may be (validated again by the engine). */
function assertSmall(choice: { picks: unknown[]; experienceName?: string }) {
  if (choice.picks.length > 2 || (choice.experienceName?.length ?? 0) > 200) throw appError("INVALID");
}

/**
 * Levels a character up by one with the player's choice. Owner or GM; the
 * owner only while the GM's "Party levels up" flag is set (CB 109), the GM
 * always. Clears the flag. LEVEL_UP_RULE for a choice the rules don't allow.
 */
export const apply = keyedUserMutation({
  args: { characterId: v.id("characters"), choice: choiceValidator },
  returns: levelResult,
  handler: async (ctx, { characterId, choice }) =>
    ctx.once("level_up_apply", { characterId, choice }, async () => {
      assertSmall(choice);
      const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
      const sheet = readSheet(character.sheet);
      if (!sheet.levelUpPending && permission !== "owner") throw appError("LEVEL_UP_RULE", "Wait for the GM to call for a level-up.");
      const allowExpansion = resolveOptions(campaign.frameId, campaign.options).hopeAndFear;
      const next = applyRule("LEVEL_UP_RULE", LevelUpRuleError, () =>
        applyLevelUp(sheet, choice, { allowExpansion, newId: () => crypto.randomUUID() }),
      );
      await saveSheet(ctx, character._id, next);
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "levelUp",
        visibility: "public",
        summary: `${sheet.name} reached level ${next.level}.`,
        undoable: false,
      });
      return { level: next.level };
    }),
});

/** Undoes the character's latest level (repeatable). Owner or GM. Sets the level-up flag again. */
export const undoLast = keyedUserMutation({
  args: { characterId: v.id("characters") },
  returns: levelResult,
  handler: async (ctx, { characterId }) =>
    ctx.once("level_up_undo", { characterId }, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      const sheet = readSheet(character.sheet);
      const next = applyRule("LEVEL_UP_RULE", LevelUpRuleError, () => revertLevelUp(sheet));
      await saveSheet(ctx, character._id, next);
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "levelUp",
        visibility: "public",
        summary: `${sheet.name} went back to level ${next.level}.`,
        undoable: false,
      });
      return { level: next.level };
    }),
});

/** GM only: sets the level directly, with no achievements, picks or cards (a correction). */
export const correctLevel = keyedUserMutation({
  args: { characterId: v.id("characters"), level: v.number() },
  returns: levelResult,
  handler: async (ctx, { characterId, level }) =>
    ctx.once("level_up_correct", { characterId, level }, async () => {
      if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw appError("LEVEL_UP_RULE", `Choose a level from 1 to ${MAX_LEVEL}.`);
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "owner");
      const sheet = readSheet(character.sheet);
      await saveSheet(ctx, character._id, { ...sheet, level });
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "levelUp",
        visibility: "public",
        summary: `The GM set ${sheet.name} to level ${level}.`,
        undoable: false,
      });
      return { level };
    }),
});

/**
 * GM only: "Party levels up" (CB 109, decision 5). Flags every active
 * character below level 10; dead, retired and away ones are left out.
 */
export const partyLevelUp = keyedGmMutation({
  args: {},
  returns: v.object({ flagged: v.number() }),
  handler: async (ctx) =>
    ctx.once("level_up_party", {}, async () => {
      // One party: a handful of characters.
      const rows = await ctx.db
        .query("characters")
        .withIndex("by_campaign", (q) => q.eq("campaignId", ctx.campaign._id))
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
          campaignId: ctx.campaign._id,
          characterId: character._id,
          actorId: ctx.user._id,
          kind: "levelUp",
          visibility: "public",
          summary: `${sheet.name} can level up to ${sheet.level + 1}.`,
          groupId,
          undoable: false,
        });
        flagged += 1;
      }
      return { flagged };
    }),
});
