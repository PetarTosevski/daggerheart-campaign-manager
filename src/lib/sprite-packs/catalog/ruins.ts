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
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 ruined wall corner and collapsed tower base: the dome, chapel corner and sunken plaza 3 x 3, the
  // amphitheatre section 3 x 2. The construct's runes only shine in the drawing (no light, D2). The bridge, mosaic,
  // camp kit, wildflowers and the plaza are walkable (open); the stone hand blocks; the seating is difficult (rubble).
  extras: {
    "props-2": [
      obj("giant snail", "none", "low", "rock", { standIn: false }),
      obj("stone face carving", "cover", "low", "statue", { standIn: false }),
      obj("fallen shield", "none", "flat", "bones", { standIn: false }),
      obj("rusted sword in rubble", "none", "low", "rubble", { standIn: false }),
      obj("toppled brazier", "none", "flat", "rubble", { standIn: false }),
      obj("scroll case", "none", "flat", "bones", { standIn: false }),
      obj("mosaic fragment", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("fallen roof beam", "cover", "low", "log", { standIn: false }),
      obj("crumbling pedestal", "cover", "low", "pillar", { standIn: false }),
      obj("fallen gargoyle", "cover", "low", "statue", { standIn: false }),
      obj("skeletal adventurer", "none", "flat", "bones", { standIn: false }),
      obj("explorer's camp kit", "none", "low", "crate", { standIn: false }),
      obj("rotted chest", "cover", "low", "chest", { standIn: false }),
      obj("rune-carved stone shard", "cover", "low", "rock", { standIn: false }),
      obj("stone frog idol", "cover", "low", "statue", { standIn: false }),
      obj("wildflowers in cracks", "none", "flat", "bush", { move: "open", standIn: false }),
    ],
    "large-2": [
      obj("collapsed dome", "block", "tall", "pillar", { w: 3, h: 3, standIn: false }),
      obj("amphitheatre seating section", "cover", "low", "rubble", { footprint: "rect", w: 3, h: 2, standIn: false }),
      obj("giant stone hand", "cover", "low", "statue", { move: "block", standIn: false }),
      obj("ruined library shelves", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
      obj("overgrown courtyard well", "cover", "low", "rock", { standIn: false }),
      obj("crumbling bridge", "none", "flat", "log", { move: "open", footprint: "rect", standIn: false }),
      obj("roofless chapel corner", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("ancient guardian construct", "block", "tall", "statue", { standIn: false }),
      obj("sunken plaza", "none", "flat", "rubble", { move: "open", w: 3, h: 3, standIn: false }),
    ],
    "terrain-2": [
      tex("cracked marble", "stone", false),
      tex("root-split paving", "stone", false),
      tex("vine-covered ground", "grass", true),
      tex("weathered terracotta", "stone", false),
    ],
  },
});
