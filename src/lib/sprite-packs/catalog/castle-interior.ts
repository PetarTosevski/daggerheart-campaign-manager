// Built-in catalog: castle interior (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const CASTLE_INTERIOR = defineFolder("castle-interior", {
  props: [
    obj("banner stand", "none", "tall", "pillar", { standIn: false }),
    obj("suit of armour", "cover", "tall", "statue", { move: "block", standIn: false }),
    obj("candelabra", "none", "tall", "crystal", { light: "faintglow" }),
    obj("ornate chair", "cover", "low", "table", { standIn: false }),
    obj("small table with goblet", "cover", "low", "table"),
    obj("rug (small)", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("fireplace grate", "none", "low", "campfire", { light: "campfire" }),
    obj("weapon display", "cover", "low", "crate", { footprint: "rect", standIn: false }),
    obj("tapestry rolled", "cover", "low", "log", { standIn: false }),
    obj("footstool", "none", "low", "table", { standIn: false }),
    obj("chest", "cover", "low", "chest"),
    obj("chamber pot", "none", "low", "barrel", { standIn: false }),
    obj("map table (small)", "cover", "low", "table"),
    obj("harp", "cover", "low", "statue", { standIn: false }),
    obj("statue bust", "cover", "low", "statue", { standIn: false }),
    obj("floor brazier", "none", "low", "torch", { light: "torch" }),
  ],
  large: [
    obj("throne on a dais", "cover", "low", "statue", { footprint: "rect", standIn: false }),
    long("long dining table", "cover", "low", "table"),
    obj("four-poster bed", "cover", "tall", "table", { move: "block", footprint: "rect", standIn: false }),
    obj("grand fireplace", "block", "tall", "campfire", { footprint: "rect", light: "campfire" }),
    obj("great rug", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("staircase", "none", "low", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("stone column", "block", "tall", "pillar"),
    obj("armoury rack", "cover", "tall", "crate", { move: "block", footprint: "rect", standIn: false }),
    obj("library desk", "cover", "low", "table", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("polished stone floor", "stone", true),
    tex("red carpet", "stone", false),
    tex("wooden floorboards", "wood", false),
    tex("marble tiles", "stone", false),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11B): new items, not variants; none stands in for a Classic kind.
  // The kitchen hearth burns (campfire light); the reading chair's candle is a faint glow. The gatehouse portcullis
  // is a door (bars: cover; blocks movement while closed); the wardrobe, screen and organ block. The portcullis,
  // statue pair and battlement wall are drawn nearly square, so they are 2 x 2 rect, not 2 x 1.
  extras: {
    "props-2": [
      obj("hunting hound", "none", "low", "rock", { standIn: false }),
      obj("heraldic shield", "none", "low", "rock", { standIn: false }),
      obj("chess table", "cover", "low", "table", { standIn: false }),
      obj("wash basin on a stand", "none", "low", "barrel", { standIn: false }),
      obj("small writing desk", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("globe on a stand", "cover", "low", "barrel", { standIn: false }),
      obj("wine rack", "cover", "low", "crate", { footprint: "rect", standIn: false }),
      obj("folding dressing screen", "block", "tall", "crate", { footprint: "rect", standIn: false }),
      obj("birdcage", "none", "low", "barrel", { standIn: false }),
      obj("potted fern", "cover", "low", "bush", { move: "open", standIn: false }),
      obj("spinning wheel", "cover", "low", "table", { standIn: false }),
      obj("crown on a velvet cushion", "none", "low", "chest", { standIn: false }),
      obj("serving trolley with food", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("wooden bathing tub", "cover", "low", "barrel", { standIn: false }),
      obj("wardrobe", "block", "tall", "crate", { footprint: "rect", standIn: false }),
      obj("reading chair with a candle", "cover", "low", "table", { light: "faintglow", standIn: false }),
    ],
    "large-2": [
      obj("copper bathtub with a screen", "cover", "low", "barrel", { footprint: "rect", standIn: false }),
      obj("kitchen hearth with a roasting spit", "block", "tall", "campfire", {
        footprint: "rect",
        light: "campfire",
        standIn: false,
      }),
      long("war table with a campaign map", "cover", "low", "table", { standIn: false }),
      obj("pipe organ", "block", "tall", "crate", { footprint: "rect", standIn: false }),
      obj("gatehouse portcullis", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
      obj("pair of knight statues", "block", "tall", "statue", { footprint: "rect", standIn: false }),
      obj("ballista", "cover", "low", "crate", { footprint: "rect", standIn: false }),
      obj("treasury strongboxes", "cover", "low", "chest", { footprint: "rect", standIn: false }),
      obj("battlement wall with crenellations", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    ],
    "terrain-2": [
      tex("blue royal carpet", "stone", false),
      tex("rush-strewn flagstones", "stone", false),
      tex("oak parquet", "wood", false),
      tex("battlement stone", "stone", false),
    ],
  },
});
