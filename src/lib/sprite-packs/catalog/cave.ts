// Built-in catalog: cave (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const CAVE = defineFolder("cave", {
  props: [
    obj("stalagmite", "cover", "low", "rock", { standIn: false }),
    obj("glowing mushroom cluster", "none", "low", "mushroom", { light: "faintglow" }),
    obj("cave crystal", "none", "low", "crystal", { light: "faintglow" }),
    obj("rock pile", "cover", "low", "rubble", { move: "difficult" }),
    obj("puddle", "none", "flat", "rock", { standIn: false }),
    obj("bat colony (hanging)", "none", "low", "bones", { standIn: false }),
    obj("bones", "none", "flat", "bones"),
    obj("old campfire", "none", "flat", "rubble", { standIn: false }),
    obj("ore vein", "none", "flat", "rock", { standIn: false }),
    obj("spider web", "none", "flat", "bones", { standIn: false }),
    obj("small stalagmite pair", "cover", "low", "rock", { standIn: false }),
    obj("fungus patch", "none", "flat", "mushroom"),
    obj("cave lizard", "none", "low", "rock", { standIn: false }),
    obj("lost backpack", "none", "low", "crate", { standIn: false }),
    obj("rock column (thin)", "block", "tall", "pillar"),
    obj("dripping water pool", "none", "flat", "rock", { standIn: false }),
  ],
  large: [
    obj("rock column", "block", "tall", "pillar"),
    obj("underground pool", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("giant crystal cluster", "block", "tall", "crystal", { light: "faintglow" }),
    obj("chasm crack", "none", "flat", "rubble", { standIn: false }),
    obj("giant spider web", "none", "flat", "bones", { standIn: false }),
    obj("rock wall chunk", "block", "tall", "boulder", { footprint: "rect" }),
    obj("mushroom grove", "block", "tall", "mushroom", { standIn: false }),
    obj("collapsed tunnel", "cover", "low", "rubble", { move: "difficult" }),
    obj("ancient altar stone", "cover", "low", "table", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("cave floor stone", "cave", true),
    tex("wet cave rock", "cave", true),
    tex("cave gravel", "cave", true),
    tex("underground water (shallow)", "water", true),
  ],
});
