// Built-in catalog: castle interior (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const CASTLE_INTERIOR = defineFolder("castle-interior", {
  props: [
    obj("banner stand", "none", "tall", "pillar", { standIn: false }),
    obj("suit of armour", "cover", "tall", "statue", { standIn: false }),
    obj("candelabra", "none", "tall", "crystal", { light: "faintglow" }),
    obj("ornate chair", "cover", "low", "table", { standIn: false }),
    obj("small table with goblet", "cover", "low", "table"),
    obj("rug (small)", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
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
    obj("four-poster bed", "cover", "tall", "table", { footprint: "rect", standIn: false }),
    obj("grand fireplace", "block", "tall", "campfire", { footprint: "rect", light: "campfire" }),
    obj("great rug", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
    obj("staircase", "none", "low", "rubble", { footprint: "rect", standIn: false }),
    obj("stone column", "block", "tall", "pillar"),
    obj("armoury rack", "cover", "tall", "crate", { footprint: "rect", standIn: false }),
    obj("library desk", "cover", "low", "table", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("polished stone floor", "stone", true),
    tex("red carpet", "stone", false),
    tex("wooden floorboards", "wood", false),
    tex("marble tiles", "stone", false),
  ],
});
