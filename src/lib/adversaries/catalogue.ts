// Adversary catalogue browsing (D8 A2): search, chip filters, tier groups and paging, as on the Adversaries board
// (reference/designs/project/Adversaries.dc.html, lines 407-441). Pure module; the caller passes the list (the
// campaign's visible entries from adversariesFor), so it does not bundle the SRD data.
//
// Core Book p.193: "Tier 1 adversaries are appropriate for level 1 characters, Tier 2 for levels 2–4, Tier 3 for
//   levels 5–7, and Tier 4 for levels 8–10."
//
// ```ts
// const hits = filterAdversaries(visible, { query: "burrower", tier: null, type: null, book: null }); // [Acid Burrower]
// groupByTier(hits, PAGE_FIRST);  // [{ tier: 1, title: "Tier 1", sub: "Level 1 · 1 adversary", entries: [...] }]
// moreLabel(100, 40);             // "Show 60 more · 60 left"
// ```

import type { AdversaryDef, AdversaryType } from "../srd/types";

export type CatalogueBook = "core" | "hope-and-fear";
export type CatalogueTier = AdversaryDef["tier"];

export type CatalogueFilters = {
  query: string;
  tier: CatalogueTier | null;
  type: AdversaryType | null;
  book: CatalogueBook | null;
};

export const NO_FILTERS: CatalogueFilters = { query: "", tier: null, type: null, book: null };

/** Rows shown first, and rows each "Show more" adds (the board's 40 then +60). */
export const PAGE_FIRST = 40;
export const PAGE_MORE = 60;

const TIER_LEVELS: Record<CatalogueTier, string> = { 1: "Level 1", 2: "Levels 2–4", 3: "Levels 5–7", 4: "Levels 8–10" };

/**
 * Lower case, accents dropped, curly quotes and dashes folded to ASCII, whitespace collapsed: Core text uses
 * straight apostrophes and Hope & Fear text curly ones, so "get 'em" finds "Get ’em Off!".
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

type Searchable = Pick<AdversaryDef, "name" | "type" | "motives" | "description" | "features">;

const haystacks = new WeakMap<object, string>();

/** Name, type, motives, description, feature names and text, normalised (cached per entry). */
function haystack(def: Searchable): string {
  let text = haystacks.get(def);
  if (text === undefined) {
    text = normalizeSearch([def.name, def.type, def.motives, def.description, ...def.features.flatMap((f) => [f.name, f.text])].join(" "));
    haystacks.set(def, text);
  }
  return text;
}

export function matchesFilters(def: Searchable & Pick<AdversaryDef, "tier" | "source">, filters: CatalogueFilters): boolean {
  if (filters.tier !== null && def.tier !== filters.tier) return false;
  if (filters.type !== null && def.type !== filters.type) return false;
  if (filters.book !== null && def.source !== filters.book) return false;
  const query = normalizeSearch(filters.query);
  return query === "" || haystack(def).includes(query);
}

/** The entries matching every filter, in catalogue order. */
export function filterAdversaries<T extends Searchable & Pick<AdversaryDef, "tier" | "source">>(list: readonly T[], filters: CatalogueFilters): T[] {
  return list.filter((def) => matchesFilters(def, filters));
}

/** A chip click: the active chip clears its filter, another chip selects its value. */
export function toggleChip<T>(current: T | null, value: T): T | null {
  return current === value ? null : value;
}

export type TierGroup<T> = { tier: CatalogueTier; title: string; sub: string; entries: T[] };

/**
 * The first `limit` entries of `list` grouped by tier (list order kept). Each heading counts all of the tier's
 * matches, shown or not: "Levels 2–4 · 36 adversaries".
 */
export function groupByTier<T extends Pick<AdversaryDef, "tier">>(list: readonly T[], limit: number): TierGroup<T>[] {
  const counts = new Map<CatalogueTier, number>();
  for (const def of list) counts.set(def.tier, (counts.get(def.tier) ?? 0) + 1);
  const groups: TierGroup<T>[] = [];
  for (const def of list.slice(0, limit)) {
    let group = groups.at(-1);
    if (group?.tier !== def.tier) {
      const n = counts.get(def.tier) ?? 0;
      group = { tier: def.tier, title: `Tier ${def.tier}`, sub: `${TIER_LEVELS[def.tier]} · ${n} ${n === 1 ? "adversary" : "adversaries"}`, entries: [] };
      groups.push(group);
    }
    group.entries.push(def);
  }
  return groups;
}

/** "Show 60 more · 87 left", or null when everything is shown. */
export function moreLabel(total: number, limit: number): string | null {
  const left = total - limit;
  return left > 0 ? `Show ${Math.min(PAGE_MORE, left)} more · ${left} left` : null;
}

/** "264 adversaries · 129 core, 135 Hope & Fear" with no filter on (the campaign's visible set), else "N of M shown". */
export function countLine(visible: readonly Pick<AdversaryDef, "source">[], shown: number): string {
  if (shown !== visible.length) return `${shown} of ${visible.length} shown`;
  const hf = visible.filter((def) => def.source === "hope-and-fear").length;
  const all = `${visible.length} ${visible.length === 1 ? "adversary" : "adversaries"}`;
  return hf === 0 ? all : `${all} · ${visible.length - hf} core, ${hf} Hope & Fear`;
}

/** The type tag: "Horde (10/HP)" for Hordes, else the type. */
export function typeLabel(def: Pick<AdversaryDef, "type" | "hordePerHp">): string {
  return def.hordePerHp === undefined ? def.type : `${def.type} (${def.hordePerHp}/HP)`;
}

/** "8/15", "5/None", "None" (CB prints None for Minions). */
export function thresholdsLabel({ major, severe }: AdversaryDef["thresholds"]): string {
  if (major === null && severe === null) return "None";
  return `${major ?? "None"}/${severe ?? "None"}`;
}

/** "+3", "-2", "+0", or a dice bonus as printed ("+2d4"). */
export function attackLabel(modifier: number | string): string {
  if (typeof modifier === "string") return modifier;
  return modifier < 0 ? `-${-modifier}` : `+${modifier}`;
}

/** "Stealth +2, Swimming +2", or "" without Experiences. */
export function experienceLabel(experiences: AdversaryDef["experiences"]): string {
  return experiences.map((e) => `${e.name} ${attackLabel(e.value)}`).join(", ");
}

export type TextBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] };

/** Feature text split into paragraphs and lists: "- " lines are list items (the d6 move tables). */
export function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("- ")) {
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(line.slice(2));
      else blocks.push({ kind: "list", items: [line.slice(2)] });
    } else {
      blocks.push({ kind: "p", text: line });
    }
  }
  return blocks;
}

/** How the catalogue orders adversaries inside each tier group. */
export type CatalogueSort = "name" | "book";

const SOURCE_RANK: Record<string, number> = { core: 0, "hope-and-fear": 1 };

/**
 * Orders by tier (the list is grouped by tier), then alphabetically or in book order (Core Rulebook, then Hope & Fear,
 * then frame entries; by page, then the data's order). Book order keeps adversaries a book prints together side by side,
 * e.g. the assassins (user 2026-10-18).
 */
export function sortAdversaries<T extends Pick<AdversaryDef, "tier" | "name" | "source"> & { page?: number }>(list: readonly T[], sort: CatalogueSort): T[] {
  const index = new Map(list.map((def, i) => [def, i]));
  return [...list].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (sort === "book") {
      const source = (SOURCE_RANK[a.source] ?? 2) - (SOURCE_RANK[b.source] ?? 2);
      if (source !== 0) return source;
      const page = (a.page ?? 0) - (b.page ?? 0);
      if (page !== 0) return page;
      return (index.get(a) ?? 0) - (index.get(b) ?? 0);
    }
    return a.name.localeCompare(b.name);
  });
}
