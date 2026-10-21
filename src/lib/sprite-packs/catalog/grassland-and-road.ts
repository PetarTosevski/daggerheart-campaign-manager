// Built-in catalog: grassland and road (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const GRASSLAND_AND_ROAD = defineFolder("grassland-and-road", {
  props: [
    obj("milestone", "cover", "low", "rock", { standIn: false }),
    obj("wildflowers", "none", "flat", "bush", { standIn: false }),
    obj("haystack (small)", "cover", "low", "bush", { standIn: false }),
    obj("fence post", "none", "low", "pillar", { standIn: false }),
    obj("rock", "cover", "low", "rock"),
    obj("shrub", "cover", "low", "bush"),
    obj("wooden gate", "cover", "low", "door", { move: "door", footprint: "rect", standIn: false }),
    obj("scarecrow", "none", "tall", "deadtree", { standIn: false }),
    obj("beehive", "cover", "low", "barrel", { standIn: false }),
    obj("trough", "cover", "low", "crate", { footprint: "rect", standIn: false }),
    obj("roadside shrine", "cover", "low", "statue", { standIn: false }),
    obj("grave marker", "cover", "low", "rock", { standIn: false }),
    obj("broken cart wheel", "none", "flat", "rubble", { standIn: false }),
    obj("picnic blanket", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("rabbit", "none", "low", "rock", { standIn: false }),
    obj("crow", "none", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("lone oak tree", "block", "tall", "tree", { variant: "green" }),
    obj("haystack", "block", "tall", "boulder", { standIn: false }),
    obj("windmill base", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    long("wooden bridge (two squares)", "none", "flat", "log", { move: "open", standIn: false }),
    obj("farmhouse corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("standing stones (pair)", "block", "tall", "boulder"),
    obj("watchtower base", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("orchard tree", "block", "tall", "tree", { variant: "olive" }),
    long("stone wall section", "block", "tall", "pillar", { standIn: false }),
  ],
  terrain: [
    tex("meadow grass", "grass", true),
    tex("dirt road", "path", false),
    tex("wheat field", "grass", false),
    tex("trampled grass", "grass", true),
  ],
});
