"use server";

import { amountForFearDirection } from "@/lib/domain/fear";
import type { FearHistoryEvent } from "@/lib/data/fear";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fearAdjustmentSchema } from "@/lib/validation/fear";

export type AdjustFearState = {
  status: "idle" | "success" | "error";
  message?: string;
  newValue?: number;
  requestKey?: string;
  event?: FearHistoryEvent;
  fieldErrors?: Record<string, string[]>;
};

function publicFearError(message: string): string {
  const knownMessages = [
    "Fear must remain between 0 and 12.",
    "Campaign not found or access denied.",
    "Idempotency key was already used for a different Fear adjustment.",
  ];

  return knownMessages.find((known) => message.includes(known)) ??
    "Fear could not be saved. Nothing was changed; please try again.";
}

export async function adjustFearAction(
  _previousState: AdjustFearState,
  formData: FormData,
): Promise<AdjustFearState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    direction: String(formData.get("direction") ?? ""),
    eventType: String(formData.get("eventType") ?? "adjustment"),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  };

  const parsed = fearAdjustmentSchema.safeParse(input);
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
      message: "Your session expired. Sign in again before changing Fear.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const { data, error } = await supabase.rpc("adjust_campaign_fear", {
    p_campaign_id: parsed.data.campaignId,
    p_amount: amountForFearDirection(parsed.data.direction),
    p_event_type: parsed.data.eventType,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      status: "error",
      message: publicFearError(error.message),
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const result = data?.[0];
  if (!result) {
    return {
      status: "error",
      message: "Fear could not be saved. Nothing was changed; please try again.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  return {
    status: "success",
    message: result.was_applied
      ? `Fear updated to ${result.new_value}.`
      : `Fear is already ${result.new_value}; the duplicate request was not applied.`,
    newValue: result.new_value,
    requestKey: parsed.data.idempotencyKey,
    event: {
      id: result.event_id,
      amount: result.change_amount,
      event_type: result.returned_event_type,
      previous_value: result.previous_value,
      new_value: result.new_value,
      created_at: result.event_created_at,
    },
  };
}
