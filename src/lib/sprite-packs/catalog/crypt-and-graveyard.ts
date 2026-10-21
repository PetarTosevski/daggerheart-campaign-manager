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
});
