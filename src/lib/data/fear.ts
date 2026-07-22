import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import type { Database, Tables } from "@/lib/supabase/database.types";

export type FearHistoryEvent = Pick<
  Tables<"fear_events">,
  | "id"
  | "amount"
  | "event_type"
  | "previous_value"
  | "new_value"
  | "created_at"
>;

export type FearTrackerData = {
  campaign: {
    id: string;
    name: string;
  };
  currentFear: number;
  history: FearHistoryEvent[];
};

export async function getFearTrackerData(
  supabase: SupabaseClient<Database>,
): Promise<FearTrackerData | null> {
  noStore();

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (campaignError) {
    throw new Error("Unable to load the campaign.");
  }

  if (!campaign) {
    return null;
  }

  const [stateResult, historyResult] = await Promise.all([
    supabase
      .from("campaign_state")
      .select("current_fear")
      .eq("campaign_id", campaign.id)
      .single(),
    supabase
      .from("fear_events")
      .select("id, amount, event_type, previous_value, new_value, created_at")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12),
  ]);

  if (stateResult.error || !stateResult.data) {
    throw new Error("Unable to load the campaign Fear total.");
  }

  if (historyResult.error) {
    throw new Error("Unable to load Fear history.");
  }

  return {
    campaign,
    currentFear: stateResult.data.current_fear,
    history: historyResult.data ?? [],
  };
}
