// Food domain rules for Task 012.
//
// Pure, framework-independent calculations shared by the weekly preview, the
// character-sheet projection, and client validation. Food is held canonically in
// PORTIONS. The authoritative weekly commit is recomputed independently in SQL;
// this module is the single TypeScript source for the same rules (used by both
// the preview action and the UI).

export const DEFAULT_PORTIONS_PER_RATION = 7;
export const DEFAULT_PORTIONS_PER_ACTIVE_CHARACTER_PER_WEEK = 7;

export const FOOD_TYPES = ["fresh", "preserved"] as const;
export type FoodType = (typeof FOOD_TYPES)[number];

export const BATCH_STATUSES = ["active", "depleted", "spoiled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const SPOILAGE_POLICIES = ["spoil_fresh", "retain"] as const;
export type SpoilagePolicy = (typeof SPOILAGE_POLICIES)[number];

/** Reserved character-sheet keys backed by the shared campaign food total. */
export const RESERVED_FOOD_KEYS = ["food_rations", "food_portions"] as const;
export type ReservedFoodKey = (typeof RESERVED_FOOD_KEYS)[number];

export function isReservedFoodKey(key: string): key is ReservedFoodKey {
  return (RESERVED_FOOD_KEYS as readonly string[]).includes(key);
}

export function rationsAndPortions(
  totalPortions: number,
  portionsPerRation: number = DEFAULT_PORTIONS_PER_RATION,
): { rations: number; portions: number } {
  if (portionsPerRation <= 0) return { rations: 0, portions: 0 };
  const total = Math.max(0, Math.floor(totalPortions));
  return {
    rations: Math.floor(total / portionsPerRation),
    portions: total % portionsPerRation,
  };
}

export function formatFoodTotal(
  totalPortions: number,
  portionsPerRation: number = DEFAULT_PORTIONS_PER_RATION,
): string {
  const { rations, portions } = rationsAndPortions(totalPortions, portionsPerRation);
  const r = `${rations} ration${rations === 1 ? "" : "s"}`;
  const p = `${portions} portion${portions === 1 ? "" : "s"}`;
  return `${r}, ${p}`;
}

/** Default weekly requirement in portions from the active roster. */
export function weeklyRequirementPortions(
  activeCharacterCount: number,
  portionsPerActiveCharacterPerWeek: number = DEFAULT_PORTIONS_PER_ACTIVE_CHARACTER_PER_WEEK,
): number {
  return Math.max(0, activeCharacterCount) * portionsPerActiveCharacterPerWeek;
}

/** Fresh food acquired in week A is eligible for spoilage when W >= A + 2. */
export function isFreshSpoilageEligible(
  acquiredWeek: number,
  targetWeek: number,
): boolean {
  return targetWeek >= acquiredWeek + 2;
}

/**
 * Projects the shared campaign food total onto a reserved sheet key. Both values
 * derive from the same total, so every character sheet shows the same figures.
 */
export function projectFoodSheetValue(
  key: ReservedFoodKey,
  totalPortions: number,
  portionsPerRation: number = DEFAULT_PORTIONS_PER_RATION,
): string {
  const { rations, portions } = rationsAndPortions(totalPortions, portionsPerRation);
  return key === "food_rations" ? String(rations) : String(portions);
}

export type PreviewBatch = {
  id: string;
  label: string;
  food_type: FoodType | string;
  status: BatchStatus | string;
  acquired_week: number;
  remaining_portions: number;
  created_at: string;
};

export type PreviewOverride = {
  requiredPortions?: number | null;
  skipSpoilage?: boolean;
  /**
   * Ordered, explicit batch selection overriding default FIFO. `null`/`undefined`
   * keeps the default FIFO behavior; a (deduped) array consumes ONLY the listed
   * batches, in the listed order.
   */
  selectedBatchIds?: readonly string[] | null;
};

export type PreviewBatchResult = {
  id: string;
  label: string;
  before: number;
  spoiled: number;
  consumed: number;
  after: number;
  /** Included in the custom selection (always true under default FIFO). */
  selected: boolean;
  /** 1-based consumption position under a custom selection; null under FIFO or when excluded. */
  order: number | null;
};

export type WeeklyPreview = {
  targetWeek: number;
  activeCharacterCount: number;
  defaultRequiredPortions: number;
  appliedRequiredPortions: number;
  spoiledPortions: number;
  availableAfterSpoilage: number;
  consumedPortions: number;
  shortagePortions: number;
  totalBefore: number;
  totalAfter: number;
  usedOverride: boolean;
  /** True when an explicit ordered batch selection replaced default FIFO. */
  usedCustomSelection: boolean;
  /** Effective ordered ids (deduped, eligible only) actually consumed from. */
  effectiveSelectedBatchIds: string[];
  /**
   * Supply basis for consumption and shortage: the selected batches'
   * post-spoilage total under a custom selection; all active batches otherwise.
   */
  consumableAvailablePortions: number;
  /** Portions left in selected batches after consumption (custom only; 0 otherwise). */
  unconsumedSelectedPortions: number;
  batches: PreviewBatchResult[];
};

/** A batch offered to the GM for explicit weekly selection. */
export type SelectableBatch = {
  id: string;
  label: string;
  food_type: FoodType | string;
  acquired_week: number;
  remaining_portions: number;
  created_at: string;
  /** Spoils during this process (and so is not consumable) unless spoilage is skipped. */
  willSpoil: boolean;
};

export type BatchSelectionValidation =
  | { ok: true; ids: string[] }
  | { ok: false; issue: "empty" | "duplicate" | "unknown" | "will-spoil"; id?: string };

/** Deterministic FIFO order: oldest acquisition week, then creation, then id. */
export function fifoOrder<T extends { acquired_week: number; created_at: string; id: string }>(
  batches: readonly T[],
): T[] {
  return [...batches].sort((a, b) => {
    if (a.acquired_week !== b.acquired_week) return a.acquired_week - b.acquired_week;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The batches a GM may explicitly select for a weekly process, in FIFO order,
 * each annotated with whether it will spoil in the target process. A batch that
 * will spoil is not consumable (unless spoilage is skipped) and must not be
 * selected — the flag lets the UI show and disable it.
 */
export function selectableBatches(input: {
  batches: readonly PreviewBatch[];
  targetWeek: number;
  spoilagePolicy?: SpoilagePolicy;
  skipSpoilage?: boolean;
}): SelectableBatch[] {
  const policy = input.spoilagePolicy ?? "spoil_fresh";
  const skip = input.skipSpoilage ?? false;
  const active = input.batches.filter(
    (b) => b.status === "active" && b.remaining_portions > 0,
  );
  return fifoOrder(active).map((b) => ({
    id: b.id,
    label: b.label,
    food_type: b.food_type,
    acquired_week: b.acquired_week,
    remaining_portions: b.remaining_portions,
    created_at: b.created_at,
    willSpoil:
      !skip &&
      policy === "spoil_fresh" &&
      b.food_type === "fresh" &&
      isFreshSpoilageEligible(b.acquired_week, input.targetWeek),
  }));
}

/**
 * Validates an ordered explicit selection against the post-spoilage eligible set:
 * non-empty, no duplicates, every id a currently-active batch, and none that will
 * spoil in this process. SQL re-validates authoritatively under locks.
 */
export function validateBatchSelection(input: {
  selectedBatchIds: readonly string[];
  batches: readonly PreviewBatch[];
  targetWeek: number;
  spoilagePolicy?: SpoilagePolicy;
  skipSpoilage?: boolean;
}): BatchSelectionValidation {
  const ids = input.selectedBatchIds;
  if (ids.length === 0) return { ok: false, issue: "empty" };

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return { ok: false, issue: "duplicate", id };
    seen.add(id);
  }

  const selectable = new Map(selectableBatches(input).map((b) => [b.id, b]));
  for (const id of ids) {
    const b = selectable.get(id);
    if (!b) return { ok: false, issue: "unknown", id };
    if (b.willSpoil) return { ok: false, issue: "will-spoil", id };
  }
  return { ok: true, ids: [...ids] };
}

/**
 * Non-persistent weekly preview: spoilage first, then consumption of the required
 * portions, then shortage and resulting balances. Consumption follows FIFO by
 * default, or an explicit ordered selection (consuming ONLY the selected batches,
 * in order) when `override.selectedBatchIds` is supplied. Mirrors
 * `process_weekly_food` (which re-derives authoritatively in SQL under locks).
 */
export function computeWeeklyPreview(input: {
  batches: readonly PreviewBatch[];
  targetWeek: number;
  activeCharacterCount: number;
  portionsPerActiveCharacterPerWeek?: number;
  spoilagePolicy?: SpoilagePolicy;
  override?: PreviewOverride;
}): WeeklyPreview {
  const ppc = input.portionsPerActiveCharacterPerWeek ?? DEFAULT_PORTIONS_PER_ACTIVE_CHARACTER_PER_WEEK;
  const policy = input.spoilagePolicy ?? "spoil_fresh";
  const skipSpoilage = input.override?.skipSpoilage ?? false;
  const selection = input.override?.selectedBatchIds ?? null;
  const usedCustomSelection = selection != null;
  const defaultRequired = weeklyRequirementPortions(input.activeCharacterCount, ppc);
  const appliedRequired = input.override?.requiredPortions ?? defaultRequired;
  const usedOverride =
    input.override?.requiredPortions != null || skipSpoilage || usedCustomSelection;

  const active = input.batches.filter(
    (b) => b.status === "active" && b.remaining_portions > 0,
  );
  const ordered = fifoOrder(active);

  const results = new Map<string, PreviewBatchResult>();
  for (const b of ordered) {
    results.set(b.id, {
      id: b.id,
      label: b.label,
      before: b.remaining_portions,
      spoiled: 0,
      consumed: 0,
      after: b.remaining_portions,
      selected: !usedCustomSelection,
      order: null,
    });
  }

  // Spoilage.
  let spoiledPortions = 0;
  if (!skipSpoilage && policy === "spoil_fresh") {
    for (const b of ordered) {
      if (b.food_type === "fresh" && isFreshSpoilageEligible(b.acquired_week, input.targetWeek)) {
        const r = results.get(b.id)!;
        r.spoiled = r.before;
        r.after = 0;
        spoiledPortions += r.before;
      }
    }
  }

  const availableAfterSpoilage = ordered.reduce(
    (sum, b) => sum + results.get(b.id)!.after,
    0,
  );

  // Consumption order and supply basis: an explicit ordered selection (only the
  // listed, deduped, eligible batches) or default FIFO across all active batches.
  const consumptionResults: PreviewBatchResult[] = [];
  const effectiveSelectedBatchIds: string[] = [];
  if (usedCustomSelection) {
    const seen = new Set<string>();
    let position = 0;
    for (const id of selection) {
      if (seen.has(id)) continue;
      const r = results.get(id);
      if (!r) continue; // unknown/ineligible ids are surfaced by validateBatchSelection
      seen.add(id);
      position += 1;
      r.selected = true;
      r.order = position;
      consumptionResults.push(r);
      effectiveSelectedBatchIds.push(id);
    }
  } else {
    for (const b of ordered) consumptionResults.push(results.get(b.id)!);
  }

  const consumableAvailablePortions = consumptionResults.reduce(
    (sum, r) => sum + r.after,
    0,
  );

  // Consume in the resolved order. Never falls back to unselected batches.
  let needed = Math.max(0, appliedRequired);
  let consumedPortions = 0;
  for (const r of consumptionResults) {
    if (needed <= 0) break;
    const take = Math.min(r.after, needed);
    if (take > 0) {
      r.consumed = take;
      r.after -= take;
      consumedPortions += take;
      needed -= take;
    }
  }

  const shortagePortions = Math.max(0, appliedRequired - consumableAvailablePortions);
  const unconsumedSelectedPortions = usedCustomSelection
    ? consumptionResults.reduce((sum, r) => sum + r.after, 0)
    : 0;
  const totalBefore = ordered.reduce((s, b) => s + results.get(b.id)!.before, 0);
  const totalAfter = ordered.reduce((s, b) => s + results.get(b.id)!.after, 0);

  // Display order: selected batches (in consumption order) first, then the rest
  // in FIFO order; plain FIFO order otherwise.
  let batches: PreviewBatchResult[];
  if (usedCustomSelection) {
    const excluded = ordered
      .filter((b) => !effectiveSelectedBatchIds.includes(b.id))
      .map((b) => results.get(b.id)!);
    batches = [...consumptionResults, ...excluded];
  } else {
    batches = ordered.map((b) => results.get(b.id)!);
  }

  return {
    targetWeek: input.targetWeek,
    activeCharacterCount: input.activeCharacterCount,
    defaultRequiredPortions: defaultRequired,
    appliedRequiredPortions: appliedRequired,
    spoiledPortions,
    availableAfterSpoilage,
    consumedPortions,
    shortagePortions,
    totalBefore,
    totalAfter,
    usedOverride,
    usedCustomSelection,
    effectiveSelectedBatchIds,
    consumableAvailablePortions,
    unconsumedSelectedPortions,
    batches,
  };
}
