import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: drawn walls on combat maps (plan map-editor ME4, docs/tasks/TASK-ME4.md). `combatMapWalls.list` is every
 * member's (players get the live map's runs, an unrevealed secret door as a plain wall); `add`, `update`, `moveVertex`,
 * `split`, `remove` and `setRevealed` are GM mutations: player, other player and grantee FORBIDDEN, outsider NOT_FOUND,
 * GM and co-GM ok. Doors in walls open through `combatVision.toggleDoor` (its row: combat.entries.ts).
 *
 * The setup gives every world a live medium map with one secret door run from (1, 1) to (3, 1), so every GM row has
 * a run to act on (`setRevealed` takes only secret doors; `split` at segment 0 inserts a point inside it).
 * What they do: tests/convex/combat-map-walls.test.ts.
 */
const area: Area = {
  area: "combat-maps",
  setup: async (w) => {
    const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
    const wallId = await w.t.run((ctx) => ctx.db.insert("combatMapWalls", { mapId, kind: "secret", points: [[1, 1], [3, 1]] }));
    w.use("combatMaps", mapId);
    w.use("combatMapWalls", wallId);
  },
  nameHints: { wallId: "combatMapWalls" },
  entries: [
    { fn: api.combatMapWalls.list, access: "view", expect: { otherPlayer: "ok" } },
    { fn: api.combatMapWalls.add, access: "gm", args: () => ({ kind: "wall", points: [[4, 4], [6, 4]] }) },
    { fn: api.combatMapWalls.update, access: "gm", args: () => ({ kind: "door" }) },
    { fn: api.combatMapWalls.moveVertex, access: "gm", args: () => ({ index: 1, x: 3, y: 2 }) },
    { fn: api.combatMapWalls.split, access: "gm", args: () => ({ index: 0, at: { x: 2, y: 1 } }) },
    { fn: api.combatMapWalls.remove, access: "gm" },
    { fn: api.combatMapWalls.setRevealed, access: "gm", args: () => ({ revealed: true }) },
  ],
};

export default area;
