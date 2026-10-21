// Built-in catalog: swamp (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const SWAMP = defineFolder("swamp", {
  props: [
    obj("reeds", "cover", "low", "bush"),
    obj("lily pads", "none", "flat", "bush", { standIn: false }),
    obj("rotten stump", "cover", "low", "log", { standIn: false }),
    obj("bog mushroom", "none", "low", "mushroom"),
    obj("will-o'-wisp light", "none", "low", "crystal", { light: "faintglow" }),
    obj("frog", "none", "low", "rock", { standIn: false }),
    obj("mossy rock", "cover", "low", "rock"),
    obj("bones in mud", "none", "flat", "bones"),
    obj("sunken barrel", "cover", "low", "barrel"),
    obj("hanging moss", "none", "low", "bush", { standIn: false }),
    obj("cattails", "cover", "low", "bush"),
    obj("snake", "none", "low", "rock", { standIn: false }),
    obj("broken boat plank", "none", "flat", "log", { standIn: false }),
    obj("witch's charm totem", "none", "tall", "pillar", { standIn: false }),
    obj("insect swarm", "none", "low", "bones", { standIn: false }),
    obj("bubbling mud", "none", "flat", "rubble", { move: "difficult", standIn: false }),
  ],
  large: [
    obj("mangrove tree", "block", "tall", "tree", { variant: "dark" }),
    obj("dead swamp tree", "none", "tall", "deadtree"),
    obj("stilt hut corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("sunken rowboat", "cover", "low", "log", { footprint: "rect", standIn: false }),
    obj("bog pool", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("giant lily pad", "none", "flat", "bush", { standIn: false }),
    long("rotting log", "cover", "low", "log", { move: "difficult" }),
    obj("witch's cauldron", "cover", "low", "barrel", { standIn: false }),
    long("broken boardwalk (two squares)", "none", "flat", "log", { move: "open", standIn: false }),
  ],
  terrain: [
    tex("swamp mud", "swamp", true),
    tex("murky shallow water", "water", true),
    tex("bog grass", "grass", true),
    tex("rotting boardwalk planks", "wood", false),
  ],
});
