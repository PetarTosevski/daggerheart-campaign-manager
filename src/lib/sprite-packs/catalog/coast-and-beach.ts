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
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 fishing hut corner and rowboat: the boathouse 3 x 3 (whole roof, like the village cottages), the
  // fishing boat and breakwater 3 x 2, salt pans and the sea-stack arch 3 x 3. The open oyster's pearl only shines in
  // the drawing (no light, D2). The breakwater's top is walkable (rock = open); salt pans are difficult (rubble).
  extras: {
    "props-2": [
      obj("lobster pot", "cover", "low", "crate", { standIn: false }),
      obj("fishing rod and tackle box", "none", "low", "crate", { standIn: false }),
      obj("jellyfish", "none", "flat", "rock", { standIn: false }),
      obj("sea turtle", "none", "low", "rock", { standIn: false }),
      obj("pelican", "none", "low", "rock", { standIn: false }),
      obj("stranded octopus", "none", "flat", "rock", { standIn: false }),
      obj("coconut pile", "none", "low", "rock", { standIn: false }),
      obj("fish drying rack", "cover", "low", "table", { standIn: false }),
      obj("basket of clams", "none", "low", "barrel", { standIn: false }),
      obj("wooden buoy", "none", "low", "barrel", { standIn: false }),
      obj("seaweed pile", "none", "flat", "rubble", { standIn: false }),
      obj("conch shell", "none", "flat", "bones", { standIn: false }),
      obj("open pearl oyster", "none", "flat", "bones", { standIn: false }),
      obj("coral chunk", "cover", "low", "rock", { standIn: false }),
      obj("sea urchins", "none", "flat", "rubble", { standIn: false }),
      obj("tar bucket and brush", "none", "low", "barrel", { standIn: false }),
    ],
    "large-2": [
      obj("boathouse", "block", "tall", "pillar", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("sea serpent coils", "block", "tall", "boulder", { standIn: false }),
      obj("giant crab", "block", "tall", "boulder", { standIn: false }),
      obj("sailing fishing boat", "cover", "low", "log", { footprint: "rect", w: 3, h: 2, standIn: false }),
      obj("stone breakwater", "cover", "low", "rock", { footprint: "rect", w: 3, h: 2, standIn: false }),
      obj("dockside crane", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
      obj("mermaid on a rock", "cover", "low", "rock", { standIn: false }),
      obj("salt evaporation pans", "none", "flat", "rubble", { footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("sea-stack rock arch", "block", "tall", "boulder", { w: 3, h: 3, standIn: false }),
    ],
    "terrain-2": [
      tex("pebble beach", "stone", true),
      tex("seaweed-covered rocks", "stone", true),
      tex("coral reef shallows", "water", true),
      tex("tidal mudflat", "swamp", true),
    ],
  },
});
