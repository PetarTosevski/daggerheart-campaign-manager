import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { logAction } from "../../../convex/lib/actionLog";
import type { Area, Entry, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: server-decided feature uses (plan drawer-answers, tracer DA12; docs/tasks/TASK-DA-DA12.md).
 * `featurePrompts.*` act for a character the caller edits (campaign wrappers with `need: "view"`, then
 * `loadCharacter(..., "edit")`): another player is FORBIDDEN, the GM plays for anyone.
 *
 * The worlds' characters are warriors without Warden's Protection or Charge, so an allowed row stops at a domain check:
 * `rollCount` FEATURE_NOT_OWNED, `targetCount` null, `charge` INVALID for the GM (no Difficulty) or FEATURE_NOT_OWNED for
 * the player (a player's Charge goes to the GM, B2). B2: `answerDifficulty` (GM) answers an open `difficulty` request;
 * `combatRequestsReads.difficulties` lists them (the GM all, a player their own). Content:
 * tests/convex/feature-prompts.test.ts.
 */

// Another player acting for characterA is refused by `loadCharacter` (edit on the character).
const NOT_THEIRS = { otherPlayer: "FORBIDDEN" } as const;
const WARDEN = "subclass:warden-of-renewal:wardens-protection";

/** A map with characterA's token and an enemy token (`mapId`, `tokenId`). */
async function board(w: World) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
  const tokenId = await w.t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10 });
    return ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterB }, side: "enemy", x: 12, y: 10 });
  });
  w.set("mapId", mapId);
  w.set("tokenId", tokenId);
}

/**
 * DA13: an open Cannonball prompt of characterB's use, rolled by characterA (`requestId`). The roll names characterA's own
 * token as the target (not an enemy), so an allowed `allyRoll` stops at COMBAT_TARGET_INVALID before anything is written.
 */
async function allyRollRow(w: World) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
  const { requestId, rollerTokenId } = await w.t.run(async (ctx) => {
    const rollerTokenId = await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10 });
    const entryId = await logAction(ctx, { campaignId: w.campaignId, characterId: w.characterB, actorId: w.users.otherPlayer, kind: "combat", visibility: "public", summary: "Bryn uses Cannonball", groupId: "g-cannonball", undoable: true });
    const requestId = await ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      mapId,
      kind: "allyRoll",
      status: "open",
      createdBy: w.users.otherPlayer,
      createdAt: Date.now(),
      responses: [],
      payload: { schemaVersion: 1, kind: "allyRoll", characterId: w.characterB, featureId: CANNONBALL, useId: "main", rollerCharacterId: w.characterA, rollerTokenId, groupId: "g-cannonball", entryId, expiresAt: Date.now() + 60 * 60_000 },
    });
    return { requestId, rollerTokenId };
  });
  w.set("requestId", requestId);
  w.set("rollerTokenId", rollerTokenId);
}

const CANNONBALL = "beastform:armored-sentry:cannonball";

/** B2: an open player's Charge waiting for the GM's Difficulty (`requestId`). */
async function difficultyRow(w: World) {
  await board(w);
  const requestId = await w.t.run((ctx) =>
    ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      mapId: w.ids.mapId as Id<"combatMaps">,
      kind: "difficulty",
      status: "open",
      createdBy: w.users.player,
      createdAt: Date.now(),
      responses: [],
      payload: { schemaVersion: 1, kind: "difficulty", characterId: w.characterA, ask: { kind: "charge", targetTokenId: w.ids.tokenId as Id<"combatTokens">, square: { x: 11, y: 10 }, stress: false, roll: {} } },
    }),
  );
  w.set("requestId", requestId);
}

/**
 * Plan lanes-2 E1.4a (dcm-vx5n): an open "Does <name>'s Cloaked end?" prompt of characterA's use on the enemy token
 * (`requestId`). An allowed `answer` declines it (`ends: false`): nothing changes on the sheet.
 */
async function cloakPromptRow(w: World) {
  await board(w);
  const requestId = await w.t.run((ctx) =>
    ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      mapId: w.ids.mapId as Id<"combatMaps">,
      kind: "cloakPrompt",
      status: "open",
      createdBy: w.users.player,
      createdAt: Date.now(),
      responses: [],
      payload: { schemaVersion: 1, kind: "cloakPrompt", characterId: w.characterA, tokenId: w.ids.tokenId as Id<"combatTokens">, label: "Words of Discord", groupId: "g-cloak", targetTokenIds: [w.ids.tokenId as Id<"combatTokens">] },
    }),
  );
  w.set("requestId", requestId);
}

const entries: Entry[] = [
  // E1.4a (dcm-vx5n): the GM's Cloaked prompts and the GM's answer.
  { fn: api.cloakPromptsReads.pending, access: "gm", args: () => ({}) },
  { fn: api.cloakPrompts.answer, access: "gm", setup: cloakPromptRow, args: (w) => ({ requestId: w.ids.requestId as Id<"combatRequests">, ends: false }) },
  // DA13 (Cannonball): the ally's drawer read, the ally's roll (the roller's player or the GM), the GM's cancel.
  { fn: api.featurePromptsReads.allyRolls, access: "view", args: (w) => ({ characterId: w.characterA }), expect: NOT_THEIRS },
  {
    fn: api.featurePrompts.allyRoll,
    access: "view",
    setup: allyRollRow,
    args: (w) => ({ requestId: w.ids.requestId as Id<"combatRequests">, trait: "strength", targetTokenId: w.ids.rollerTokenId as Id<"combatTokens"> }),
    expect: NOT_THEIRS,
    okCodes: ["COMBAT_TARGET_INVALID"],
  },
  { fn: api.featurePrompts.cancelAllyRoll, access: "gm", setup: allyRollRow, args: (w) => ({ requestId: w.ids.requestId as Id<"combatRequests"> }) },
  {
    fn: api.featurePrompts.rollCount,
    access: "view",
    args: (w) => ({ characterId: w.characterA, featureId: WARDEN }),
    expect: NOT_THEIRS,
    okCodes: ["FEATURE_NOT_OWNED"],
  },
  { fn: api.featurePrompts.targetCount, access: "view", args: (w) => ({ characterId: w.characterA, featureId: WARDEN }), expect: NOT_THEIRS },
  // B1: the drawer's Charge pick (the board's map is not live, so an allowed row reads an empty list).
  { fn: api.featurePrompts.chargeOptions, access: "view", setup: board, args: (w) => ({ characterId: w.characterA, mapId: w.ids.mapId as Id<"combatMaps"> }), expect: NOT_THEIRS },
  {
    fn: api.featurePrompts.charge,
    access: "view",
    setup: board,
    args: (w) => ({
      characterId: w.characterA,
      mapId: w.ids.mapId as Id<"combatMaps">,
      targetTokenId: w.ids.tokenId as Id<"combatTokens">,
      square: { x: 11, y: 10 },
      stress: false,
      roll: {},
    }),
    expect: NOT_THEIRS,
    okCodes: ["INVALID", "FEATURE_NOT_OWNED"],
  },
  // B2: the rolls waiting for the GM's Difficulty, and the GM's answer (a decline: nothing is rolled).
  { fn: api.combatRequestsReads.difficulties, access: "view", args: () => ({}) },
  { fn: api.featurePrompts.answerDifficulty, access: "gm", setup: difficultyRow, args: (w) => ({ requestId: w.ids.requestId as Id<"combatRequests">, difficulty: null }) },
];

const area: Area = { area: "prompts", entries };

export default area;
