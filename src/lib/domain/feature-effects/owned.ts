// Which features a sheet holds (plan sheet-drawer, SD1; analysis section 5.1). Pure: reads the SRD data and the sheet,
// never the effect tables (a feature is held whether or not its FE-* entry is written yet).
//
// Book rules (printed pages, CB = Core Book, HF = Hope & Fear):
// - Hope features: each class has one (CB p.90: "You can spend 3 Hope to activate these powerful abilities"); a
//   multiclass gives none (D5 hooks.ts, CB p.111).
// - Multiclass, CB p.111: "When you multiclass, you get to choose an additional class, select one domain from that class,
//   and gain access to their class feature. … then choose a foundation card from a subclass of your choice." And: "you
//   can't gain the mastery card for any subclass." So the second class gives its class features and the foundation of
//   its subclass; the primary subclass gives its cards up to `subclassRank` (CB p.110: "If you have only the foundation
//   card, take a specialization. If you have a specialization already, take a mastery.").
// - Mixed ancestry, CB p.71: "You must choose the first feature from one ancestry and the second from another."
// - Shapeshifter (HF p.38, Only Skin Deep): "You gain the benefit of only one of your chosen ancestry's features, which you
//   select when you choose the ancestry." The sheet keeps the form (`ancestry.form`) and that feature (`ancestry.feature`).
// - Transformations (Q11, HF p.34-40): every feature of the sheet's `transformationId`.
// - Beastform (Q10, CB p.30): the form's features while transformed. D5 stores the form as the `beastform` sheet effect
//   whose text starts with the form's name; `scope.beastformId` overrides it.
// - Martial stances (Q5, HF p.12): the stances in `classState.martial.known`.
// - Hope & Fear content (classes, subclasses, ancestries, communities, transformations, stances) only with the campaign's
//   `hopeAndFear` option, as D5's `classFeaturesAvailable`.
//
// ```ts
// owned(sheet, { hopeAndFear: campaign.options.hopeAndFear }).map((f) => f.featureId);
// // ["hope:guardian", "class:guardian:unstoppable", "subclass:stalwart:unwavering", …, "community:orderborne:dedicated"]
// ```

import { BEASTFORMS } from "../../srd/beastforms";
import { CLASSES } from "../../srd/classes";
import { featureUsage } from "../../srd/feature-effects/classification";
import { ANCESTRIES, COMMUNITIES, TRANSFORMATIONS } from "../../srd/heritage";
import { STANCES } from "../../srd/stances";
import { SUBCLASSES } from "../../srd/subclasses";
import type { Feature, Source } from "../../srd/types";
import type { CharacterSheet } from "../../validation/characters";
import { featureId, featureSlug } from "./ids";
import type { FeatureSource, FeatureUsage, SubclassCard } from "./types";
import type { Holdings } from "./upgrades";

/** The sheet fields `owned` reads. */
export type OwnedSheet = Pick<
  CharacterSheet,
  "classId" | "subclassId" | "subclassRank" | "multiclass" | "ancestry" | "communityId" | "transformationId" | "effects" | "classState" | "level"
>;

export interface OwnedScope {
  /** The campaign's Hope & Fear option (default: on, as D5's callers without a campaign). */
  hopeAndFear?: boolean;
  /** The active Beastform; absent: read from the sheet's `beastform` effect; null: not transformed. */
  beastformId?: string | null;
}

/** One feature the sheet holds. */
export interface OwnedFeature {
  featureId: string;
  source: FeatureSource;
  /** The class, subclass, ancestry, community, Beastform or transformation id; `martial-artist` for a stance. */
  owner: string;
  name: string;
  text: string;
  /** The subclass card that grants it (subclass features). */
  card?: SubclassCard;
  /** From the multiclass (its class features and its subclass foundation). */
  multiclass?: true;
  usage: FeatureUsage;
}

const RANKS: readonly SubclassCard[] = ["foundation", "specialization", "mastery"];

const allowed = (source: Source, scope: OwnedScope) => source !== "hope-and-fear" || scope.hopeAndFear !== false;

function make(source: FeatureSource, owner: string, f: Feature, extra: Partial<Pick<OwnedFeature, "card" | "multiclass">> = {}): OwnedFeature {
  const id = source === "hope" ? featureId("hope", owner) : featureId(source, owner, f.name);
  return { featureId: id, source, owner, name: f.name, text: f.text, ...extra, usage: featureUsage(id) };
}

/** The Beastform the sheet is in: D5's `beastform` effect names the form first in its text (`classes/druid.ts`). */
export function activeBeastformId(sheet: Pick<CharacterSheet, "effects">): string | null {
  const effect = sheet.effects.find((e) => e.id === "beastform");
  if (!effect) return null;
  const byLength = [...BEASTFORMS].sort((a, b) => b.name.length - a.name.length);
  return byLength.find((b) => effect.text.startsWith(b.name))?.id ?? null;
}

/** Every feature the sheet holds, in drawer order: Hope, class, subclass, ancestry, community, transformation, Beastform, stances. */
export function owned(sheet: OwnedSheet, scope: OwnedScope = {}): OwnedFeature[] {
  const out: OwnedFeature[] = [];

  // Class: the primary Hope feature, then the class features of the class and the multiclass.
  const primary = CLASSES.find((c) => c.id === sheet.classId);
  if (primary && allowed(primary.source, scope)) {
    out.push(make("hope", primary.id, primary.hopeFeature));
    for (const f of primary.classFeatures) out.push(make("class", primary.id, f));
  }
  const second = sheet.multiclass ? CLASSES.find((c) => c.id === sheet.multiclass!.classId && c.id !== sheet.classId) : undefined;
  if (second && allowed(second.source, scope)) for (const f of second.classFeatures) out.push(make("class", second.id, f, { multiclass: true }));

  // Subclass cards up to the rank; the multiclass's foundation.
  const subclass = SUBCLASSES.find((s) => s.id === sheet.subclassId);
  if (subclass && allowed(subclass.source, scope)) {
    const upTo = RANKS.indexOf(sheet.subclassRank);
    for (const card of RANKS.slice(0, upTo + 1)) for (const f of subclass[card]) out.push(make("subclass", subclass.id, f, { card }));
  }
  const mcSub = sheet.multiclass ? SUBCLASSES.find((s) => s.id === sheet.multiclass!.subclassId && s.id !== sheet.subclassId) : undefined;
  if (mcSub && allowed(mcSub.source, scope)) for (const f of mcSub.foundation) out.push(make("subclass", mcSub.id, f, { card: "foundation", multiclass: true }));

  // Ancestry: single (both), mixed (first of one, second of the other), shapeshifter (the one chosen form feature).
  const ancestry = (id: string) => ANCESTRIES.find((a) => a.id === id);
  const a = sheet.ancestry;
  const pushAncestry = (id: string, index: number) => {
    const def = ancestry(id);
    const f = def?.features[index];
    if (def && f && allowed(def.source, scope)) out.push(make("ancestry", def.id, f));
  };
  if (a.kind === "single") {
    const def = ancestry(a.id);
    if (def) def.features.forEach((_, i) => pushAncestry(def.id, i));
  } else if (a.kind === "mixed") {
    pushAncestry(a.first, 0);
    pushAncestry(a.second, 1);
  } else {
    const def = ancestry(a.form);
    const index = def ? def.features.findIndex((f) => f.name === a.feature || featureSlug(f.name) === featureSlug(a.feature)) : -1;
    if (def && index >= 0) pushAncestry(def.id, index);
  }

  // Community.
  const community = COMMUNITIES.find((c) => c.id === sheet.communityId);
  if (community && allowed(community.source, scope)) out.push(make("community", community.id, community.feature));

  // Transformation (Q11).
  const transformation = sheet.transformationId ? TRANSFORMATIONS.find((t) => t.id === sheet.transformationId) : undefined;
  if (transformation && allowed(transformation.source, scope)) for (const f of transformation.features) out.push(make("transformation", transformation.id, f));

  // Beastform while transformed (Q10).
  const formId = scope.beastformId === undefined ? activeBeastformId(sheet) : scope.beastformId;
  const form = formId ? BEASTFORMS.find((b) => b.id === formId) : undefined;
  if (form) for (const f of form.features) out.push(make("beastform", form.id, f));

  // Known martial stances (Q5): Hope & Fear content.
  if (scope.hopeAndFear !== false) {
    for (const slug of sheet.classState.martial?.known ?? []) {
      const stance = STANCES.find((s) => s.id === slug);
      if (stance) out.push(make("stance", "martial-artist", { name: stance.name, text: stance.text }));
    }
  }

  return out.filter((f, i, all) => all.findIndex((g) => g.featureId === f.featureId) === i);
}

/**
 * What `applyUpgrades` reads for a feature: the rank of its own subclass card (the primary subclass's `subclassRank`;
 * any other owner holds only its foundation), every held feature id, and the level.
 */
export function holdingsFor(sheet: Pick<CharacterSheet, "subclassId" | "subclassRank" | "level">, held: readonly OwnedFeature[], owner?: string): Holdings {
  const rank: SubclassCard = owner === undefined || owner === sheet.subclassId ? sheet.subclassRank : "foundation";
  return { rank, featureIds: new Set(held.map((f) => f.featureId)), level: sheet.level };
}
