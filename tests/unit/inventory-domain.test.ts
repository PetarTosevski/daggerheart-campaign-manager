import { describe, expect, it } from "vitest";

import {
  canMergeStacks,
  computeInventoryProjection,
  formatWeight,
  isReservedInventoryKey,
  projectInventorySheetValue,
  validateStackQuantity,
  wouldCreateContainerCycle,
  type ProjectionEntry,
  type ProjectionItemDefinition,
} from "@/lib/domain/inventory";

describe("validateStackQuantity", () => {
  it("rejects non-positive or non-integer quantities", () => {
    const item = { stackable: true, default_stack_limit: null };
    expect(validateStackQuantity(item, 0)).toEqual({ ok: false, issue: "not-positive" });
    expect(validateStackQuantity(item, -3)).toEqual({ ok: false, issue: "not-positive" });
    expect(validateStackQuantity(item, 1.5)).toEqual({ ok: false, issue: "not-positive" });
  });

  it("limits non-stackable items to a single unit", () => {
    const item = { stackable: false, default_stack_limit: null };
    expect(validateStackQuantity(item, 1)).toEqual({ ok: true });
    expect(validateStackQuantity(item, 2)).toEqual({ ok: false, issue: "not-stackable" });
  });

  it("enforces a configured stack limit", () => {
    const item = { stackable: true, default_stack_limit: 20 };
    expect(validateStackQuantity(item, 20)).toEqual({ ok: true });
    expect(validateStackQuantity(item, 21)).toEqual({ ok: false, issue: "over-limit" });
  });

  it("allows any positive quantity when stackable and unlimited", () => {
    const item = { stackable: true, default_stack_limit: null };
    expect(validateStackQuantity(item, 999)).toEqual({ ok: true });
  });
});

describe("canMergeStacks", () => {
  it("is false for non-stackable items", () => {
    expect(canMergeStacks({ stackable: false, default_stack_limit: null }, 1, 1)).toBe(false);
  });

  it("respects the stack limit", () => {
    const item = { stackable: true, default_stack_limit: 10 };
    expect(canMergeStacks(item, 4, 6)).toBe(true);
    expect(canMergeStacks(item, 5, 6)).toBe(false);
  });

  it("allows any merge when unlimited", () => {
    expect(canMergeStacks({ stackable: true, default_stack_limit: null }, 50, 50)).toBe(true);
  });
});

describe("wouldCreateContainerCycle", () => {
  const containers = [
    { id: "a", parent_container_id: null },
    { id: "b", parent_container_id: "a" },
    { id: "c", parent_container_id: "b" },
  ];

  it("never cycles at the top level", () => {
    expect(wouldCreateContainerCycle(containers, "a", null)).toBe(false);
  });

  it("detects self-parenting", () => {
    expect(wouldCreateContainerCycle(containers, "a", "a")).toBe(true);
  });

  it("detects an indirect cycle (ancestor under a descendant)", () => {
    // Making a a child of c would form a -> ... -> c -> a.
    expect(wouldCreateContainerCycle(containers, "a", "c")).toBe(true);
  });

  it("allows a valid re-parent", () => {
    expect(wouldCreateContainerCycle(containers, "c", "a")).toBe(false);
  });
});

describe("computeInventoryProjection", () => {
  const definitions: ProjectionItemDefinition[] = [
    { id: "torch", name: "Torch", unit_weight: 1 },
    { id: "sword", name: "Sword", unit_weight: 3.5 },
    { id: "gem", name: "Gem", unit_weight: null },
  ];
  const entries: ProjectionEntry[] = [
    { quantity: 5, state: "stored", equipped_slot: null, item_definition_id: "torch", custom_name: null },
    { quantity: 1, state: "equipped", equipped_slot: "main hand", item_definition_id: "sword", custom_name: null },
    { quantity: 10, state: "stored", equipped_slot: null, item_definition_id: "gem", custom_name: "Rubies" },
  ];

  it("sums quantities, weight, and equipped items", () => {
    const p = computeInventoryProjection(entries, definitions);
    expect(p.totalQuantity).toBe(16);
    expect(p.stackCount).toBe(3);
    expect(p.equippedCount).toBe(1);
    expect(p.equippedLabels).toEqual(["main hand: Sword"]);
    // 5*1 + 1*3.5 + 10*0 = 8.5
    expect(p.carriedWeight).toBe(8.5);
  });

  it("returns an empty projection for no entries", () => {
    const p = computeInventoryProjection([], definitions);
    expect(p).toEqual({
      totalQuantity: 0,
      stackCount: 0,
      equippedCount: 0,
      equippedLabels: [],
      carriedWeight: 0,
    });
  });

  it("prefers a custom name for equipped labels", () => {
    const p = computeInventoryProjection(
      [{ quantity: 1, state: "equipped", equipped_slot: "armor", item_definition_id: "sword", custom_name: "Heirloom Blade" }],
      definitions,
    );
    expect(p.equippedLabels).toEqual(["armor: Heirloom Blade"]);
  });
});

describe("projectInventorySheetValue", () => {
  const projection = {
    totalQuantity: 16,
    stackCount: 3,
    equippedCount: 1,
    equippedLabels: ["main hand: Sword"],
    carriedWeight: 8.5,
  };

  it("formats each reserved key", () => {
    expect(projectInventorySheetValue("inventory_summary", projection)).toBe("16 items in 3 stacks");
    expect(projectInventorySheetValue("equipped_items", projection)).toBe("main hand: Sword");
    expect(projectInventorySheetValue("carried_weight", projection)).toBe("8.50");
  });

  it("singularizes and handles empties", () => {
    const one = { totalQuantity: 1, stackCount: 1, equippedCount: 0, equippedLabels: [], carriedWeight: 0 };
    expect(projectInventorySheetValue("inventory_summary", one)).toBe("1 item in 1 stack");
    expect(projectInventorySheetValue("equipped_items", one)).toBe("None");
    expect(projectInventorySheetValue("carried_weight", one)).toBe("0");
  });
});

describe("isReservedInventoryKey", () => {
  it("recognizes the three reserved keys", () => {
    expect(isReservedInventoryKey("inventory_summary")).toBe(true);
    expect(isReservedInventoryKey("equipped_items")).toBe(true);
    expect(isReservedInventoryKey("carried_weight")).toBe(true);
    expect(isReservedInventoryKey("strength")).toBe(false);
  });
});

describe("formatWeight", () => {
  it("keeps integers clean and fixes decimals", () => {
    expect(formatWeight(5)).toBe("5");
    expect(formatWeight(2.5)).toBe("2.50");
  });
});
