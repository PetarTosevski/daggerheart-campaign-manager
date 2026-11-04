import { v } from "convex/values";

import { shortRestsSinceLong } from "../src/lib/domain/rest/index";
import { oasisPool } from "../src/lib/domain/rest/feature-moves";
import { loadCharacter } from "./lib/characterSheet";
import { campaignQuery, userQuery } from "./lib/functions";
import { choicesOf, groupUndoable, isProject, oasisPoolOf, oasisWindowOpen, pickableMoves, recentRests } from "./lib/restView";
import { downtimeDieValidator, restChoiceMoveValidator, restKindValidator, restMoveValidator, restStatusValidator } from "./lib/validators/rests";
import { seesFear } from "./campaigns";

/**
 * The rest reads (CB 104-105): the open rest with each resting PC's pickable moves, and a character's projects. Moved
 * out of `rests.ts` by dcm-uh6r so these subscriptions (the HUD and the party page) load without the rest hooks and the
 * card runner the rest mutations need. Same wrappers, arguments and returns as before.
 */

const choiceView = v.object({ characterId: v.id("characters"), moves: v.array(restChoiceMoveValidator) });
const movesView = v.object({
  characterId: v.id("characters"),
  moves: v.array(restMoveValidator),
  /** Efficient (CB 53): the long rest moves the PC can take one of on this short rest, with `choose`'s `efficient`. */
  efficient: v.array(restMoveValidator),
  /** Most moves the PC can pick: 2, +1 with Celestial Trance (CB 56), +1 per extra move granted (Eloquent, CB 29). */
  slots: v.number(),
  /** The PC holds Celestial Trance (CB 56): one of the extra slots is the trance's. */
  trance: v.boolean(),
  /** Extra downtime moves granted for this rest (Eloquent, CB 29: "an additional downtime move during their next rest"). */
  extraMoves: v.number(),
  /** The PC holds Oasis and this is a short rest: after the dice are shown, they add one reroll to the party's pool (HF 27). */
  oasis: v.boolean(),
});

/**
 * The open rest with its choices and each resting PC's pickable moves (core,
 * frame and class moves, `restMovesFor`), the short-rest count (CB 105), and
 * the latest ended rest for undo. Everyone in the campaign. With "Players see the GM's Fear" off, a player's `last` has
 * no Fear roll or gain (null, as for an older row; dcm-jh6d.62): the gain is a change of the GM's Fear.
 */
export const current = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.object({
    open: v.union(
      v.object({
        _id: v.id("rests"),
        kind: restKindValidator,
        startedAt: v.number(),
        gmOverride: v.boolean(),
        choices: v.array(choiceView),
        moves: v.array(movesView),
      }),
      v.null(),
    ),
    shortRestsSinceLong: v.number(),
    last: v.union(
      v.object({
        _id: v.id("rests"),
        kind: restKindValidator,
        status: restStatusValidator,
        finishedAt: v.union(v.number(), v.null()),
        fearRoll: v.union(v.number(), v.null()),
        fearGained: v.union(v.number(), v.null()),
        undoable: v.boolean(),
        /** The downtime dice it rolled, in roll order (`oasisReroll`'s `die` is the index); empty for older rows. */
        dice: v.array(downtimeDieValidator),
        /** The resting PCs who held Oasis when it ended; each adds one reroll to the party's pool (HF 27; DA15). */
        oasisHolders: v.array(v.id("characters")),
        /** The holders who closed their own Oasis panel (DA15); their unused reroll left the pool. */
        oasisClosed: v.array(v.id("characters")),
        /** The rerolls left in the party's Oasis pool (DA15): holders with an open panel whose reroll nobody spent. */
        oasisLeft: v.number(),
        /** The Oasis window is open (DA15): dice rolled and at least one holder has not closed their panel. */
        resultsOpen: v.boolean(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const rests = await recentRests(ctx, ctx.campaign._id);
    const open = rests.find((r) => r.status === "open") ?? null;
    const newest = rests[0];
    const last = newest !== undefined && newest.status !== "open" ? newest : null;
    const fearShown = seesFear(ctx.campaign, ctx.permission);
    return {
      open:
        open === null
          ? null
          : {
              _id: open._id,
              kind: open.kind,
              startedAt: open.startedAt,
              gmOverride: open.gmOverride ?? false,
              choices: (await choicesOf(ctx, open._id)).map((c) => ({ characterId: c.characterId, moves: c.moves })),
              moves: await pickableMoves(ctx, ctx.campaign, open.kind),
            },
      shortRestsSinceLong: shortRestsSinceLong(rests),
      last:
        last === null
          ? null
          : {
              _id: last._id,
              kind: last.kind,
              status: last.status,
              finishedAt: last.finishedAt ?? null,
              fearRoll: fearShown ? (last.fearRoll ?? null) : null,
              fearGained: fearShown ? (last.fearGained ?? null) : null,
              undoable: await groupUndoable(ctx, ctx.campaign._id, last.groupId),
              dice: last.dice ?? [],
              oasisHolders: last.oasisHolders ?? [],
              oasisClosed: last.oasisClosed ?? [],
              oasisLeft: oasisWindowOpen(last) ? oasisPool(last.dice ?? [], oasisPoolOf(last)).left : 0,
              resultsOpen: oasisWindowOpen(last),
            },
    };
  },
});

const projectView = v.object({
  _id: v.id("countdowns"),
  name: v.string(),
  startingValue: v.number(),
  currentValue: v.number(),
  status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed"), v.literal("cancelled")),
});

/** A character's project countdowns (Work on a Project, CB 105; `kind` "project"), not cancelled. Everyone who can see the character. */
export const projects = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.array(projectView),
  handler: async (ctx, { characterId }) => {
    const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "view");
    // A character has a handful of projects.
    const rows = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaign._id).eq("ownerKey", character._id))
      .collect();
    return rows
      .filter((c) => isProject(c, character._id))
      .map((c) => ({ _id: c._id, name: c.name, startingValue: c.startingValue, currentValue: c.currentValue, status: c.status }));
  },
});
