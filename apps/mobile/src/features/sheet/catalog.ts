import { hopeMax, scarsMax, tierForLevel } from "../../../../../src/lib/domain/characters";
import { derivedDefense, derivedThresholds } from "../../../../../src/lib/domain/characters/derived";
import { spellcastTraitOf } from "../../../../../src/lib/domain/characters/spellcast";
import { MOVE_LABELS, REST_MOVES, type RestKind, type RestMove } from "../../../../../src/lib/domain/rest/moves";
import { ARMOR as TIER1_ARMOR, WEAPONS as TIER1_WEAPONS } from "../../../../../src/lib/srd/equipment";
import { TIERED_ARMOR, TIERED_WEAPONS } from "../../../../../src/lib/srd/equipment-tiers";
import { CLASSES } from "../../../../../src/lib/srd/classes";
import { DOMAIN_CARDS } from "../../../../../src/lib/srd/domain-cards";
import { DOMAINS } from "../../../../../src/lib/srd/domains";
import { ANCESTRIES, COMMUNITIES } from "../../../../../src/lib/srd/heritage";
import { SUBCLASSES } from "../../../../../src/lib/srd/subclasses";
import { TRAIT_IDS, type TraitId } from "../../../../../src/lib/srd/types";

import type { Ancestry, SheetData } from "./types";

const WEAPONS = [...TIER1_WEAPONS, ...TIERED_WEAPONS];
const ARMOR = [...TIER1_ARMOR, ...TIERED_ARMOR];

export { hopeMax, MOVE_LABELS, REST_MOVES, scarsMax, TRAIT_IDS };
export type { RestKind, RestMove, TraitId };

export function className(id: string): string {
  return CLASSES.find((item) => item.id === id)?.name ?? id;
}

export function classDomains(id: string): readonly string[] {
  return CLASSES.find((item) => item.id === id)?.domains ?? [];
}

export function subclassName(id: string): string {
  return SUBCLASSES.find((item) => item.id === id)?.name ?? id;
}

export function domainName(id: string): string {
  return DOMAINS.find((item) => item.id === id)?.name ?? id;
}

export function communityName(id: string): string {
  return COMMUNITIES.find((item) => item.id === id)?.name ?? id;
}

export function ancestryName(id: string): string {
  return ANCESTRIES.find((item) => item.id === id)?.name ?? id;
}

export function ancestryLabel(ancestry: Ancestry): string {
  if (ancestry.kind === "single") return ancestryName(ancestry.id);
  if (ancestry.kind === "mixed") {
    return ancestry.name || `${ancestryName(ancestry.first)} / ${ancestryName(ancestry.second)}`;
  }
  return `Shapeshifter (${ancestryName(ancestry.form)} form)`;
}

export function heritageLine(sheet: Pick<SheetData, "ancestry" | "communityId">): string {
  return [ancestryLabel(sheet.ancestry), communityName(sheet.communityId)].filter(Boolean).join(" · ");
}

export function cardName(id: string): string {
  return DOMAIN_CARDS.find((card) => card.id === id)?.name ?? id;
}

export function cardRecall(id: string): number {
  return DOMAIN_CARDS.find((card) => card.id === id)?.recallCost ?? 0;
}

export function weaponOf(id: string | undefined): { name: string; range: string; damage: string; trait: string } | null {
  if (!id) return null;
  const weapon = WEAPONS.find((item) => item.id === id);
  if (!weapon) return { name: id, range: "", damage: "", trait: "" };
  return { name: weapon.name, range: weapon.range, damage: weapon.damage, trait: weapon.trait };
}

export function armorOf(id: string | undefined): { name: string; score: number; major: number; severe: number } | null {
  if (!id) return null;
  const armor = ARMOR.find((item) => item.id === id);
  if (!armor) return { name: id, score: 0, major: 0, severe: 0 };
  return { name: armor.name, score: armor.baseScore, major: armor.baseThresholds.major, severe: armor.baseThresholds.severe };
}

export function defenseOf(sheet: SheetData, augments: readonly string[] = []): { evasion: number; armorScore: number } {
  const defense = derivedDefense(
    {
      evasion: sheet.evasion,
      primaryWeaponId: sheet.primaryWeaponId,
      secondaryWeaponId: sheet.secondaryWeaponId,
      armorId: sheet.armorId,
      subclassId: sheet.subclassId,
      subclassRank: sheet.subclassRank,
      classId: sheet.classId,
      proficiency: sheet.proficiency,
      ...(sheet.multiclass
        ? {
            multiclass: {
              classId: sheet.multiclass.classId,
              domainId: sheet.multiclass.domainId,
              subclassId: sheet.multiclass.subclassId,
            },
          }
        : {}),
    },
    augments,
  );
  return { evasion: defense.evasion, armorScore: defense.armorScore };
}

export function thresholdsOf(sheet: SheetData): { major: number; severe: number } {
  const thresholds = derivedThresholds({
    level: sheet.level,
    armorId: sheet.armorId,
    subclassId: sheet.subclassId,
    subclassRank: sheet.subclassRank,
    ...(sheet.multiclass
      ? {
          multiclass: {
            classId: sheet.multiclass.classId,
            domainId: sheet.multiclass.domainId,
            subclassId: sheet.multiclass.subclassId,
          },
        }
      : {}),
  });
  return { major: thresholds.major, severe: thresholds.severe };
}

export function weaponChoices(
  slot: "primary" | "secondary",
  sheet: SheetData,
  hopeAndFear: boolean,
): { id: string; name: string }[] {
  const tier = tierForLevel(sheet.level);
  const spellcaster = spellcastTraitOf({
    subclassId: sheet.subclassId,
    ...(sheet.multiclass
      ? {
          multiclass: {
            classId: sheet.multiclass.classId,
            domainId: sheet.multiclass.domainId,
            subclassId: sheet.multiclass.subclassId,
          },
        }
      : {}),
  });
  const current = slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
  return WEAPONS.filter(
    (weapon) =>
      weapon.id === current ||
      (weapon.slot === slot &&
        weapon.tier <= tier &&
        (hopeAndFear || weapon.source === "core") &&
        (!weapon.classId || weapon.classId === sheet.classId) &&
        (weapon.category !== "magic" || spellcaster !== null)),
  ).map((weapon) => ({ id: weapon.id, name: weapon.name }));
}

export function armorChoices(sheet: SheetData, hopeAndFear: boolean): { id: string; name: string }[] {
  const tier = tierForLevel(sheet.level);
  return ARMOR.filter(
    (armor) => armor.id === sheet.armorId || (armor.tier <= tier && (hopeAndFear || armor.source === "core")),
  ).map((armor) => ({ id: armor.id, name: armor.name }));
}

/** Domain cards this class can take at the character's level that are not owned yet. */
export function deckChoices(sheet: SheetData, hopeAndFear: boolean): { id: string; name: string; level: number }[] {
  const domains = new Set(classDomains(sheet.classId));
  if (sheet.multiclass) domains.add(sheet.multiclass.domainId);
  const owned = new Set(sheet.domainCards.owned);
  return DOMAIN_CARDS.filter(
    (card) =>
      !owned.has(card.id) &&
      domains.has(card.domain) &&
      card.level <= sheet.level &&
      (hopeAndFear || card.source === "core"),
  )
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((card) => ({ id: card.id, name: card.name, level: card.level }));
}

export function traitLabel(id: string): string {
  const labels: Record<string, string> = {
    agility: "Agility",
    strength: "Strength",
    finesse: "Finesse",
    instinct: "Instinct",
    presence: "Presence",
    knowledge: "Knowledge",
  };
  return labels[id] ?? id;
}

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** "d8 phy" at Proficiency 2 reads "2d8 phy". */
export function weaponDamageLine(damage: string, proficiency: number): string {
  return damage.replace(/^d(\d+)/, `${proficiency}d$1`);
}
