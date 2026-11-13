// Reading a paper character sheet from photos (D5 T7): the prompt and output
// schema sent to Claude, the zod check of its answer, and the fuzzy match of
// the names it read to SRD ids. Pure: no framework imports, relative imports only.

import * as z from "../zod";

import { ANCESTRIES, ARMOR, CLASSES, COMMUNITIES, DOMAIN_CARDS, SUBCLASSES, TRAIT_IDS, WEAPONS, type Source, type TraitId } from "../srd/index";
import type { ImportDraft, PhotoReadResult, Unmatched } from "./draft";

// ---------------------------------------------------------------- what Claude returns

const text = z.string().max(2000).nullable();
const count = z.number().int().nullable();

/**
 * Claude's reading of the sheet as the rest of the import uses it: every field
 * nullable (null = not readable). The API sends `sheetWireSchema`; `readingFromWire` converts.
 */
export const sheetReadingSchema = z.object({
  name: text,
  pronouns: text,
  description: text,
  level: count,
  className: text,
  subclassName: text,
  ancestry: text,
  community: text,
  traits: z.object(Object.fromEntries(TRAIT_IDS.map((t) => [t, count])) as Record<TraitId, typeof count>),
  evasion: count,
  hpMax: count,
  hpMarked: count,
  stressMax: count,
  stressMarked: count,
  hope: count,
  armorMarked: count,
  proficiency: count,
  primaryWeapon: text,
  secondaryWeapon: text,
  armor: text,
  experiences: z.array(z.object({ name: z.string().max(200), value: count })).max(20),
  domainCards: z.array(z.string().max(200)).max(40),
  inventory: z.array(z.string().max(200)).max(60),
  gold: z.object({ handfuls: count, bags: count, chest: z.boolean().nullable() }),
});

export type SheetReading = z.infer<typeof sheetReadingSchema>;

// ---------------------------------------------------------------- what goes over the wire

// The Messages API refuses a structured-output schema with more than 16 union-typed parameters (type arrays or
// anyOf), and the nullable reading above has 29 (bug dcm-5378). So the wire shape has no unions at all: a blank or
// unreadable string is "", every number is a plain integer, gold.chest a plain boolean, and `unreadable` names the
// fields Claude could not read by dotted path ("level", "traits.agility", "gold.handfuls", "gold.chest",
// "experiences.1.value", where 1 is the position in the `experiences` list Claude returned). `readingFromWire`
// turns it back into the nullable `SheetReading`, so everything downstream is unchanged. PS2 adds `uncertain` (same
// paths: values read but not sure of, kept as guesses) and `salvageWire`, which keeps every field of an off-schema
// reply that parses on its own, so a reply is never rejected (dcm-ccnm).

const wireText = z.string().max(2000);
const wireCount = z.number().int();

/** Claude's reading as the API returns it: no nulls; "" and `unreadable` mark what couldn't be read. */
export const sheetWireSchema = z.object({
  name: wireText,
  pronouns: wireText,
  description: wireText,
  level: wireCount,
  className: wireText,
  subclassName: wireText,
  ancestry: wireText,
  community: wireText,
  traits: z.object(Object.fromEntries(TRAIT_IDS.map((t) => [t, wireCount])) as Record<TraitId, typeof wireCount>),
  evasion: wireCount,
  hpMax: wireCount,
  hpMarked: wireCount,
  stressMax: wireCount,
  stressMarked: wireCount,
  hope: wireCount,
  armorMarked: wireCount,
  proficiency: wireCount,
  primaryWeapon: wireText,
  secondaryWeapon: wireText,
  armor: wireText,
  experiences: z.array(z.object({ name: z.string().max(200), value: wireCount })).max(20),
  domainCards: z.array(z.string().max(200)).max(40),
  inventory: z.array(z.string().max(200)).max(60),
  gold: z.object({ handfuls: wireCount, bags: wireCount, chest: z.boolean() }),
  unreadable: z.array(z.string().max(200)).max(100),
  /** PS2: fields Claude read but is not sure of (messy handwriting), same paths as `unreadable`; the guess is kept. */
  uncertain: z.array(z.string().max(200)).max(100),
});

export type SheetWire = z.infer<typeof sheetWireSchema>;

/**
 * The wire reading as today's `SheetReading`: a blank string, and any field
 * named in `unreadable`, becomes null. The list wins over a value Claude also
 * gave (it is told to give 0). Paths that name no field are ignored.
 */
export function readingFromWire(wire: SheetWire): SheetReading {
  const unreadable = new Set(wire.unreadable.map((p) => p.trim()));
  const asText = (path: string, value: string): string | null => (unreadable.has(path) || value.trim() === "" ? null : value);
  const asCount = (path: string, value: number): number | null => (unreadable.has(path) ? null : value);
  return {
    name: asText("name", wire.name),
    pronouns: asText("pronouns", wire.pronouns),
    description: asText("description", wire.description),
    level: asCount("level", wire.level),
    className: asText("className", wire.className),
    subclassName: asText("subclassName", wire.subclassName),
    ancestry: asText("ancestry", wire.ancestry),
    community: asText("community", wire.community),
    traits: Object.fromEntries(TRAIT_IDS.map((t) => [t, asCount(`traits.${t}`, wire.traits[t])])) as SheetReading["traits"],
    evasion: asCount("evasion", wire.evasion),
    hpMax: asCount("hpMax", wire.hpMax),
    hpMarked: asCount("hpMarked", wire.hpMarked),
    stressMax: asCount("stressMax", wire.stressMax),
    stressMarked: asCount("stressMarked", wire.stressMarked),
    hope: asCount("hope", wire.hope),
    armorMarked: asCount("armorMarked", wire.armorMarked),
    proficiency: asCount("proficiency", wire.proficiency),
    primaryWeapon: asText("primaryWeapon", wire.primaryWeapon),
    secondaryWeapon: asText("secondaryWeapon", wire.secondaryWeapon),
    armor: asText("armor", wire.armor),
    experiences: wire.experiences.map((e, i) => ({ name: e.name, value: asCount(`experiences.${i}.value`, e.value) })),
    domainCards: wire.domainCards,
    inventory: wire.inventory,
    gold: {
      handfuls: asCount("gold.handfuls", wire.gold.handfuls),
      bags: asCount("gold.bags", wire.gold.bags),
      chest: unreadable.has("gold.chest") ? null : wire.gold.chest,
    },
  };
}

// ---------------------------------------------------------------- salvaging a reply (PS2)

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const TEXT_FIELDS = ["name", "pronouns", "description", "className", "subclassName", "ancestry", "community", "primaryWeapon", "secondaryWeapon", "armor"] as const;
const COUNT_FIELDS = ["level", "evasion", "hpMax", "hpMarked", "stressMax", "stressMarked", "hope", "armorMarked", "proficiency"] as const;
const listItem = z.string().max(200);

/**
 * A reply as a wire reading even when it fails `sheetWireSchema`: every field that parses on its own is kept, every
 * other one gets its blank value ("", 0, false) and its path joins `unreadable`. In a list, invalid items are dropped
 * and the list itself ("experiences", "domainCards", "inventory") is listed; a list over its limit keeps its first
 * items and is listed too. An Experience whose name parses but whose modifier doesn't is kept with its modifier
 * unreadable. Invalid `unreadable` / `uncertain` entries are ignored. Null when the reply isn't a JSON object.
 */
export function salvageWire(raw: unknown): SheetWire | null {
  if (!isRaw(raw)) return null;
  const bad: string[] = [];
  const field = <T>(path: string, schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    bad.push(path);
    return fallback;
  };
  const items = (path: string, max: number, value: unknown): string[] => {
    if (!Array.isArray(value)) {
      bad.push(path);
      return [];
    }
    const kept = value.filter((item): item is string => listItem.safeParse(item).success);
    if (kept.length < value.length || kept.length > max) bad.push(path);
    return kept.slice(0, max);
  };
  const paths = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((p): p is string => listItem.safeParse(p).success).slice(0, 100) : [];

  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, field(f, wireText, raw[f], "")])) as Pick<SheetWire, (typeof TEXT_FIELDS)[number]>;
  const counts = Object.fromEntries(COUNT_FIELDS.map((f) => [f, field(f, wireCount, raw[f], 0)])) as Pick<SheetWire, (typeof COUNT_FIELDS)[number]>;
  const traitsRaw = isRaw(raw.traits) ? raw.traits : {};
  const goldRaw = isRaw(raw.gold) ? raw.gold : {};

  const experiences: SheetWire["experiences"] = [];
  if (Array.isArray(raw.experiences)) {
    for (const item of raw.experiences) {
      const name = isRaw(item) ? z.string().max(200).safeParse(item.name) : null;
      if (!name?.success || experiences.length >= 20) {
        bad.push("experiences");
        continue;
      }
      const value = field(`experiences.${experiences.length}.value`, wireCount, (item as Raw).value, 0);
      experiences.push({ name: name.data, value });
    }
  } else {
    bad.push("experiences");
  }

  const wire: SheetWire = {
    ...texts,
    ...counts,
    traits: Object.fromEntries(TRAIT_IDS.map((t) => [t, field(`traits.${t}`, wireCount, traitsRaw[t], 0)])) as SheetWire["traits"],
    experiences,
    domainCards: items("domainCards", 40, raw.domainCards),
    inventory: items("inventory", 60, raw.inventory),
    gold: {
      handfuls: field("gold.handfuls", wireCount, goldRaw.handfuls, 0),
      bags: field("gold.bags", wireCount, goldRaw.bags, 0),
      chest: field("gold.chest", z.boolean(), goldRaw.chest, false),
    },
    unreadable: [],
    uncertain: paths(raw.uncertain),
  };
  wire.unreadable = [...new Set([...paths(raw.unreadable), ...bad])];
  return wire;
}

/** Whether a reading holds anything at all: some text, a list item, a number other than 0 or a marked chest. */
export function anythingRead(reading: SheetReading): boolean {
  if (TEXT_FIELDS.map((f) => reading[f]).some((t) => (t ?? "").trim() !== "")) return true;
  if ([...reading.domainCards, ...reading.inventory, ...reading.experiences.map((e) => e.name)].some((t) => t.trim() !== "")) return true;
  const numbers = [...COUNT_FIELDS.map((f) => reading[f]), ...TRAIT_IDS.map((t) => reading.traits[t]), reading.gold.handfuls, reading.gold.bags];
  return numbers.some((n) => n !== null && n !== 0) || reading.gold.chest === true;
}

/**
 * Every path the review form can flag: the blank draft lists them all, so the form opens with every field red. Lists
 * are flagged by their name.
 */
export const ALL_DRAFT_PATHS: readonly string[] = [
  "name",
  "pronouns",
  "description",
  "level",
  "classId",
  "subclassId",
  "ancestry.id",
  "communityId",
  ...TRAIT_IDS.map((t) => `traits.${t}`),
  "evasion",
  "proficiency",
  "hpMax",
  "hp",
  "stressMax",
  "stress",
  "hope",
  "armorMarked",
  "primaryWeaponId",
  "secondaryWeaponId",
  "armorId",
  "gold.handfuls",
  "gold.bags",
  "gold.chest",
  "experiences",
  "domainCards",
  "inventory",
];

/** The reading of a sheet with nothing on it: every field null, every list empty. */
function emptyReading(): SheetReading {
  return {
    ...(Object.fromEntries([...TEXT_FIELDS, ...COUNT_FIELDS].map((f) => [f, null])) as Pick<SheetReading, (typeof TEXT_FIELDS)[number] | (typeof COUNT_FIELDS)[number]>),
    traits: Object.fromEntries(TRAIT_IDS.map((t) => [t, null])) as SheetReading["traits"],
    experiences: [],
    domainCards: [],
    inventory: [],
    gold: { handfuls: null, bags: null, chest: null },
  };
}

/**
 * The review form for a reply with nothing usable in it (a refusal, a reply cut off at max_tokens, a reply that isn't
 * JSON or holds nothing): the default draft, every field unreadable, `blank` set so the form says why.
 */
export function blankReadResult(hopeAndFear: boolean): PhotoReadResult {
  const { draft } = draftFromReading(emptyReading(), hopeAndFear);
  return { draft, unreadable: [...ALL_DRAFT_PATHS], uncertain: [], unmatched: [], blank: true };
}

/**
 * Claude's reply text as a review form, never an error (PS2): JSON that fails the wire schema is salvaged field by
 * field (`salvageWire`); null (no usable reply), text that isn't JSON or a JSON object, or a reply with nothing read
 * gives `blankReadResult`.
 */
export function readResultFromReply(text: string | null, hopeAndFear: boolean): PhotoReadResult {
  if (text === null) return blankReadResult(hopeAndFear);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return blankReadResult(hopeAndFear);
  }
  const wire = salvageWire(raw);
  if (wire === null) return blankReadResult(hopeAndFear);
  const reading = readingFromWire(wire);
  return anythingRead(reading) ? draftFromReading(reading, hopeAndFear, wire) : blankReadResult(hopeAndFear);
}

const string = { type: "string" };
const integer = { type: "integer" };

function object(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * JSON Schema of `sheetWireSchema`, for the Messages API's structured output
 * (`output_config.format`). No union types (the API allows at most 16); every
 * object lists all its properties as required and forbids any others.
 */
export const SHEET_READING_JSON_SCHEMA = object({
  name: string,
  pronouns: string,
  description: string,
  level: integer,
  className: string,
  subclassName: string,
  ancestry: string,
  community: string,
  traits: object(Object.fromEntries(TRAIT_IDS.map((t) => [t, integer]))),
  evasion: integer,
  hpMax: integer,
  hpMarked: integer,
  stressMax: integer,
  stressMarked: integer,
  hope: integer,
  armorMarked: integer,
  proficiency: integer,
  primaryWeapon: string,
  secondaryWeapon: string,
  armor: string,
  experiences: { type: "array", items: object({ name: string, value: integer }) },
  domainCards: { type: "array", items: string },
  inventory: { type: "array", items: string },
  gold: object({ handfuls: integer, bags: integer, chest: { type: "boolean" } }),
  unreadable: { type: "array", items: string },
  uncertain: { type: "array", items: string },
});

/** The sources a campaign uses: core, plus Hope & Fear when switched on. */
function sources(hopeAndFear: boolean): Source[] {
  return hopeAndFear ? ["core", "hope-and-fear"] : ["core"];
}

/** The instruction sent with the photos. Lists the classes the campaign uses. */
export function sheetPrompt(hopeAndFear: boolean): string {
  const classes = CLASSES.filter((c) => sources(hopeAndFear).includes(c.source)).map((c) => c.name);
  return [
    "These photos show one Daggerheart character sheet filled in by hand (several photos may show different parts or sides of the same sheet).",
    "Transcribe what is written into the JSON schema. Copy names as written; do not invent values.",
    'Text that is blank or that you cannot read is an empty string "".',
    'A number you cannot read: give 0 and list its path in unreadable, for example "level", "traits.agility", "gold.handfuls", or "experiences.1.value" for the modifier of the second Experience in your experiences list. If you cannot tell whether the gold chest is marked, give false and list "gold.chest". Leave unreadable empty when you could read every number.',
    'A value you can read but are not sure of (messy handwriting, a smudge, a word you had to guess): give your best guess and list its path in uncertain, with the same paths as unreadable, for example "name", "className", "traits.finesse", "domainCards.2" or "experiences.0.name". Leave uncertain empty when you are sure of everything you gave.',
    "Empty lists stay empty.",
    `The class is one of: ${classes.join(", ")}.`,
    "Trait values are the modifiers (for example -1, 0, +2). hpMarked and stressMarked count the filled-in boxes; hpMax and stressMax count all available boxes.",
    "ancestry: one ancestry name, or two separated by \" / \" for a mixed ancestry. domainCards: the names of the domain cards listed. experiences: each Experience with its modifier.",
  ].join("\n");
}

// ---------------------------------------------------------------- fuzzy matching

/** Lower case, accents and punctuation removed: "Elf / Half-Orc" → "elfhalforc". */
export function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** How close two names are, 0 to 1 (1 = the same once normalised). */
export function similarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (x === "" || y === "") return 0;
  if (x === y) return 1;
  const score = 1 - editDistance(x, y) / Math.max(x.length, y.length);
  // A name written without its last word ("Gambeson" for "Gambeson Armor") still counts.
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(short) ? Math.max(score, 0.9) : score;
}

/** Names this close or closer count as a match (one typo in a short word, a few in a long one). */
export const MATCH_THRESHOLD = 0.75;

/** The candidate whose name is closest to `text`, or undefined when none reaches `MATCH_THRESHOLD`. */
export function bestMatch<T extends { name: string }>(text: string, candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestScore = MATCH_THRESHOLD;
  for (const c of candidates) {
    const score = similarity(text, c.name);
    if (score > bestScore || (score === bestScore && best === undefined)) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Turns Claude's reading into a draft for review: names matched to SRD ids
 * (classes, subclasses, heritage, domain cards and every tier of equipment,
 * filtered by the campaign's sources), unreadable fields filled with a
 * default and listed in `unreadable`, unmatched names listed in `unmatched`.
 * The draft may not validate yet: the GM fixes it on the review screen.
 * `flags` are the wire's `unreadable` and `uncertain` paths (PS2): they are turned into draft paths (`wireToDraftPaths`)
 * and added, so a list, the chest, the pronouns or the description Claude flagged shows red too; an uncertain field
 * that is also unreadable counts as unreadable only.
 */
export function draftFromReading(reading: SheetReading, hopeAndFear: boolean, flags: { unreadable: string[]; uncertain: string[] } = { unreadable: [], uncertain: [] }): PhotoReadResult {
  const allowed = sources(hopeAndFear);
  const usable = <T extends { source: Source }>(list: readonly T[]) => list.filter((item) => allowed.includes(item.source));
  const unreadable: string[] = [];
  const unmatched: Unmatched[] = [];

  const str = (field: string, value: string | null, fallback = ""): string => {
    const v = value?.trim() ?? "";
    if (v === "") unreadable.push(field);
    return v === "" ? fallback : v;
  };
  const num = (field: string, value: number | null, fallback: number, min: number, max: number): number => {
    if (value === null) {
      unreadable.push(field);
      return fallback;
    }
    return Math.min(max, Math.max(min, value));
  };
  /** The id of the closest candidate, "" when unreadable or unmatched. */
  const match = <T extends { id: string; name: string }>(field: string, value: string | null, candidates: readonly T[]): T | undefined => {
    const v = value?.trim() ?? "";
    if (v === "") {
      unreadable.push(field);
      return undefined;
    }
    const found = bestMatch(v, candidates);
    if (!found) unmatched.push({ field, text: v });
    return found;
  };

  const cls = match("classId", reading.className, usable(CLASSES));
  const sub = match("subclassId", reading.subclassName, usable(SUBCLASSES).filter((s) => !cls || s.classId === cls.id));
  const classId = cls?.id ?? sub?.classId ?? "";

  const ancestries = usable(ANCESTRIES);
  const ancestryText = reading.ancestry?.trim() ?? "";
  const parts = ancestryText.split(/\s*(?:\/|&|\band\b)\s*/i).filter((p) => p !== "");
  const ancestry: ImportDraft["ancestry"] =
    parts.length >= 2
      ? {
          kind: "mixed",
          first: match("ancestry.first", parts[0] ?? null, ancestries)?.id ?? "",
          second: match("ancestry.second", parts[1] ?? null, ancestries)?.id ?? "",
          name: "",
        }
      : { kind: "single", id: match("ancestry.id", reading.ancestry, ancestries)?.id ?? "" };
  const community = match("communityId", reading.community, usable(COMMUNITIES));

  const weapons = usable(WEAPONS).filter((w) => !w.classId || w.classId === classId);
  const primary = match("primaryWeaponId", reading.primaryWeapon, weapons.filter((w) => w.slot === "primary"));
  const secondaryText = reading.secondaryWeapon?.trim() ?? "";
  const secondary = secondaryText === "" ? undefined : match("secondaryWeaponId", secondaryText, weapons.filter((w) => w.slot === "secondary"));
  const armorText = reading.armor?.trim() ?? "";
  const armor = armorText === "" ? undefined : match("armorId", armorText, usable(ARMOR));

  const classDomains = new Set<string>(CLASSES.find((c) => c.id === classId)?.domains ?? []);
  const cardPool = usable(DOMAIN_CARDS).filter((c) => classDomains.size === 0 || classDomains.has(c.domain));
  const domainCards: string[] = [];
  reading.domainCards.forEach((name, i) => {
    if (name.trim() === "") return;
    const card = match(`domainCards.${i}`, name, cardPool);
    if (card && !domainCards.includes(card.id)) domainCards.push(card.id);
  });

  const level = num("level", reading.level, 1, 1, 10);
  const startingHp = CLASSES.find((c) => c.id === classId)?.startingHp ?? 6;
  const startingEvasion = CLASSES.find((c) => c.id === classId)?.startingEvasion ?? 10;
  const hpMax = num("hpMax", reading.hpMax, startingHp, 1, 12);
  const stressMax = num("stressMax", reading.stressMax, 6, 1, 12);

  const draft: ImportDraft = {
    name: str("name", reading.name).slice(0, 80),
    pronouns: (reading.pronouns ?? "").trim().slice(0, 80),
    description: (reading.description ?? "").slice(0, 2000),
    level,
    classId,
    subclassId: sub?.id ?? "",
    ancestry,
    communityId: community?.id ?? "",
    traits: Object.fromEntries(TRAIT_IDS.map((t) => [t, num(`traits.${t}`, reading.traits[t], 0, -5, 10)])) as ImportDraft["traits"],
    evasion: num("evasion", reading.evasion, startingEvasion, 0, 40),
    hpMax,
    hp: num("hp", reading.hpMarked, 0, 0, hpMax),
    stressMax,
    stress: num("stress", reading.stressMarked, 0, 0, stressMax),
    hope: num("hope", reading.hope, 2, 0, 6),
    armorMarked: num("armorMarked", reading.armorMarked, 0, 0, 12),
    proficiency: num("proficiency", reading.proficiency, 1, 1, 10),
    primaryWeaponId: primary?.id ?? "",
    ...(secondary ? { secondaryWeaponId: secondary.id } : {}),
    ...(armor ? { armorId: armor.id } : {}),
    gold: {
      handfuls: num("gold.handfuls", reading.gold.handfuls, 0, 0, 99),
      bags: num("gold.bags", reading.gold.bags, 0, 0, 99),
      chest: reading.gold.chest ?? false,
    },
    experiences: reading.experiences
      .filter((e) => e.name.trim() !== "")
      .slice(0, 12)
      .map((e, i) => ({ name: e.name.trim().slice(0, 80), value: num(`experiences.${i}.value`, e.value, 2, -5, 10) })),
    domainCards,
    inventory: reading.inventory
      .map((item) => item.trim().slice(0, 200))
      .filter((item) => item !== "")
      .slice(0, 60),
  };
  if (reading.gold.chest === null) unreadable.push("gold.chest");
  const mapped = (paths: string[]) => wireToDraftPaths(paths, reading, ancestry.kind);
  for (const path of mapped(flags.unreadable)) if (!unreadable.includes(path)) unreadable.push(path);
  const uncertain = [...new Set(mapped(flags.uncertain))].filter((path) => !unreadable.includes(path));
  return { draft, unreadable, uncertain, unmatched, blank: false };
}

/** Reading list fields whose items are flagged as the whole list (domain cards are ticked, inventory is one text box). */
const LIST_FLAGS = new Set(["domainCards", "inventory", "experiences"]);
const RENAMED: Record<string, string> = {
  className: "classId",
  subclassName: "subclassId",
  community: "communityId",
  hpMarked: "hp",
  stressMarked: "stress",
  primaryWeapon: "primaryWeaponId",
  secondaryWeapon: "secondaryWeaponId",
  armor: "armorId",
};
const SAME = new Set<string>(["name", "pronouns", "description", "level", "evasion", "hpMax", "stressMax", "hope", "armorMarked", "proficiency", "gold.handfuls", "gold.bags", "gold.chest", ...TRAIT_IDS.map((t) => `traits.${t}`)]);

/**
 * Wire paths as the review form's draft paths: renamed fields ("className" → "classId", "hpMarked" → "hp"), the
 * ancestry as its select(s), an Experience by its position once blank names are dropped, and any item of the domain
 * cards or inventory as the whole list. Paths that name nothing are dropped.
 */
export function wireToDraftPaths(paths: string[], reading: SheetReading, ancestryKind: ImportDraft["ancestry"]["kind"]): string[] {
  // Reading index → draft index of the Experiences (blank names are dropped, at most 12 kept).
  const kept = reading.experiences.map((e, i) => ({ blank: e.name.trim() === "", i })).filter((e) => !e.blank).slice(0, 12).map((e) => e.i);
  const out: string[] = [];
  for (const raw of paths) {
    const path = raw.trim();
    const [head, index, leaf] = path.split(".");
    if (SAME.has(path)) out.push(path);
    else if (RENAMED[path]) out.push(RENAMED[path]);
    else if (path === "ancestry") out.push(...(ancestryKind === "mixed" ? ["ancestry.first", "ancestry.second"] : ["ancestry.id"]));
    else if (head === "experiences" && index !== undefined && (leaf === "name" || leaf === "value")) {
      const at = kept.indexOf(Number(index));
      if (at !== -1) out.push(`experiences.${at}.${leaf}`);
    } else if (head !== undefined && LIST_FLAGS.has(head)) out.push(head);
  }
  return out;
}
