/**
 * Combat map domain (D9): layout spec, sight defaults, range bands, light and
 * the vision engine. Pure TypeScript, shared by Convex and the browser.
 *
 * Server (C7), per query:
 *   const map = prepareMap({ w, h, base, areas, objects, paint, block, image });
 *   const view = createView(map, { token: myToken, characterId, instinct }, { phase, tokens, fog });
 *   tokens.filter((t) => tokenVisibility(view, t) !== "hidden");
 * Client (C8): visibleSquares(view).levels paints fog; exploredFrom / encodeExplored for markExplored.
 */

export * from "./spec";
export * from "./sight";
export * from "./ranges";
export * from "./light";
export * from "./vision";
