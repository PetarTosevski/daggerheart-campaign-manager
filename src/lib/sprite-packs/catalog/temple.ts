// Built-in catalog: temple (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const TEMPLE = defineFolder("temple", {
  props: [
    obj("candle stand", "none", "tall", "crystal", { light: "faintglow" }),
    obj("offering bowl", "none", "low", "barrel", { standIn: false }),
    obj("prayer mat", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
    obj("incense burner", "none", "low", "barrel", { standIn: false }),
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
    obj("sacred pool", "none", "flat", "rock", { standIn: false }),
    obj("bell tower base", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("stained-glass light pattern", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
    obj("reliquary", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    obj("priest's dais", "none", "low", "rubble", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("temple marble", "stone", true),
    tex("mosaic floor", "stone", false),
    tex("stone tiles with runes", "stone", false),
    tex("polished wood", "wood", false),
  ],
});
