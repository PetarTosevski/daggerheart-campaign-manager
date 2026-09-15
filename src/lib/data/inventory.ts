import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import { getActiveCampaign, type CampaignRef } from "@/lib/data/characters";
import {
  computeInventoryProjection,
  type InventoryProjection,
} from "@/lib/domain/inventory";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type ItemDefinitionRow = Pick<
  Tables<"item_definitions">,
  | "id"
  | "name"
  | "description"
  | "category"
  | "stackable"
  | "default_stack_limit"
  | "unit_weight"
  | "is_active"
  | "created_at"
>;

export type InventoryContainerRow = Pick<
  Tables<"inventory_containers">,
  | "id"
  | "character_id"
  | "parent_container_id"
  | "name"
  | "container_type"
  | "capacity_value"
  | "is_default"
  | "sort_order"
>;

export type InventoryEntryRow = Pick<
  Tables<"inventory_entries">,
  | "id"
  | "character_id"
  | "container_id"
  | "item_definition_id"
  | "quantity"
  | "state"
  | "equipped_slot"
  | "custom_name"
  | "notes"
  | "created_at"
>;

export type InventoryTransactionRow = Pick<
  Tables<"inventory_transactions">,
  | "id"
  | "entry_id"
  | "item_definition_id"
  | "transaction_type"
  | "quantity_delta"
  | "source_character_id"
  | "target_character_id"
  | "source_container_id"
  | "target_container_id"
  | "reason"
  | "created_at"
>;

export type InventoryCharacterRef = Pick<Tables<"characters">, "id" | "name" | "status">;

export type InventoryOverview = {
  campaign: CampaignRef;
  items: ItemDefinitionRow[];
  containers: InventoryContainerRow[];
  entries: InventoryEntryRow[];
  history: InventoryTransactionRow[];
  characters: InventoryCharacterRef[];
};

const ITEM_COLUMNS =
  "id, name, description, category, stackable, default_stack_limit, unit_weight, is_active, created_at";
const CONTAINER_COLUMNS =
  "id, character_id, parent_container_id, name, container_type, capacity_value, is_default, sort_order";
const ENTRY_COLUMNS =
  "id, character_id, container_id, item_definition_id, quantity, state, equipped_slot, custom_name, notes, created_at";
const TRANSACTION_COLUMNS =
  "id, entry_id, item_definition_id, transaction_type, quantity_delta, source_character_id, target_character_id, source_container_id, target_container_id, reason, created_at";

export async function getInventoryOverview(
  supabase: SupabaseClient<Database>,
): Promise<InventoryOverview | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) return null;

  const [itemsResult, containersResult, entriesResult, historyResult, charactersResult] =
    await Promise.all([
      supabase
        .from("item_definitions")
        .select(ITEM_COLUMNS)
        .eq("campaign_id", campaign.id)
        .order("is_active", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("inventory_containers")
        .select(CONTAINER_COLUMNS)
        .eq("campaign_id", campaign.id)
        .order("character_id", { ascending: true, nullsFirst: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("inventory_entries")
        .select(ENTRY_COLUMNS)
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("inventory_transactions")
        .select(TRANSACTION_COLUMNS)
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(30),
      supabase
        .from("characters")
        .select("id, name, status")
        .eq("campaign_id", campaign.id)
        .order("status", { ascending: true })
        .order("name", { ascending: true }),
    ]);

  if (
    itemsResult.error ||
    containersResult.error ||
    entriesResult.error ||
    historyResult.error ||
    charactersResult.error
  ) {
    throw new Error("Unable to load the campaign inventory.");
  }

  return {
    campaign,
    items: itemsResult.data ?? [],
    containers: containersResult.data ?? [],
    entries: entriesResult.data ?? [],
    history: historyResult.data ?? [],
    characters: charactersResult.data ?? [],
  };
}

/**
 * The read-only inventory projection for one character, for the character-sheet
 * reserved fields. Sums the character's stored and equipped stacks; returns an
 * empty projection when the character holds nothing.
 */
export async function getCharacterInventoryProjection(
  supabase: SupabaseClient<Database>,
  characterId: string,
): Promise<InventoryProjection> {
  noStore();

  const { data: entries, error: entriesError } = await supabase
    .from("inventory_entries")
    .select("quantity, state, equipped_slot, item_definition_id, custom_name")
    .eq("character_id", characterId);

  if (entriesError) {
    throw new Error("Unable to load character inventory.");
  }

  const rows = entries ?? [];
  if (rows.length === 0) {
    return computeInventoryProjection([], []);
  }

  const itemIds = Array.from(new Set(rows.map((r) => r.item_definition_id)));
  const { data: definitions, error: definitionsError } = await supabase
    .from("item_definitions")
    .select("id, name, unit_weight")
    .in("id", itemIds);

  if (definitionsError) {
    throw new Error("Unable to load character inventory.");
  }

  return computeInventoryProjection(rows, definitions ?? []);
}
