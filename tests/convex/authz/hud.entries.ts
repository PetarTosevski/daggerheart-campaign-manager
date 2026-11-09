import { api } from "../../../convex/_generated/api";
import type { Area, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: Combat HUD reads (plan `.omc/plans/combat-hud.yaml`, tracer HD1). `combatHud.party` and
 * `combatHud.scene` are every member's (`need: "view"`): anonymous UNAUTHENTICATED, outsider NOT_FOUND, every member
 * (player, other player, grantee, GM) ok. The area's setup puts a live map with characterA's PC token on it, so the
 * member rows read real banners. What the rows contain (no adversary data, the live map only for players, the scene's
 * flags, enemy condition names) is checked in tests/convex/hud-party.test.ts and hud-enemy-conditions.test.ts.
 * `combatHud.sheet` (HD2, `userQuery` + `loadCharacter(..., "view")`: class `own`) is every member's too; its modes and
 * what view mode leaves out are checked in tests/convex/hud-sheet.test.ts.
 * `combatWithdraw.withdraw` (HD3, answer 8a; `need: "view"` + `loadCharacter(..., "edit")` on the request's character):
 * characterA's player, the edit grantee and the GM withdraw characterA's open sanction (or Charge waiting for its
 * Difficulty, user 2026-11-02); another player is FORBIDDEN.
 * Its content checks are in tests/convex/hud-withdraw.test.ts.
 * `combatHud.sceneEndPreview` (H5.3, `gmQuery`): the GM only; what it lists is checked in tests/convex/hud-scene-end.test.ts.
 * `combatHud.resultDamage` (dcm-uemx, `gmQuery`): the GM only; what it reads is checked in
 * tests/convex/card-result-targets.test.ts. `combatHud.playerResults` (dcm-uemx, `gmQuery`): the GM only; its content is
 * checked there too.
 */
async function setup(w: World) {
  const campaignId = w.campaignId;
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: freshKey() });
  await w.t.run((ctx) =>
    ctx.db.insert("combatTokens", {
      campaignId,
      mapId,
      size: 1,
      face: 0,
      light: "none",
      revealedTo: [],
      ref: { kind: "pc", characterId: w.characterA },
      side: "pc",
      x: 5,
      y: 10,
    }),
  );
  w.set("mapId", mapId);
}

/** An open card sanction of characterA, asked by its player (`requestId`). */
async function sanctioned(w: World) {
  const requestId = await w.t.run((ctx) =>
    ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      kind: "sanction",
      status: "open",
      createdBy: w.users.player,
      createdAt: Date.now(),
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "sanction",
        characterId: w.characterA,
        action: { kind: "card", cardId: "cinder-grasp", useId: "main", targetTokenIds: [], choices: [] },
        outOfRange: [],
      },
    }),
  );
  w.set("requestId", requestId);
}

/** A card use's public row and its GM row with `targetDamage` (dcm-uemx), characterA's (`entryId`). */
async function resultRows(w: World) {
  const entryId = await w.t.run(async (ctx) => {
    const base = { campaignId: w.campaignId, actorId: w.users.player, kind: "combat" as const, groupId: "authz-result", undoable: true, at: Date.now() };
    const tokenId = (await ctx.db.query("combatTokens").first())!._id;
    await ctx.db.insert("actionLog", { ...base, visibility: "gm", summary: "Ash · Rain of Blades → Ogre: 7 → Major → 2 HP", targetDamage: [{ tokenId, severity: "major", hpMarked: 2 }] });
    return ctx.db.insert("actionLog", { ...base, characterId: w.characterA, visibility: "public", summary: "Ash uses Rain of Blades → Ogre: Hit" });
  });
  w.set("entryId", entryId);
}

const area: Area = {
  area: "hud",
  setup,
  entries: [
    { fn: api.combatHud.party, access: "view", args: (w) => ({ mapId: w.ids.mapId }), expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.combatHud.scene, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    // HD2 (answer 4a): every member reads any PC's sheet panel (characterA here: the other player and the grantee too).
    {
      fn: api.combatHud.sheet,
      access: "own",
      args: (w) => ({ characterId: w.characterA }),
      expect: { otherPlayer: "ok", grantee: "ok" },
    },
    // HD3 (answer 8a): edit on the request's character withdraws it (another player: `loadCharacter` FORBIDDEN).
    {
      fn: api.combatWithdraw.withdraw,
      access: "view",
      setup: sanctioned,
      args: (w) => ({ requestId: w.ids.requestId }),
      expect: { otherPlayer: "FORBIDDEN", grantee: "ok" },
    },
    // dcm-bxp.99.32.40: the GM's latest withdrawals, for the toast (gmQuery: players and the edit grantee FORBIDDEN).
    { fn: api.combatRequestsReads.withdrawn, access: "gm", expect: { otherPlayer: "FORBIDDEN", grantee: "FORBIDDEN" } },
    // H5.3: what End scene would end, for its confirm (gmQuery: the GM only; the edit grantee and players FORBIDDEN).
    { fn: api.combatHud.sceneEndPreview, access: "gm", expect: { otherPlayer: "FORBIDDEN", grantee: "FORBIDDEN" } },
    // dcm-uemx: severity and HP per adversary hit for the GM's result panel (gmQuery; U1: players and the grantee FORBIDDEN).
    {
      fn: api.combatHud.resultDamage,
      access: "gm",
      setup: resultRows,
      args: (w) => ({ entryId: w.ids.entryId }),
      expect: { otherPlayer: "FORBIDDEN", grantee: "FORBIDDEN" },
    },
    // dcm-uemx (user 2026-11-09): the players' results for the GM's HUD (gmQuery; other players' results stay theirs).
    { fn: api.combatHud.playerResults, access: "gm", expect: { otherPlayer: "FORBIDDEN", grantee: "FORBIDDEN" } },
  ],
};

export default area;
