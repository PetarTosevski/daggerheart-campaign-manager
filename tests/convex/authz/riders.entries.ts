import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area, Entry, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: riders and the after-roll step on map attacks (plan sheet-drawer, tracer SD5; docs/tasks/TASK-SD-SD5.md).
 * `combatActions.riders` reads the character's own sheet (edit: the character's player or the GM; another player is
 * FORBIDDEN, U1). `combatActions.afterRoll` answers a held attack for a character the caller edits (the player's Use /
 * Pass, the GM's Resolve now). Content: tests/convex/combat-riders.test.ts.
 */

// Another player acting for characterA is refused by `loadCharacter` (edit on the character).
const NOT_THEIRS = { otherPlayer: "FORBIDDEN" } as const;

/** A live map with characterA's token, an Ogre and an open after-roll request on characterA's attack (`requestId`). */
async function held(w: World) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
  const now = Date.now();
  const ids = await w.t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10 });
    const encounterId = await ctx.db.insert("encounters", { campaignId: w.campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const ogre = await ctx.db.insert("encounterAdversaries", {
      campaignId: w.campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Ogre",
      order: 0,
      summoned: false,
      stats: { difficulty: 99, major: 100, severe: 200, hpMax: 5, stressMax: 1 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const ogreToken = await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: Math.PI, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: ogre }, side: "enemy", x: 6, y: 10 });
    const requestId = await ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      encounterId,
      mapId,
      kind: "afterRoll",
      status: "open",
      createdBy: w.users.player,
      createdAt: now,
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "afterRoll",
        characterId: w.characterA,
        action: { kind: "attack", slot: "primary", targetTokenIds: [ogreToken], roll: { modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [] } },
        dice: [3, 7],
        dualityAt: 0,
        roll: { kind: "action", dice: [{ sides: 12, value: 3, role: "hope" }, { sides: 12, value: 7, role: "fear" }], modifier: 0, total: 10, outcome: "successFear", manual: false },
        hits: [{ tokenId: ogreToken, hit: false }],
        options: [{ featureId: "hope:warlock", useId: "main" }],
      },
    });
    // DA2: a Death Strike prompt on the attack (an actionLog row of characterA's, not undone).
    const entryId = await ctx.db.insert("actionLog", {
      campaignId: w.campaignId,
      characterId: w.characterA,
      actorId: w.users.player,
      kind: "combat",
      visibility: "public",
      summary: "attack",
      groupId: "g-da2",
      undoable: true,
      at: now,
    } as never);
    const pickId = await ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      encounterId,
      mapId,
      kind: "riderPick",
      status: "open",
      createdBy: w.users.player,
      createdAt: now,
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "riderPick",
        characterId: w.characterA,
        groupId: "g-da2",
        entryId,
        rider: { source: "feature", id: "subclass:executioners-guild:death-strike", useId: "main", name: "Death Strike" },
        candidates: [ogreToken],
        hostRoll: { success: true, critical: false, withHope: true, withFear: false },
      },
    });
    return { mapId, requestId, pickId };
  });
  w.set("mapId", ids.mapId);
  w.set("requestId", ids.requestId);
  w.set("pickId", ids.pickId);
}

const entries: Entry[] = [
  { fn: api.combatActions.riders, access: "view", args: (w) => ({ characterId: w.characterA }), expect: NOT_THEIRS },
  {
    fn: api.combatActions.afterRoll,
    access: "view",
    setup: held,
    args: (w) => ({ requestId: w.ids.requestId as Id<"combatRequests">, choice: { kind: "pass" } }),
    expect: NOT_THEIRS,
    // A row answered by an earlier role is no longer open.
    okCodes: ["REQUEST_NOT_OPEN"],
  },
  // DA2: the attacker's player or the GM answers a damage-phase rider prompt (Death Strike); Pass closes it.
  {
    fn: api.combatActions.riderPick,
    access: "view",
    setup: held,
    args: (w) => ({ requestId: w.ids.pickId as Id<"combatRequests">, choice: { kind: "pass" } }),
    expect: NOT_THEIRS,
    okCodes: ["REQUEST_NOT_OPEN"],
  },
];

const area: Area = { area: "riders", entries };

export default area;
