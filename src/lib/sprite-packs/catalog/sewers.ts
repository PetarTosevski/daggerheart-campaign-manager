// Built-in catalog: sewers (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const SEWERS = defineFolder("sewers", {
  props: [
    obj("grate", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    obj("rat", "none", "low", "rock", { standIn: false }),
    obj("sewage puddle", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("pipe outlet", "none", "low", "pillar", { standIn: false }),
    obj("broken crate", "cover", "low", "crate"),
    obj("ladder up", "none", "low", "log", { move: "open", footprint: "rect", standIn: false }),
    obj("lost dagger", "none", "flat", "bones", { standIn: false }),
    obj("fungus patch", "none", "flat", "mushroom"),
    obj("bones", "none", "flat", "bones"),
    obj("rusty chain", "none", "flat", "bones", { standIn: false }),
    obj("valve wheel", "none", "low", "rubble", { move: "open", standIn: false }),
    obj("sludge pile", "cover", "low", "rubble", { move: "difficult" }),
    obj("candle stub", "none", "low", "crystal", { light: "faintglow" }),
    obj("bucket", "none", "low", "barrel", { standIn: false }),
    obj("torn sack", "cover", "low", "crate", { standIn: false }),
    obj("eel", "none", "low", "rock", { standIn: false }),
  ],
  large: [
    obj("sewer channel crossing", "none", "flat", "rock", { footprint: "rect", standIn: false }),
    obj("arched tunnel mouth", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("cistern", "cover", "low", "barrel", { standIn: false }),
    obj("collapsed pipe", "cover", "low", "rubble", { move: "difficult", standIn: false }),
    obj("rat nest", "cover", "low", "rubble", { standIn: false }),
    long("stone bridge over channel", "none", "flat", "log", { move: "open", standIn: false }),
    obj("thieves' hideout corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("iron gate", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
    obj("flooded chamber", "none", "flat", "rock", { move: "difficult", footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("wet sewer stone", "stone", true),
    tex("sewage water", "water", true),
    tex("slimy brick floor", "stone", false),
    tex("mossy drainage stone", "stone", true),
  ],
});
