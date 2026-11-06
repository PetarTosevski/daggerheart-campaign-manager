import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { isAllyPickRow } from "./lib/allyPicks";
import { findCharacter } from "./lib/characterSheet";
import { encounterRunning, openRequests } from "./lib/combatRequests";
import { campaignQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";

/**
 * Per-ally picks (plan finish-hud-lk FH-AP; bead dcm-bxp.99.32.24; convex/lib/allyPicks.ts): the open picks the caller
 * sees. A player gets the picks waiting on their own characters (`mine`: they answer them on their screen) and the uses
 * they made that wait on others (`actor`: "2 of 3 chose, waiting…"); the GM gets every open pick of the campaign, each
 * outstanding one answerable (`mine`: the queue answers a no-show). Who picked what is not sent, only whether each
 * chooser answered. A row still under the actor's review (CU2) goes to the actor and the GM only. Picks of an ended encounter are left out. Oldest first. Kept apart from `allyPicks.ts` so the HUD's
 * subscription loads no mutation code.
 */

const chooserView = v.object({
  stepId: v.string(),
  chooserId: v.string(),
  characterId: v.optional(v.id("characters")),
  name: v.string(),
  label: v.string(),
  options: v.array(v.object({ id: v.string(), label: v.string() })),
  answered: v.boolean(),
  /** The caller may answer it now (their character's pick, or any outstanding pick for the GM). */
  mine: v.boolean(),
  /** The actor's own pick (Rousing Strike's "you"): the review can't untick it (CU2). */
  self: v.boolean(),
});

const pickView = v.object({
  requestId: v.id("combatRequests"),
  name: v.string(),
  actorName: v.string(),
  /** The caller made the use (the PC's player, or the GM for an adversary feature): the waiting line is theirs. */
  actor: v.boolean(),
  createdAt: v.number(),
  /**
   * The actor still reviews the computed allies (plan rule-switches CU2, user 2026-11-06): only the actor and the GM get
   * the row, nobody answers yet; the actor unticks who can't see or hear them and sends (`allyPicks.send`).
   */
  review: v.boolean(),
  choosers: v.array(chooserView),
});

export const open = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(pickView),
  handler: async (ctx) => {
    const gm = atLeast(ctx.permission, "owner");
    const edits = new Map<Id<"characters">, boolean>();
    const canEdit = async (id: Id<"characters">) => {
      if (gm) return true;
      if (!edits.has(id)) {
        const found = await findCharacter(ctx, ctx.user, id, "edit");
        edits.set(id, found !== null && atLeast(found.permission, "edit"));
      }
      return edits.get(id)!;
    };
    const out = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      if (!isAllyPickRow(row) || !(await encounterRunning(ctx, row))) continue;
      const p = row.payload;
      const actor = p.source.kind === "rider" ? await canEdit(p.source.characterId) : gm;
      const review = p.review === true;
      // CU2: while the actor reviews the list, only the actor and the GM see the row, and nobody answers yet.
      if (review && !gm && !actor) continue;
      const self = p.source.kind === "rider" ? p.source.characterId : undefined;
      const choosers = [];
      for (const c of p.choosers) {
        const answered = p.answers.some((a) => a.stepId === c.stepId && a.chooserId === c.chooserId);
        const mine = !review && !answered && (gm || (c.characterId !== undefined && (await canEdit(c.characterId))));
        choosers.push({
          stepId: c.stepId,
          chooserId: c.chooserId,
          ...(c.characterId ? { characterId: c.characterId } : {}),
          name: c.name,
          label: c.label,
          options: c.options,
          answered,
          mine,
          self: self !== undefined && c.characterId === self,
        });
      }
      if (!gm && !actor && !choosers.some((c) => c.mine || (c.characterId !== undefined && edits.get(c.characterId) === true))) continue;
      out.push({ requestId: row._id, name: p.name, actorName: p.actorName, actor, createdAt: row.createdAt, review, choosers });
    }
    return out;
  },
});
