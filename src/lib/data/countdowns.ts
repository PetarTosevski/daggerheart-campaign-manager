import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import type { Database, Tables } from "@/lib/supabase/database.types";

export type CountdownHistoryEvent = Pick<
  Tables<"countdown_events">,
  | "id"
  | "countdown_id"
  | "change_amount"
  | "event_type"
  | "reason"
  | "previous_value"
  | "new_value"
  | "previous_status"
  | "new_status"
  | "created_at"
>;

export type CountdownSummary = Pick<
  Tables<"countdowns">,
  | "id"
  | "name"
  | "description"
  | "category"
  | "current_value"
  | "starting_value"
  | "status"
  | "consequence"
  | "completed_at"
  | "created_at"
> & {
  events: CountdownHistoryEvent[];
};

export type CountdownTrackerData = {
  active: CountdownSummary[];
  historical: CountdownSummary[];
};

export async function getCountdownTrackerData(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<CountdownTrackerData> {
  noStore();

  const countdownResult = await supabase
    .from("countdowns")
    .select(
      "id, name, description, category, current_value, starting_value, status, consequence, completed_at, created_at",
    )
    .eq("campaign_id", campaignId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (countdownResult.error) {
    throw new Error("Unable to load campaign countdowns.");
  }

  const countdowns = countdownResult.data ?? [];
  if (countdowns.length === 0) {
    return { active: [], historical: [] };
  }

  const eventResult = await supabase
    .from("countdown_events")
    .select(
      "id, countdown_id, change_amount, event_type, reason, previous_value, new_value, previous_status, new_status, created_at",
    )
    .in(
      "countdown_id",
      countdowns.map((countdown) => countdown.id),
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (eventResult.error) {
    throw new Error("Unable to load countdown history.");
  }

  const eventsByCountdown = new Map<string, CountdownHistoryEvent[]>();
  for (const event of eventResult.data ?? []) {
    const existing = eventsByCountdown.get(event.countdown_id) ?? [];
    if (existing.length < 8) {
      existing.push(event);
      eventsByCountdown.set(event.countdown_id, existing);
    }
  }

  const summaries: CountdownSummary[] = countdowns.map((countdown) => ({
    ...countdown,
    events: eventsByCountdown.get(countdown.id) ?? [],
  }));

  return {
    active: summaries.filter(
      (countdown) =>
        countdown.status === "active" || countdown.status === "paused",
    ),
    historical: summaries.filter(
      (countdown) =>
        countdown.status === "completed" || countdown.status === "cancelled",
    ),
  };
}
