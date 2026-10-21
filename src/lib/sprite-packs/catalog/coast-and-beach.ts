// Built-in catalog: coast and beach (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const COAST_AND_BEACH = defineFolder("coast-and-beach", {
  props: [
    obj("seashell", "none", "flat", "bones", { standIn: false }),
    obj("crab", "none", "low", "rock", { standIn: false }),
    obj("driftwood", "cover", "low", "log"),
    obj("rowboat oar", "none", "flat", "log", { standIn: false }),
    obj("fishing net", "none", "flat", "rubble", { standIn: false }),
    obj("rock with seaweed", "cover", "low", "rock"),
    obj("tide pool", "none", "flat", "rock", { move: "difficult", standIn: false }),
    obj("sandcastle", "cover", "low", "rubble", { standIn: false }),
    obj("seagull", "none", "low", "rock", { standIn: false }),
    obj("rope post", "none", "low", "pillar", { standIn: false }),
    obj("barrel washed ashore", "cover", "low", "barrel"),
    obj("anchor", "cover", "low", "rubble", { standIn: false }),
    obj("message bottle", "none", "flat", "bones", { standIn: false }),
    obj("beach grass", "cover", "low", "bush"),
    obj("starfish", "none", "flat", "bones", { standIn: false }),
    obj("broken crate", "cover", "low", "crate"),
  ],
  large: [
    obj("rowboat", "cover", "low", "log", { footprint: "rect", standIn: false }),
    long("wooden pier section", "none", "flat", "log", { move: "open", standIn: false }),
    obj("palm tree", "block", "tall", "tree", { variant: "olive" }),
    obj("large sea rock", "block", "tall", "boulder"),
    obj("shipwreck piece", "block", "tall", "boulder", { footprint: "rect", standIn: false }),
    obj("fishing hut corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("lighthouse base", "block", "tall", "pillar", { standIn: false }),
    obj("sea cave mouth", "block", "tall", "boulder", { standIn: false }),
    obj("beached whale bones", "cover", "low", "bones", { standIn: false }),
  ],
  terrain: [
    tex("beach sand", "sand", true),
    tex("wet sand", "sand", true),
    tex("shallow sea water", "water", true),
    tex("rocky shore", "stone", true),
  ],
});
