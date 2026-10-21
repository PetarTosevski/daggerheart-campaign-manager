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
});
