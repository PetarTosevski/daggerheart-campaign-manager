// Built-in catalog: ship deck (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const SHIP_DECK = defineFolder("ship-deck", {
  props: [
    obj("deck cannon", "cover", "low", "barrel", { footprint: "rect", standIn: false }),
    obj("coil of rope", "none", "low", "barrel", { standIn: false }),
    obj("barrel", "cover", "low", "barrel"),
    obj("crate", "cover", "low", "crate"),
    obj("ship's wheel", "cover", "low", "table", { standIn: false }),
    obj("anchor", "cover", "low", "rubble", { standIn: false }),
    obj("bucket and mop", "none", "low", "barrel", { standIn: false }),
    obj("cargo net", "none", "flat", "rubble", { standIn: false }),
    obj("hatch (closed)", "none", "flat", "crate", { footprint: "rect", standIn: false }),
    obj("hatch (open)", "none", "flat", "crate", { footprint: "rect", standIn: false }),
    obj("lantern on a hook", "none", "low", "walltorch", { light: "torch" }),
    obj("sea chest", "cover", "low", "chest"),
    obj("rigging pulley", "none", "low", "rubble", { standIn: false }),
    obj("parrot", "none", "low", "rock", { standIn: false }),
    obj("cannonballs pile", "cover", "low", "rubble", { standIn: false }),
    obj("harpoon", "none", "flat", "log", { standIn: false }),
  ],
  large: [
    obj("mast with sail shadow", "block", "tall", "mast"),
    obj("captain's table", "cover", "low", "table", { footprint: "rect", standIn: false }),
    obj("capstan", "cover", "low", "barrel", { standIn: false }),
    obj("lifeboat", "cover", "low", "log", { footprint: "rect", standIn: false }),
    obj("cargo stack", "block", "tall", "crate", { footprint: "rect", standIn: false }),
    obj("stairs below deck", "none", "flat", "rubble", { move: "open", footprint: "rect", standIn: false }),
    long("cannon pair", "cover", "low", "barrel", { standIn: false }),
    obj("ship's bow", "none", "flat", "hull", { standIn: false }),
    obj("ship's stern cabin corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("deck planks", "wood", false),
    tex("wet deck planks", "wood", false),
    tex("below-deck floor", "wood", false),
    tex("dark sea water", "deep", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 captain's table and cargo stack: the galley 3 x 3 (a whole room), the figurehead and gangplank
  // 1 x 2 (drawn upright). The galley stove is drawn cold (no light, D2). The brig cell is a door (closed blocks,
  // open passes; bars stay see-through as cover, like the sewers iron gate). The gangplank is open (a walkway), the
  // kraken's tentacles block; the galley's floor is walkable (open).
  extras: {
    "props-2": [
      obj("spyglass on a chart", "none", "flat", "crate", { standIn: false }),
      obj("compass binnacle", "cover", "low", "pillar", { standIn: false }),
      obj("ship's bell", "none", "low", "barrel", { standIn: false }),
      obj("hammock", "none", "low", "log", { move: "open", footprint: "rect", standIn: false }),
      obj("powder keg", "cover", "low", "barrel", { standIn: false }),
      obj("belaying-pin rack", "cover", "low", "crate", { footprint: "rect", standIn: false }),
      obj("bundle of signal flags", "none", "low", "crate", { standIn: false }),
      obj("grappling hook with rope", "none", "flat", "bones", { standIn: false }),
      obj("crossed cutlasses", "none", "flat", "bones", { standIn: false }),
      obj("pile of caught fish", "none", "flat", "bones", { standIn: false }),
      obj("small galley stove", "cover", "low", "crate", { standIn: false }),
      obj("bilge pump", "none", "low", "pillar", { standIn: false }),
      obj("crate of rum bottles", "cover", "low", "crate", { standIn: false }),
      obj("folded pirate flag", "none", "flat", "crate", { standIn: false }),
      obj("swivel gun", "cover", "low", "barrel", { standIn: false }),
      obj("tar barrel", "cover", "low", "barrel", { standIn: false }),
    ],
    "large-2": [
      obj("crow's nest", "block", "tall", "mast", { standIn: false }),
      obj("kraken tentacles", "cover", "tall", "boulder", { move: "block", standIn: false }),
      obj("ship's galley", "cover", "low", "table", { move: "open", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("mermaid figurehead", "cover", "low", "statue", { footprint: "rect", w: 1, h: 2, standIn: false }),
      obj("gangplank", "none", "flat", "log", { move: "open", footprint: "rect", w: 1, h: 2, standIn: false }),
      obj("rowing benches with oars", "cover", "low", "log", { footprint: "rect", standIn: false }),
      obj("captain's cabin bed", "cover", "low", "table", { footprint: "rect", standIn: false }),
      obj("grain heap in the cargo hold", "none", "flat", "rubble", { footprint: "rect", standIn: false }),
      obj("brig cell", "cover", "tall", "door", { move: "door", footprint: "rect", standIn: false }),
    ],
    "terrain-2": [
      tex("tarred planks", "wood", false),
      tex("sun-bleached deck", "wood", false),
      tex("canvas sail laid flat", "wood", false),
      tex("stormy sea water", "deep", true),
    ],
  },
});
