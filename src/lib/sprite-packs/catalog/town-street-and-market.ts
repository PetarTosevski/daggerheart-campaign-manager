// Built-in catalog: town street and market (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const TOWN_STREET_AND_MARKET = defineFolder("town-street-and-market", {
  props: [
    obj("market crate of apples", "cover", "low", "crate"),
    obj("fish barrel", "cover", "low", "barrel"),
    obj("vegetable stall basket", "cover", "low", "barrel", { standIn: false }),
    obj("street lamp", "none", "tall", "torch", { light: "torch" }),
    obj("well bucket", "none", "low", "barrel", { standIn: false }),
    obj("bench", "cover", "low", "log", { footprint: "rect", standIn: false }),
    obj("cart (handcart)", "cover", "low", "crate", { standIn: false }),
    obj("crate stack", "cover", "low", "crate"),
    obj("pottery jars", "cover", "low", "barrel", { standIn: false }),
    obj("bolt of cloth", "none", "low", "log", { standIn: false }),
    obj("sign post", "none", "tall", "pillar", { standIn: false }),
    obj("trash pile", "cover", "low", "rubble", { move: "difficult" }),
    obj("chicken", "none", "low", "rock", { standIn: false }),
    obj("dog", "none", "low", "rock", { standIn: false }),
    obj("rain barrel", "cover", "low", "barrel"),
    obj("flower box", "cover", "low", "crate", { footprint: "rect", standIn: false }),
  ],
  large: [
    obj("market stall with awning", "block", "tall", "tent", { footprint: "rect", standIn: false }),
    obj("fountain", "cover", "low", "statue", { standIn: false }),
    obj("town well", "cover", "low", "rock", { standIn: false }),
    obj("statue on a plinth", "block", "tall", "statue"),
    obj("house corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("blacksmith forge", "block", "tall", "campfire", { footprint: "rect", light: "campfire" }),
    obj("wagon", "block", "tall", "tent", { footprint: "rect", standIn: false }),
    obj("large tree in a planter", "block", "tall", "tree", { variant: "green" }),
    obj("guard post", "block", "tall", "tent", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("cobblestones", "path", false),
    tex("town square flagstones", "stone", false),
    tex("muddy street", "dirt", true),
    tex("market plaza tiles", "stone", false),
  ],
  // The village sheet (large-2.jpg, tracer P4V): new items, not variants. Sizes in squares, against the town's
  // 2 x 2 house corner and wagon: cottages 3 x 3, the barn 3 x 4, fence and gate 3 x 1, garden plot 3 x 3,
  // haystack and coop 2 x 2, woodpile 2 x 1. Movement (map-movement M0): the fence and the fenced coop block, the gate
  // is a door (blocks while closed), the garden plot is difficult; the buildings block by the D1 default.
  extras: {
    "large-2": [
      obj("thatched cottage", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("stone cottage", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("timber barn", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 4, standIn: false }),
      obj("wooden fence section", "cover", "low", "log", { move: "block", footprint: "rect", w: 3, h: 1, standIn: false }),
      obj("wooden fence gate", "cover", "low", "door", { move: "door", footprint: "rect", w: 3, h: 1, standIn: false }),
      obj("vegetable garden plot", "none", "flat", "rubble", { move: "difficult", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("haystack", "block", "tall", "boulder", { standIn: false }),
      long("woodpile with chopping block", "cover", "low", "log", { standIn: false }),
      obj("chicken coop with fenced run", "cover", "low", "crate", { move: "block", footprint: "rect", standIn: false }),
    ],
    // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11B): new items, not variants; none stands in. No light sources.
    // Buildings against the 3 x 3 cottages: townhouse and shop 3 x 3, town gate 4 x 3 (a door: its gateway is a
    // portcullis, cover, blocking movement while closed), clock tower 2 x 4 (drawn upright), market hall 4 x 4,
    // stable block 4 x 3, tannery yard and canal 3 x 3. The canal is water (difficult); the drain and mat are open.
    "props-2": [
      obj("hitching post", "none", "tall", "pillar", { standIn: false }),
      obj("street vendor's tray", "none", "low", "crate", { standIn: false }),
      obj("laundry line", "cover", "tall", "pillar", { footprint: "rect", standIn: false }),
      obj("spice sacks", "cover", "low", "barrel", { standIn: false }),
      obj("flock of pigeons", "none", "low", "rock", { standIn: false }),
      obj("cobbler's bench", "cover", "low", "table", { standIn: false }),
      obj("beggar's bowl and mat", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("lamplighter's ladder", "none", "tall", "pillar", { standIn: false }),
      obj("topiary bush", "cover", "low", "bush", { move: "open", standIn: false }),
      obj("flower cart", "cover", "low", "crate", { standIn: false }),
      obj("rolled rugs", "cover", "low", "log", { standIn: false }),
      obj("caged songbirds", "none", "low", "barrel", { standIn: false }),
      obj("street drain", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("baker's display table", "cover", "low", "table", { standIn: false }),
      obj("market scales", "none", "low", "barrel", { standIn: false }),
      obj("town crier's bell", "none", "low", "barrel", { standIn: false }),
    ],
    "large-3": [
      obj("townhouse (whole roof)", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("shop with an awning (whole building)", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("town gate with two towers", "cover", "tall", "door", { move: "door", footprint: "rect", w: 4, h: 3, standIn: false }),
      obj("clock tower", "block", "tall", "pillar", { footprint: "rect", w: 2, h: 4, standIn: false }),
      obj("covered market hall", "block", "tall", "pillar", { footprint: "rect", w: 4, h: 4, standIn: false }),
      obj("stable block", "block", "tall", "pillar", { footprint: "rect", w: 4, h: 3, standIn: false }),
      obj("tannery vats", "cover", "low", "barrel", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("gallows platform", "cover", "tall", "table", { footprint: "rect", standIn: false }),
      obj("canal with a footbridge", "none", "flat", "rock", { move: "difficult", footprint: "rect", w: 3, h: 3, standIn: false }),
    ],
    "terrain-2": [
      tex("brick road", "path", false),
      tex("dirt alley", "dirt", true),
      tex("mossy cobblestones", "path", false),
      tex("canal water", "water", true),
    ],
  },
});
