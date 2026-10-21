// Built-in catalog: mountain and cliffs (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const MOUNTAIN_AND_CLIFFS = defineFolder("mountain-and-cliffs", {
  props: [
    obj("loose rocks", "cover", "low", "rubble"),
    obj("mountain goat", "none", "low", "rock", { standIn: false }),
    obj("cairn", "cover", "low", "rock", { standIn: false }),
    obj("snowy rock", "cover", "low", "rock"),
    obj("climbing rope with piton", "none", "flat", "rubble", { standIn: false }),
    obj("cracked boulder", "cover", "low", "rock"),
    obj("mountain shrub", "cover", "low", "bush"),
    obj("eagle nest", "none", "flat", "bones", { standIn: false }),
    obj("old campsite", "none", "flat", "rubble", { standIn: false }),
    obj("broken pickaxe", "none", "flat", "bones", { standIn: false }),
    obj("ice patch", "none", "flat", "rock", { standIn: false }),
    obj("crystal outcrop", "none", "low", "crystal", { light: "faintglow" }),
    obj("bones of a climber", "none", "flat", "bones"),
    obj("rope bridge anchor", "cover", "low", "log", { standIn: false }),
    obj("lookout flag", "none", "tall", "pillar", { standIn: false }),
    obj("tiny pine", "cover", "low", "bush", { variant: "pine" }),
  ],
  large: [
    obj("cliff edge rock", "block", "tall", "boulder", { footprint: "rect" }),
    obj("large boulder pair", "block", "tall", "boulder"),
    obj("rock spire", "block", "tall", "boulder"),
    obj("cave mouth", "block", "tall", "boulder", { standIn: false }),
    obj("pine trees (pair)", "block", "tall", "tree", { variant: "pine" }),
    obj("rockslide", "cover", "low", "rubble"),
    long("rope bridge (two squares)", "none", "flat", "log", { standIn: false }),
    obj("stone stair", "none", "low", "rubble", { footprint: "rect", standIn: false }),
    obj("giant's skull", "block", "tall", "bones", { standIn: false }),
  ],
  terrain: [
    tex("rocky ground", "dirt", true),
    tex("scree and gravel", "path", true),
    tex("bare granite", "stone", true),
    tex("alpine grass", "grass", true),
  ],
});
