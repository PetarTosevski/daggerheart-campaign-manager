// Environment stat blocks (EV1): which ones a campaign sees, and the catalogue's search, filters and labels. Pure and
// data-free, like src/lib/domain/adversaries: the caller passes the list (ENVIRONMENTS from src/lib/srd/environments.ts).
// The adversary catalogue's helpers (src/lib/adversaries/catalogue.ts) do the tier grouping, paging and ordering.
//
// Core Book p.240: "Environments represent everything in a scene beyond the PCs and adversaries, such as the physical
//   space, background NPCs, and natural forces."
// Core Book p.242: "Tier 1 (Level 1)", "Tier 2 (Levels 2–4)", "Tier 3 (Levels 5–7)", "Tier 4 (Levels 8–10)".
//
// ```ts
// environmentsFor(ENVIRONMENTS, { hopeAndFear: false, frameId: "witherwild" }); // the 19 Core blocks
// filterEnvironments(visible, { query: "river", tier: null, type: null, book: null }); // [Raging River]
// environmentCountLine(visible, visible.length); // "47 environments · 19 core, 28 Hope & Fear"
// potentialAdversariesText(raging.potentialAdversaries); // "Beasts (Bear, Glass Snake), Jagged Knife Bandits (...)"
// ```

import { adversariesFor } from "../adversaries";
import { groupByTier, normalizeSearch, type CatalogueBook, type CatalogueTier, type TierGroup } from "../../adversaries/catalogue";
import type { EnvironmentAdversaryRef, EnvironmentDef, EnvironmentType } from "../../srd/types";

/** The environments a campaign sees: Core always, Hope & Fear with the switch on, frame entries only in their frame. */
export function environmentsFor<T extends Pick<EnvironmentDef, "source" | "frameId">>(
  list: readonly T[],
  campaign: { hopeAndFear: boolean; frameId: string | null | undefined },
): T[] {
  return adversariesFor(list, campaign);
}

export type EnvironmentFilters = {
  query: string;
  tier: CatalogueTier | null;
  type: EnvironmentType | null;
  book: CatalogueBook | null;
};

export const NO_ENVIRONMENT_FILTERS: EnvironmentFilters = { query: "", tier: null, type: null, book: null };

type Searchable = Pick<EnvironmentDef, "name" | "type" | "description" | "impulses" | "potentialAdversaries" | "features">;

const haystacks = new WeakMap<object, string>();

/** The "Potential Adversaries" line as printed: "Beasts (Bear, Glass Snake), Masked Thief, Merchant". */
export function potentialAdversariesText(refs: readonly EnvironmentAdversaryRef[]): string {
  return refs.map((r) => (r.members ? `${r.name} (${r.members.map((m) => m.name).join(", ")})` : r.name)).join(", ");
}

/** Name, type, description, impulses, potential adversaries, feature names, text and questions, normalised (cached). */
function haystack(def: Searchable): string {
  let text = haystacks.get(def);
  if (text === undefined) {
    text = normalizeSearch(
      [
        def.name,
        def.type,
        def.description,
        def.impulses,
        potentialAdversariesText(def.potentialAdversaries),
        ...def.features.flatMap((f) => [f.name, f.text, f.questions ?? ""]),
      ].join(" "),
    );
    haystacks.set(def, text);
  }
  return text;
}

/** The entries matching every filter, in list order; the query folds case, accents and apostrophes. */
export function filterEnvironments<T extends Searchable & Pick<EnvironmentDef, "tier" | "source">>(list: readonly T[], filters: EnvironmentFilters): T[] {
  const query = normalizeSearch(filters.query);
  return list.filter(
    (def) =>
      (filters.tier === null || def.tier === filters.tier) &&
      (filters.type === null || def.type === filters.type) &&
      (filters.book === null || def.source === filters.book) &&
      (query === "" || haystack(def).includes(query)),
  );
}

/** groupByTier with "environments" in the tier line ("Levels 2–4 · 12 environments"). */
export function groupEnvironmentsByTier<T extends Pick<EnvironmentDef, "tier">>(list: readonly T[], limit: number, collapsed?: ReadonlySet<number>): TierGroup<T>[] {
  return groupByTier(list, limit, collapsed).map((group) => ({
    ...group,
    sub: group.sub.replace(/ adversar(?:y|ies)$/, (word) => (word === " adversary" ? " environment" : " environments")),
  }));
}

/** "47 environments · 19 core, 28 Hope & Fear" with no filter on (the campaign's visible set), else "N of M shown". */
export function environmentCountLine(visible: readonly Pick<EnvironmentDef, "source">[], shown: number): string {
  if (shown !== visible.length) return `${shown} of ${visible.length} shown`;
  const hf = visible.filter((def) => def.source === "hope-and-fear").length;
  const all = `${visible.length} ${visible.length === 1 ? "environment" : "environments"}`;
  return hf === 0 ? all : `${all} · ${visible.length - hf} core, ${hf} Hope & Fear`;
}

/** "Tier 2 Exploration", as the stat block prints it. */
export function environmentTierLine(def: Pick<EnvironmentDef, "tier" | "type">): string {
  return `Tier ${def.tier} ${def.type}`;
}

/** How a countdown started from an environment feature begins: a printed number, or dice the server rolls. */
export type EnvironmentCountdownStart = { kind: "fixed"; value: number } | { kind: "dice"; count: number; sides: number };

/**
 * The starting value of a feature's countdown label (EF1): "Countdown (6)" and "Consequence Countdown (8)" give the
 * number, "Countdown (Loop 4)" / "(Long-Term 4)" give 4, and "Countdown (Loop 1d4)" gives dice to roll. Null when the
 * label has no value in brackets.
 *
 * ```ts
 * environmentCountdownStart("Countdown (Loop 1d4)"); // { kind: "dice", count: 1, sides: 4 }
 * ```
 */
export function environmentCountdownStart(label: string): EnvironmentCountdownStart | null {
  const m = /\((?:(?:Loop|Long-Term)\s+)?(?:(\d+)d(\d+)|(\d+))\)\s*$/i.exec(label);
  if (!m) return null;
  if (m[3] !== undefined) return { kind: "fixed", value: Number(m[3]) };
  return { kind: "dice", count: Number(m[1]), sides: Number(m[2]) };
}

/** The dashboard category of a feature's countdown: Consequence → consequence, Progress → project, any other → threat. */
export function environmentCountdownCategory(label: string): "consequence" | "project" | "threat" {
  if (/^consequence\b/i.test(label)) return "consequence";
  if (/^progress\b/i.test(label)) return "project";
  return "threat";
}

/** "Mountain Pass: Icy Winds", the name of a dashboard countdown started from an environment feature. */
export function environmentCountdownName(environment: Pick<EnvironmentDef, "name">, featureName: string): string {
  return `${environment.name}: ${featureName}`;
}
