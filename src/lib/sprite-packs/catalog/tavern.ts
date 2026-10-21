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
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11B): new items, not variants; none stands in for a Classic kind.
  // No light sources on these sheets. The cellar trapdoor stays open like the dungeon trapdoor (a floor hatch); the
  // stable stall's walls block like the fenced coop; shelves and the brewing vats block by the D1 default.
  extras: {
    "props-2": [
      obj("arm-wrestling table", "cover", "low", "table", { standIn: false }),
      obj("dice game on a barrelhead", "cover", "low", "barrel", { standIn: false }),
      obj("cheese wheel", "none", "low", "barrel", { standIn: false }),
      obj("bread basket", "none", "low", "barrel", { standIn: false }),
      obj("broken chair", "none", "low", "rubble", { standIn: false }),
      obj("spittoon", "none", "low", "barrel", { standIn: false }),
      obj("chopping board with a cleaver", "none", "flat", "table", { footprint: "rect", standIn: false }),
      obj("pot of stew", "none", "low", "barrel", { standIn: false }),
      obj("washtub of dishes", "cover", "low", "barrel", { standIn: false }),
      obj("sack of potatoes", "cover", "low", "barrel", { standIn: false }),
      obj("crate of wine bottles", "cover", "low", "crate", { standIn: false }),
      obj("overturned table", "cover", "low", "table", { standIn: false }),
      obj("hearth rug", "none", "flat", "rubble", { move: "open", standIn: false }),
      obj("bard's hand drum", "none", "low", "barrel", { standIn: false }),
      obj("small round table for two", "cover", "low", "table", { standIn: false }),
      obj("crock of pickles", "none", "low", "barrel", { standIn: false }),
    ],
    "large-2": [
      obj("wine cellar rack", "block", "tall", "crate", { footprint: "rect", standIn: false }),
      obj("brewing copper and vats", "block", "tall", "barrel", { footprint: "rect", standIn: false }),
      obj("large round table with chairs", "cover", "low", "table", { standIn: false }),
      long("gambling table", "cover", "low", "table", { standIn: false }),
      long("guest bathtub", "cover", "low", "barrel", { standIn: false }),
      long("pair of fireside armchairs", "cover", "low", "table", { standIn: false }),
      obj("inn stable stall with a horse", "cover", "low", "crate", { move: "block", footprint: "rect", standIn: false }),
      obj("cellar trapdoor with stairs", "none", "flat", "crate", { footprint: "rect", standIn: false }),
      long("back-bar shelves with bottles", "block", "tall", "crate", { standIn: false }),
    ],
    "terrain-2": [
      tex("stone cellar floor", "stone", false),
      tex("straw-covered floor", "dirt", true),
      tex("sawdust floor", "dirt", true),
      tex("dark oak planks", "wood", false),
    ],
  },
});
