// Which features a sheet holds (plan sheet-drawer, SD1; analysis section 5.1). Pure: reads the SRD data and the sheet,
// never the effect entries (a feature is held whether or not its FE-* entry is written yet); the Beastform statistics
// and Evolved / Hybrid data come from src/lib/srd/feature-effects/beastforms.ts (DA9).
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
// - Beastform (Q10, CB p.30): the form's features while transformed, and its attack and statistics line
//   (`beastform:<form>:attack`; B1, user 2026-10-29: the table owns the form's trait and Evasion bonuses, dcm-bxp.99.19.19).
//   D5 stores the form as the `beastform` sheet effect whose text starts with `beastformLabel` (the form's name, then the
//   upgraded form or the Hybrid's picks in parentheses); `scope.beastformId` overrides it. DA9 (dcm-bxp.99.19.6 (3) (4)):
//   - Evolved forms (CB p.34 Legendary Beast, p.35 Mythic Beast: "you retain all traits and features from the original
//     form and gain the following bonuses") hold the base form's features and statistics (not its attack: the Evolved
//     attack replaces it) and the Evolved uses keyed by the base id (`uses`).
//   - Hybrid forms (CB p.34 Legendary Hybrid: "Choose a total of four advantages and two features from those options";
//     p.35 Mythic Hybrid: three features) hold their own statistics and the chosen features.
// - Martial stances (Q5, HF p.12): the stances in `classState.martial.known`.
// - Hope & Fear content (classes, subclasses, ancestries, communities, transformations, stances) only with the campaign's
//   `hopeAndFear` option, as D5's `classFeaturesAvailable`.
//
// ```ts
// owned(sheet, { hopeAndFear: campaign.options.hopeAndFear }).map((f) => f.featureId);
// // ["hope:guardian", "class:guardian:unstoppable", "subclass:stalwart:unwavering", …, "community:orderborne:dedicated"]
// ```

import { BEASTFORMS } from "../../srd/beastforms";
import { BEASTFORM_STATS, EVOLVED_FORMS, HYBRID_EXTRA_STRESS } from "../../srd/feature-effects/beastforms";
import { CLASSES } from "../../srd/classes";
import { featureUsage } from "../../srd/feature-effects/classification";
import { ANCESTRIES, COMMUNITIES, TRANSFORMATIONS } from "../../srd/heritage";
import { STANCES } from "../../srd/stances";
import { SUBCLASSES } from "../../srd/subclasses";
import type { Feature, Source } from "../../srd/types";
import type { CharacterSheet } from "../../validation/characters";
import { beastformAttackId, featureId, featureSlug } from "./ids";
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
  /**
   * The active Beastform; absent: read from the sheet's `beastform` effect; null: not transformed. A form id other than the
   * sheet's holds that form without an upgraded form or Hybrid picks.
   */
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
  /**
   * DA9: only these uses of the feature's entry are held (an Evolved form's uses keyed by its base form; a base form's
   * statistics under an Evolved form, without its own attack). Absent: every use.
   */
  uses?: readonly string[];
}

const RANKS: readonly SubclassCard[] = ["foundation", "specialization", "mastery"];

const allowed = (source: Source, scope: OwnedScope) => source !== "hope-and-fear" || scope.hopeAndFear !== false;

function make(source: FeatureSource, owner: string, f: Feature, extra: Partial<Pick<OwnedFeature, "card" | "multiclass">> = {}): OwnedFeature {
  const id = source === "hope" ? featureId("hope", owner) : featureId(source, owner, f.name);
  return { featureId: id, source, owner, name: f.name, text: f.text, ...extra, usage: featureUsage(id) };
}

// ---------------------------------------------------------------- the Beastform the sheet is in

/** The form a druid is in: an Evolved form's base form, a Hybrid's chosen features. */
export interface BeastformHolding {
  formId: string;
  /** Evolved forms (CB p.34-35): the Tier 1 (or Tier 1-2) form it upgrades. */
  baseFormId?: string;
  /** Hybrid forms (CB p.34-35): the chosen features, as `<source form id>:<feature slug>`. */
  hybridFeatures?: readonly string[];
}

const formById = (id: string) => BEASTFORMS.find((b) => b.id === id);
const BY_NAME_LENGTH = [...BEASTFORMS].sort((a, b) => b.name.length - a.name.length);

/** An Evolved form (Legendary Beast, Mythic Beast). */
export const isEvolvedForm = (formId: string): boolean => EVOLVED_FORMS[formId] !== undefined;
/** A Hybrid form (Legendary Hybrid, Mythic Hybrid). */
export const isHybridForm = (formId: string): boolean => HYBRID_EXTRA_STRESS[formId] !== undefined;

/** A Hybrid pick (`<form id>:<feature slug>`) as its form and printed feature; undefined for one that names none. */
export function hybridPick(pick: string): { form: (typeof BEASTFORMS)[number]; feature: Feature } | undefined {
  const [formId, slug] = pick.split(":");
  const form = formId ? formById(formId) : undefined;
  const feature = form?.features.find((f) => featureSlug(f.name) === slug);
  return form && feature ? { form, feature } : undefined;
}

/**
 * The name D5's `beastform` effect text starts with: "Agile Scout", "Legendary Beast (Agile Scout)", "Legendary Hybrid
 * (Agile Scout: Agile + Armored Sentry: Cannonball)". `activeBeastform` reads it back.
 */
export function beastformLabel(holding: BeastformHolding): string {
  const form = formById(holding.formId);
  if (!form) return holding.formId;
  const base = holding.baseFormId ? formById(holding.baseFormId) : undefined;
  if (base) return `${form.name} (${base.name})`;
  const picks = (holding.hybridFeatures ?? []).flatMap((p) => hybridPick(p) ?? []);
  if (picks.length > 0) return `${form.name} (${picks.map((p) => `${p.form.name}: ${p.feature.name}`).join(" + ")})`;
  return form.name;
}

/**
 * D5's `beastform` choice (`params.choice`, the drawer's `form` option): `<form id>`, `<evolved id>/<base id>` or
 * `<hybrid id>/<form id>:<feature slug>+<form id>:<feature slug>`. Null for an empty choice.
 */
export function parseBeastformChoice(choice: string): BeastformHolding | null {
  const [formId, rest] = choice.split("/");
  if (!formId) return null;
  if (rest === undefined || rest === "") return { formId };
  if (isEvolvedForm(formId)) return { formId, baseFormId: rest };
  return { formId, hybridFeatures: rest.split("+").filter((p) => p !== "") };
}

/** The choice string `parseBeastformChoice` reads. */
export function beastformChoice(holding: BeastformHolding): string {
  if (holding.baseFormId) return `${holding.formId}/${holding.baseFormId}`;
  if (holding.hybridFeatures && holding.hybridFeatures.length > 0) return `${holding.formId}/${holding.hybridFeatures.join("+")}`;
  return holding.formId;
}

/** The Beastform the sheet is in, read from D5's `beastform` effect text (`beastformLabel`); null when not transformed. */
export function activeBeastform(sheet: Pick<CharacterSheet, "effects">): BeastformHolding | null {
  const effect = sheet.effects.find((e) => e.id === "beastform");
  if (!effect) return null;
  const form = BY_NAME_LENGTH.find((b) => effect.text.startsWith(b.name));
  if (!form) return null;
  const rest = effect.text.slice(form.name.length);
  const close = rest.indexOf(")");
  const inner = rest.startsWith(" (") && close > 2 ? rest.slice(2, close) : "";
  if (inner === "") return { formId: form.id };
  if (isEvolvedForm(form.id)) {
    const base = BEASTFORMS.find((b) => b.name === inner);
    return base ? { formId: form.id, baseFormId: base.id } : { formId: form.id };
  }
  if (isHybridForm(form.id)) {
    const picks = inner.split(" + ").flatMap((part) => {
      const at = part.indexOf(": ");
      const source = at < 0 ? undefined : BEASTFORMS.find((b) => b.name === part.slice(0, at));
      const feature = source?.features.find((f) => f.name === part.slice(at + 2));
      return source && feature ? [`${source.id}:${featureSlug(feature.name)}`] : [];
    });
    return picks.length > 0 ? { formId: form.id, hybridFeatures: picks } : { formId: form.id };
  }
  return { formId: form.id };
}

/** The Beastform the sheet is in: D5's `beastform` effect names the form first in its text (`classes/druid.ts`). */
export function activeBeastformId(sheet: Pick<CharacterSheet, "effects">): string | null {
  return activeBeastform(sheet)?.formId ?? null;
}

/** A form's attack and statistics line (`beastform:<form>:attack`): a combat entry whose passive `form` use is the stat line. */
function statLine(formId: string, uses?: readonly string[]): OwnedFeature | null {
  const form = formById(formId);
  if (!form) return null;
  const stats = BEASTFORM_STATS[formId];
  const text = stats ? `${stats.line} (CB p.${stats.page})` : `The upgraded form's attack with the Evolved bonuses (CB p.${EVOLVED_FORMS[formId]?.page ?? 34}).`;
  return { featureId: beastformAttackId(formId), source: "beastform", owner: formId, name: `${form.name}: attack and statistics`, text, usage: "combat", ...(uses ? { uses } : {}) };
}

/** Whether an owned feature is a form's attack and statistics line. */
export const isStatLine = (feature: Pick<OwnedFeature, "featureId" | "source" | "owner">): boolean =>
  feature.source === "beastform" && feature.featureId === beastformAttackId(feature.owner);

/** What a Beastform holds (CB p.30, p.32-35): its stat line and features; Evolved and Hybrid forms as in the header. */
function beastformHeld(holding: BeastformHolding): OwnedFeature[] {
  const form = formById(holding.formId);
  if (!form) return [];
  const out: OwnedFeature[] = [];
  const push = (f: OwnedFeature | null) => {
    if (f) out.push(f);
  };
  if (isEvolvedForm(form.id)) {
    // Keyed by the base form: without one (an older sheet) none of the per-base uses is held.
    const base = holding.baseFormId ? formById(holding.baseFormId) : undefined;
    const keyed = base ? [base.id] : [];
    push(statLine(form.id, keyed));
    for (const f of form.features) out.push({ ...make("beastform", form.id, f), uses: keyed });
    if (base) {
      push(statLine(base.id, ["form", "advantage"]));
      for (const f of base.features) out.push(make("beastform", base.id, f));
    }
    return out;
  }
  push(statLine(form.id));
  for (const f of form.features) out.push(make("beastform", form.id, f));
  if (isHybridForm(form.id)) {
    for (const pick of holding.hybridFeatures ?? []) {
      const p = hybridPick(pick);
      if (p) out.push(make("beastform", p.form.id, p.feature));
    }
  }
  return out;
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

  // Beastform while transformed (Q10): the stat line and features, Evolved and Hybrid holdings (DA9).
  const active = activeBeastform(sheet);
  const holding =
    scope.beastformId === undefined ? active : scope.beastformId === null ? null : active?.formId === scope.beastformId ? active : { formId: scope.beastformId };
  if (holding) out.push(...beastformHeld(holding));

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
