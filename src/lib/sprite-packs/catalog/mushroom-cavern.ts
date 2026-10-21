// Built-in catalog: mushroom cavern (underdark) (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const MUSHROOM_CAVERN = defineFolder("mushroom-cavern", {
  props: [
    obj("glowing blue mushroom", "none", "low", "mushroom", { light: "faintglow" }),
    obj("glowing purple mushroom", "none", "low", "mushroom", { light: "faintglow" }),
    obj("spore puff", "none", "low", "mushroom"),
    obj("luminous moss", "none", "flat", "mushroom", { light: "faintglow" }),
    obj("crystal shard", "none", "low", "crystal", { light: "faintglow" }),
    obj("underground beetle", "none", "low", "rock", { standIn: false }),
    obj("rock", "cover", "low", "rock"),
    obj("mushroom stump", "cover", "low", "log", { standIn: false }),
    obj("silk cocoon", "cover", "low", "barrel", { standIn: false }),
    obj("dark pool", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("bones", "none", "flat", "bones"),
    obj("fungal spike", "cover", "low", "mushroom", { standIn: false }),
    obj("glowing lichen", "none", "flat", "mushroom", { light: "faintglow" }),
    obj("strange egg", "cover", "low", "barrel", { standIn: false }),
    obj("drow lantern", "none", "low", "torch", { light: "torch" }),
    obj("cave fish", "none", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("giant glowing mushroom", "block", "tall", "mushroom", { light: "faintglow" }),
    obj("mushroom cluster", "block", "tall", "mushroom", { standIn: false }),
    obj("giant crystal", "block", "tall", "crystal", { light: "faintglow" }),
    obj("underground lake", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("fungal tree", "block", "tall", "tree", { variant: "pink" }),
    obj("spider silk wall", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("obsidian rock", "block", "tall", "boulder"),
    obj("chasm", "none", "flat", "rubble", { standIn: false }),
    obj("ancient drow statue", "block", "tall", "statue"),
  ],
  terrain: [
    tex("dark cave floor", "cave", true),
    tex("glowing moss floor", "cave", true),
    tex("fungal carpet", "cave", true),
    tex("black underground water", "water", true),
  ],
});
