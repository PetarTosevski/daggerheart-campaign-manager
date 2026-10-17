// Shared types for the Daggerheart rules data (Core Rulebook + Hope & Fear).
// Pure types: no framework imports, relative imports only (bundled into Convex).

/** Which book a piece of content comes from, so campaigns can hide expansion content. */
export type Source = "core" | "hope-and-fear";

export type TraitId = "agility" | "strength" | "finesse" | "instinct" | "presence" | "knowledge";

export const TRAIT_IDS: readonly TraitId[] = [
  "agility",
  "strength",
  "finesse",
  "instinct",
  "presence",
  "knowledge",
];

export type ClassId =
  | "bard"
  | "druid"
  | "guardian"
  | "ranger"
  | "rogue"
  | "seraph"
  | "sorcerer"
  | "warrior"
  | "wizard"
  | "assassin"
  | "brawler"
  | "warlock"
  | "witch";

export type DomainId =
  | "arcana"
  | "blade"
  | "bone"
  | "codex"
  | "grace"
  | "midnight"
  | "sage"
  | "splendor"
  | "valor"
  | "dread";

export type Range = "Melee" | "Very Close" | "Close" | "Far" | "Very Far";

/** A named rules feature; `text` is verbatim and may contain "\n" and "• " bullets. */
export interface Feature {
  name: string;
  text: string;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  source: Source;
  domains: readonly DomainId[];
  startingEvasion: number;
  startingHp: number;
  hopeFeature: Feature;
  classFeatures: readonly Feature[];
  /** Subclass ids, see SUBCLASSES. */
  subclasses: readonly string[];
  /** The "take either ... OR ..." class items line. */
  classItems: string;
  /** Character-description prompts (empty for Hope & Fear classes on the board). */
  clothes: string;
  attitude: string;
  backgroundQuestions: readonly string[];
  connectionQuestions: readonly string[];
}

export interface SubclassDef {
  id: string;
  classId: ClassId;
  name: string;
  source: Source;
  /** "Play the X if you want to ..." */
  description: string | null;
  spellcastTrait: TraitId | null;
  foundation: readonly Feature[];
  specialization: readonly Feature[];
  mastery: readonly Feature[];
}

export interface DomainDef {
  id: DomainId;
  name: string;
  /** Banner colour used by the design. */
  color: string;
  source: Source;
}

export type DomainCardType = "ability" | "spell" | "grimoire";

export interface DomainCard {
  id: string;
  name: string;
  level: number;
  domain: DomainId;
  type: DomainCardType;
  recallCost: number;
  text: string;
  source: Source;
  /** Design asset id for the card art, if the board has one. */
  art: string | null;
}

export interface Ancestry {
  id: string;
  name: string;
  source: Source;
  features: readonly Feature[];
}

export interface Community {
  id: string;
  name: string;
  source: Source;
  feature: Feature;
  /** "Members of this community are often ..." adjectives, verbatim. */
  often: string;
}

export interface Transformation {
  id: string;
  name: string;
  source: Source;
  tagline: string;
  description: string;
  features: readonly Feature[];
  questions: readonly string[];
}

export interface Weapon {
  id: string;
  name: string;
  slot: "primary" | "secondary";
  category: "physical" | "magic";
  tier: 1 | 2 | 3 | 4;
  /** "choice" = a trait of the wielder's choice (Brawler's Strike). */
  trait: TraitId | "choice";
  range: Range;
  /** Verbatim damage, e.g. "d10+3 phy". */
  damage: string;
  damageType: "physical" | "magic" | "either";
  burden: "one-handed" | "two-handed" | "barehanded";
  feature: Feature | null;
  source: Source;
  /** Set when the weapon is granted by a class feature rather than chosen. */
  classId?: ClassId;
}

export interface Armor {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  baseThresholds: { major: number; severe: number };
  baseScore: number;
  feature: Feature | null;
  source: Source;
}

export interface StartingSuggestion {
  traits: Record<TraitId, number>;
  /** Weapon ids. */
  primaryWeapon: string | null;
  secondaryWeapon: string | null;
  /** Armor id. */
  armor: string;
}

export interface ExperienceSuggestionGroup {
  category: string;
  examples: readonly string[];
}

export interface Beastform {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  examples: string;
  /** Null for the "Evolved" upgrade forms (Legendary Beast, Mythic Beast). */
  traitBonus: { trait: TraitId; bonus: number } | null;
  evasionBonus: number | null;
  attack: { range: Range; trait: TraitId; damage: string } | null;
  advantages: readonly string[];
  features: readonly Feature[];
}

export interface PortraitArt {
  /** Design asset id (public/design-assets/<id>.*). */
  asset: string;
  /** CSS background-position. */
  position: string;
}
