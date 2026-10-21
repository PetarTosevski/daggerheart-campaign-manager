// Built-in catalog: dungeon (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const DUNGEON = defineFolder("dungeon", {
  props: [
    obj("stone pillar (small)", "block", "tall", "pillar"),
    obj("iron cage", "cover", "tall", "crate", { move: "block", footprint: "rect", standIn: false }),
    obj("chains on the floor", "none", "flat", "bones", { standIn: false }),
    obj("lever", "none", "low", "rubble", { move: "open", standIn: false }),
    obj("pressure plate", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("wooden door (closed)", "block", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
    obj("portcullis section", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
    obj("torture rack", "cover", "low", "table", { footprint: "rect", standIn: false }),
    obj("prisoner bench", "cover", "low", "table", { footprint: "rect", standIn: false }),
    obj("trapdoor", "none", "flat", "crate", { footprint: "rect", standIn: false }),
    obj("spike trap", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
    obj("broken shackles", "none", "flat", "bones", { standIn: false }),
    obj("rat", "none", "low", "rock", { standIn: false }),
    obj("candle cluster", "none", "low", "crystal", { light: "faintglow" }),
    obj("urn", "cover", "low", "barrel", { standIn: false }),
    obj("bloodstain", "none", "flat", "bones", { move: "open", standIn: false }),
  ],
  large: [
    obj("thick stone pillar", "block", "tall", "pillar"),
    obj("iron maiden", "block", "tall", "statue", { footprint: "rect", standIn: false }),
    obj("cell with bars", "cover", "tall", "crate", { move: "block", footprint: "rect", standIn: false }),
    obj("throne", "cover", "low", "statue", { footprint: "rect", standIn: false }),
    obj("stone sarcophagus", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    obj("collapsed wall", "cover", "low", "rubble", { move: "difficult" }),
    obj("large pit", "none", "flat", "rubble", { standIn: false }),
    obj("stone stair down", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("altar with candles", "cover", "low", "table", { footprint: "rect", light: "faintglow" }),
  ],
  terrain: [
    tex("dungeon flagstones", "stone", false),
    tex("mossy stone floor", "stone", true),
    tex("cracked stone", "stone", true),
    tex("dirt and straw floor", "dirt", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11A): new items, not variants. The open wooden door and the vault
  // door are doors (traits of the closed door; an open door's `open` flag clears sight and movement, M2). Light by D2 / Q1:
  // the cauldron sits on a burning fire (campfire), the glyph trap glows faintly. The prison-cell row is 3 x 2, the rest 2 x 2.
  extras: {
    "props-2": [
      obj("mimic chest with teeth", "cover", "low", "chest", { standIn: false }),
      obj("key ring on a hook", "none", "flat", "bones", { move: "open", standIn: false }),
      obj("iron ball and chain", "none", "flat", "bones", { standIn: false }),
      obj("executioner's block with axe", "cover", "low", "log", { standIn: false }),
      obj("stocks", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("straw pile", "none", "flat", "rubble", { move: "open", standIn: false }),
      obj("poison dart trap", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("glowing glyph trap", "none", "flat", "rubble", { move: "open", light: "faintglow", standIn: false }),
      obj("collapsed skeleton", "none", "flat", "bones", { standIn: false }),
      obj("wooden door (open)", "block", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
      obj("wall manacles", "none", "low", "bones", { move: "open", standIn: false }),
      obj("guards' dice table", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("cauldron of gruel", "none", "low", "campfire", { light: "campfire", standIn: false }),
      obj("rat swarm", "none", "low", "rock", { standIn: false }),
      obj("dripping slime puddle", "none", "flat", "rock", { move: "difficult", standIn: false }),
      obj("iron floor grating", "none", "flat", "crate", { footprint: "rect", standIn: false }),
    ],
    "large-2": [
      obj("gelatinous cube", "cover", "tall", "rock", { standIn: false }),
      obj("minotaur", "cover", "tall", "rock", { standIn: false }),
      obj("guard-room table with chairs", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("torture wheel", "cover", "tall", "table", { standIn: false }),
      obj("spiked pit trap", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
      obj("round vault door", "block", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
      obj("stone golem", "cover", "tall", "statue", { standIn: false }),
      obj("row of three prison cells", "cover", "tall", "crate", { move: "block", footprint: "rect", w: 3, h: 2, standIn: false }),
      obj("spiral staircase", "none", "flat", "rubble", { move: "open", standIn: false }),
    ],
    "terrain-2": [
      tex("wet flagstones", "stone", false),
      tex("bloodstained stone", "stone", true),
      tex("iron grating floor", "stone", false),
      tex("rubble-strewn floor", "stone", true),
    ],
  },
});
