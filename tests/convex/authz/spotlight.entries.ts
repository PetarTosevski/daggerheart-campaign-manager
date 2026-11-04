import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the spotlight (plan combat-hud H1.S, convex/combatSpotlight.ts). `state` is every member's (`need:
 * "view"`): anonymous UNAUTHENTICATED, outsider NOT_FOUND, every member ok. `gmTake`, `handTo` and `handToParty` (H9.S) are keyed GM
 * mutations: player, other player and grantee FORBIDDEN, GM ok. `handTo` hands it to playerA's Ash. What the state says
 * to whom and the helpers' refusals are checked in tests/convex/hud-spotlight.test.ts; the party holder and the
 * paid take (`gmTake` with `pay: "fear"`) in tests/convex/spotlight-v2.test.ts.
 */
const area: Area = {
  area: "spotlight",
  entries: [
    { fn: api.combatSpotlight.state, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.combatSpotlight.gmTake, access: "gm" },
    { fn: api.combatSpotlight.handTo, access: "gm", args: (w) => ({ characterId: w.characterA }) },
    { fn: api.combatSpotlight.handToParty, access: "gm" },
  ],
};

export default area;
