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
  ],
};

export default area;
