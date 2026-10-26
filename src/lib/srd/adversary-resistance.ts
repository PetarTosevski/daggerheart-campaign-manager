// Resistance and immunity of the SRD adversaries, read from their feature text (plan combat-actions, tracer CA2, Q8).
// Pure data and helpers: no framework imports, relative imports only.
//
// CB p.99: "When a creature has resistance to a damage type, they halve damage of that type before comparing it to their
// damage thresholds. ... When a creature has immunity to a damage type, they do not take any damage from an attack that
// deals damage of that type. ... If an attack deals both physical and magic damage, you can only benefit from resistance or
// immunity if you are resistant or immune to both damage types." It also says: "If the text doesn't specify whether
// resistance or immunity applies to physical or magic damage, the effect applies to both" (so "all damage" is both).

/** How a creature takes one damage type (CB p.99). */
export type ResistanceLevel = "none" | "resistant" | "immune";

export interface AdversaryResistance {
  physical: ResistanceLevel;
  magic: ResistanceLevel;
  /**
   * Set when the resistance holds only in a state the engine cannot see ("While underground"). The values above are the
   * resistance in that state; the GM switches it on per instance (Q8). Absent means always on.
   */
  conditional?: string;
  /** Damage text on the same feature that stays manual for the GM (Q8: "double damage from fire"). */
  manual?: string;
  /** Name of the feature that grants it, as printed in `ADVERSARIES`. */
  feature: string;
}

/** Keyed by `AdversaryDef.id`. One feature per adversary grants resistance or immunity in the SRD. */
export const ADVERSARY_RESISTANCE: Readonly<Record<string, AdversaryResistance>> = {
  // ---------------------------------------------------------------- always on, physical
  "skeleton-warrior": { physical: "resistant", magic: "none", feature: "Only Bones" },
  phantom: { physical: "resistant", magic: "none", feature: "Incorporeal" },
  poltergeist: { physical: "resistant", magic: "none", feature: "Specter" },
  banshee: { physical: "resistant", magic: "none", feature: "Specter" },
  dullahan: { physical: "resistant", magic: "none", feature: "Specter" },
  "entombed-empress": { physical: "resistant", magic: "none", feature: "Empty Husk" },
  "failed-experiment": { physical: "resistant", magic: "none", feature: "Warped Fortitude" },
  "guahalan-spirit-beast": { physical: "resistant", magic: "none", feature: "Ethereal Form" },
  "spectral-archer": { physical: "resistant", magic: "none", feature: "Ghost" },
  "spectral-captain": { physical: "resistant", magic: "none", feature: "Ghost" },
  "spectral-guardian": { physical: "resistant", magic: "none", feature: "Ghost" },
  "whisper-wraith": { physical: "resistant", magic: "none", feature: "Greater Specter" },
  "volcanic-dragon-obsidian-predator": { physical: "resistant", magic: "none", feature: "Obsidian Scales" },
  "zombie-legion": { physical: "resistant", magic: "none", feature: "Unyielding" },
  scarecrow: {
    physical: "resistant",
    magic: "none",
    manual: "Takes double damage from fire.",
    feature: "Made of Straw",
  },
  "ghastly-legion": {
    physical: "immune",
    magic: "none",
    manual: "Takes double magic damage.",
    feature: "Necroplasmic",
  },
  // ---------------------------------------------------------------- always on, magic
  "minor-chaos-elemental": { physical: "none", magic: "resistant", feature: "Arcane Form" },
  "chaos-skull": { physical: "none", magic: "resistant", feature: "Wards" },
  gargoyle: { physical: "none", magic: "resistant", feature: "Unliving" },
  roc: { physical: "none", magic: "resistant", feature: "Electrifying Aura" },
  "shapeshifting-fiend": { physical: "none", magic: "resistant", feature: "Fiendish Nature" },
  "shapeshifting-fiend-revealed": { physical: "none", magic: "resistant", feature: "Fiendish Resistance" },
  "owl-witch": { physical: "none", magic: "resistant", feature: "Witch Barrier" },
  // ---------------------------------------------------------------- always on, both
  "cephilith-titan": { physical: "immune", magic: "resistant", feature: "Merely a Projection" },
  // ---------------------------------------------------------------- conditional (GM toggle)
  landshark: {
    physical: "resistant",
    magic: "resistant",
    conditional: "While underground (it can't attack).",
    feature: "Burrowing",
  },
  "landshark-behemoth": {
    physical: "immune",
    magic: "immune",
    conditional: "While underground (it can't attack).",
    feature: "Deep Diver",
  },
  stonewraith: {
    physical: "immune",
    magic: "immune",
    conditional: "While within stone or earth (and Hidden).",
    feature: "Stonestrider",
  },
  "oak-treant": {
    physical: "resistant",
    magic: "none",
    conditional: "While Rooted (Take Root).",
    feature: "Take Root",
  },
  hydra: {
    physical: "none",
    magic: "immune",
    conditional: "While Dazed, after taking magic damage, until the next roll with Fear.",
    feature: "Magical Weakness",
  },
  "cloud-titan": {
    physical: "immune",
    magic: "none",
    conditional: "While in misty cloud form (Nebulous Transformation).",
    manual: "Takes double magic damage in that form.",
    feature: "Nebulous Transformation",
  },
  phoenix: {
    physical: "immune",
    magic: "immune",
    conditional: "As the Smoldering Egg, after the Phoenix is defeated.",
    feature: "Resurrection",
  },
};

export interface ResistanceExclusion {
  adversaryId: string;
  feature: string;
  /** Why the text is not a damage resistance this table can apply. */
  reason: string;
}

/** Features that mention resistance or immunity but grant none to the adversary itself against damage. */
export const RESISTANCE_EXCLUSIONS: readonly ResistanceExclusion[] = [
  {
    adversaryId: "yufo",
    feature: "Psychic Strongbox",
    reason: "Immune to abilities and features that affect its thoughts or emotions, not to damage.",
  },
  {
    adversaryId: "vault-guardian-gaoler",
    feature: "Blocking Shield",
    reason: "Creatures trapped inside the Gaoler are immune to this feature; not damage.",
  },
  {
    adversaryId: "cult-adept",
    feature: "Shroud of the Fallen",
    reason:
      "Grants an ally Protection (resistance to all damage) until the Adept marks their last HP; the GM toggles a conditional resistance on that ally's instance.",
  },
];

const NO_RESISTANCE = { physical: "none", magic: "none" } as const satisfies Pick<
  AdversaryResistance,
  "physical" | "magic"
>;

/** True when a feature text mentions resistance or immunity (the scan the unit test runs over every SRD feature). */
export function mentionsResistance(text: string): boolean {
  return /resistan|immun/i.test(text);
}

/** The resistance applied automatically to an SRD adversary: always-on entries only; conditional ones need the GM toggle. */
export function alwaysOnResistance(adversaryId: string): Pick<AdversaryResistance, "physical" | "magic"> {
  const entry = ADVERSARY_RESISTANCE[adversaryId];
  if (!entry || entry.conditional !== undefined) return NO_RESISTANCE;
  return { physical: entry.physical, magic: entry.magic };
}

/** The conditional resistance an SRD adversary has when the GM switches it on, or undefined. */
export function conditionalResistance(adversaryId: string): AdversaryResistance | undefined {
  const entry = ADVERSARY_RESISTANCE[adversaryId];
  return entry?.conditional !== undefined ? entry : undefined;
}
