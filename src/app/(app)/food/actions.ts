"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getFoodOverview, toPreviewBatches } from "@/lib/data/food";
import { computeWeeklyPreview, type WeeklyPreview } from "@/lib/domain/food";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acquireFoodBatchSchema,
  correctFoodBatchSchema,
  processWeeklyFoodSchema,
} from "@/lib/validation/food";

export type FoodActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  requestKey?: string;
  nextRequestKey?: string;
  fieldErrors?: Record<string, string[]>;
};

function publicFoodError(message: string): string {
  const known = [
    "Campaign not found or access denied.",
    "Food label must contain between 1 and 100 characters.",
    "Food type must be fresh or preserved.",
    "Portions must be a positive integer.",
    "An override requires a reason.",
    "This campaign week has already been processed.",
    "Target week must be at least 1.",
    "Food batch not found or access denied.",
    "A correction requires a reason.",
    "Corrected remaining portions must be between 0 and the batch total.",
    "The correction does not change the batch.",
    "Idempotency key was already used for a different operation.",
    "Select at least one batch for a custom selection.",
    "A batch can only be selected once.",
    "A selected batch is not an available, consumable batch. Refresh and try again.",
  ];
  return (
    known.find((k) => message.includes(k)) ??
    "The food change could not be saved. Nothing was changed; please try again."
  );
}

/** Parses the JSON-encoded ordered batch selection carried by a hidden form field. */
function parseSelectedBatchIds(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function authed() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { authenticated: !error && Boolean(user), supabase };
}

export async function acquireFoodBatchAction(
  _prev: FoodActionState,
  formData: FormData,
): Promise<FoodActionState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    label: String(formData.get("label") ?? ""),
    foodType: String(formData.get("foodType") ?? ""),
    initialPortions: String(formData.get("initialPortions") ?? ""),
    sourceNote: String(formData.get("sourceNote") ?? ""),
  };
  const parsed = acquireFoodBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      requestKey: input.idempotencyKey,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await authed();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again.", requestKey: parsed.data.idempotencyKey };
  }

  const { data, error } = await supabase.rpc("acquire_food_batch", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_label: parsed.data.label,
    p_food_type: parsed.data.foodType,
    p_initial_portions: parsed.data.initialPortions,
    p_source_note: parsed.data.sourceNote,
  });
  if (error) {
    return { status: "error", message: publicFoodError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  const row = data?.[0];
  revalidatePath("/food");
  revalidatePath("/characters");
  return {
    status: "success",
    message: row?.was_applied ? `Added ${row.returned_label}.` : "That batch was already added.",
    requestKey: parsed.data.idempotencyKey,
    nextRequestKey: randomUUID(),
  };
}

export type PreviewResult =
  | { status: "ok"; preview: WeeklyPreview }
  | { status: "error"; message: string };

export async function previewWeeklyFoodAction(input: {
  overrideRequiredPortions: number | null;
  skipSpoilage: boolean;
  overrideBatchSelection?: boolean;
  selectedBatchIds?: string[];
}): Promise<PreviewResult> {
  const { authenticated, supabase } = await authed();
  if (!authenticated) return { status: "error", message: "Your session expired. Sign in again." };

  const overview = await getFoodOverview(supabase);
  if (!overview) return { status: "error", message: "No active campaign." };

  const preview = computeWeeklyPreview({
    batches: toPreviewBatches(overview.batches),
    targetWeek: overview.currentWeek,
    activeCharacterCount: overview.activeCharacterCount,
    portionsPerActiveCharacterPerWeek: overview.settings.portionsPerActiveCharacterPerWeek,
    spoilagePolicy: overview.settings.defaultSpoilagePolicy,
    override: {
      requiredPortions: input.overrideRequiredPortions,
      skipSpoilage: input.skipSpoilage,
      selectedBatchIds: input.overrideBatchSelection ? (input.selectedBatchIds ?? []) : null,
    },
  });
  return { status: "ok", preview };
}

export async function commitWeeklyFoodAction(
  _prev: FoodActionState,
  formData: FormData,
): Promise<FoodActionState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    targetWeek: String(formData.get("targetWeek") ?? ""),
    overrideRequiredPortions: String(formData.get("overrideRequiredPortions") ?? ""),
    skipSpoilage: formData.get("skipSpoilage") === "on" || formData.get("skipSpoilage") === "true",
    overrideBatchSelection:
      formData.get("overrideBatchSelection") === "on" ||
      formData.get("overrideBatchSelection") === "true",
    selectedBatchIds: parseSelectedBatchIds(formData.get("selectedBatchIds")),
    reason: String(formData.get("reason") ?? ""),
  };
  const parsed = processWeeklyFoodSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      requestKey: input.idempotencyKey,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await authed();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again.", requestKey: parsed.data.idempotencyKey };
  }

  const { data, error } = await supabase.rpc("process_weekly_food", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_target_week: parsed.data.targetWeek,
    p_override_required_portions: parsed.data.overrideRequiredPortions,
    p_skip_spoilage: parsed.data.skipSpoilage,
    p_reason: parsed.data.reason || null,
    p_selected_batch_ids: parsed.data.overrideBatchSelection ? parsed.data.selectedBatchIds : null,
  });
  if (error) {
    return { status: "error", message: publicFoodError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  const row = data?.[0];
  revalidatePath("/food");
  revalidatePath("/characters");
  const summary = row
    ? `Week ${row.returned_processed_week} processed: ${row.returned_consumed} consumed, ${row.returned_spoiled} spoiled${row.returned_shortage > 0 ? `, shortage ${row.returned_shortage}` : ""}.`
    : "Weekly food processed.";
  return {
    status: "success",
    message: row?.was_applied ? summary : "That weekly process was already applied.",
    requestKey: parsed.data.idempotencyKey,
    nextRequestKey: randomUUID(),
  };
}

export async function correctFoodBatchAction(
  _prev: FoodActionState,
  formData: FormData,
): Promise<FoodActionState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    batchId: String(formData.get("batchId") ?? ""),
    newRemainingPortions: String(formData.get("newRemainingPortions") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
  const parsed = correctFoodBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      requestKey: input.idempotencyKey,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await authed();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again.", requestKey: parsed.data.idempotencyKey };
  }

  const { data, error } = await supabase.rpc("correct_food_batch", {
    p_campaign_id: parsed.data.campaignId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_batch_id: parsed.data.batchId,
    p_new_remaining_portions: parsed.data.newRemainingPortions,
    p_reason: parsed.data.reason,
  });
  if (error) {
    return { status: "error", message: publicFoodError(error.message), requestKey: parsed.data.idempotencyKey };
  }
  revalidatePath("/food");
  revalidatePath("/characters");
  return {
    status: "success",
    message: data?.[0]?.was_applied ? "Correction recorded." : "That correction was already applied.",
    requestKey: parsed.data.idempotencyKey,
    nextRequestKey: randomUUID(),
  };
}
