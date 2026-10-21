// Built-in catalog: snow and tundra (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const SNOW_AND_TUNDRA = defineFolder("snow-and-tundra", {
  props: [
    obj("snowy rock", "cover", "low", "rock"),
    obj("ice chunk", "cover", "low", "rock", { standIn: false }),
    obj("snowman", "cover", "low", "statue", { standIn: false }),
    obj("frozen bush", "cover", "low", "bush"),
    obj("animal tracks", "none", "flat", "bones", { move: "open", standIn: false }),
    obj("snowy log", "cover", "low", "log"),
    obj("ice spike", "cover", "low", "crystal", { standIn: false }),
    obj("campfire in snow", "none", "low", "campfire", { light: "campfire" }),
    obj("fur bedroll", "none", "flat", "log", { move: "open", standIn: false }),
    obj("sled", "cover", "low", "crate", { footprint: "rect", standIn: false }),
    obj("frozen corpse", "none", "low", "bones", { standIn: false }),
    obj("wolf", "none", "low", "rock", { standIn: false }),
    obj("snowdrift", "cover", "low", "rubble", { move: "difficult", standIn: false }),
    obj("broken spear in ice", "none", "flat", "bones", { standIn: false }),
    obj("snowy signpost", "none", "tall", "pillar", { standIn: false }),
    obj("icicle cluster", "none", "low", "crystal"),
  ],
  large: [
    obj("snowy pine tree", "block", "tall", "tree", { variant: "pine" }),
    obj("frozen lake hole", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("ice formation", "block", "tall", "boulder"),
    obj("igloo", "block", "tall", "tent"),
    obj("snowy boulder", "block", "tall", "boulder"),
    obj("mammoth skeleton", "cover", "low", "bones", { standIn: false }),
    obj("frozen waterfall base", "block", "tall", "boulder", { standIn: false }),
    obj("snow-covered tent", "block", "tall", "tent"),
    obj("ice cave mouth", "block", "tall", "boulder", { standIn: false }),
  ],
  terrain: [
    tex("fresh snow", "snow", true),
    tex("packed snow", "snow", true),
    tex("ice", "water", true),
    tex("frozen tundra grass", "grass", true),
  ],
});
