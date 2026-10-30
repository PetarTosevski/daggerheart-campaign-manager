import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../../convex/_generated/api";

/** What `combatFeatures.drawer` returns (the character's own sheet only, U1). */
export type Drawer = FunctionReturnType<typeof api.combatFeatures.drawer>;
export type DrawerFeature = Drawer["features"][number];
export type DrawerUse = DrawerFeature["uses"][number];

/** The section ids in the order the drawer shows them (analysis Q5, Q10, Q11, Q15, Q16). */
export const SECTION_ORDER = ["hope", "class", "subclass", "ancestry", "community", "transformation", "form", "other"] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  hope: "Hope feature",
  class: "Class features",
  subclass: "Subclass",
  ancestry: "Ancestry",
  community: "Community",
  transformation: "Transformation",
  form: "Beastform and stance",
  other: "Other features",
};

/**
 * Rest-time features the rest flow applies by itself (Q15 b, plan tracer SD-R): Hardy, Efficient, Celestial Trance and
 * Oasis. The drawer lists them under "Other features" with the note "applied at rest", and no Use button.
 */
export const REST_TIME_FEATURES: ReadonlySet<string> = new Set([
  "community:frostborne:hardy",
  "ancestry:clank:efficient",
  "ancestry:elf:celestial-trance",
  "community:duneborne:oasis",
]);

/** The section a feature is listed under: out-of-combat and narrative features and the rest-time ones go to "Other features" (Q15). */
export function sectionOf(f: DrawerFeature): SectionId {
  if (REST_TIME_FEATURES.has(f.featureId) || f.usage === "outOfCombat" || f.usage === "narrative") return "other";
  switch (f.source) {
    case "beastform":
    case "stance":
      return "form";
    default:
      return f.source;
  }
}

export type Section = { id: SectionId; title: string; features: DrawerFeature[] };

/** The non-empty sections in order; `form` is also kept when the character knows stances (its controls show there). */
export function sectionsOf(drawer: Pick<Drawer, "features" | "martial">): Section[] {
  const by = new Map<SectionId, DrawerFeature[]>();
  for (const f of drawer.features) {
    const id = sectionOf(f);
    by.set(id, [...(by.get(id) ?? []), f]);
  }
  if (drawer.martial && !by.has("form")) by.set("form", []);
  return SECTION_ORDER.flatMap((id) => (by.has(id) ? [{ id, title: SECTION_TITLES[id], features: by.get(id) ?? [] }] : []));
}

const HOW_BADGE: Record<string, string> = {
  action: "Use",
  reaction: "Reaction",
  rider: "With an attack",
  auto: "Automatic",
  passive: "Passive",
  text: "Text",
};

/** The feature's kind badge: Use / Reaction / With an attack / Automatic / Passive / Text. */
export function kindBadge(f: Pick<DrawerFeature, "how">): string {
  return HOW_BADGE[f.how] ?? "Text";
}

/** Cost and limit badges of one use. */
export function useBadges(u: Pick<DrawerUse, "costs" | "limit">): string[] {
  return [...u.costs, ...(u.limit ? [u.limit] : [])];
}

/** The uses that get a Use button: an action or a reaction of a feature whose effect table is written. */
export function usableUses(f: DrawerFeature): DrawerUse[] {
  if (!f.automated || f.usage !== "combat" || REST_TIME_FEATURES.has(f.featureId)) return [];
  return f.uses.filter((u) => u.activation === "action" || u.activation === "reaction");
}

/** The subclass cards above the character's rank, per subclass, as locks (the multiclass has no mastery, CB p.111). */
export function lockedCards(features: readonly DrawerFeature[]): { owner: string; card: "specialization" | "mastery" }[] {
  const owners = new Map<string, { cards: Set<string>; multiclass: boolean }>();
  for (const f of features) {
    if (f.source !== "subclass") continue;
    const e = owners.get(f.owner) ?? { cards: new Set<string>(), multiclass: f.multiclass };
    if (f.card) e.cards.add(f.card);
    owners.set(f.owner, e);
  }
  const out: { owner: string; card: "specialization" | "mastery" }[] = [];
  for (const [owner, e] of owners) {
    if (e.multiclass) continue;
    if (!e.cards.has("specialization")) out.push({ owner, card: "specialization" });
    if (!e.cards.has("mastery")) out.push({ owner, card: "mastery" });
  }
  return out;
}

const CARD_LABEL = { foundation: "Foundation", specialization: "Specialization", mastery: "Mastery" } as const;
export const cardLabel = (card: DrawerFeature["card"]): string | null => (card ? CARD_LABEL[card] : null);

/** The stance's id (the slug of its feature id), as `combatFeatures.shiftStance` takes it. */
export function stanceId(featureId: string): string {
  return featureId.split(":")[2] ?? featureId;
}

/** Marking a Stress instead of a Focus to shift stances (HF p.11, Flow State). */
export function hasFlowState(features: readonly DrawerFeature[]): boolean {
  return features.some((f) => f.featureId.endsWith(":flow-state"));
}

/** "stalwart" or "agile-scout" as a title. */
export function titleCase(id: string): string {
  return id
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Q15 (a): out-of-combat features keep their existing D5 Use (`classFeatures.use`, the Party sheet's button). The map
 * is feature id → D5 `FeatureMeta.key`; both take no input (Commune, HF p.16; Get In & Get Out, HF p.8).
 */
export const D5_USES: Readonly<Record<string, string>> = {
  "class:witch:commune": "commune",
  "class:assassin:get-in-get-out": "getInGetOut",
};

/** The D5 key of a feature's existing Use under "Other features", or null. */
export function d5UseOf(f: Pick<DrawerFeature, "featureId" | "usage">): string | null {
  if (f.usage === "combat" || f.usage === "passive") return null;
  return D5_USES[f.featureId] ?? null;
}

/** The Beastform the character is in (Q10): the owner of its `beastform` features, or null when not transformed into one. */
export function activeForm(features: readonly DrawerFeature[]): string | null {
  return features.find((f) => f.source === "beastform")?.owner ?? null;
}
