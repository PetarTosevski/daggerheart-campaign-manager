// Pure state and gating for the character creation wizard (Party board, Core ch. 1).
// No React: unit-tested in tests/unit/wizard-logic.test.ts.

import { TRAIT_POOL } from "@/lib/domain/characters";
import {
  ANCESTRIES,
  ARMOR,
  CLASSES,
  COMMUNITIES,
  PORTRAITS,
  WEAPONS,
  cardsForDomains,
  fromSources,
  getAncestry,
  getArmor,
  getClass,
  getStartingSuggestion,
  getSubclass,
  getWeapon,
  type ClassDef,
  type Feature,
  type Source,
  type TraitId,
} from "@/lib/srd";
import { ikonisMissing, ikonisSchema, INITIAL_MOTHERBOARD, type Ikonis } from "@/lib/frames/extras/motherboard";
import type { CharacterDraft } from "@/lib/validation/characters";

export const STEP_TITLES = [
  "Class & Subclass",
  "Heritage",
  "Traits",
  "Character Info",
  "Starting Equipment",
  "Background",
  "Experiences",
  "Domain Cards",
  "Connections",
] as const;

export const STEP_COUNT = STEP_TITLES.length;

/** The two potions a new character chooses between (Core ch. 1, step 5). */
export const POTIONS = [
  { name: "Minor Health Potion", effect: "clear 1d4 Hit Points" },
  { name: "Minor Stamina Potion", effect: "clear 1d4 Stress" },
] as const;

export type AncestryMode = "single" | "mixed" | "shapeshifter";

/** What the wizard keeps while the player works through it (and in localStorage). */
export type WizardState = {
  step: number;
  classId: string | null;
  subclassId: string | null;
  ancestryMode: AncestryMode | null;
  ancestryId: string | null;
  mixedFirst: string | null;
  mixedSecond: string | null;
  mixedName: string;
  shapeForm: string | null;
  shapeFeature: string | null;
  communityId: string | null;
  traits: Partial<Record<TraitId, number>>;
  name: string;
  pronouns: string;
  description: string;
  /** PORTRAITS key (e.g. "sub-stalwart"), "none" for no portrait, null for the default (subclass art). */
  portrait: string | null;
  primaryWeaponId: string | null;
  secondaryWeaponId: string | null;
  armorId: string | null;
  potion: string | null;
  classItem: string | null;
  background: string[];
  experiences: [string, string];
  domainCards: string[];
  connections: string[];
  /** GM only: who the character belongs to (a user id); null = the GM. */
  ownerId: string | null;
  /** Motherboard campaigns: the Ikonis designed in place of weapons (CB 301). */
  ikonis: Ikonis;
};

export const emptyWizard = (): WizardState => ({
  step: 1,
  classId: null,
  subclassId: null,
  ancestryMode: null,
  ancestryId: null,
  mixedFirst: null,
  mixedSecond: null,
  mixedName: "",
  shapeForm: null,
  shapeFeature: null,
  communityId: null,
  traits: {},
  name: "",
  pronouns: "",
  description: "",
  portrait: null,
  primaryWeaponId: null,
  secondaryWeaponId: null,
  armorId: null,
  potion: null,
  classItem: null,
  background: [],
  experiences: ["", ""],
  domainCards: [],
  connections: [],
  ownerId: null,
  ikonis: { ...INITIAL_MOTHERBOARD.ikonis },
});

/** Restores a stored draft, keeping only fields of the right type. */
export function restoreWizard(raw: unknown): WizardState {
  const base = emptyWizard();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const mode = r.ancestryMode === "single" || r.ancestryMode === "mixed" || r.ancestryMode === "shapeshifter" ? r.ancestryMode : null;
  const traits: Partial<Record<TraitId, number>> = {};
  if (r.traits && typeof r.traits === "object") {
    for (const [k, v] of Object.entries(r.traits as Record<string, unknown>)) {
      if (typeof v === "number" && TRAIT_POOL.includes(v)) traits[k as TraitId] = v;
    }
  }
  const exps = strings(r.experiences);
  const step = typeof r.step === "number" && Number.isInteger(r.step) ? Math.min(STEP_COUNT, Math.max(1, r.step)) : 1;
  return {
    ...base,
    step,
    classId: str(r.classId),
    subclassId: str(r.subclassId),
    ancestryMode: mode,
    ancestryId: str(r.ancestryId),
    mixedFirst: str(r.mixedFirst),
    mixedSecond: str(r.mixedSecond),
    mixedName: text(r.mixedName),
    shapeForm: str(r.shapeForm),
    shapeFeature: str(r.shapeFeature),
    communityId: str(r.communityId),
    traits,
    name: text(r.name),
    pronouns: text(r.pronouns),
    description: text(r.description),
    portrait: str(r.portrait),
    primaryWeaponId: str(r.primaryWeaponId),
    secondaryWeaponId: str(r.secondaryWeaponId),
    armorId: str(r.armorId),
    potion: str(r.potion),
    classItem: str(r.classItem),
    background: strings(r.background),
    experiences: [exps[0] ?? "", exps[1] ?? ""],
    domainCards: strings(r.domainCards),
    connections: strings(r.connections),
    ownerId: str(r.ownerId),
    ikonis: (() => {
      const parsed = ikonisSchema.safeParse(r.ikonis);
      return parsed.success ? parsed.data : base.ikonis;
    })(),
  };
}

/** `ikonis`: a Motherboard campaign, where an Ikonis replaces weapons (CB 301). */
export type WizardOptions = { hopeAndFear: boolean; ikonis?: boolean };

export const sourcesFor = (opts: WizardOptions): Source[] => (opts.hopeAndFear ? ["core", "hope-and-fear"] : ["core"]);

export const availableClasses = (opts: WizardOptions) => fromSources(CLASSES, sourcesFor(opts));
export const availableAncestries = (opts: WizardOptions) => fromSources(ANCESTRIES, sourcesFor(opts));
export const availableCommunities = (opts: WizardOptions) => fromSources(COMMUNITIES, sourcesFor(opts));

/** "a romance novel OR a letter never opened. Then …" → the two items. */
export function classItemsFor(cls: ClassDef | undefined): string[] {
  if (!cls) return [];
  return cls.classItems
    .split(".")[0]
    .split(/ OR /i)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1));
}

/** Tier 1 primary weapons the character may choose: class weapons only for their class; magic needs a Spellcast trait. */
export function primaryWeaponsFor(state: Pick<WizardState, "classId" | "subclassId">, opts: WizardOptions) {
  const spellcast = !!(state.subclassId && getSubclass(state.subclassId)?.spellcastTrait);
  return fromSources(WEAPONS, sourcesFor(opts)).filter(
    (w) =>
      w.slot === "primary" &&
      w.tier === 1 &&
      (!w.classId || w.classId === state.classId) &&
      (w.category !== "magic" || spellcast),
  );
}

export function secondaryWeaponsFor(opts: WizardOptions) {
  return fromSources(WEAPONS, sourcesFor(opts)).filter((w) => w.slot === "secondary" && w.tier === 1);
}

export function armorFor(opts: WizardOptions) {
  return fromSources(ARMOR, sourcesFor(opts)).filter((a) => a.tier === 1);
}

export function domainCardOptions(classId: string | null, opts: WizardOptions) {
  const cls = classId ? getClass(classId) : undefined;
  if (!cls) return [];
  return fromSources(cardsForDomains(cls.domains, 1), sourcesFor(opts)).filter((c) => c.level === 1);
}

/** Drops choices that no longer fit (another class, Hope & Fear switched off, a two-handed primary …). */
export function normalizeWizard(state: WizardState, opts: WizardOptions): WizardState {
  const src = sourcesFor(opts);
  const ok = (source: Source | undefined) => !!source && src.includes(source);
  const cls = state.classId ? getClass(state.classId) : undefined;
  const classId = cls && ok(cls.source) ? cls.id : null;
  const sub = state.subclassId ? getSubclass(state.subclassId) : undefined;
  const subclassId = classId && sub && sub.classId === classId ? sub.id : null;
  const anc = (id: string | null) => (id && ok(getAncestry(id)?.source) ? id : null);
  let ancestryMode = state.ancestryMode;
  if (ancestryMode === "shapeshifter" && !opts.hopeAndFear) ancestryMode = null;
  const mixedFirst = anc(state.mixedFirst);
  const mixedSecondRaw = anc(state.mixedSecond);
  const mixedSecond = mixedSecondRaw && mixedSecondRaw !== mixedFirst ? mixedSecondRaw : null;
  const shapeForm = anc(state.shapeForm);
  const formFeatures = shapeForm ? (getAncestry(shapeForm)?.features ?? []) : [];
  const shapeFeature = formFeatures.some((f) => f.name === state.shapeFeature) ? state.shapeFeature : null;
  const com = state.communityId ? COMMUNITIES.find((c) => c.id === state.communityId) : undefined;
  const communityId = com && ok(com.source) ? com.id : null;

  const primaries = opts.ikonis ? [] : primaryWeaponsFor({ classId, subclassId }, opts);
  const primary = primaries.find((w) => w.id === state.primaryWeaponId);
  const secondary =
    primary && primary.burden !== "two-handed"
      ? secondaryWeaponsFor(opts).find((w) => w.id === state.secondaryWeaponId)
      : undefined;
  const armor = armorFor(opts).find((a) => a.id === state.armorId);
  const items = classItemsFor(cls);
  const cardIds = new Set(domainCardOptions(classId, opts).map((c) => c.id));

  const next: WizardState = {
    ...state,
    classId,
    subclassId,
    ancestryMode,
    ancestryId: anc(state.ancestryId),
    mixedFirst,
    mixedSecond,
    shapeForm,
    shapeFeature,
    communityId,
    primaryWeaponId: primary?.id ?? null,
    secondaryWeaponId: secondary?.id ?? null,
    armorId: armor?.id ?? null,
    potion: POTIONS.some((p) => p.name === state.potion) ? state.potion : null,
    classItem: state.classItem && items.includes(state.classItem) ? state.classItem : null,
    domainCards: [...new Set(state.domainCards.filter((id) => cardIds.has(id)))].slice(0, 2),
  };
  const portraitOk = state.portrait === null || state.portrait === "none" || portraitOptions(next).some((p) => p.key === state.portrait);
  return portraitOk ? next : { ...next, portrait: null };
}

/** The portrait asset the character will get: the chosen one, else the subclass (or ancestry) art. */
export function portraitAsset(state: WizardState): string | null {
  if (state.portrait === "none") return null;
  const key = state.portrait ?? portraitOptions(state).find((p) => PORTRAITS[p.key])?.key;
  return (key && PORTRAITS[key]?.asset) || null;
}

export const traitsComplete = (traits: Partial<Record<TraitId, number>>) =>
  Object.values(traits).filter((v) => typeof v === "number").length === 6 &&
  [...Object.values(traits)].sort((a, b) => (a ?? 0) - (b ?? 0)).join() === [...TRAIT_POOL].sort((a, b) => a - b).join();

/** What each step still needs, in the board's words. Expects a normalized state. */
export function missingByStep(s: WizardState, opts?: WizardOptions): Record<number, string[]> {
  const cls = s.classId ? getClass(s.classId) : undefined;
  const has = (v: string) => v.trim().length > 0;
  const list = (...items: (string | false | null | undefined)[]) => items.filter((x): x is string => !!x);
  const left = 2 - s.domainCards.length;
  return {
    1: list(!s.classId && "a class", cls && !s.subclassId && "a subclass"),
    2: list(
      !s.ancestryMode && "an ancestry",
      s.ancestryMode === "single" && !s.ancestryId && "an ancestry",
      s.ancestryMode === "mixed" && !s.mixedFirst && "a first ancestry",
      s.ancestryMode === "mixed" && !s.mixedSecond && "a second ancestry",
      s.ancestryMode === "shapeshifter" && !s.shapeForm && "a current form",
      s.ancestryMode === "shapeshifter" && !!s.shapeForm && !s.shapeFeature && "a form feature",
      !s.communityId && "a community",
    ),
    3: list(!traitsComplete(s.traits) && "all six trait modifiers"),
    4: list(!has(s.name) && "a name"),
    5: list(
      ...(opts?.ikonis ? ikonisMissing(s.ikonis) : [!s.primaryWeaponId && "a primary weapon"]),
      !s.armorId && "armor",
      !s.potion && "a potion",
      classItemsFor(cls).length > 0 && !s.classItem && "a class item",
    ),
    6: [],
    7: list(!has(s.experiences[0]) && "a first Experience", !has(s.experiences[1]) && "a second Experience"),
    8: list(left > 0 && `${left} more domain card${left === 1 ? "" : "s"}`),
    9: [],
  };
}

/** "Still needed: a, b and c", or "" when nothing is missing. */
export function stillNeeded(missing: string[]): string {
  if (missing.length === 0) return "";
  const text = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0];
  return `Still needed: ${text}`;
}

/** A step is reachable once every earlier step is complete. */
export function canReach(step: number, missing: Record<number, string[]>): boolean {
  for (let i = 1; i < step; i++) if ((missing[i] ?? []).length > 0) return false;
  return true;
}

export const incompleteSteps = (missing: Record<number, string[]>) =>
  STEP_TITLES.filter((_, i) => (missing[i + 1] ?? []).length > 0);

/**
 * Assigns a trait modifier as the board does: if every copy of the value is
 * already used, it swaps with the trait holding it.
 */
export function assignTrait(
  traits: Partial<Record<TraitId, number>>,
  trait: TraitId,
  value: number,
): Partial<Record<TraitId, number>> {
  const copies = TRAIT_POOL.filter((v) => v === value).length;
  const holders = (Object.keys(traits) as TraitId[]).filter((k) => k !== trait && traits[k] === value);
  const next = { ...traits, [trait]: value };
  if (holders.length >= copies) {
    const other = holders[0];
    const previous = traits[trait];
    if (previous === undefined) delete next[other];
    else next[other] = previous;
  }
  return next;
}

/** Board behaviour for the Experience chips: click to fill the first empty slot, click again to remove. */
export function toggleExperience(exps: [string, string], example: string): [string, string] {
  let [a, b] = exps.map((x) => x.trim());
  if (a === example) a = "";
  else if (b === example) b = "";
  else if (!a) a = example;
  else b = example;
  return [a, b];
}

export function toggleCard(cards: string[], id: string): string[] {
  if (cards.includes(id)) return cards.filter((c) => c !== id);
  return cards.length >= 2 ? cards : [...cards, id];
}

/** The class's suggested trait spread. */
export function suggestedTraits(classId: string | null): Partial<Record<TraitId, number>> | null {
  const sg = classId ? getStartingSuggestion(classId) : undefined;
  return sg ? { ...sg.traits } : null;
}

/** The class's suggested weapons and armor, limited to what the character may take. */
export function suggestedLoadout(state: WizardState, opts: WizardOptions) {
  const sg = state.classId ? getStartingSuggestion(state.classId) : undefined;
  if (!sg || !sg.primaryWeapon) return null;
  const primary = primaryWeaponsFor(state, opts).find((w) => w.id === sg.primaryWeapon);
  if (!primary) return null;
  const secondary =
    primary.burden !== "two-handed" ? secondaryWeaponsFor(opts).find((w) => w.id === sg.secondaryWeapon) : undefined;
  const armor = armorFor(opts).find((a) => a.id === sg.armor);
  return { primaryWeaponId: primary.id, secondaryWeaponId: secondary?.id ?? null, armorId: armor?.id ?? null };
}

const featureMod = (feature: Feature | null | undefined, stat: "Evasion" | "Armor Score") => {
  if (!feature) return 0;
  let total = 0;
  for (const m of feature.text.matchAll(new RegExp(`([+\\-−]\\d+) to ${stat}`, "g"))) {
    total += parseInt(m[1].replace("−", "-"), 10);
  }
  return total;
};

/** Board's gear summary: Evasion and Armor Score with equipment features applied. */
export function gearSummary(state: WizardState) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const primary = state.primaryWeaponId ? getWeapon(state.primaryWeaponId) : undefined;
  const secondary = state.secondaryWeaponId ? getWeapon(state.secondaryWeaponId) : undefined;
  const armor = state.armorId ? getArmor(state.armorId) : undefined;
  const gear = [primary?.feature, secondary?.feature, armor?.feature];
  const evasion = (cls?.startingEvasion ?? 10) + gear.reduce((n, f) => n + featureMod(f, "Evasion"), 0);
  const armorScore = armor ? armor.baseScore + gear.reduce((n, f) => n + featureMod(f, "Armor Score"), 0) : null;
  const parts = [`Evasion ${evasion}`];
  if (armor) parts.push(`Armor Score ${armorScore}`, `Thresholds ${armor.baseThresholds.major} / ${armor.baseThresholds.severe}`);
  parts.push("Proficiency 1");
  return parts.join(" · ");
}

/** Portrait choices that match the character: subclass, ancestry (or both mixed halves) and community art. */
export function portraitOptions(state: WizardState) {
  const keys: { key: string; label: string }[] = [];
  const sub = state.subclassId ? getSubclass(state.subclassId) : undefined;
  if (sub) keys.push({ key: `sub-${sub.id}`, label: sub.name });
  const ancestryIds =
    state.ancestryMode === "single"
      ? [state.ancestryId]
      : state.ancestryMode === "mixed"
        ? [state.mixedFirst, state.mixedSecond]
        : state.ancestryMode === "shapeshifter"
          ? [state.shapeForm]
          : [];
  for (const id of ancestryIds) {
    const a = id ? getAncestry(id) : undefined;
    if (a) keys.push({ key: `anc-${a.id}`, label: a.name });
  }
  const com = state.communityId ? COMMUNITIES.find((c) => c.id === state.communityId) : undefined;
  if (com) keys.push({ key: `com-${com.id}`, label: com.name });
  return keys;
}

/** Builds the server draft from a complete, normalized state. */
export function toCharacterDraft(s: WizardState, portrait: string | null): CharacterDraft {
  const ancestry: CharacterDraft["ancestry"] =
    s.ancestryMode === "mixed"
      ? { kind: "mixed", first: s.mixedFirst ?? "", second: s.mixedSecond ?? "", name: s.mixedName.trim() }
      : s.ancestryMode === "shapeshifter"
        ? { kind: "shapeshifter", form: s.shapeForm ?? "", feature: s.shapeFeature ?? "" }
        : { kind: "single", id: s.ancestryId ?? "" };
  const answers = (list: string[]) => list.map((x) => x.trim());
  return {
    classId: s.classId ?? "",
    subclassId: s.subclassId ?? "",
    ancestry,
    communityId: s.communityId ?? "",
    traits: s.traits as Record<TraitId, number>,
    name: s.name.trim(),
    pronouns: s.pronouns.trim(),
    description: s.description.trim(),
    primaryWeaponId: s.primaryWeaponId ?? "",
    ...(s.secondaryWeaponId ? { secondaryWeaponId: s.secondaryWeaponId } : {}),
    armorId: s.armorId ?? "",
    potion: s.potion ?? "",
    classItem: s.classItem ?? "",
    background: answers(s.background),
    experiences: [s.experiences[0].trim(), s.experiences[1].trim()],
    domainCards: [...s.domainCards],
    connections: answers(s.connections),
    ...(portrait ? { portrait: { kind: "asset" as const, asset: portrait } } : {}),
  };
}
