// Built-in catalog: desert (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const DESERT = defineFolder("desert", {
  props: [
    obj("cactus", "cover", "low", "bush", { standIn: false }),
    obj("desert rock", "cover", "low", "rock"),
    obj("sun-bleached skull", "none", "flat", "bones"),
    obj("dry bush", "cover", "low", "bush", { variant: "olive" }),
    obj("scorpion", "none", "low", "rock", { standIn: false }),
    obj("clay jar", "cover", "low", "barrel", { standIn: false }),
    obj("rug", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("water skin", "none", "flat", "bones", { standIn: false }),
    obj("sand dune ripple", "none", "flat", "rubble", { move: "open", standIn: false }),
    obj("bones", "none", "flat", "bones"),
    obj("broken pottery", "none", "flat", "rubble", { standIn: false }),
    obj("palm sapling", "cover", "low", "bush", { standIn: false }),
    obj("tent stake and rope", "none", "flat", "log", { standIn: false }),
    obj("campfire", "none", "low", "campfire", { light: "campfire" }),
    obj("desert snake", "none", "low", "rock", { standIn: false }),
    obj("ancient tablet", "cover", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("palm tree", "block", "tall", "tree", { variant: "olive" }),
    obj("oasis pool", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("sandstone pillar", "block", "tall", "pillar"),
    obj("desert tent", "block", "tall", "tent"),
    obj("camel", "block", "tall", "boulder", { standIn: false }),
    obj("ruined obelisk", "block", "tall", "pillar"),
    obj("giant skeleton ribs", "cover", "low", "bones", { standIn: false }),
    obj("sand dune", "block", "tall", "boulder", { move: "difficult", standIn: false }),
    obj("merchant's caravan wagon", "block", "tall", "tent", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("desert sand", "sand", true),
    tex("cracked dry earth", "dirt", true),
    tex("sandstone floor", "stone", false),
    tex("rocky desert", "dirt", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 palm tree and caravan wagon: the sphinx 2 x 3 (drawn portrait), mesa, colossus head and shrine
  // 3 x 3, the mummy 1 x 1 (a man-sized figure). The brass oil lamp is drawn unlit (no light, D2).
  extras: {
    "props-2": [
      obj("vulture", "none", "low", "rock", { standIn: false }),
      obj("scarab beetle", "none", "low", "rock", { standIn: false }),
      obj("jackal", "none", "low", "rock", { standIn: false }),
      obj("tumbleweed", "cover", "low", "bush", { standIn: false }),
      obj("prickly pear cactus", "cover", "low", "bush", { standIn: false }),
      obj("basket of dates", "none", "low", "barrel", { standIn: false }),
      obj("hookah", "none", "low", "barrel", { standIn: false }),
      obj("brass oil lamp", "none", "low", "barrel", { standIn: false }),
      obj("half-buried helmet", "none", "flat", "bones", { standIn: false }),
      obj("amphora", "cover", "low", "barrel", { standIn: false }),
      obj("spice pile", "none", "flat", "rubble", { standIn: false }),
      obj("weathered idol", "cover", "low", "rock", { standIn: false }),
      obj("quicksand patch", "none", "flat", "rubble", { move: "difficult", standIn: false }),
      obj("wind-carved rock", "cover", "low", "rock", { standIn: false }),
      obj("snake charmer's basket", "none", "low", "barrel", { standIn: false }),
      obj("saddle bags", "none", "low", "crate", { standIn: false }),
    ],
    "large-2": [
      obj("sphinx statue", "block", "tall", "statue", { footprint: "rect", w: 2, h: 3, standIn: false }),
      obj("mummy", "none", "low", "rock", { w: 1, h: 1, standIn: false }),
      obj("giant sandworm emerging", "block", "tall", "boulder", { standIn: false }),
      obj("bazaar pavilion", "block", "tall", "tent", { footprint: "rect", standIn: false }),
      obj("acacia tree", "block", "tall", "tree", { variant: "olive", standIn: false }),
      obj("mesa rock", "block", "tall", "boulder", { w: 3, h: 3, standIn: false }),
      obj("sunken tomb entrance", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("half-buried colossus head", "block", "tall", "statue", { w: 3, h: 3, standIn: false }),
      obj("desert shrine with pillars", "cover", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
    ],
    "terrain-2": [
      tex("red sand", "sand", true),
      tex("salt flat", "sand", true),
      tex("wind-rippled dunes", "sand", true),
      tex("desert pebbles", "dirt", true),
    ],
  },
});
