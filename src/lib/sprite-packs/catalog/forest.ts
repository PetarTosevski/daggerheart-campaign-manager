// Built-in catalog: forest (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const FOREST = defineFolder("forest", {
  props: [
    obj("bush", "cover", "low", "bush", { variant: "green" }),
    obj("fern clump", "cover", "low", "bush"),
    obj("mushroom ring", "none", "flat", "mushroom"),
    obj("tree stump", "cover", "low", "log", { standIn: false }),
    obj("small rock", "cover", "low", "rock"),
    obj("mossy log (short)", "cover", "low", "log"),
    obj("berry bush", "cover", "low", "bush"),
    obj("flower patch", "none", "flat", "bush", { standIn: false }),
    obj("thorn bramble", "cover", "low", "bush", { move: "difficult" }),
    obj("hollow log", "cover", "low", "log"),
    obj("animal carcass", "none", "flat", "bones", { standIn: false }),
    obj("bird's nest on the ground", "none", "flat", "bones", { standIn: false }),
    obj("woodcutter's axe in a stump", "cover", "low", "log", { standIn: false }),
    obj("signpost", "none", "tall", "pillar", { standIn: false }),
    obj("small pond", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("rabbit burrow", "none", "flat", "rubble", { standIn: false }),
  ],
  large: [
    obj("oak tree", "block", "tall", "tree", { variant: "green" }),
    obj("pine tree", "block", "tall", "tree", { variant: "pine" }),
    obj("birch tree", "block", "tall", "tree", { variant: "olive" }),
    obj("dead tree", "none", "tall", "deadtree"),
    obj("giant mushroom", "block", "tall", "mushroom", { standIn: false }),
    obj("autumn maple tree", "block", "tall", "tree", { variant: "autumn" }),
    long("thick hedge", "block", "tall", "bush", { standIn: false }),
    obj("hunter's lean-to", "block", "tall", "tent", { footprint: "rect" }),
    obj("ancient tree with roots", "block", "tall", "tree", { variant: "dark" }),
  ],
  terrain: [
    tex("forest floor with leaves", "grass", true),
    tex("moss", "grass", true),
    tex("tall grass", "grass", true),
    tex("muddy path", "path", false),
  ],
});
