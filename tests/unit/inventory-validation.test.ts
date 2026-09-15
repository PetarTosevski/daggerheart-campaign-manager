import { describe, expect, it } from "vitest";

import {
  addInventoryItemSchema,
  correctInventoryEntrySchema,
  createInventoryContainerSchema,
  createItemDefinitionSchema,
  equipInventoryEntrySchema,
  mergeInventoryEntriesSchema,
  splitInventoryEntrySchema,
} from "@/lib/validation/inventory";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";

describe("createItemDefinitionSchema", () => {
  const base = {
    campaignId: uuid,
    idempotencyKey: uuid2,
    itemDefinitionId: uuid3,
    name: "Torch",
    description: "",
    category: "tool",
    stackable: true,
    defaultStackLimit: "20",
    unitWeight: "1.5",
  };

  it("accepts a valid item and coerces optional numbers", () => {
    const parsed = createItemDefinitionSchema.parse(base);
    expect(parsed.defaultStackLimit).toBe(20);
    expect(parsed.unitWeight).toBe(1.5);
  });

  it("maps empty optional numbers to null", () => {
    const parsed = createItemDefinitionSchema.parse({ ...base, defaultStackLimit: "", unitWeight: "" });
    expect(parsed.defaultStackLimit).toBeNull();
    expect(parsed.unitWeight).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(createItemDefinitionSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(createItemDefinitionSchema.safeParse({ ...base, category: "potion" }).success).toBe(false);
  });

  it("rejects a negative unit weight", () => {
    expect(createItemDefinitionSchema.safeParse({ ...base, unitWeight: "-1" }).success).toBe(false);
  });
});

describe("createInventoryContainerSchema", () => {
  const base = {
    campaignId: uuid,
    idempotencyKey: uuid2,
    containerId: uuid3,
    characterId: "",
    parentContainerId: "",
    name: "Chest",
    containerType: "storage",
    capacityValue: "",
  };

  it("maps empty owner/parent to null (shared, top level)", () => {
    const parsed = createInventoryContainerSchema.parse(base);
    expect(parsed.characterId).toBeNull();
    expect(parsed.parentContainerId).toBeNull();
    expect(parsed.capacityValue).toBeNull();
  });

  it("rejects an invalid container type", () => {
    expect(createInventoryContainerSchema.safeParse({ ...base, containerType: "vault" }).success).toBe(false);
  });
});

describe("addInventoryItemSchema", () => {
  const base = {
    campaignId: uuid,
    idempotencyKey: uuid2,
    entryId: uuid3,
    itemDefinitionId: uuid,
    containerId: uuid2,
    quantity: "3",
    customName: "",
    notes: "",
  };

  it("coerces quantity", () => {
    expect(addInventoryItemSchema.parse(base).quantity).toBe(3);
  });

  it("rejects a non-positive quantity", () => {
    expect(addInventoryItemSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
  });
});

describe("splitInventoryEntrySchema", () => {
  it("requires a positive split quantity", () => {
    const base = { campaignId: uuid, idempotencyKey: uuid2, newEntryId: uuid3, entryId: uuid, quantity: "2" };
    expect(splitInventoryEntrySchema.parse(base).quantity).toBe(2);
    expect(splitInventoryEntrySchema.safeParse({ ...base, quantity: "-1" }).success).toBe(false);
  });
});

describe("mergeInventoryEntriesSchema", () => {
  it("rejects merging a stack into itself", () => {
    const result = mergeInventoryEntriesSchema.safeParse({
      campaignId: uuid,
      idempotencyKey: uuid2,
      sourceEntryId: uuid3,
      targetEntryId: uuid3,
    });
    expect(result.success).toBe(false);
  });

  it("accepts two different stacks", () => {
    expect(
      mergeInventoryEntriesSchema.safeParse({
        campaignId: uuid,
        idempotencyKey: uuid2,
        sourceEntryId: uuid3,
        targetEntryId: uuid,
      }).success,
    ).toBe(true);
  });
});

describe("equipInventoryEntrySchema", () => {
  const base = { campaignId: uuid, idempotencyKey: uuid2, entryId: uuid3, equippedSlot: "main hand" };
  it("requires a slot", () => {
    expect(equipInventoryEntrySchema.safeParse({ ...base, equippedSlot: "" }).success).toBe(false);
    expect(equipInventoryEntrySchema.parse(base).equippedSlot).toBe("main hand");
  });
});

describe("correctInventoryEntrySchema", () => {
  const base = { campaignId: uuid, idempotencyKey: uuid2, entryId: uuid3, newQuantity: "0", reason: "recount" };
  it("allows zero (removal) but requires a reason", () => {
    expect(correctInventoryEntrySchema.parse(base).newQuantity).toBe(0);
    expect(correctInventoryEntrySchema.safeParse({ ...base, reason: "  " }).success).toBe(false);
  });

  it("rejects a negative quantity", () => {
    expect(correctInventoryEntrySchema.safeParse({ ...base, newQuantity: "-2" }).success).toBe(false);
  });
});
