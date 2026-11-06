import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area, Entry, World } from "./harness";

/**
 * Authz matrix: per-ally picks (plan finish-hud-lk FH-AP; convex/allyPicks.ts, convex/allyPicksReads.ts). Content checks
 * are in tests/convex/ally-picks.test.ts. The area's setup gives every world a running encounter with a Bear and an open
 * `allyPick` row whose only chooser is characterA (Ash): Ash's player and the GM may answer it, another player is refused
 * by `loadCharacter` (edit on the chooser's character). The answer completes the held use; the Bear's Bite with no
 * target can't run, so the row is called off (`declined`), which still means access was granted.
 */
export async function setup(w: World) {
  const campaignId = w.campaignId;
  const now = Date.now();
  const ids = await w.t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const bear = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const pickId = await ctx.db.insert("combatRequests", {
      campaignId,
      encounterId,
      kind: "allyPick",
      status: "open",
      createdBy: w.users.gm,
      createdAt: now,
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "allyPick",
        name: "Bite",
        actorName: "Bear",
        groupId: "matrix-pick-group",
        source: { kind: "adversary", instanceId: bear, args: { instanceId: bear, feature: "Bite", targets: [] }, dice: [] },
        choosers: [{ stepId: "pick", chooserId: w.characterA, characterId: w.characterA, name: "Ash", label: "Pick one", options: [{ id: "a", label: "A" }] }],
        answers: [],
      },
    });
    return { pickId };
  });
  w.set("pickId", ids.pickId);
}

const entries: Entry[] = [
  { fn: api.allyPicksReads.open, access: "view" },
  {
    fn: api.allyPicks.answer,
    access: "view",
    args: (w) => ({ requestId: w.ids.pickId as Id<"combatRequests">, stepId: "pick", chooserId: w.characterA, options: ["a"] }),
    expect: { otherPlayer: "FORBIDDEN" },
  },
  {
    // CU2 (plan rule-switches, user 2026-11-06): the actor's review of Ash's Rousing Strike before the picks go out. Ash's
    // player and the GM may send it; another player is refused by `loadCharacter` (edit on the rider's character).
    fn: api.allyPicks.send,
    access: "view",
    setup: async (w) => {
      const reviewId = await w.t.run(async (ctx) => {
        const encounter = await ctx.db
          .query("encounters")
          .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", w.campaignId).eq("status", "running"))
          .first();
        const entryId = await ctx.db.insert("actionLog", { campaignId: w.campaignId, characterId: w.characterA, actorId: w.users.gm, kind: "combat", visibility: "public", summary: "Ash attacks", groupId: "matrix-review-group", undoable: true, at: Date.now() });
        const option = [{ id: "hp", label: "Clear a Hit Point" }];
        return ctx.db.insert("combatRequests", {
          campaignId: w.campaignId,
          ...(encounter ? { encounterId: encounter._id } : {}),
          kind: "allyPick",
          status: "open",
          createdBy: w.users.gm,
          createdAt: Date.now(),
          responses: [],
          payload: {
            schemaVersion: 1,
            kind: "allyPick",
            name: "Rousing Strike",
            actorName: "Ash",
            groupId: "matrix-review-group",
            source: {
              kind: "rider",
              characterId: w.characterA,
              rider: { source: "card", id: "rousing-strike", useId: "main", name: "Rousing Strike" },
              choices: [],
              hostRoll: { success: true, critical: true, withHope: false, withFear: false },
              entryId,
            },
            choosers: [
              { stepId: "rousing", chooserId: "ash", characterId: w.characterA, name: "Ash", label: "Pick one", options: option },
              { stepId: "rousing", chooserId: "bryn", characterId: w.characterB, name: "Bryn", label: "Pick one", options: option },
            ],
            answers: [],
            review: true,
          },
        });
      });
      w.set("reviewId", reviewId);
    },
    args: (w) => ({ requestId: w.ids.reviewId as Id<"combatRequests">, drop: ["bryn"] }),
    expect: { otherPlayer: "FORBIDDEN" },
  },
];

const area: Area = { area: "ally-picks", setup, entries };

export default area;
