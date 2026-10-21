// Built-in catalog: mushroom cavern (underdark) (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, glowTex, obj, tex } from "./types";

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
    glowTex("glowing moss floor", "cave", true),
    tex("fungal carpet", "cave", true),
    tex("black underground water", "water", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 giant glowing mushroom: the mushroom house, the circle of mushroom folk, the river bend and the
  // fungus bridge 3 x 3. Light (D2): the glowing moth, fern, seed pods, crystal flower and water lily, the crystal
  // throne and the vine curtain glow faintly (like the glowing mushrooms and giant crystal). The vine curtain blocks
  // sight but can be pushed through (difficult); the river bend is difficult (water); the fungus bridge is open.
  extras: {
    "props-2": [
      obj("mushroom-folk sprout", "none", "low", "mushroom", { standIn: false }),
      obj("glowing moth", "none", "low", "rock", { light: "faintglow", standIn: false }),
      obj("giant slug", "none", "low", "rock", { standIn: false }),
      obj("glowing fern", "cover", "low", "bush", { light: "faintglow", standIn: false }),
      obj("puffball cluster", "none", "low", "mushroom", { standIn: false }),
      obj("rock with shelf fungus", "cover", "low", "rock", { standIn: false }),
      obj("glowing seed pods", "none", "low", "mushroom", { light: "faintglow", standIn: false }),
      obj("mushroom stool", "none", "low", "mushroom", { standIn: false }),
      obj("crystal flower", "none", "low", "crystal", { light: "faintglow", standIn: false }),
      obj("cave crab", "none", "low", "rock", { standIn: false }),
      obj("dark elf crossbow", "none", "flat", "bones", { standIn: false }),
      obj("web-wrapped body", "none", "flat", "bones", { standIn: false }),
      obj("glowing water lily", "none", "flat", "mushroom", { light: "faintglow", standIn: false }),
      obj("fungal vine", "none", "flat", "log", { standIn: false }),
      obj("orange ember-cap mushroom", "none", "low", "mushroom", { standIn: false }),
      obj("spore pile", "none", "flat", "rubble", { standIn: false }),
    ],
    "large-2": [
      obj("mushroom house", "block", "tall", "pillar", { w: 3, h: 3, standIn: false }),
      obj("circle of mushroom folk", "none", "low", "mushroom", { w: 3, h: 3, standIn: false }),
      obj("underground river bend", "none", "flat", "rock", { move: "difficult", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("giant fungus bridge", "none", "flat", "log", { move: "open", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("dark elf tent", "block", "tall", "tent", { standIn: false }),
      obj("crystal throne", "block", "tall", "crystal", { light: "faintglow", standIn: false }),
      obj("giant puffball", "block", "tall", "mushroom", { standIn: false }),
      obj("curtain of glowing vines", "block", "tall", "bush", { move: "difficult", light: "faintglow", footprint: "rect", standIn: false }),
      obj("spider-goddess shrine", "cover", "low", "statue", { standIn: false }),
    ],
    "terrain-2": [
      glowTex("violet glowing moss", "cave", true),
      glowTex("crystal-studded floor", "cave", true),
      tex("spore-dust ground", "cave", true),
      tex("wet obsidian", "stone", true),
    ],
  },
});
