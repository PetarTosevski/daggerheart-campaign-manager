// Built-in catalog: volcanic (docs/sprite-packs/prompts.md, grid order). Traits: D3 sight, D4 size, D5 height, Q1 light.

import { defineFolder, glowTex, long, obj, tex } from "./types";

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
    glowTex("glowing lava", "lava", true),
    tex("ash ground", "dirt", true),
    tex("cracked basalt", "stone", true),
  ],
  // Batch 2 (docs/sprite-packs/batch-2.md, tracer P11C): new items, not variants, in sheet order. Props 1 x 1; large
  // against the 2 x 2 forge of the fire giants: the dragon, the lava-lake island and the ash-buried house 3 x 3.
  // Light (D2): the small fire elemental and the throne's braziers give torch light, the burning bush and the giant
  // brass brazier campfire light; lava, molten gold, the glowing fissure, fire beetle, rune stone, salamander nest,
  // magma fall and lava tube glow faintly (like the magma bubble and lava pool). Lava and molten gold are difficult.
  extras: {
    "props-2": [
      obj("fire imp", "none", "low", "rock", { standIn: false }),
      obj("lava crab", "none", "low", "rock", { standIn: false }),
      obj("fire beetle", "none", "low", "rock", { light: "faintglow", standIn: false }),
      obj("small lava stream", "none", "flat", "rubble", { move: "difficult", light: "faintglow", standIn: false }),
      obj("pumice rocks", "cover", "low", "rock", { standIn: false }),
      obj("puddle of molten gold", "none", "flat", "rock", { move: "difficult", light: "faintglow", standIn: false }),
      obj("dragon egg", "cover", "low", "barrel", { standIn: false }),
      obj("obsidian dagger", "none", "flat", "bones", { standIn: false }),
      obj("smouldering backpack", "none", "low", "crate", { standIn: false }),
      obj("ash-covered body", "none", "flat", "bones", { standIn: false }),
      obj("smoking fissure", "none", "flat", "rubble", { light: "faintglow", standIn: false }),
      obj("small fire elemental", "none", "low", "torch", { light: "torch", standIn: false }),
      obj("red crystal cluster", "none", "low", "crystal", { standIn: false }),
      obj("slag heap", "cover", "low", "rubble", { standIn: false }),
      obj("fire rune stone", "cover", "low", "rock", { light: "faintglow", standIn: false }),
      obj("burning bush", "cover", "low", "campfire", { light: "campfire", standIn: false }),
    ],
    "large-2": [
      obj("sleeping red dragon", "block", "tall", "boulder", { w: 3, h: 3, standIn: false }),
      obj("fire giant's throne", "block", "tall", "torch", { light: "torch", standIn: false }),
      obj("magma fall", "block", "tall", "boulder", { light: "faintglow", footprint: "rect", standIn: false }),
      obj("obsidian archway", "cover", "tall", "pillar", { standIn: false }),
      obj("island in a lava lake", "none", "flat", "rock", { move: "difficult", light: "faintglow", footprint: "rect", w: 3, h: 3, standIn: false }),
      obj("salamander nest", "cover", "low", "rubble", { light: "faintglow", standIn: false }),
      obj("ash-buried house", "cover", "low", "rubble", { w: 3, h: 3, standIn: false }),
      obj("giant brass brazier", "block", "tall", "campfire", { light: "campfire", standIn: false }),
      obj("lava tube opening", "none", "flat", "rubble", { light: "faintglow", footprint: "rect", standIn: false }),
    ],
    "terrain-2": [
      tex("cooled ropy lava", "stone", true),
      glowTex("red-hot cracked ground", "lava", true),
      tex("sulphur crust", "dirt", true),
      tex("obsidian glass", "stone", true),
    ],
  },
});
