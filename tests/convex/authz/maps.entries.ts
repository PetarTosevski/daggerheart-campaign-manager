import { api } from "../../../convex/_generated/api";
import type { Area, Outcome, Role } from "./harness";

/**
 * Authz matrix: World map hex grid calibration (tracer WH1, dcm-kggd). The rest of the map functions are in
 * world.entries.ts. Like every map change, `calibrateHexGrid` goes through `mapAccess` (edit on the `map` resource),
 * so the grantee acts as the GM; it is a Journey to Horizon crawl function (`gmCrawl`).
 */
const GM_CHANGE: Partial<Record<Role, Outcome>> = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", grantee: "ok", gm: "ok" };

const area: Area = {
  area: "maps",
  entries: [
    {
      fn: api.maps.calibrateHexGrid,
      access: "scoped",
      world: { frameId: "journey-to-horizon" },
      // Back to the printed grid: allowed over the frame's own art, so the GM's call succeeds.
      args: () => ({ change: { field: "printed" } }),
      expect: GM_CHANGE,
    },
  ],
};

export default area;
