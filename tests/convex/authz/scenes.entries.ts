import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: scenes on the Combat Map (plan sheet-drawer SD8, Q7). `combatScenes.end` is the GM's End scene button on
 * the Combat Map GM column and the Encounter tab: a keyed GM mutation (anonymous UNAUTHENTICATED, outsider NOT_FOUND,
 * player FORBIDDEN, GM ok). The dashboard's RF1 `scenes.end` stays in the world area.
 */
const area: Area = {
  area: "scenes",
  entries: [{ fn: api.combatScenes.end, access: "gm" }],
};

export default area;
