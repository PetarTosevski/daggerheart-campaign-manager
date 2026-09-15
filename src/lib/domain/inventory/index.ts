// Inventory domain rules for Task 013.
//
// Pure, framework-independent calculations shared by the inventory UI, the
// character-sheet projection, and client validation. The authoritative writes
// are recomputed independently in SQL (the inventory functions); this module is
// the single TypeScript source for the same rules (stack limits, container
// cycles, and the derived per-character sheet projection).

export const ITEM_CATEGORIES = [
  "weapon",
  "armor",
  "consumable",
  "tool",
  "treasure",
  "misc",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CONTAINER_TYPES = [
  "backpack",
  "equipment",
  "storage",
  "shared",
  "other",
] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const ENTRY_STATES = ["stored", "equipped"] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

export const INVENTORY_TRANSACTION_TYPES = [
  "add",
  "remove",
  "move",
  "transfer",
  "equip",
  "unequip",
  "consume",
  "split",
  "merge",
  "correction",
] as const;
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number];

export const EQUIP_SLOT_MAX = 40;

/** Reserved character-sheet keys backed by the character's inventory domain. */
export const RESERVED_INVENTORY_KEYS = [
  "inventory_summary",
  "equipped_items",
  "carried_weight",
] as const;
export type ReservedInventoryKey = (typeof RESERVED_INVENTORY_KEYS)[number];

export function isReservedInventoryKey(key: string): key is ReservedInventoryKey {
  return (RESERVED_INVENTORY_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Stack rules
// ---------------------------------------------------------------------------

export type StackRuleItem = {
  stackable: boolean;
  default_stack_limit: number | null;
};

export type StackQuantityValidation =
  | { ok: true }
  | { ok: false; issue: "not-positive" | "not-stackable" | "over-limit" };

/**
 * Validates a quantity against an item's stack rules: quantity must be positive,
 * a non-stackable item is limited to 1, and a configured stack limit is enforced.
 * SQL re-validates authoritatively under locks.
 */
export function validateStackQuantity(
  item: StackRuleItem,
  quantity: number,
): StackQuantityValidation {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, issue: "not-positive" };
  }
  if (!item.stackable) {
    return quantity === 1 ? { ok: true } : { ok: false, issue: "not-stackable" };
  }
  if (item.default_stack_limit != null && quantity > item.default_stack_limit) {
    return { ok: false, issue: "over-limit" };
  }
  return { ok: true };
}

/** Whether two like stored stacks can merge without exceeding the stack limit. */
export function canMergeStacks(
  item: StackRuleItem,
  sourceQuantity: number,
  targetQuantity: number,
): boolean {
  if (!item.stackable) return false;
  const combined = sourceQuantity + targetQuantity;
  if (item.default_stack_limit != null && combined > item.default_stack_limit) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Container cycles
// ---------------------------------------------------------------------------

export type ContainerNode = {
  id: string;
  parent_container_id: string | null;
};

/**
 * Whether re-parenting `containerId` under `newParentId` would create a cycle,
 * mirroring the SQL cycle-guard trigger. A container may not become its own
 * ancestor. `null` (top level) can never form a cycle.
 */
export function wouldCreateContainerCycle(
  containers: readonly ContainerNode[],
  containerId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === containerId) return true;
  const parentOf = new Map(containers.map((c) => [c.id, c.parent_container_id]));
  let cursor: string | null = newParentId;
  let guard = 0;
  while (cursor != null) {
    if (cursor === containerId) return true;
    cursor = parentOf.get(cursor) ?? null;
    guard += 1;
    if (guard > 10000) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-character sheet projection (inventory_summary, equipped_items, carried_weight)
// ---------------------------------------------------------------------------

export type ProjectionEntry = {
  quantity: number;
  state: EntryState | string;
  equipped_slot: string | null;
  item_definition_id: string;
  custom_name: string | null;
};

export type ProjectionItemDefinition = {
  id: string;
  name: string;
  unit_weight: number | null;
};

export type InventoryProjection = {
  /** Total units held across the character's stacks (stored and equipped). */
  totalQuantity: number;
  /** Number of distinct stacks/entries. */
  stackCount: number;
  equippedCount: number;
  /** Human labels for equipped items, e.g. "main hand: Longsword". */
  equippedLabels: string[];
  carriedWeight: number;
};

/** Derives the read-only sheet projection for one character from raw rows. */
export function computeInventoryProjection(
  entries: readonly ProjectionEntry[],
  definitions: readonly ProjectionItemDefinition[],
): InventoryProjection {
  const defById = new Map(definitions.map((d) => [d.id, d]));
  let totalQuantity = 0;
  let carriedWeight = 0;
  let equippedCount = 0;
  const equippedLabels: string[] = [];

  for (const entry of entries) {
    totalQuantity += entry.quantity;
    const def = defById.get(entry.item_definition_id);
    const unitWeight = def?.unit_weight ?? 0;
    carriedWeight += entry.quantity * unitWeight;
    if (entry.state === "equipped") {
      equippedCount += 1;
      const name = entry.custom_name ?? def?.name ?? "Item";
      const slot = entry.equipped_slot ? `${entry.equipped_slot}: ` : "";
      equippedLabels.push(`${slot}${name}`);
    }
  }

  // Rounding guards against binary-float drift when summing decimal weights.
  carriedWeight = Math.round(carriedWeight * 100) / 100;

  return {
    totalQuantity,
    stackCount: entries.length,
    equippedCount,
    equippedLabels,
    carriedWeight,
  };
}

export function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(2);
}

/** Projects a character's inventory onto a reserved sheet key as display text. */
export function projectInventorySheetValue(
  key: ReservedInventoryKey,
  projection: InventoryProjection,
): string {
  switch (key) {
    case "inventory_summary": {
      const items = `${projection.totalQuantity} item${projection.totalQuantity === 1 ? "" : "s"}`;
      const stacks = `${projection.stackCount} stack${projection.stackCount === 1 ? "" : "s"}`;
      return `${items} in ${stacks}`;
    }
    case "equipped_items":
      return projection.equippedLabels.length > 0
        ? projection.equippedLabels.join(", ")
        : "None";
    case "carried_weight":
      return formatWeight(projection.carriedWeight);
  }
}
