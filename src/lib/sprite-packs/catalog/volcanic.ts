// Built-in catalog: volcanic (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, long, obj, tex } from "./types";

export const VOLCANIC = defineFolder("volcanic", {
  props: [
    obj("lava rock", "cover", "low", "rock"),
    obj("steam vent", "none", "flat", "rubble", { standIn: false }),
    obj("obsidian shard", "none", "low", "crystal"),
    obj("fire salamander", "none", "low", "rock", { standIn: false }),
    obj("scorched bones", "none", "flat", "bones"),
    obj("sulphur crystal", "none", "low", "crystal"),
    obj("ember pile", "none", "flat", "rubble", { light: "faintglow" }),
    obj("cracked basalt", "cover", "low", "rock"),
    obj("smoking crater", "none", "flat", "rubble", { standIn: false }),
    obj("charred stump", "cover", "low", "log", { standIn: false }),
    obj("magma bubble", "none", "flat", "rubble", { light: "faintglow" }),
    obj("fire opal", "none", "flat", "crystal"),
    obj("ash pile", "none", "flat", "rubble", { standIn: false }),
    obj("burning brazier", "none", "low", "torch", { light: "torch" }),
    obj("broken chain", "none", "flat", "bones", { standIn: false }),
    obj("heat-cracked shield", "none", "flat", "bones", { standIn: false }),
  ],
  large: [
    obj("lava pool", "none", "flat", "rock", { move: "difficult", light: "faintglow" }),
    obj("obsidian spire", "block", "tall", "pillar"),
    obj("volcanic boulder", "block", "tall", "boulder"),
    obj("fire geyser", "none", "low", "rubble", { light: "faintglow" }),
    obj("basalt column cluster", "block", "tall", "pillar"),
    obj("scorched tree", "none", "tall", "deadtree"),
    long("lava bridge", "none", "flat", "log", { move: "open", light: "faintglow" }),
    obj("dragon bones", "cover", "low", "bones", { standIn: false }),
    obj("forge of the fire giants", "block", "tall", "campfire", { footprint: "rect", light: "campfire" }),
  ],
  terrain: [
    tex("black volcanic rock", "stone", true),
    tex("glowing lava", "lava", true),
    tex("ash ground", "dirt", true),
    tex("cracked basalt", "stone", true),
  ],
});
