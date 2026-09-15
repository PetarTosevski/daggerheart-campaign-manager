import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import { getActiveCampaign, type CampaignRef } from "@/lib/data/characters";
import {
  DEFAULT_PORTIONS_PER_ACTIVE_CHARACTER_PER_WEEK,
  DEFAULT_PORTIONS_PER_RATION,
  type PreviewBatch,
  type SpoilagePolicy,
} from "@/lib/domain/food";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type FoodSettings = {
  portionsPerRation: number;
  portionsPerActiveCharacterPerWeek: number;
  defaultSpoilagePolicy: SpoilagePolicy;
};

export type FoodBatchRow = Pick<
  Tables<"food_batches">,
  | "id"
  | "label"
  | "food_type"
  | "acquired_week"
  | "acquired_cycle"
  | "acquired_cycle_day"
  | "initial_portions"
  | "remaining_portions"
  | "source_note"
  | "status"
  | "created_at"
>;

export type FoodTransactionRow = Pick<
  Tables<"food_transactions">,
  | "id"
  | "batch_id"
  | "transaction_type"
  | "portions_delta"
  | "before_portions"
  | "after_portions"
  | "reason"
  | "created_at"
>;

export type FoodOverview = {
  campaign: CampaignRef;
  settings: FoodSettings;
  currentWeek: number;
  totalPortions: number;
  activeCharacterCount: number;
  batches: FoodBatchRow[];
  history: FoodTransactionRow[];
};

const BATCH_COLUMNS =
  "id, label, food_type, acquired_week, acquired_cycle, acquired_cycle_day, initial_portions, remaining_portions, source_note, status, created_at";

function settingsFrom(row: Tables<"food_settings"> | null): FoodSettings {
  return {
    portionsPerRation: row?.portions_per_ration ?? DEFAULT_PORTIONS_PER_RATION,
    portionsPerActiveCharacterPerWeek:
      row?.portions_per_active_character_per_week ??
      DEFAULT_PORTIONS_PER_ACTIVE_CHARACTER_PER_WEEK,
    defaultSpoilagePolicy: (row?.default_spoilage_policy ?? "spoil_fresh") as SpoilagePolicy,
  };
}

/** Total remaining portions across all active batches (the shared campaign store). */
export function totalRemainingPortions(
  batches: readonly Pick<FoodBatchRow, "status" | "remaining_portions">[],
): number {
  return batches
    .filter((b) => b.status === "active")
    .reduce((sum, b) => sum + b.remaining_portions, 0);
}

export async function getFoodOverview(
  supabase: SupabaseClient<Database>,
): Promise<FoodOverview | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) return null;

  const [settingsResult, stateResult, batchesResult, historyResult, rosterResult] =
    await Promise.all([
      supabase
        .from("food_settings")
        .select("*")
        .eq("campaign_id", campaign.id)
        .maybeSingle(),
      supabase
        .from("campaign_state")
        .select("current_week")
        .eq("campaign_id", campaign.id)
        .maybeSingle(),
      supabase
        .from("food_batches")
        .select(BATCH_COLUMNS)
        .eq("campaign_id", campaign.id)
        .order("acquired_week", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("food_transactions")
        .select(
          "id, batch_id, transaction_type, portions_delta, before_portions, after_portions, reason, created_at",
        )
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(20),
      supabase
        .from("characters")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "active"),
    ]);

  if (
    settingsResult.error ||
    stateResult.error ||
    batchesResult.error ||
    historyResult.error ||
    rosterResult.error
  ) {
    throw new Error("Unable to load the campaign food store.");
  }

  const batches = batchesResult.data ?? [];
  return {
    campaign,
    settings: settingsFrom(settingsResult.data),
    currentWeek: stateResult.data?.current_week ?? 1,
    totalPortions: totalRemainingPortions(batches),
    activeCharacterCount: rosterResult.count ?? 0,
    batches,
    history: historyResult.data ?? [],
  };
}

/** Batches shaped for the domain preview (active batches only are needed). */
export function toPreviewBatches(batches: readonly FoodBatchRow[]): PreviewBatch[] {
  return batches.map((b) => ({
    id: b.id,
    label: b.label,
    food_type: b.food_type,
    status: b.status,
    acquired_week: b.acquired_week,
    remaining_portions: b.remaining_portions,
    created_at: b.created_at,
  }));
}

/**
 * The shared campaign food total in portions, for the character-sheet projection.
 * Reads active batches only; returns null when there is no active campaign.
 */
export async function getCampaignFoodPortions(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<{ totalPortions: number; portionsPerRation: number }> {
  noStore();
  const [batchesResult, settingsResult] = await Promise.all([
    supabase
      .from("food_batches")
      .select("status, remaining_portions")
      .eq("campaign_id", campaignId)
      .eq("status", "active"),
    supabase
      .from("food_settings")
      .select("portions_per_ration")
      .eq("campaign_id", campaignId)
      .maybeSingle(),
  ]);
  if (batchesResult.error || settingsResult.error) {
    throw new Error("Unable to load campaign food.");
  }
  const totalPortions = (batchesResult.data ?? []).reduce(
    (sum, b) => sum + b.remaining_portions,
    0,
  );
  return {
    totalPortions,
    portionsPerRation:
      settingsResult.data?.portions_per_ration ?? DEFAULT_PORTIONS_PER_RATION,
  };
}
