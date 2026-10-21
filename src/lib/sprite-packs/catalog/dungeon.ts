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
});
