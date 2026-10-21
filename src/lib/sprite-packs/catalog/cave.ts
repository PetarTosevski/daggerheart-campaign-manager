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
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11A): new items, not variants. Light by D2 / Q1: the glowworm
  // cluster and the miner's candle glow faintly, the goblin camp has a burning campfire. The goblin camp is 3 x 3, the
  // rest 2 x 2; the dwarven door is a door (blocks while closed).
  extras: {
    "props-2": [
      obj("giant spider", "none", "low", "rock", { standIn: false }),
      obj("giant centipede", "none", "low", "rock", { standIn: false }),
      obj("kobold", "none", "low", "rock", { standIn: false }),
      obj("goblin totem", "none", "tall", "pillar", { standIn: false }),
      obj("pick and shovel", "none", "flat", "bones", { move: "open", standIn: false }),
      obj("kobold snare trap", "none", "flat", "rubble", { standIn: false }),
      obj("slab with cave paintings", "none", "flat", "rock", { standIn: false }),
      obj("glowworm cluster", "none", "flat", "mushroom", { light: "faintglow", standIn: false }),
      obj("small sinkhole", "none", "flat", "rubble", { standIn: false }),
      obj("guano pile", "none", "flat", "rubble", { standIn: false }),
      obj("rope ladder going down", "none", "flat", "rubble", { move: "open", standIn: false }),
      obj("miner's helmet with a candle", "none", "low", "crystal", { light: "faintglow", standIn: false }),
      obj("broken lantern", "none", "low", "crate", { standIn: false }),
      obj("geode cut open", "none", "low", "crystal", { standIn: false }),
      obj("fallen stalactite", "cover", "low", "rock", { standIn: false }),
      obj("cave moth", "none", "low", "rock", { standIn: false }),
    ],
    "large-2": [
      obj("goblin camp", "cover", "tall", "campfire", { light: "campfire", w: 3, h: 3, standIn: false }),
      obj("mine-cart track junction", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("stone ledge over a chasm", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
      obj("cave bear den", "none", "flat", "bones", { standIn: false }),
      obj("underground waterfall", "block", "tall", "boulder", { footprint: "rect", standIn: false }),
      obj("dwarven door in the rock", "block", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
      obj("cave troll", "cover", "tall", "rock", { standIn: false }),
      obj("giant stalactite cluster", "block", "tall", "pillar", { standIn: false }),
      obj("giant worm burrow", "none", "flat", "rubble", { standIn: false }),
    ],
    "terrain-2": [
      tex("muddy cave floor", "cave", true),
      tex("limestone flowstone", "cave", true),
      tex("crystal-flecked rock", "cave", true),
      tex("bat guano ground", "cave", true),
    ],
  },
});
