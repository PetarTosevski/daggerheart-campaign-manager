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
      obj("wooden fence gate", "cover", "low", "log", { move: "door", footprint: "rect", w: 3, h: 1, standIn: false }),
      obj("vegetable garden plot", "none", "flat", "rubble", { move: "difficult", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("haystack", "block", "tall", "boulder", { standIn: false }),
      long("woodpile with chopping block", "cover", "low", "log", { standIn: false }),
      obj("chicken coop with fenced run", "cover", "low", "crate", { move: "block", footprint: "rect", standIn: false }),
    ],
  },
});
