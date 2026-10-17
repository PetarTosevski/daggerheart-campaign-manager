// Daggerheart rules data and lookup helpers.
// Pure data: no framework imports, relative imports only (bundled into Convex).

import { BEASTFORMS } from "./beastforms";
import { CLASSES } from "./classes";
import { DOMAIN_CARDS, DOMAINS } from "./domain-cards";
import { ARMOR, STARTING_SUGGESTIONS, WEAPONS } from "./equipment";
import { ANCESTRIES, COMMUNITIES, TRANSFORMATIONS } from "./heritage";
import { PORTRAITS } from "./art";
import { SUBCLASSES } from "./subclasses";
import type {
  Ancestry,
  Armor,
  Beastform,
  ClassDef,
  Community,
  DomainCard,
  DomainDef,
  DomainId,
  PortraitArt,
  Source,
  StartingSuggestion,
  SubclassDef,
  Transformation,
  Weapon,
} from "./types";

export * from "./types";
export { BEASTFORMS } from "./beastforms";
export { CLASSES } from "./classes";
export { DOMAIN_CARDS, DOMAINS } from "./domain-cards";
export { ARMOR, EXPERIENCE_SUGGESTIONS, STARTING_SUGGESTIONS, WEAPONS } from "./equipment";
export { ANCESTRIES, COMMUNITIES, TRANSFORMATIONS } from "./heritage";
export { DOMAIN_CARD_ART, PORTRAITS, TRANSFORMATION_ART } from "./art";
export { SUBCLASSES } from "./subclasses";

const byId = <T extends { id: string }>(list: readonly T[], id: string): T | undefined =>
  list.find((item) => item.id === id);

export const getClass = (id: string): ClassDef | undefined => byId(CLASSES, id);
export const getSubclass = (id: string): SubclassDef | undefined => byId(SUBCLASSES, id);
export const getDomain = (id: string): DomainDef | undefined => byId(DOMAINS, id);
export const getDomainCard = (id: string): DomainCard | undefined => byId(DOMAIN_CARDS, id);
export const getAncestry = (id: string): Ancestry | undefined => byId(ANCESTRIES, id);
export const getCommunity = (id: string): Community | undefined => byId(COMMUNITIES, id);
export const getTransformation = (id: string): Transformation | undefined =>
  byId(TRANSFORMATIONS, id);
export const getWeapon = (id: string): Weapon | undefined => byId(WEAPONS, id);
export const getArmor = (id: string): Armor | undefined => byId(ARMOR, id);
export const getBeastform = (id: string): Beastform | undefined => byId(BEASTFORMS, id);

export const subclassesForClass = (classId: string): SubclassDef[] =>
  SUBCLASSES.filter((s) => s.classId === classId);

export const getStartingSuggestion = (classId: string): StartingSuggestion | undefined =>
  (STARTING_SUGGESTIONS as Readonly<Record<string, StartingSuggestion>>)[classId];

/** Domain cards from the given domains at or below `maxLevel`, ordered by level then name. */
export const cardsForDomains = (
  domains: readonly DomainId[],
  maxLevel = 10,
): DomainCard[] =>
  DOMAIN_CARDS.filter((c) => domains.includes(c.domain) && c.level <= maxLevel).sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name),
  );

/** Beastforms available at a character tier (that tier or lower). */
export const beastformsForTier = (tier: number): Beastform[] =>
  BEASTFORMS.filter((b) => b.tier <= tier);

/** Keep only content whose source is enabled, e.g. hide Hope & Fear for core-only campaigns. */
export const fromSources = <T extends { source: Source }>(
  list: readonly T[],
  sources: readonly Source[],
): T[] => list.filter((item) => sources.includes(item.source));

/** Portrait for a subclass, falling back to the ancestry, as the Party board does. */
export const portraitFor = (opts: {
  subclassId?: string | null;
  ancestryId?: string | null;
}): PortraitArt | undefined =>
  (opts.subclassId ? PORTRAITS[`sub-${opts.subclassId}`] : undefined) ??
  (opts.ancestryId ? PORTRAITS[`anc-${opts.ancestryId}`] : undefined);
