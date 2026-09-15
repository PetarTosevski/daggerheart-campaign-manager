"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addInventoryItemSchema,
  consumeInventoryEntrySchema,
  correctInventoryEntrySchema,
  createInventoryContainerSchema,
  createItemDefinitionSchema,
  equipInventoryEntrySchema,
  mergeInventoryEntriesSchema,
  moveInventoryContainerSchema,
  splitInventoryEntrySchema,
  transferInventoryEntrySchema,
  unequipInventoryEntrySchema,
  updateItemDefinitionSchema,
} from "@/lib/validation/inventory";

export type InventoryActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  requestKey?: string;
  nextRequestKey?: string;
  fieldErrors?: Record<string, string[]>;
};

function publicInventoryError(message: string): string {
  const known = [
    "Campaign not found or access denied.",
    "Item definition not found or access denied.",
    "Item definition is not in this campaign.",
    "Item definition is archived.",
    "Container not found or access denied.",
    "Container is not in this campaign.",
    "Target container is not in this campaign.",
    "Parent container is not in this campaign.",
    "A nested container must share its parent owner.",
    "That move would create a container cycle.",
    "A container cannot contain itself.",
    "Inventory entry not found or access denied.",
    "This item is not stackable; add one at a time.",
    "This item is not stackable.",
    "Quantity exceeds this item's stack limit.",
    "Quantity must be a positive integer.",
    "Unequip this item before moving it.",
    "The item is already in that container.",
    "Only stored stacks can be split.",
    "Split quantity must be less than the stack size.",
    "Only stacks of the same item can be merged.",
    "Only stored stacks can be merged.",
    "Stacks must be in the same container to merge.",
    "Merged quantity would exceed the stack limit.",
    "Choose two different stacks to merge.",
    "This item is already equipped.",
    "Only a character-owned item can be equipped.",
    "Split a single unit before equipping.",
    "That equip slot is already occupied. Unequip the current item first.",
    "This item is not equipped.",
    "Stow the item into one of its owner's containers.",
    "Cannot consume more than the stack holds.",
    "A correction requires a reason.",
    "An equipped item is a single unit.",
    "The correction does not change the stack.",
    "Corrected quantity exceeds the stack limit.",
    "Stack limit is below an existing stack; split those stacks first.",
    "Idempotency key was already used for a different operation.",
  ];
  return (
    known.find((k) => message.includes(k)) ??
    "The inventory change could not be saved. Nothing was changed; please try again."
  );
}

async function authed() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { authenticated: !error && Boolean(user), supabase };
}

function invalid(input: { idempotencyKey: string }, error: import("zod").ZodError): InventoryActionState {
  return {
    status: "error",
    message: error.issues[0]?.message ?? "Check the submitted values.",
    requestKey: input.idempotencyKey,
    fieldErrors: error.flatten().fieldErrors,
  };
}

function expired(requestKey: string): InventoryActionState {
  return { status: "error", message: "Your session expired. Sign in again.", requestKey };
}

function success(requestKey: string, message: string): InventoryActionState {
  revalidatePath("/inventory");
  revalidatePath("/characters");
  return { status: "success", message, requestKey, nextRequestKey: randomUUID() };
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

// ---------------------------------------------------------------------------
// Item definitions
// ---------------------------------------------------------------------------

export async function createItemDefinitionAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    itemDefinitionId: str(formData, "itemDefinitionId"),
    name: str(formData, "name"),
    description: str(formData, "description"),
    category: str(formData, "category"),
    stackable: checkbox(formData, "stackable"),
    defaultStackLimit: str(formData, "defaultStackLimit"),
    unitWeight: str(formData, "unitWeight"),
  };
  const parsed = createItemDefinitionSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("create_item_definition", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_item_definition_id: parsed.data.itemDefinitionId,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_stackable: parsed.data.stackable,
    p_default_stack_limit: parsed.data.defaultStackLimit,
    p_unit_weight: parsed.data.unitWeight,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  const row = data?.[0];
  return success(
    parsed.data.idempotencyKey,
    row?.was_applied ? `Created ${row.returned_name}.` : "That item already exists.",
  );
}

export async function updateItemDefinitionAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    itemDefinitionId: str(formData, "itemDefinitionId"),
    name: str(formData, "name"),
    description: str(formData, "description"),
    category: str(formData, "category"),
    stackable: checkbox(formData, "stackable"),
    defaultStackLimit: str(formData, "defaultStackLimit"),
    unitWeight: str(formData, "unitWeight"),
    isActive: checkbox(formData, "isActive"),
  };
  const parsed = updateItemDefinitionSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("update_item_definition", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_item_definition_id: parsed.data.itemDefinitionId,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_stackable: parsed.data.stackable,
    p_default_stack_limit: parsed.data.defaultStackLimit,
    p_unit_weight: parsed.data.unitWeight,
    p_is_active: parsed.data.isActive,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  const row = data?.[0];
  return success(
    parsed.data.idempotencyKey,
    row?.was_applied ? `Updated ${row.returned_name}.` : "That update was already applied.",
  );
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export async function createInventoryContainerAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    containerId: str(formData, "containerId"),
    characterId: str(formData, "characterId"),
    parentContainerId: str(formData, "parentContainerId"),
    name: str(formData, "name"),
    containerType: str(formData, "containerType"),
    capacityValue: str(formData, "capacityValue"),
  };
  const parsed = createInventoryContainerSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("create_inventory_container", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_container_id: parsed.data.containerId,
    p_character_id: parsed.data.characterId,
    p_parent_container_id: parsed.data.parentContainerId,
    p_name: parsed.data.name,
    p_container_type: parsed.data.containerType,
    p_capacity_value: parsed.data.capacityValue,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  const row = data?.[0];
  return success(
    parsed.data.idempotencyKey,
    row?.was_applied ? `Created ${row.returned_name}.` : "That container already exists.",
  );
}

export async function moveInventoryContainerAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    containerId: str(formData, "containerId"),
    newParentContainerId: str(formData, "newParentContainerId"),
  };
  const parsed = moveInventoryContainerSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("move_inventory_container", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_container_id: parsed.data.containerId,
    p_new_parent_container_id: parsed.data.newParentContainerId,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Container moved." : "That move was already applied.",
  );
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function addInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    entryId: str(formData, "entryId"),
    itemDefinitionId: str(formData, "itemDefinitionId"),
    containerId: str(formData, "containerId"),
    quantity: str(formData, "quantity"),
    customName: str(formData, "customName"),
    notes: str(formData, "notes"),
  };
  const parsed = addInventoryItemSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("add_inventory_item", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_entry_id: parsed.data.entryId,
    p_item_definition_id: parsed.data.itemDefinitionId,
    p_container_id: parsed.data.containerId,
    p_quantity: parsed.data.quantity,
    p_custom_name: parsed.data.customName,
    p_notes: parsed.data.notes,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Item added." : "That item was already added.",
  );
}

export async function transferInventoryEntryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    entryId: str(formData, "entryId"),
    targetContainerId: str(formData, "targetContainerId"),
    reason: str(formData, "reason"),
  };
  const parsed = transferInventoryEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("transfer_inventory_entry", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_entry_id: parsed.data.entryId,
    p_target_container_id: parsed.data.targetContainerId,
    p_reason: parsed.data.reason || null,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Item moved." : "That move was already applied.",
  );
}

export async function splitInventoryEntryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    newEntryId: str(formData, "newEntryId"),
    entryId: str(formData, "entryId"),
    quantity: str(formData, "quantity"),
  };
  const parsed = splitInventoryEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("split_inventory_entry", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_new_entry_id: parsed.data.newEntryId,
    p_entry_id: parsed.data.entryId,
    p_quantity: parsed.data.quantity,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Stack split." : "That split was already applied.",
  );
}

export async function mergeInventoryEntriesAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    sourceEntryId: str(formData, "sourceEntryId"),
    targetEntryId: str(formData, "targetEntryId"),
  };
  const parsed = mergeInventoryEntriesSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("merge_inventory_entries", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_source_entry_id: parsed.data.sourceEntryId,
    p_target_entry_id: parsed.data.targetEntryId,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Stacks merged." : "That merge was already applied.",
  );
}

export async function equipInventoryEntryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    entryId: str(formData, "entryId"),
    equippedSlot: str(formData, "equippedSlot"),
  };
  const parsed = equipInventoryEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("equip_inventory_entry", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_entry_id: parsed.data.entryId,
    p_equipped_slot: parsed.data.equippedSlot,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Item equipped." : "That item was already equipped.",
  );
}

export async function unequipInventoryEntryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    entryId: str(formData, "entryId"),
    targetContainerId: str(formData, "targetContainerId"),
  };
  const parsed = unequipInventoryEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("unequip_inventory_entry", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_entry_id: parsed.data.entryId,
    p_target_container_id: parsed.data.targetContainerId,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Item unequipped." : "That item was already unequipped.",
  );
}

export async function consumeInventoryEntryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    entryId: str(formData, "entryId"),
    quantity: str(formData, "quantity"),
    reason: str(formData, "reason"),
  };
  const parsed = consumeInventoryEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("consume_inventory_entry", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_entry_id: parsed.data.entryId,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason || null,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Item consumed." : "That consumption was already applied.",
  );
}

export async function correctInventoryEntryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const input = {
    campaignId: str(formData, "campaignId"),
    idempotencyKey: str(formData, "idempotencyKey"),
    entryId: str(formData, "entryId"),
    newQuantity: str(formData, "newQuantity"),
    reason: str(formData, "reason"),
  };
  const parsed = correctInventoryEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);

  const { authenticated, supabase } = await authed();
  if (!authenticated) return expired(parsed.data.idempotencyKey);

  const { data, error } = await supabase.rpc("correct_inventory_entry", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_entry_id: parsed.data.entryId,
    p_new_quantity: parsed.data.newQuantity,
    p_reason: parsed.data.reason,
  });
  if (error) {
    return { status: "error", message: publicInventoryError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  return success(
    parsed.data.idempotencyKey,
    data?.[0]?.was_applied ? "Correction recorded." : "That correction was already applied.",
  );
}
