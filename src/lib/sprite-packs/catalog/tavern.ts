// Built-in catalog: tavern (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const TAVERN = defineFolder("tavern", {
  props: [
    obj("tavern table with mugs", "cover", "low", "table"),
    obj("stool", "cover", "low", "table", { standIn: false }),
    obj("barrel tap", "cover", "low", "barrel"),
    obj("keg", "cover", "low", "barrel"),
    obj("chair", "cover", "low", "table", { standIn: false }),
    obj("plate of food", "none", "flat", "table", { standIn: false }),
    obj("tankard tray", "none", "flat", "table", { standIn: false }),
    obj("broom", "none", "flat", "log", { standIn: false }),
    obj("card game table", "cover", "low", "table"),
    obj("candle", "none", "low", "crystal", { light: "faintglow" }),
    obj("coat rack", "none", "tall", "pillar", { standIn: false }),
    obj("bard's lute", "none", "flat", "log", { standIn: false }),
    obj("drunk patron asleep", "none", "low", "bones", { standIn: false }),
    obj("cat", "none", "low", "rock", { standIn: false }),
    obj("bucket", "none", "low", "barrel", { standIn: false }),
    obj("notice board", "cover", "tall", "pillar", { footprint: "rect", standIn: false }),
  ],
  large: [
    long("bar counter (two squares)", "cover", "low", "table", { standIn: false }),
    obj("hearth fireplace", "block", "tall", "campfire", { footprint: "rect", light: "campfire" }),
    long("long bench table", "cover", "low", "table"),
    obj("stage platform", "none", "low", "table", { footprint: "rect", standIn: false }),
    obj("stair up", "none", "low", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("kitchen stove", "cover", "low", "campfire", { footprint: "rect", light: "campfire" }),
    obj("storeroom shelves", "block", "tall", "crate", { footprint: "rect", standIn: false }),
    obj("booth with benches", "cover", "low", "table", { footprint: "rect", standIn: false }),
    obj("bed (inn room)", "cover", "low", "table", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("tavern floorboards", "wood", false),
    tex("worn planks", "wood", false),
    tex("kitchen tiles", "stone", false),
    tex("stone hearth floor", "stone", true),
  ],
});
