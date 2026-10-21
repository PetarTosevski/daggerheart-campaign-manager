// Built-in catalog: town street and market (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, obj, tex } from "./types";

export const TOWN_STREET_AND_MARKET = defineFolder("town-street-and-market", {
  props: [
    obj("market crate of apples", "cover", "low", "crate"),
    obj("fish barrel", "cover", "low", "barrel"),
    obj("vegetable stall basket", "cover", "low", "barrel", { standIn: false }),
    obj("street lamp", "none", "tall", "torch", { light: "torch" }),
    obj("well bucket", "none", "low", "barrel", { standIn: false }),
    obj("bench", "cover", "low", "log", { footprint: "rect", standIn: false }),
    obj("cart (handcart)", "cover", "low", "crate", { standIn: false }),
    obj("crate stack", "cover", "low", "crate"),
    obj("pottery jars", "cover", "low", "barrel", { standIn: false }),
    obj("bolt of cloth", "none", "low", "log", { standIn: false }),
    obj("sign post", "none", "tall", "pillar", { standIn: false }),
    obj("trash pile", "cover", "low", "rubble"),
    obj("chicken", "none", "low", "rock", { standIn: false }),
    obj("dog", "none", "low", "rock", { standIn: false }),
    obj("rain barrel", "cover", "low", "barrel"),
    obj("flower box", "cover", "low", "crate", { footprint: "rect", standIn: false }),
  ],
  large: [
    obj("market stall with awning", "block", "tall", "tent", { footprint: "rect", standIn: false }),
    obj("fountain", "cover", "low", "statue", { standIn: false }),
    obj("town well", "cover", "low", "rock", { standIn: false }),
    obj("statue on a plinth", "block", "tall", "statue"),
    obj("house corner", "block", "tall", "pillar", { footprint: "rect", standIn: false }),
    obj("blacksmith forge", "block", "tall", "campfire", { footprint: "rect", light: "campfire" }),
    obj("wagon", "block", "tall", "tent", { footprint: "rect", standIn: false }),
    obj("large tree in a planter", "block", "tall", "tree", { variant: "green" }),
    obj("guard post", "block", "tall", "tent", { footprint: "rect", standIn: false }),
  ],
  terrain: [
    tex("cobblestones", "path", false),
    tex("town square flagstones", "stone", false),
    tex("muddy street", "dirt", true),
    tex("market plaza tiles", "stone", false),
  ],
});
