// Built-in catalog: temple (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const TEMPLE = defineFolder("temple", {
  props: [
    obj("candle stand", "none", "tall", "crystal", { light: "faintglow" }),
    obj("offering bowl", "none", "low", "barrel", { standIn: false }),
    obj("prayer mat", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    // dcm-bxp.90 (user 2026-10-22, Q-P1-1): the incense burner glows faintly.
    obj("incense burner", "none", "low", "barrel", { light: "faintglow", standIn: false }),
    obj("holy book on a lectern", "cover", "low", "table", { standIn: false }),
    obj("bell", "cover", "low", "barrel", { standIn: false }),
    obj("small statue", "cover", "low", "statue", { standIn: false }),
    obj("flower offering", "none", "flat", "bush", { standIn: false }),
    obj("font of holy water", "cover", "low", "barrel", { standIn: false }),
    obj("pew (short)", "cover", "low", "log", { footprint: "rect", standIn: false }),
    obj("relic box", "cover", "low", "chest"),
    obj("banner of the faith", "none", "tall", "pillar", { standIn: false }),
    obj("gong", "cover", "tall", "pillar", { standIn: false }),
    obj("prayer beads", "none", "flat", "bones", { standIn: false }),
    obj("urn of ashes", "cover", "low", "barrel", { standIn: false }),
    obj("kneeler", "none", "low", "table", { standIn: false }),
  ],
  large: [
    obj("altar", "cover", "low", "table", { footprint: "rect", standIn: false }),
    obj("great statue of a god", "block", "tall", "statue"),
    obj("pew row", "cover", "low", "log", { footprint: "rect", standIn: false }),
    obj("stone column", "block", "tall", "pillar"),
    obj("sacred pool", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("bell tower base", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("stained-glass light pattern", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("reliquary", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    obj("priest's dais", "none", "low", "rubble", { move: "open", footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("temple marble", "stone", true),
    tex("mosaic floor", "stone", false),
    tex("stone tiles with runes", "stone", false),
    tex("polished wood", "wood", false),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11B): new items, not variants; none stands in for a Classic kind.
  // The eternal flame bowl burns (torch light, like the floor brazier); the votive candle rack is a faint glow. The
  // lotus pond is difficult (like the sacred pool); the steps, garden floors and cushion are open; the lion statue,
  // bell and colonnade block. The cloister garden and entrance steps are 3 x 3, the colonnade 3 x 2.
  extras: {
    "props-2": [
      obj("kneeling monk", "none", "low", "rock", { standIn: false }),
      obj("hanging censer", "none", "low", "barrel", { standIn: false }),
      obj("scroll shelf", "cover", "low", "crate", { footprint: "rect", standIn: false }),
      obj("prayer wheel", "cover", "low", "barrel", { standIn: false }),
      obj("votive candle rack", "cover", "low", "crystal", { light: "faintglow", footprint: "rect", standIn: false }),
      obj("alms box", "cover", "low", "chest", { standIn: false }),
      obj("eternal flame bowl", "none", "low", "torch", { light: "torch", standIn: false }),
      obj("ceremonial dagger on a cushion", "none", "low", "chest", { standIn: false }),
      obj("golden chalice", "none", "low", "barrel", { standIn: false }),
      obj("guardian lion statue", "cover", "low", "statue", { move: "block", standIn: false }),
      obj("lotus bowl", "none", "low", "barrel", { standIn: false }),
      obj("meditation cushion", "none", "flat", "rubble", { move: "open", standIn: false }),
      obj("ritual drum", "cover", "low", "barrel", { standIn: false }),
      obj("crystal orb on a stand", "none", "low", "crystal", { standIn: false }),
      obj("small sword in a stone", "cover", "low", "rock", { standIn: false }),
      obj("tithe chest", "cover", "low", "chest", { standIn: false }),
    ],
    "large-2": [
      obj("cloister garden", "none", "flat", "rubble", { move: "open", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("lotus pond", "none", "flat", "rock", { move: "difficult", standIn: false }),
      obj("choir stalls", "cover", "low", "log", { footprint: "rect", standIn: false }),
      obj("temple entrance steps", "none", "low", "rubble", { move: "open", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("great brass bell", "cover", "tall", "barrel", { move: "block", standIn: false }),
      obj("raked sand garden", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("oracle's smoking tripod", "none", "low", "barrel", { standIn: false }),
      obj("sun-disc altar", "cover", "low", "table", { standIn: false }),
      obj("colonnade", "cover", "tall", "pillar", { move: "block", footprint: "rect", w: 3, h: 2, standIn: false }),
    ],
    "terrain-2": [
      tex("gold-inlaid floor", "stone", false),
      tex("purple prayer carpet", "stone", false),
      tex("sandstone temple floor", "stone", false),
      tex("white gravel", "path", true),
    ],
  },
});
