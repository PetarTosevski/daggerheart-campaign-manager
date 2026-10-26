// Built-in catalog: crypt and graveyard (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const CRYPT_AND_GRAVEYARD = defineFolder("crypt-and-graveyard", {
  props: [
    obj("gravestone", "cover", "low", "rock", { standIn: false }),
    obj("cracked gravestone", "cover", "low", "rock", { standIn: false }),
    obj("candle cluster", "none", "low", "crystal", { light: "faintglow" }),
    obj("skull pile", "none", "low", "bones"),
    obj("urn", "cover", "low", "barrel", { standIn: false }),
    obj("coffin (closed)", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    obj("coffin (open)", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    obj("wilted flowers", "none", "flat", "bush", { standIn: false }),
    obj("lantern on a post", "none", "tall", "torch", { light: "torch" }),
    obj("spiderweb", "none", "flat", "bones", { standIn: false }),
    obj("bones", "none", "flat", "bones"),
    obj("grave mound", "cover", "low", "rubble", { standIn: false }),
    obj("broken statue head", "cover", "low", "rubble", { standIn: false }),
    obj("holy symbol", "none", "flat", "bones", { standIn: false }),
    obj("iron fence section", "cover", "tall", "log", { move: "block", footprint: "rect", standIn: false }),
    obj("raven", "none", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("mausoleum corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("stone sarcophagus", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    obj("open grave", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
    obj("dead tree", "none", "tall", "deadtree"),
    obj("angel statue", "block", "tall", "statue"),
    obj("crypt gate", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
    obj("bone pile", "cover", "low", "bones", { standIn: false }),
    obj("ossuary shelf", "block", "tall", "crate", { footprint: "rect", standIn: false }),
    long("catacomb niche wall", "block", "tall", "pillar", { standIn: false }),
  ],
  terrain: [
    tex("crypt flagstones", "stone", false),
    tex("graveyard grass", "grass", true),
    tex("grave dirt", "dirt", true),
    tex("dusty tomb floor", "stone", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11A): new items, not variants. Light by D2 / Q1: the ghostly blue
  // candle and the necromancer's candles glow faintly. The mausoleum and the hut are 3 x 3 buildings, the headstone row
  // 3 x 1, the embalming table 2 x 1, the rest 2 x 2.
  extras: {
    "props-2": [
      obj("zombie", "none", "low", "rock", { standIn: false }),
      obj("skeleton rising from the ground", "none", "low", "bones", { move: "open", standIn: false }),
      obj("ghost", "none", "low", "rock", { standIn: false }),
      obj("gravedigger's shovel and pick", "none", "flat", "bones", { move: "open", standIn: false }),
      obj("memorial wreath", "none", "flat", "bush", { move: "open", standIn: false }),
      obj("celtic cross headstone", "cover", "low", "rock", { standIn: false }),
      obj("small obelisk headstone", "cover", "tall", "rock", { standIn: false }),
      obj("wooden grave marker", "cover", "low", "rock", { standIn: false }),
      obj("cracked tomb slab", "none", "flat", "rock", { footprint: "rect", standIn: false }),
      obj("black cat", "none", "low", "rock", { standIn: false }),
      obj("canopic jars", "none", "low", "barrel", { standIn: false }),
      obj("shrouded corpse on a bier", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("ghostly blue candle", "none", "low", "crystal", { light: "faintglow", standIn: false }),
      obj("coffin lid on the ground", "none", "flat", "chest", { footprint: "rect", standIn: false }),
      obj("iron grave cage", "cover", "tall", "crate", { move: "block", footprint: "rect", standIn: false }),
      obj("offering of coins", "none", "flat", "chest", { standIn: false }),
    ],
    "large-2": [
      obj("small mausoleum (whole roof)", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("necromancer's altar", "cover", "low", "table", { footprint: "rect", light: "faintglow", standIn: false }),
      obj("bone throne", "cover", "tall", "statue", { standIn: false }),
      obj("gravedigger's hut", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("wraith", "none", "tall", "rock", { standIn: false }),
      obj("row of headstones", "cover", "low", "rock", { footprint: "rect", w: 3, h: 1, standIn: false }),
      long("embalming table", "cover", "low", "table", { standIn: false }),
      obj("crypt staircase going down", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
      obj("cracked-open tomb", "cover", "low", "chest", { footprint: "rect", standIn: false }),
    ],
    "terrain-2": [
      tex("bone-strewn floor", "stone", true),
      tex("overgrown graveyard path", "path", false),
      tex("ash and dust", "dirt", true),
      tex("dead grass", "grass", true),
    ],
  },
});
