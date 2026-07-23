"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  pinCharacterSheetVersionSchema,
  saveCharacterSheetValueSchema,
} from "@/lib/validation/character-sheet";

export type SaveValueResult =
  | { status: "saved"; value: string | null; updatedAt: string }
  | { status: "conflict" }
  | { status: "error"; message: string };

export type PinVersionResult =
  | { status: "success" }
  | { status: "error"; message: string };

function publicSheetError(message: string): string {
  const known = [
    "Character not found or access denied.",
    "Character has no pinned template version.",
    "Field not found in this campaign.",
    "Field does not belong to the character's pinned version.",
    "Field is not active.",
    "Computed and read-only fields cannot be edited.",
    "Value must be a number.",
    "Value is below the allowed minimum.",
    "Value is above the allowed maximum.",
    "Checkbox value must be true or false.",
    "Value is not an allowed option.",
    "Value is too long.",
  ];
  return (
    known.find((k) => message.includes(k)) ??
    "The value could not be saved. Please try again."
  );
}

async function authedClient() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { authenticated: !error && Boolean(user), supabase };
}

export async function saveCharacterSheetValueAction(input: {
  characterId: string;
  templateFieldId: string;
  value: string;
  expectedUpdatedAt: string;
}): Promise<SaveValueResult> {
  const parsed = saveCharacterSheetValueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid value.",
    };
  }

  const { authenticated, supabase } = await authedClient();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again." };
  }

  const { data, error } = await supabase.rpc("save_character_sheet_value", {
    p_character_id: parsed.data.characterId,
    p_template_field_id: parsed.data.templateFieldId,
    p_value: parsed.data.value,
    p_expected_updated_at: parsed.data.expectedUpdatedAt || null,
  });

  if (error) {
    // 40001 = the optimistic-concurrency guard rejected a stale write.
    if (
      error.code === "40001" ||
      error.message.includes("changed since you last loaded")
    ) {
      return { status: "conflict" };
    }
    return { status: "error", message: publicSheetError(error.message) };
  }

  const row = data?.[0];
  if (!row) {
    return { status: "error", message: "The value could not be saved." };
  }
  return { status: "saved", value: row.returned_value, updatedAt: row.returned_updated_at };
}

export async function pinCharacterSheetVersionAction(input: {
  characterId: string;
}): Promise<PinVersionResult> {
  const parsed = pinCharacterSheetVersionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Select a valid character." };
  }

  const { authenticated, supabase } = await authedClient();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again." };
  }

  const { data, error } = await supabase.rpc("pin_character_sheet_version", {
    p_character_id: parsed.data.characterId,
  });

  if (error) {
    const known = [
      "Character is already pinned to a version.",
      "Character has no template assigned.",
      "The template has no active version.",
      "The template has no published version to assign.",
      "Character not found or access denied.",
    ];
    return {
      status: "error",
      message:
        known.find((k) => error.message.includes(k)) ??
        "The template version could not be assigned.",
    };
  }
  if (!data?.[0]) {
    return { status: "error", message: "The template version could not be assigned." };
  }
  return { status: "success" };
}
