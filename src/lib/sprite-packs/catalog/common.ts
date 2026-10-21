// Built-in catalog: common (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const COMMON = defineFolder("common", {
  props: [
    obj("wooden crate", "cover", "low", "crate"),
    obj("barrel", "cover", "low", "barrel"),
    obj("treasure chest (closed)", "cover", "low", "chest"),
    obj("treasure chest (open, coins inside)", "cover", "low", "chest"),
    obj("sack of grain", "cover", "low", "crate", { standIn: false }),
    obj("small round table", "cover", "low", "table"),
    obj("wooden chair", "cover", "low", "table", { standIn: false }),
    obj("bedroll", "none", "flat", "log", { move: "open", standIn: false }),
    obj("campfire (burning)", "none", "low", "campfire", { light: "campfire" }),
    obj("campfire (burnt out, ashes)", "none", "flat", "rubble", { standIn: false }),
    obj("standing torch (lit)", "none", "tall", "torch", { light: "torch" }),
    obj("iron brazier (lit)", "none", "low", "torch", { light: "torch" }),
    obj("pile of rubble", "cover", "low", "rubble", { move: "difficult" }),
    obj("scattered bones and a skull", "none", "flat", "bones"),
    obj("weapon rack with swords and spears", "cover", "low", "crate", { footprint: "rect", standIn: false }),
    obj("coil of rope and a lantern", "none", "low", "crate", { standIn: false }),
  ],
  large: [
    obj("covered wagon", "block", "tall", "tent", { footprint: "rect", standIn: false }),
    obj("hay cart", "block", "tall", "tent", { footprint: "rect", standIn: false }),
    long("long feast table with benches", "cover", "low", "table"),
    long("bookshelf (seen from above, two squares wide)", "block", "tall", "crate", { standIn: false }),
    obj("canvas tent (closed)", "block", "tall", "tent"),
    obj("large boulder", "block", "tall", "boulder"),
    long("fallen tree trunk", "cover", "low", "log", { move: "difficult" }),
    obj("stone well", "cover", "low", "rock", { standIn: false }),
    obj("broken statue lying on its side", "cover", "low", "statue", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("grass", "grass", true),
    tex("packed dirt", "dirt", true),
    tex("cobblestone road", "path", false),
    tex("flagstone floor", "stone", false),
  ],
});
