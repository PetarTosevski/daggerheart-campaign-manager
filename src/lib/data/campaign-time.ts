import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import {
  assertValidCampaignTime,
  toCampaignCycleDay,
  type CampaignCycle,
  type CampaignTime,
} from "@/lib/domain/campaign-time";
import type { Database } from "@/lib/supabase/database.types";

export type CampaignTimeHistoryEvent = {
  id: string;
  operationId: string;
  eventType: "advance" | "correction";
  previous: CampaignTime;
  next: CampaignTime;
  note: string | null;
  correctsEventId: string | null;
  createdAt: string;
};

export type CampaignTimeData = {
  current: CampaignTime;
  history: CampaignTimeHistoryEvent[];
};

export type CampaignTimelineState = {
  campaignName: string;
  current: CampaignTime;
};

function toCycle(value: string): CampaignCycle {
  if (value !== "DAY" && value !== "NIGHT") {
    throw new Error("Campaign time contains an unsupported cycle.");
  }
  return value;
}

export async function getCampaignTimeData(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<CampaignTimeData> {
  noStore();

  const [stateResult, historyResult] = await Promise.all([
    supabase
      .from("campaign_state")
      .select("current_week, current_cycle, current_cycle_day")
      .eq("campaign_id", campaignId)
      .single(),
    supabase
      .from("campaign_time_events")
      .select(
        "id, operation_id, event_type, previous_week, previous_cycle, previous_cycle_day, new_week, new_cycle, new_cycle_day, note, corrects_event_id, created_at",
      )
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12),
  ]);

  if (stateResult.error || !stateResult.data) {
    throw new Error("Unable to load campaign time.");
  }
  if (historyResult.error) {
    throw new Error("Unable to load campaign time history.");
  }

  const current: CampaignTime = {
    currentWeek: stateResult.data.current_week,
    currentCycle: toCycle(stateResult.data.current_cycle),
    currentCycleDay: toCampaignCycleDay(stateResult.data.current_cycle_day),
  };
  assertValidCampaignTime(current);

  const history = (historyResult.data ?? []).map((event) => {
    const previous: CampaignTime = {
      currentWeek: event.previous_week,
      currentCycle: toCycle(event.previous_cycle),
      currentCycleDay: toCampaignCycleDay(event.previous_cycle_day),
    };
    const next: CampaignTime = {
      currentWeek: event.new_week,
      currentCycle: toCycle(event.new_cycle),
      currentCycleDay: toCampaignCycleDay(event.new_cycle_day),
    };
    assertValidCampaignTime(previous);
    assertValidCampaignTime(next);

    if (event.event_type !== "advance" && event.event_type !== "correction") {
      throw new Error("Campaign time history contains an unsupported event type.");
    }
    const eventType: CampaignTimeHistoryEvent["eventType"] = event.event_type;

    return {
      id: event.id,
      operationId: event.operation_id,
      eventType,
      previous,
      next,
      note: event.note,
      correctsEventId: event.corrects_event_id,
      createdAt: event.created_at,
    };
  });

  return { current, history };
}

/**
 * Loads only the canonical campaign time needed by the persistent timeline in
 * the application shell. Returns null when no active campaign exists, so the
 * shell can render a neutral state rather than a fabricated Week 1. History is
 * intentionally not fetched here; the timeline is display-only.
 */
export async function getCampaignTimelineState(
  supabase: SupabaseClient<Database>,
): Promise<CampaignTimelineState | null> {
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

  const { data, error } = await supabase
    .from("campaign_state")
    .select("current_week, current_cycle, current_cycle_day")
    .eq("campaign_id", campaign.id)
    .single();

  if (error || !data) {
    throw new Error("Unable to load campaign time.");
  }

  const current: CampaignTime = {
    currentWeek: data.current_week,
    currentCycle: toCycle(data.current_cycle),
    currentCycleDay: toCampaignCycleDay(data.current_cycle_day),
  };
  assertValidCampaignTime(current);

  return { campaignName: campaign.name, current };
}
