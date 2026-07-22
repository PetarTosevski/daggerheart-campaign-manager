"use server";

import { randomUUID } from "node:crypto";

import type { CampaignTimeHistoryEvent } from "@/lib/data/campaign-time";
import {
  assertValidCampaignTime,
  formatCampaignTime,
  toCampaignCycleDay,
  type CampaignCycle,
  type CampaignTime,
} from "@/lib/domain/campaign-time";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { campaignTimeActionSchema } from "@/lib/validation/campaign-time";

export type CampaignTimeActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  requestKey?: string;
  nextRequestKey?: string;
  current?: CampaignTime;
  event?: CampaignTimeHistoryEvent;
  fieldErrors?: Record<string, string[]>;
};

function publicCampaignTimeError(message: string): string {
  const knownMessages = [
    "Campaign not found or access denied.",
    "Campaign time notes cannot exceed 200 characters.",
    "Campaign time correction must change the current state.",
    "The corrected campaign time event does not belong to this campaign.",
    "Idempotency key was already used for a different operation.",
  ];

  return (
    knownMessages.find((known) => message.includes(known)) ??
    "Campaign time could not be saved. Nothing was changed; please try again."
  );
}

function toCycle(value: string): CampaignCycle {
  if (value !== "DAY" && value !== "NIGHT") {
    throw new Error("The saved campaign cycle is invalid.");
  }
  return value;
}

export async function changeCampaignTimeAction(
  _previousState: CampaignTimeActionState,
  formData: FormData,
): Promise<CampaignTimeActionState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    intent: String(formData.get("intent") ?? ""),
    targetWeek: String(formData.get("targetWeek") ?? ""),
    targetCycle: String(formData.get("targetCycle") ?? ""),
    targetCycleDay: String(formData.get("targetCycleDay") ?? ""),
    note: String(formData.get("note") ?? ""),
    correctsEventId: String(formData.get("correctsEventId") ?? ""),
  };

  const parsed = campaignTimeActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      requestKey: input.idempotencyKey,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before changing campaign time.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const correctionArgs =
    parsed.data.intent === "correction"
      ? {
          p_target_week: parsed.data.targetWeek,
          p_target_cycle: parsed.data.targetCycle,
          p_target_cycle_day: parsed.data.targetCycleDay,
          p_corrects_event_id: parsed.data.correctsEventId ?? undefined,
        }
      : {};

  const { data, error } = await supabase.rpc("change_campaign_time", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_intent: parsed.data.intent,
    p_note: parsed.data.note || undefined,
    ...correctionArgs,
  });

  if (error) {
    return {
      status: "error",
      message: publicCampaignTimeError(error.message),
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const result = data?.[0];
  if (!result) {
    return {
      status: "error",
      message: "Campaign time could not be saved. Nothing was changed; please try again.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  try {
    const previous: CampaignTime = {
      currentWeek: result.previous_week,
      currentCycle: toCycle(result.previous_cycle),
      currentCycleDay: toCampaignCycleDay(result.previous_cycle_day),
    };
    const current: CampaignTime = {
      currentWeek: result.new_week,
      currentCycle: toCycle(result.new_cycle),
      currentCycleDay: toCampaignCycleDay(result.new_cycle_day),
    };
    assertValidCampaignTime(previous);
    assertValidCampaignTime(current);
    if (
      result.returned_event_type !== "advance" &&
      result.returned_event_type !== "correction"
    ) {
      throw new Error("The saved campaign-time event type is invalid.");
    }

    const event: CampaignTimeHistoryEvent = {
      id: result.event_id,
      operationId: result.operation_id,
      eventType: result.returned_event_type,
      previous,
      next: current,
      note: result.returned_note ?? null,
      correctsEventId: result.returned_corrects_event_id ?? null,
      createdAt: result.event_created_at,
    };

    return {
      status: "success",
      message: result.was_applied
        ? `${event.eventType === "correction" ? "Campaign time corrected" : "Campaign day advanced"} to ${formatCampaignTime(current)}.`
        : `Campaign time is already ${formatCampaignTime(current)}; the duplicate request was not applied.`,
      requestKey: parsed.data.idempotencyKey,
      nextRequestKey: randomUUID(),
      current,
      event,
    };
  } catch {
    return {
      status: "error",
      message: "Campaign time was saved, but its result could not be displayed. Refresh the page.",
      requestKey: parsed.data.idempotencyKey,
    };
  }
}
