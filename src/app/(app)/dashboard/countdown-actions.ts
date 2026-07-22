"use server";

import { randomUUID } from "node:crypto";

import { amountForCountdownIntent } from "@/lib/domain/countdowns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createCountdownSchema,
  operateCountdownSchema,
} from "@/lib/validation/countdowns";

export type CountdownActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  requestKey?: string;
  nextRequestKey?: string;
  fieldErrors?: Record<string, string[]>;
};

function publicCountdownError(message: string): string {
  const knownMessages = [
    "Campaign not found or access denied.",
    "Countdown not found or access denied.",
    "Countdown name must contain between 1 and 100 characters.",
    "Countdown category is not supported.",
    "Countdown starting value must be a positive integer.",
    "Countdown value must remain between 0 and its starting value.",
    "Resume the countdown before changing its value.",
    "A completed countdown must be reversed to reopen it.",
    "Only an active countdown can be paused.",
    "Only a paused countdown can be resumed.",
    "Only an active or paused countdown can be cancelled.",
    "Cancelled countdowns cannot be changed.",
    "Idempotency key was already used for a different countdown.",
    "Idempotency key was already used for a different countdown action.",
  ];

  return (
    knownMessages.find((known) => message.includes(known)) ??
    "The countdown could not be saved. Nothing was changed; please try again."
  );
}

async function hasAuthenticatedUser(): Promise<{
  authenticated: boolean;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { authenticated: !error && Boolean(user), supabase };
}

export async function createCountdownAction(
  _previousState: CountdownActionState,
  formData: FormData,
): Promise<CountdownActionState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? ""),
    startingValue: String(formData.get("startingValue") ?? ""),
    consequence: String(formData.get("consequence") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  };

  const parsed = createCountdownSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      requestKey: input.idempotencyKey,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await hasAuthenticatedUser();
  if (!authenticated) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before creating a countdown.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const { data, error } = await supabase.rpc("create_campaign_countdown", {
    p_campaign_id: parsed.data.campaignId,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_starting_value: parsed.data.startingValue,
    p_consequence: parsed.data.consequence,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      status: "error",
      message: publicCountdownError(error.message),
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const result = data?.[0];
  if (!result) {
    return {
      status: "error",
      message: "The countdown could not be saved. Nothing was changed; please try again.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  return {
    status: "success",
    message: result.was_applied
      ? `${result.returned_name} was created.`
      : `${result.returned_name} was already created; the duplicate request was not applied.`,
    requestKey: parsed.data.idempotencyKey,
    nextRequestKey: randomUUID(),
  };
}

export async function operateCountdownAction(
  _previousState: CountdownActionState,
  formData: FormData,
): Promise<CountdownActionState> {
  const input = {
    countdownId: String(formData.get("countdownId") ?? ""),
    intent: String(formData.get("intent") ?? ""),
    eventMode: String(formData.get("eventMode") ?? "operation"),
    reason: String(formData.get("reason") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  };

  const parsed = operateCountdownSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      requestKey: input.idempotencyKey,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await hasAuthenticatedUser();
  if (!authenticated) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before changing a countdown.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const valueIntent =
    parsed.data.intent === "advance" || parsed.data.intent === "reverse";
  const action =
    parsed.data.eventMode === "correction" && valueIntent
      ? "correction"
      : parsed.data.intent;

  const { data, error } = await supabase.rpc("operate_countdown", {
    p_countdown_id: parsed.data.countdownId,
    p_action: action,
    p_change_amount: amountForCountdownIntent(parsed.data.intent),
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return {
      status: "error",
      message: publicCountdownError(error.message),
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const result = data?.[0];
  if (!result) {
    return {
      status: "error",
      message: "The countdown could not be saved. Nothing was changed; please try again.",
      requestKey: parsed.data.idempotencyKey,
    };
  }

  const statusChanged = result.previous_status !== result.new_status;
  const message = result.was_applied
    ? statusChanged && result.new_status === "completed"
      ? "Countdown reached 0 and completed."
      : statusChanged && result.previous_status === "completed"
        ? `Countdown reopened at ${result.new_value}.`
        : result.change_amount === 0
          ? `Countdown is now ${result.new_status}.`
          : `Countdown updated to ${result.new_value}.`
    : "The duplicate countdown request was not applied.";

  return {
    status: "success",
    message,
    requestKey: parsed.data.idempotencyKey,
    nextRequestKey: randomUUID(),
  };
}
