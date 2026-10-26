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
    // dcm-bxp.90 (user 2026-10-22, Q-P1-1): the witch's cauldron glows faintly.
    obj("witch's cauldron", "cover", "low", "barrel", { light: "faintglow", standIn: false }),
    long("broken boardwalk (two squares)", "none", "flat", "log", { move: "open", standIn: false }),
  ],
  terrain: [
    tex("swamp mud", "swamp", true),
    tex("murky shallow water", "water", true),
    tex("bog grass", "grass", true),
    tex("rotting boardwalk planks", "wood", false),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11B): new items, not variants; none stands in for a Classic kind.
  // The skull lantern and the skull shrine's fire are real flames (torch light). The boardwalk junction is open (like
  // the broken boardwalk); the tar pit, sunken arch and swamp terrains follow the movement defaults (difficult).
  extras: {
    "props-2": [
      obj("alligator", "none", "low", "rock", { standIn: false }),
      obj("giant leech", "none", "low", "rock", { standIn: false }),
      obj("heron", "none", "low", "rock", { standIn: false }),
      obj("turtle on a log", "cover", "low", "log", { standIn: false }),
      obj("crayfish trap", "none", "low", "crate", { standIn: false }),
      obj("fishing pole in the mud", "none", "flat", "log", { move: "open", standIn: false }),
      obj("skull lantern on a stick", "none", "tall", "torch", { light: "torch", standIn: false }),
      obj("stack of peat bricks", "cover", "low", "crate", { standIn: false }),
      obj("mooring post with rope", "none", "tall", "pillar", { standIn: false }),
      obj("carnivorous plant", "cover", "low", "bush", { standIn: false }),
      obj("sunken statue head", "cover", "low", "statue", { standIn: false }),
      obj("wicker eel trap", "none", "low", "barrel", { standIn: false }),
      obj("hand reaching from the mud", "none", "low", "bones", { standIn: false }),
      obj("swamp orchid", "none", "low", "bush", { move: "open", standIn: false }),
      obj("dead fish", "none", "flat", "bones", { move: "open", standIn: false }),
      obj("half-sunken chest", "cover", "low", "chest", { standIn: false }),
    ],
    "large-2": [
      obj("witch's hut on stilts (whole)", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("swamp troll", "cover", "tall", "rock", { standIn: false }),
      obj("boardwalk junction", "none", "flat", "log", { move: "open", footprint: "rect", standIn: false }),
      long("flat-bottomed punt", "cover", "low", "log", { standIn: false }),
      obj("cypress tree with knees", "block", "tall", "tree", { variant: "dark", standIn: false }),
      obj("skull shrine", "cover", "low", "torch", { light: "torch", standIn: false }),
      obj("giant carnivorous plant", "block", "tall", "bush", { standIn: false }),
      obj("sunken stone arch", "cover", "low", "rubble", { footprint: "rect", standIn: false }),
      obj("bubbling tar pit", "none", "flat", "rubble", { standIn: false }),
    ],
    "terrain-2": [
      tex("duckweed water", "water", true),
      tex("peat bog", "swamp", true),
      tex("wet reed bed", "swamp", true),
      tex("algae-green mud", "swamp", true),
    ],
  },
});
