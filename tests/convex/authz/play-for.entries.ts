import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: the GM's "Play for this character" switch (plan drawer-answers DA6, convex/playFor.ts). Both functions
 * are gmQuery / gmMutation: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok. The character
 * argument is playerA's (synthesized from the world's first character).
 */
const area: Area = {
  area: "play-for",
  entries: [
    { fn: api.playFor.list, access: "gm" },
    { fn: api.playFor.set, access: "gm", args: (w) => ({ characterId: w.characterA, on: true }) },
  ],
};

export default area;
