import { z } from "zod";

import {
  CONTAINER_TYPES,
  EQUIP_SLOT_MAX,
  ITEM_CATEGORIES,
} from "@/lib/domain/inventory";

export const INVENTORY_NAME_MAX = 100;
export const INVENTORY_DESCRIPTION_MAX = 500;
export const INVENTORY_NOTE_MAX = 500;
export const INVENTORY_REASON_MAX = 300;

const campaignId = z.uuid("Select a valid campaign.");
const idempotencyKey = z.uuid("The request key is invalid. Refresh and try again.");

/** An optional uuid carried through a form: an empty string becomes null. */
const optionalUuid = (message: string) =>
  z
    .union([z.literal(""), z.uuid(message)])
    .transform((value) => (value === "" ? null : value));

/** An optional non-negative number carried through a form: empty becomes null. */
const optionalNonNegativeNumber = (message: string) =>
  z
    .union([z.literal(""), z.coerce.number(message).min(0, message)])
    .transform((value) => (value === "" ? null : value));

/** An optional positive integer carried through a form: empty becomes null. */
const optionalPositiveInt = (message: string) =>
  z
    .union([z.literal(""), z.coerce.number(message).int(message).positive(message)])
    .transform((value) => (value === "" ? null : value));

const name = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(INVENTORY_NAME_MAX, `Names cannot exceed ${INVENTORY_NAME_MAX} characters.`);

const description = z
  .string()
  .trim()
  .max(INVENTORY_DESCRIPTION_MAX, `Descriptions cannot exceed ${INVENTORY_DESCRIPTION_MAX} characters.`);

const notes = z
  .string()
  .trim()
  .max(INVENTORY_NOTE_MAX, `Notes cannot exceed ${INVENTORY_NOTE_MAX} characters.`);

const optionalReason = z
  .string()
  .trim()
  .max(INVENTORY_REASON_MAX, `Reasons cannot exceed ${INVENTORY_REASON_MAX} characters.`);

const requiredReason = z
  .string()
  .trim()
  .min(1, "A correction requires a reason.")
  .max(INVENTORY_REASON_MAX, `Reasons cannot exceed ${INVENTORY_REASON_MAX} characters.`);

const quantity = z.coerce
  .number("Enter a quantity.")
  .int("Quantity must be a whole number.")
  .positive("Quantity must be greater than zero.");

// ---------------------------------------------------------------------------
// Item definitions
// ---------------------------------------------------------------------------

export const createItemDefinitionSchema = z.object({
  campaignId,
  idempotencyKey,
  itemDefinitionId: z.uuid("The item id is invalid."),
  name,
  description,
  category: z.enum(ITEM_CATEGORIES),
  stackable: z.boolean(),
  defaultStackLimit: optionalPositiveInt("Stack limit must be a positive whole number."),
  unitWeight: optionalNonNegativeNumber("Unit weight cannot be negative."),
});

export const updateItemDefinitionSchema = createItemDefinitionSchema.extend({
  isActive: z.boolean(),
});

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export const createInventoryContainerSchema = z.object({
  campaignId,
  idempotencyKey,
  containerId: z.uuid("The container id is invalid."),
  characterId: optionalUuid("Select a valid character."),
  parentContainerId: optionalUuid("Select a valid parent container."),
  name,
  containerType: z.enum(CONTAINER_TYPES),
  capacityValue: optionalNonNegativeNumber("Capacity cannot be negative."),
});

export const moveInventoryContainerSchema = z.object({
  campaignId,
  idempotencyKey,
  containerId: z.uuid("Select a valid container."),
  newParentContainerId: optionalUuid("Select a valid parent container."),
});

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export const addInventoryItemSchema = z.object({
  campaignId,
  idempotencyKey,
  entryId: z.uuid("The entry id is invalid."),
  itemDefinitionId: z.uuid("Select a valid item."),
  containerId: z.uuid("Select a valid container."),
  quantity,
  customName: z
    .string()
    .trim()
    .max(INVENTORY_NAME_MAX, `Names cannot exceed ${INVENTORY_NAME_MAX} characters.`),
  notes,
});

export const transferInventoryEntrySchema = z.object({
  campaignId,
  idempotencyKey,
  entryId: z.uuid("Select a valid entry."),
  targetContainerId: z.uuid("Select a target container."),
  reason: optionalReason,
});

export const splitInventoryEntrySchema = z.object({
  campaignId,
  idempotencyKey,
  newEntryId: z.uuid("The new entry id is invalid."),
  entryId: z.uuid("Select a valid entry."),
  quantity,
});

export const mergeInventoryEntriesSchema = z
  .object({
    campaignId,
    idempotencyKey,
    sourceEntryId: z.uuid("Select a source stack."),
    targetEntryId: z.uuid("Select a target stack."),
  })
  .refine((data) => data.sourceEntryId !== data.targetEntryId, {
    message: "Choose two different stacks to merge.",
    path: ["targetEntryId"],
  });

export const equipInventoryEntrySchema = z.object({
  campaignId,
  idempotencyKey,
  entryId: z.uuid("Select a valid entry."),
  equippedSlot: z
    .string()
    .trim()
    .min(1, "Enter an equip slot.")
    .max(EQUIP_SLOT_MAX, `Slots cannot exceed ${EQUIP_SLOT_MAX} characters.`),
});

export const unequipInventoryEntrySchema = z.object({
  campaignId,
  idempotencyKey,
  entryId: z.uuid("Select a valid entry."),
  targetContainerId: z.uuid("Select a container to stow the item."),
});

export const consumeInventoryEntrySchema = z.object({
  campaignId,
  idempotencyKey,
  entryId: z.uuid("Select a valid entry."),
  quantity,
  reason: optionalReason,
});

export const correctInventoryEntrySchema = z.object({
  campaignId,
  idempotencyKey,
  entryId: z.uuid("Select a valid entry."),
  newQuantity: z.coerce
    .number("Enter the corrected quantity.")
    .int("Quantity must be a whole number.")
    .min(0, "Quantity cannot be negative."),
  reason: requiredReason,
});

export type CreateItemDefinitionInput = z.infer<typeof createItemDefinitionSchema>;
export type UpdateItemDefinitionInput = z.infer<typeof updateItemDefinitionSchema>;
export type CreateInventoryContainerInput = z.infer<typeof createInventoryContainerSchema>;
export type MoveInventoryContainerInput = z.infer<typeof moveInventoryContainerSchema>;
export type AddInventoryItemInput = z.infer<typeof addInventoryItemSchema>;
export type TransferInventoryEntryInput = z.infer<typeof transferInventoryEntrySchema>;
export type SplitInventoryEntryInput = z.infer<typeof splitInventoryEntrySchema>;
export type MergeInventoryEntriesInput = z.infer<typeof mergeInventoryEntriesSchema>;
export type EquipInventoryEntryInput = z.infer<typeof equipInventoryEntrySchema>;
export type UnequipInventoryEntryInput = z.infer<typeof unequipInventoryEntrySchema>;
export type ConsumeInventoryEntryInput = z.infer<typeof consumeInventoryEntrySchema>;
export type CorrectInventoryEntryInput = z.infer<typeof correctInventoryEntrySchema>;
