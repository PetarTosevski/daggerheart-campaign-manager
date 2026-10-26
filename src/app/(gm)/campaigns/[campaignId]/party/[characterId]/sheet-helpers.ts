// Pure helpers for the character sheet (D4). No React; unit-tested in tests/unit/sheet-helpers.test.ts.

import { hitPointsToMark, type Severity, type Thresholds } from "@/lib/domain/characters";
import {
  getAncestry,
  getCommunity,
  getDomainCard,
  getTransformation,
  PORTRAITS,
  TRANSFORMATION_ART,
  type DomainCard,
  type Feature,
} from "@/lib/srd";
import type { CharacterSheet } from "@/lib/validation/characters";

/**
 * Weapon damage with Proficiency as the number of damage dice: "d8+1 phy" at
 * Proficiency 2 reads "2d8+1 phy". Only the weapon's first die is multiplied.
 */
export function weaponDamage(damage: string, proficiency: number): string {
  return damage.replace(/^d(\d+)/, `${proficiency}d$1`);
}

/**
 * Change to a track when slot `slot` (1-based) is tapped: tapping the last
 * marked slot clears it, any other slot marks up to it.
 */
export function pipDelta(slot: number, marked: number): number {
  const target = slot === marked ? slot - 1 : slot;
  return target - marked;
}

/** Display ranges for the Minor / Major / Severe boxes. */
export function thresholdRanges(t: Thresholds): { minor: string; major: string; severe: string } {
  return {
    minor: t.major > 1 ? `1 – ${t.major - 1}` : "—",
    major: t.severe > t.major ? `${t.major} – ${t.severe - 1}` : "—",
    severe: `${t.severe}+`,
  };
}

export type DamagePlan = { severity: Severity; marks: number; armorUsed: boolean };

/** What applying `damage` would do; an Armor Slot only helps when one is free and the hit marks HP. */
export function planDamage(damage: number, t: Thresholds, useArmorSlot: boolean, armorFree: number): DamagePlan {
  const raw = hitPointsToMark(damage, t, false);
  const armorUsed = useArmorSlot && armorFree > 0 && raw.marks > 0;
  const result = armorUsed ? hitPointsToMark(damage, t, true) : raw;
  return { ...result, armorUsed };
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  none: "No damage",
  minor: "Minor damage",
  major: "Major damage",
  severe: "Severe damage",
};

/** Owned cards not in the loadout, in the order they were taken. */
export function vaultCardIds(sheet: Pick<CharacterSheet, "domainCards">): string[] {
  const loadout = new Set(sheet.domainCards.loadout);
  return sheet.domainCards.owned.filter((id) => !loadout.has(id));
}

export function resolveCards(ids: readonly string[]): DomainCard[] {
  return ids.flatMap((id) => {
    const card = getDomainCard(id);
    return card ? [card] : [];
  });
}

/** Why a vault card can't move into the loadout right now, or null when it can. */
export function recallBlock(card: Pick<DomainCard, "level">, level: number, loadoutSize: number): string | null {
  if (card.level > level) return `Level ${card.level} card: above your level.`;
  if (loadoutSize >= 5) return "Loadout full (5): vault a card first.";
  return null;
}

export type HeritageCard = {
  key: string;
  kind: "Ancestry" | "Community" | "Transformation";
  name: string;
  features: readonly Feature[];
  /** Design asset id and CSS position for the card art. */
  art?: { asset: string; position: string };
  note?: string;
};

/**
 * Ancestry and community cards. A mixed ancestry takes the first feature of
 * its first ancestry and the second feature of the other; a Shapeshifter
 * keeps only the chosen feature of its current form.
 */
export function heritageCards(sheet: Pick<CharacterSheet, "ancestry" | "communityId" | "transformationId">): HeritageCard[] {
  const cards: HeritageCard[] = [];
  const a = sheet.ancestry;
  if (a.kind === "single") {
    const anc = getAncestry(a.id);
    if (anc) cards.push({ key: `anc-${anc.id}`, kind: "Ancestry", name: anc.name, features: anc.features, art: PORTRAITS[`anc-${anc.id}`] });
  } else if (a.kind === "mixed") {
    const first = getAncestry(a.first);
    const second = getAncestry(a.second);
    const features = [first?.features[0], second?.features[1]].filter((f): f is Feature => Boolean(f));
    cards.push({
      key: "anc-mixed",
      kind: "Ancestry",
      name: a.name || [first?.name, second?.name].filter(Boolean).join(" / "),
      features,
      art: PORTRAITS[`anc-${a.first}`],
      note: `Mixed ancestry: ${first?.name ?? "?"} and ${second?.name ?? "?"}`,
    });
  } else {
    const form = getAncestry(a.form);
    const chosen = form?.features.filter((f) => f.name === a.feature) ?? [];
    cards.push({
      key: "anc-form",
      kind: "Ancestry",
      name: form?.name ?? "Unknown form",
      features: chosen.length > 0 ? chosen : [{ name: a.feature, text: "" }],
      art: form ? PORTRAITS[`anc-${form.id}`] : undefined,
      note: "Current form (Shapeshifter): only the chosen feature applies.",
    });
  }
  const community = getCommunity(sheet.communityId);
  if (community) {
    cards.push({
      key: `com-${community.id}`,
      kind: "Community",
      name: community.name,
      features: [community.feature],
      art: PORTRAITS[`com-${community.id}`],
      note: community.often ? `Members are often: ${community.often}` : undefined,
    });
  }
  const tid = sheet.transformationId ?? (a.kind === "shapeshifter" ? "shapeshifter" : undefined);
  const t = tid ? getTransformation(tid) : undefined;
  if (t) {
    const asset = TRANSFORMATION_ART[t.id];
    cards.push({
      key: `tr-${t.id}`,
      kind: "Transformation",
      name: t.name,
      features: t.features,
      art: asset ? { asset, position: "30% 8%" } : undefined,
    });
  }
  return cards;
}

/** "+2", "0", "−1" for modifiers. */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

/** "Elf", "Elf / Orc" (or the mixed name), "Shapeshifter (Elf form)". */
export function ancestryLabel(a: CharacterSheet["ancestry"]): string {
  if (a.kind === "single") return getAncestry(a.id)?.name ?? a.id;
  if (a.kind === "mixed") return a.name || `${getAncestry(a.first)?.name ?? a.first} / ${getAncestry(a.second)?.name ?? a.second}`;
  return `Shapeshifter (${getAncestry(a.form)?.name ?? a.form} form)`;
}

/** Roving-focus tabs (WAI-ARIA tabs pattern): the tab index an arrow, Home or End key moves to, or -1 for other keys. */
export function nextTabIndex(key: string, current: number, count: number): number {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

/** The ancestry whose art stands in for a missing portrait. */
export function ancestryArtId(a: CharacterSheet["ancestry"]): string {
  return a.kind === "single" ? a.id : a.kind === "mixed" ? a.first : a.form;
}
