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
    obj("rug", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
    obj("water skin", "none", "flat", "bones", { standIn: false }),
    obj("sand dune ripple", "none", "flat", "rubble", { standIn: false }),
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
    obj("oasis pool", "none", "flat", "rock", { standIn: false }),
    obj("sandstone pillar", "block", "tall", "pillar"),
    obj("desert tent", "block", "tall", "tent"),
    obj("camel", "block", "tall", "boulder", { standIn: false }),
    obj("ruined obelisk", "block", "tall", "pillar"),
    obj("giant skeleton ribs", "cover", "low", "bones", { standIn: false }),
    obj("sand dune", "block", "tall", "boulder", { standIn: false }),
    obj("merchant's caravan wagon", "block", "tall", "tent", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("desert sand", "sand", true),
    tex("cracked dry earth", "dirt", true),
    tex("sandstone floor", "stone", false),
    tex("rocky desert", "dirt", true),
  ],
});
