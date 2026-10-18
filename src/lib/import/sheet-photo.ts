// Reading a paper character sheet from photos (D5 T7): the prompt and output
// schema sent to Claude, the zod check of its answer, and the fuzzy match of
// the names it read to SRD ids. Pure: no framework imports, relative imports only.

import { z } from "zod";

import { ANCESTRIES, ARMOR, CLASSES, COMMUNITIES, DOMAIN_CARDS, SUBCLASSES, TRAIT_IDS, WEAPONS, type Source, type TraitId } from "../srd/index";
import type { ImportDraft, PhotoReadResult, Unmatched } from "./draft";

// ---------------------------------------------------------------- what Claude returns

const text = z.string().max(2000).nullable();
const count = z.number().int().nullable();

/** Claude's reading of the sheet: every field nullable (null = not readable). */
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

const nullableString = { type: ["string", "null"] };
const nullableInteger = { type: ["integer", "null"] };

function object(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

/** JSON Schema of `sheetReadingSchema`, for the Messages API's structured output (`output_config.format`). */
export const SHEET_READING_JSON_SCHEMA = object({
  name: nullableString,
  pronouns: nullableString,
  description: nullableString,
  level: nullableInteger,
  className: nullableString,
  subclassName: nullableString,
  ancestry: nullableString,
  community: nullableString,
  traits: object(Object.fromEntries(TRAIT_IDS.map((t) => [t, nullableInteger]))),
  evasion: nullableInteger,
  hpMax: nullableInteger,
  hpMarked: nullableInteger,
  stressMax: nullableInteger,
  stressMarked: nullableInteger,
  hope: nullableInteger,
  armorMarked: nullableInteger,
  proficiency: nullableInteger,
  primaryWeapon: nullableString,
  secondaryWeapon: nullableString,
  armor: nullableString,
  experiences: { type: "array", items: object({ name: { type: "string" }, value: nullableInteger }) },
  domainCards: { type: "array", items: { type: "string" } },
  inventory: { type: "array", items: { type: "string" } },
  gold: object({ handfuls: nullableInteger, bags: nullableInteger, chest: { type: ["boolean", "null"] } }),
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
    "Use null for any field you cannot read or that is blank, and an empty list for empty lists.",
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
 */
export function draftFromReading(reading: SheetReading, hopeAndFear: boolean): PhotoReadResult {
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
  return { draft, unreadable, unmatched };
}
