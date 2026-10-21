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
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11B): new items, not variants; none stands in for a Classic kind.
  // No light sources (the frozen lantern is out; the frost crystal does not glow). Ice holes and the frozen pond are
  // difficult (like the frozen lake hole and ice patch), the crevasse by the pit default; the ice bridge is open.
  // Sizes: longhouse 4 x 3 (against the 3 x 3 cottages), dog sled team 3 x 1, the full-cell ice scenes 3 x 3.
  extras: {
    "props-2": [
      obj("arctic fox", "none", "low", "rock", { standIn: false }),
      obj("snowy owl", "none", "low", "rock", { standIn: false }),
      obj("seal", "none", "low", "rock", { standIn: false }),
      obj("ice-fishing hole with a rod", "none", "flat", "rock", { move: "difficult", standIn: false }),
      obj("frozen treasure chest", "cover", "low", "chest", { standIn: false }),
      obj("pair of snowshoes", "none", "flat", "log", { move: "open", standIn: false }),
      obj("sword frozen in ice", "cover", "low", "crystal", { standIn: false }),
      obj("frost crystal", "none", "low", "crystal", { standIn: false }),
      obj("frozen lantern", "none", "low", "barrel", { standIn: false }),
      obj("wooden skis", "none", "flat", "log", { move: "open", standIn: false }),
      obj("dropped fur cloak", "none", "flat", "log", { move: "open", standIn: false }),
      obj("mammoth tusk", "none", "low", "bones", { standIn: false }),
      obj("frosted barrel", "cover", "low", "barrel", { standIn: false }),
      obj("ice sculpture", "cover", "low", "statue", { move: "block", standIn: false }),
      obj("snow hare", "none", "low", "rock", { standIn: false }),
      obj("small frozen pond", "none", "flat", "rock", { move: "difficult", standIn: false }),
    ],
    "large-2": [
      obj("polar bear", "cover", "low", "rock", { standIn: false }),
      obj("yeti", "cover", "tall", "rock", { standIn: false }),
      obj("reindeer", "cover", "low", "rock", { standIn: false }),
      obj("longhouse (whole roof)", "block", "tall", "pillar", { footprint: "rect", w: 4, h: 3, standIn: false }),
      obj("dog sled team", "cover", "low", "crate", { footprint: "rect", w: 3, h: 1, standIn: false }),
      obj("frozen ship's bow", "block", "tall", "boulder", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("ice bridge", "none", "flat", "rubble", { move: "open", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("glacier crevasse", "none", "flat", "rubble", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("frost giant frozen in ice", "block", "tall", "boulder", { footprint: "rect", standIn: false }),
    ],
    "terrain-2": [
      tex("blue glacier ice", "water", true),
      tex("wind-swept snow", "snow", true),
      tex("slush", "snow", true),
      tex("frozen gravel", "dirt", true),
    ],
  },
});
