// Five Banners Burning campaign mechanics (Core Book pp.268-269): faction
// relationships, nation sheets (assets and problems) and objective countdowns.
// Pure logic and data: bundled into Convex, so relative imports only.

import { z } from "zod";

export const FIVE_BANNERS_FRAME_ID = "five-banners-burning";
/** frameTrackers key holding the campaign's Five Banners state. */
export const FIVE_BANNERS_KEY = "fiveBanners.state";

export const NATION_IDS = ["armada", "hilltop", "jesthaen", "polaris", "voldaen"] as const;
export type NationId = (typeof NATION_IDS)[number];

export const NATION_NAMES: Record<NationId, string> = {
  armada: "Armada",
  hilltop: "Hilltop",
  jesthaen: "Jesthaen",
  polaris: "Polaris",
  voldaen: "Voldaen",
};

export const isNationId = (value: string): value is NationId => (NATION_IDS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Relationships (p.268): one symmetric rating per nation pair, −3..+3.

export const MIN_RELATIONSHIP = -3;
export const MAX_RELATIONSHIP = 3;

/** The book names −3..+3 except 0; 0 is "Neutral" (user decision). */
export const RELATIONSHIP_LABELS: Record<number, string> = {
  [-3]: "Nemeses",
  [-2]: "Enemies",
  [-1]: "Unfriendly",
  0: "Neutral",
  1: "Friendly",
  2: "Allies",
  3: "Close Allies",
};

export function relationshipLabel(value: number): string {
  return RELATIONSHIP_LABELS[value] ?? "Unknown";
}

/** "+2", "0", "−3" (typographic minus). */
export function formatRating(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

export type PairKey = `${NationId}|${NationId}`;

/** Order-independent key for a nation pair. */
export function pairKey(a: NationId, b: NationId): PairKey {
  if (a === b) throw new Error("A nation has no relationship with itself.");
  return NATION_IDS.indexOf(a) < NATION_IDS.indexOf(b) ? `${a}|${b}` : `${b}|${a}`;
}

/** All ten unordered pairs, in nation order. */
export const NATION_PAIRS: [NationId, NationId][] = NATION_IDS.flatMap((a, i) =>
  NATION_IDS.slice(i + 1).map((b) => [a, b] as [NationId, NationId]),
);

/** Starting ratings, as printed on p.268 (each pair is listed symmetrically there). */
export const SEED_RELATIONSHIPS: Record<PairKey, number> = Object.fromEntries(
  (
    [
      ["armada", "jesthaen", 2],
      ["armada", "polaris", 1],
      ["armada", "voldaen", -1],
      ["armada", "hilltop", -2],
      ["hilltop", "voldaen", 2],
      ["hilltop", "jesthaen", -2],
      ["hilltop", "polaris", -3],
      ["jesthaen", "polaris", 1],
      ["jesthaen", "voldaen", -3],
      ["polaris", "voldaen", -2],
    ] as [NationId, NationId, number][]
  ).map(([a, b, v]) => [pairKey(a, b), v]),
) as Record<PairKey, number>;

// ---------------------------------------------------------------------------
// Nation sheets (p.268): assets and problems, GM-editable.

export type NationSheet = { assets: string[]; problems: string[] };

export const SEED_SHEETS: Record<NationId, NationSheet> = {
  armada: {
    assets: ["Large and powerful navy", "Superior maps of ocean & wind currents", "Allied water monsters"],
    problems: [
      "Small land area",
      "Limited overland access to the main continent",
      "Lingering reputation as pirates and thieves",
    ],
  },
  hilltop: {
    assets: [
      "Wealth from tithes",
      "A devout army",
      "Priests and seraphs",
      "Divine power and authority",
      "Influence and intelligence through temples and shrines",
    ],
    problems: ["Surrounded by adversaries", "Negligible navy", "Scarcity of domestically produced food"],
  },
  jesthaen: {
    assets: ["A strong land-based military", "Natural resources", "Large amounts of arable land"],
    problems: ["Political instability as a new nation", "Remaining conservative elements loyal to Voldaen"],
  },
  polaris: {
    assets: ["Skilled mages", "Magitech innovations", "Airships", "Magical creatures"],
    problems: ["Lack of workers", "Poor quality and scarce raw materials"],
  },
  voldaen: {
    assets: ["Traditional political and cultural authority", "Seemingly boundless wealth"],
    problems: [
      "Strategic vulnerability due to major settlements close to large borders with Polaris and Jesthaen",
      "Political upheaval following Jesthaen’s separatist revolution",
    ],
  },
};

/** The book's starting objectives (p.268), offered as suggestions when creating an objective. */
export const SUGGESTED_OBJECTIVES: Record<NationId, { major: string[]; minor: string[] }> = {
  armada: {
    major: ["Build friendly port infrastructure in Voldaen and Polaris for trade"],
    minor: ["Acquire airship technology", "Deploy privateers against adversaries"],
  },
  hilltop: {
    major: ["Bring the Armadan miscreants back into the fold and redeem them"],
    minor: ["Beseech the gods for a bountiful harvest", "Implicate Polaris as the supporters of a Fallen cult"],
  },
  jesthaen: {
    major: ["Take revenge on Voldaen for injustices across centuries"],
    minor: ["Secure enduring trade partnerships with Armada and Polaris", "Take control of local temples from Hilltop"],
  },
  polaris: {
    major: ["Perfect magical servitor enchantments"],
    minor: ["Secure new mines and quarries", "Foster immigration through job programs"],
  },
  voldaen: {
    major: ["Reclaim key resources from Jesthaen without starting another war"],
    minor: ["Turn Armada against their allies", "Steal magical talent and technology from Polaris"],
  },
};

// ---------------------------------------------------------------------------
// Stored state (one frameTrackers row).

export const MAX_SHEET_ITEMS = 12;
export const MAX_SHEET_ITEM_LENGTH = 200;

const nationIdSchema = z.enum(NATION_IDS);
export const relationshipRatingSchema = z
  .number()
  .int("A relationship is a whole number.")
  .min(MIN_RELATIONSHIP, "Relationships range from −3 (Nemeses).")
  .max(MAX_RELATIONSHIP, "Relationships range up to +3 (Close Allies).");

const sheetItemsSchema = (label: string) =>
  z
    .array(z.string().trim().max(MAX_SHEET_ITEM_LENGTH, `Each ${label} is at most ${MAX_SHEET_ITEM_LENGTH} characters.`))
    .transform((items) => items.filter((item) => item.length > 0))
    .pipe(z.array(z.string()).max(MAX_SHEET_ITEMS, `A nation lists at most ${MAX_SHEET_ITEMS} ${label}s.`));

export const nationSheetSchema = z.object({
  assets: sheetItemsSchema("asset"),
  problems: sheetItemsSchema("problem"),
});

const pairKeySchema = z.string().refine((key): key is PairKey => {
  const [a, b] = key.split("|");
  return a !== undefined && b !== undefined && isNationId(a) && isNationId(b) && a !== b && pairKey(a, b) === key;
}, "Unknown nation pair.");

export const fiveBannersStateSchema = z.object({
  week: z.number().int().min(1),
  relationships: z.record(pairKeySchema, relationshipRatingSchema),
  sheets: z.partialRecord(nationIdSchema, nationSheetSchema),
  /** Per-item reveal flags; absent means hidden from players. */
  revealedPairs: z.array(pairKeySchema),
  revealedSheets: z.array(nationIdSchema),
});

export type FiveBannersState = {
  week: number;
  relationships: Record<PairKey, number>;
  sheets: Record<NationId, NationSheet>;
  revealedPairs: PairKey[];
  revealedSheets: NationId[];
};

export function seedState(): FiveBannersState {
  return {
    week: 1,
    relationships: { ...SEED_RELATIONSHIPS },
    sheets: Object.fromEntries(
      NATION_IDS.map((n) => [n, { assets: [...SEED_SHEETS[n].assets], problems: [...SEED_SHEETS[n].problems] }]),
    ) as Record<NationId, NationSheet>,
    revealedPairs: [],
    revealedSheets: [],
  };
}

/**
 * Reads stored state; a campaign that never saved any uses the book's seed.
 * Malformed data throws instead of silently resetting (the next write would
 * otherwise overwrite the GM's data with the seed).
 */
export function loadState(raw: unknown): FiveBannersState {
  const seed = seedState();
  if (raw === null || raw === undefined) return seed;
  const parsed = fiveBannersStateSchema.safeParse(raw);
  if (!parsed.success) throw new Error("TRACKER_CORRUPT");
  const data = parsed.data;
  return {
    week: data.week,
    relationships: { ...seed.relationships, ...(data.relationships as Partial<Record<PairKey, number>>) },
    sheets: { ...seed.sheets, ...(data.sheets as Partial<Record<NationId, NationSheet>>) },
    revealedPairs: data.revealedPairs as PairKey[],
    revealedSheets: data.revealedSheets,
  };
}

export function setRelationship(state: FiveBannersState, a: NationId, b: NationId, value: number): FiveBannersState {
  const rating = relationshipRatingSchema.parse(value);
  return { ...state, relationships: { ...state.relationships, [pairKey(a, b)]: rating } };
}

export function setReveal<T extends string>(list: T[], item: T, revealed: boolean): T[] {
  const without = list.filter((x) => x !== item);
  return revealed ? [...without, item] : without;
}

// ---------------------------------------------------------------------------
// Objective countdowns (p.269).

export const OBJECTIVE_KINDS = ["objective-major", "objective-minor"] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/** "Completing major objectives requires a 10-step countdown". */
export const MAJOR_STEPS = 10;
/** "minor objectives have 4 to 6 steps depending on the scale of the endeavor". */
export const MINOR_STEPS = [4, 5, 6] as const;
/** "one major objective countdown and up to two minor objective countdowns at a time". */
export const OBJECTIVE_LIMITS: Record<ObjectiveKind, number> = { "objective-major": 1, "objective-minor": 2 };

export const OBJECTIVE_KIND_LABEL: Record<ObjectiveKind, string> = {
  "objective-major": "Major",
  "objective-minor": "Minor",
};

export const nationOwnerKey = (nation: NationId) => `nation:${nation}`;

export function nationFromOwnerKey(ownerKey: string | undefined): NationId | null {
  if (!ownerKey?.startsWith("nation:")) return null;
  const id = ownerKey.slice("nation:".length);
  return isNationId(id) ? id : null;
}

export const isObjectiveKind = (value: string | undefined): value is ObjectiveKind =>
  value === "objective-major" || value === "objective-minor";

export const createObjectiveSchema = z
  .object({
    nation: nationIdSchema,
    kind: z.enum(OBJECTIVE_KINDS),
    name: z.string().trim().min(1, "Name the objective.").max(150, "Objective names are at most 150 characters."),
    notes: z.string().trim().max(1000, "Notes are at most 1000 characters."),
    steps: z.number().int("Steps are a whole number."),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "objective-major" && value.steps !== MAJOR_STEPS) {
      ctx.addIssue({ code: "custom", path: ["steps"], message: `A major objective is a ${MAJOR_STEPS}-step countdown.` });
    }
    if (value.kind === "objective-minor" && !(MINOR_STEPS as readonly number[]).includes(value.steps)) {
      ctx.addIssue({ code: "custom", path: ["steps"], message: "A minor objective has 4 to 6 steps." });
    }
  });

export type ObjectiveStatus = "active" | "paused" | "completed" | "cancelled";

/** Objectives that occupy one of the nation's slots: running or paused (completed ones make room for a new one). */
export const holdsSlot = (status: ObjectiveStatus) => status === "active" || status === "paused";

/** Why this nation cannot take another objective of this kind, or null when it can. */
export function objectiveLimitError(
  existing: { kind: ObjectiveKind; status: ObjectiveStatus }[],
  kind: ObjectiveKind,
): string | null {
  const held = existing.filter((o) => o.kind === kind && holdsSlot(o.status)).length;
  if (held < OBJECTIVE_LIMITS[kind]) return null;
  return kind === "objective-major"
    ? "This nation already has a major objective."
    : "This nation already has two minor objectives.";
}

// ---------------------------------------------------------------------------
// Weekly advance (p.269): "Each in-game week, pick one countdown for each
// nation to advance (step down the countdown by one tick)".

export type WeekObjective = {
  id: string;
  nation: NationId;
  name: string;
  status: ObjectiveStatus;
  currentValue: number;
};

export type WeekPick = { nation: NationId; objectiveId: string };

/** Above this many completions in one week, the book's stagger advice is broken. */
export const STAGGER_LIMIT = 2;

export const canAdvanceObjective = (o: { status: ObjectiveStatus; currentValue: number }) =>
  o.status === "active" && o.currentValue > 0;

/**
 * Checks the GM's picks (at most one per nation, each an advanceable objective
 * of that nation; a nation may be skipped) and returns what advances, what
 * completes, and a stagger warning when more than two complete at once.
 */
export function planWeekAdvance(
  objectives: WeekObjective[],
  picks: WeekPick[],
): { advance: WeekObjective[]; completing: WeekObjective[]; warning: string | null } {
  const seen = new Set<NationId>();
  const advance: WeekObjective[] = [];
  for (const pick of picks) {
    if (seen.has(pick.nation)) throw new Error(`Pick only one countdown for ${NATION_NAMES[pick.nation]}.`);
    seen.add(pick.nation);
    const objective = objectives.find((o) => o.id === pick.objectiveId);
    if (!objective || objective.nation !== pick.nation) {
      throw new Error(`That countdown is not one of ${NATION_NAMES[pick.nation]}’s objectives.`);
    }
    if (!canAdvanceObjective(objective)) throw new Error(`${objective.name} is not running, so it cannot advance.`);
    advance.push(objective);
  }
  const completing = advance.filter((o) => o.currentValue === 1);
  const warning =
    completing.length > STAGGER_LIMIT
      ? `${completing.length} nations complete an objective this week. The book suggests staggering countdowns so only one or two complete at once.`
      : null;
  return { advance, completing, warning };
}

/** The default pick for each nation: its running objective closest to completion. */
export function defaultPicks(objectives: WeekObjective[]): WeekPick[] {
  return NATION_IDS.flatMap((nation) => {
    const candidates = objectives
      .filter((o) => o.nation === nation && canAdvanceObjective(o))
      .sort((a, b) => a.currentValue - b.currentValue);
    return candidates[0] ? [{ nation, objectiveId: candidates[0].id }] : [];
  });
}
