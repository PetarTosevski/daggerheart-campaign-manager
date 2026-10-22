import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area, Entry, World } from "./harness";

/**
 * Authz matrix: adversaryActions (plan combat-actions, tracer AA2; docs/tasks/TASK-CA-AA2.md). Content checks are in
 * tests/convex/adversary-actions.test.ts, the target / ally / other-player rows in adversary-actions-authz.test.ts.
 *
 * The area's setup gives every world a running encounter with a Bear (SRD) and an open incoming hit on characterA (Ash)
 * from it, Ash being its only responder (the target). So `respond` and `pending` act on a real hit for Ash's player and
 * the GM; another player is refused by `loadCharacter` (edit on the character), as for CA4's `useCard`.
 */
export async function setup(w: World) {
  const campaignId = w.campaignId;
  const characterA = w.characterA;
  const gm = w.users.gm;
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
    const requestId = await ctx.db.insert("combatRequests", {
      campaignId,
      encounterId,
      kind: "incomingHit",
      status: "open",
      createdBy: gm,
      createdAt: now,
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "incomingHit",
        attacker: { instanceId: bear, label: "Bear" },
        targetCharacterId: characterA,
        damage: 6,
        damageType: "physical",
        direct: false,
        critical: false,
        groupId: "matrix-group",
        responders: [{ characterId: characterA, role: "target", cardIds: [] }],
      },
    });
    return { bear, requestId };
  });
  w.set("bear", ids.bear);
  w.set("requestId", ids.requestId);
}

// Another player answering for, or reading the hits of, characterA is refused by `loadCharacter` (edit).
const NOT_THEIRS = { otherPlayer: "FORBIDDEN" } as const;

const entries: Entry[] = [
  { fn: api.adversaryActions.attack, access: "gm", args: (w) => ({ instanceId: w.ids.bear, targets: [w.characterA] }) },
  { fn: api.adversaryActions.useFeature, access: "gm", args: (w) => ({ instanceId: w.ids.bear, feature: "Bite", targets: [w.characterA] }) },
  {
    fn: api.adversaryActions.respond,
    access: "view",
    args: (w) => ({ requestId: w.ids.requestId as Id<"combatRequests">, characterId: w.characterA, choice: { kind: "noArmor" } }),
    expect: NOT_THEIRS,
  },
  { fn: api.adversaryActions.resolve, access: "gm", args: (w) => ({ requestId: w.ids.requestId }) },
  { fn: api.adversaryActions.pending, access: "view", args: (w) => ({ characterId: w.characterA }), expect: NOT_THEIRS },
  { fn: api.adversaryActions.windows, access: "gm" },
];

const area: Area = { area: "adversary-actions", setup, entries };

export default area;
