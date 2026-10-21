// Built-in catalog: ruins (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const RUINS = defineFolder("ruins", {
  props: [
    obj("broken column piece", "cover", "low", "rubble"),
    obj("fallen statue hand", "cover", "low", "rubble", { standIn: false }),
    obj("cracked tile", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("vine-covered rock", "cover", "low", "rock"),
    obj("ancient urn", "cover", "low", "barrel", { standIn: false }),
    obj("rubble", "cover", "low", "rubble", { move: "difficult" }),
    obj("crumbled wall stub", "cover", "low", "rubble", { standIn: false }),
    obj("mossy brick pile", "cover", "low", "rubble", { move: "difficult" }),
    obj("old coin pile", "none", "flat", "chest", { standIn: false }),
    obj("rusted helmet", "none", "flat", "bones", { standIn: false }),
    obj("bones", "none", "flat", "bones"),
    obj("overgrown shrub", "cover", "low", "bush"),
    obj("broken arch stone", "cover", "low", "rock", { standIn: false }),
    obj("torn banner", "none", "flat", "rubble", { standIn: false }),
    obj("ritual circle stone", "cover", "low", "rock", { standIn: false }),
    obj("lizard", "none", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("broken column", "block", "tall", "pillar"),
    obj("fallen arch", "cover", "low", "rubble", { footprint: "rect", standIn: false }),
    obj("overgrown statue", "block", "tall", "statue"),
    obj("ruined wall corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("collapsed tower base", "block", "tall", "boulder", { standIn: false }),
    obj("ancient altar", "cover", "low", "table", { footprint: "rect", standIn: false }),
    obj("tree growing through stone", "block", "tall", "tree", { variant: "dark" }),
    obj("broken fountain", "cover", "low", "statue", { standIn: false }),
    obj("stone stairs leading nowhere", "cover", "low", "rubble", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("cracked ancient flagstones", "stone", false),
    tex("overgrown stone", "stone", true),
    tex("mossy rubble ground", "dirt", true),
    tex("sand-covered tiles", "sand", false),
  ],
});
