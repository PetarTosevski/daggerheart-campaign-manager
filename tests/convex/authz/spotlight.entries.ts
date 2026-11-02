import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the spotlight (plan combat-hud H1.S, convex/combatSpotlight.ts). `state` is every member's (`need:
 * "view"`): anonymous UNAUTHENTICATED, outsider NOT_FOUND, every member ok. `gmTake` and `handTo` are keyed GM
 * mutations: player, other player and grantee FORBIDDEN, GM ok. `handTo` hands it to playerA's Ash. What the state says
 * to whom and the helpers' refusals are checked in tests/convex/hud-spotlight.test.ts.
 */
const area: Area = {
  area: "spotlight",
  entries: [
    { fn: api.combatSpotlight.state, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.combatSpotlight.gmTake, access: "gm" },
    { fn: api.combatSpotlight.handTo, access: "gm", args: (w) => ({ characterId: w.characterA }) },
  ],
};

export default area;
