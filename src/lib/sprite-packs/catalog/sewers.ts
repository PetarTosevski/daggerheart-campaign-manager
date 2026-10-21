// Built-in catalog: sewers (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const SEWERS = defineFolder("sewers", {
  props: [
    obj("grate", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("rat", "none", "low", "rock", { standIn: false }),
    obj("sewage puddle", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("pipe outlet", "none", "low", "pillar", { standIn: false }),
    obj("broken crate", "cover", "low", "crate"),
    obj("ladder up", "none", "low", "log", { move: "open", footprint: "rect", standIn: false }),
    obj("lost dagger", "none", "flat", "bones", { standIn: false }),
    obj("fungus patch", "none", "flat", "mushroom"),
    obj("bones", "none", "flat", "bones"),
    obj("rusty chain", "none", "flat", "bones", { standIn: false }),
    obj("valve wheel", "none", "low", "rubble", { move: "open", standIn: false }),
    obj("sludge pile", "cover", "low", "rubble", { move: "difficult" }),
    obj("candle stub", "none", "low", "crystal", { light: "faintglow" }),
    obj("bucket", "none", "low", "barrel", { standIn: false }),
    obj("torn sack", "cover", "low", "crate", { standIn: false }),
    obj("eel", "none", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("sewer channel crossing", "none", "flat", "rock", { footprint: "rect", standIn: false }),
    obj("arched tunnel mouth", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("cistern", "cover", "low", "barrel", { standIn: false }),
    obj("collapsed pipe", "cover", "low", "rubble", { move: "difficult", standIn: false }),
    obj("rat nest", "cover", "low", "rubble", { standIn: false }),
    long("stone bridge over channel", "none", "flat", "log", { move: "open", standIn: false }),
    obj("thieves' hideout corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("iron gate", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
    obj("flooded chamber", "none", "flat", "rock", { move: "difficult", footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("wet sewer stone", "stone", true),
    tex("sewage water", "water", true),
    tex("slimy brick floor", "stone", false),
    tex("mossy drainage stone", "stone", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 thieves' hideout corner: the meeting table and canal boat 3 x 2. Light (D2): the embers under
  // the beggar's pot and the shrine's candles glow faintly. The sluice gate is a door (closed blocks, open passes;
  // see-through as cover, like the iron gate). Slime, debris, muck, mouldy bricks, the ooze pool, refuse heap and den
  // are difficult; the chalk mark, bedroll and drain cover are open.
  extras: {
    "props-2": [
      obj("wererat", "none", "low", "rock", { standIn: false }),
      obj("giant cockroach", "none", "low", "rock", { standIn: false }),
      obj("green slime blob", "none", "flat", "rubble", { standIn: false }),
      obj("lost boot", "none", "flat", "bones", { standIn: false }),
      obj("floating debris", "none", "flat", "rubble", { standIn: false }),
      obj("rusted key", "none", "flat", "bones", { standIn: false }),
      obj("chalked thieves' mark", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("beggar's cooking pot", "none", "low", "barrel", { light: "faintglow", standIn: false }),
      obj("rag bedroll", "none", "flat", "rubble", { move: "open", standIn: false }),
      obj("open drain cover", "none", "flat", "rubble", { move: "open", standIn: false }),
      obj("pipe junction", "cover", "low", "pillar", { standIn: false }),
      obj("mould on bricks", "cover", "low", "rubble", { standIn: false }),
      obj("caged rat trap", "none", "low", "crate", { footprint: "rect", standIn: false }),
      obj("dead rat", "none", "flat", "bones", { standIn: false }),
      obj("coins in the muck", "none", "flat", "rock", { move: "difficult", standIn: false }),
      obj("smuggled bundle", "cover", "low", "crate", { standIn: false }),
    ],
    "large-2": [
      obj("outflow waterfall", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
      obj("ooze pool", "none", "flat", "rock", { move: "difficult", footprint: "rect", standIn: false }),
      obj("thieves' guild meeting table", "cover", "low", "table", { footprint: "rect", w: 3, h: 2, standIn: false }),
      obj("forgotten shrine", "cover", "tall", "statue", { move: "block", light: "faintglow", standIn: false }),
      obj("sluice gate", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
      obj("smugglers' canal boat", "cover", "low", "log", { footprint: "rect", w: 3, h: 2, standIn: false }),
      obj("pair of brick pillars", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
      obj("refuse heap", "cover", "low", "rubble", { footprint: "rect", standIn: false }),
      obj("wererat den", "cover", "low", "rubble", { footprint: "rect", standIn: false }),
    ],
    "terrain-2": [
      tex("rusty iron grating", "stone", false),
      tex("algae-slick brick", "stone", false),
      tex("murky green water", "water", true),
      tex("wet cobbled tunnel floor", "path", false),
    ],
  },
});
