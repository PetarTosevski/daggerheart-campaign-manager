"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createCharacterSchema,
  updateCharacterSchema,
} from "@/lib/validation/characters";

export type CharacterActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

/**
 * Maps a database error message to a safe, user-facing message. Only known,
 * non-sensitive validation messages raised by the character functions are
 * surfaced verbatim; anything else collapses to a generic failure.
 */
function publicCharacterError(message: string): string {
  const knownMessages = [
    "Campaign not found or access denied.",
    "Character not found or access denied.",
    "Character name must contain between 1 and 100 characters.",
    "Select a class for the character.",
    "The selected class is unavailable for this campaign.",
    "The selected sheet template is unavailable for this campaign.",
    "Character status is not supported.",
  ];

  return (
    knownMessages.find((known) => message.includes(known)) ??
    "The character could not be saved. Nothing was changed; please try again."
  );
}

async function requireAuthenticatedClient(): Promise<{
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

export async function createCharacterAction(
  _previousState: CharacterActionState,
  formData: FormData,
): Promise<CharacterActionState> {
  const input = {
    campaignId: String(formData.get("campaignId") ?? ""),
    name: String(formData.get("name") ?? ""),
    classId: String(formData.get("classId") ?? ""),
    sheetTemplateId: String(formData.get("sheetTemplateId") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };

  const parsed = createCharacterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before creating a character.",
    };
  }

  const { data, error } = await supabase.rpc("create_character", {
    p_campaign_id: parsed.data.campaignId,
    p_name: parsed.data.name,
    p_class_id: parsed.data.classId,
    p_sheet_template_id: parsed.data.sheetTemplateId,
    p_notes: parsed.data.notes,
  });

  if (error) {
    return {
      status: "error",
      message: publicCharacterError(error.message),
    };
  }

  const created = data?.[0];
  if (!created) {
    return {
      status: "error",
      message: "The character could not be created. Please try again.",
    };
  }

  revalidatePath("/characters");
  // Create -> open the new character workspace. redirect() must stay outside any
  // try/catch: it signals navigation by throwing.
  redirect(`/characters/${created.character_id}`);
}

export async function updateCharacterAction(
  _previousState: CharacterActionState,
  formData: FormData,
): Promise<CharacterActionState> {
  const input = {
    characterId: String(formData.get("characterId") ?? ""),
    name: String(formData.get("name") ?? ""),
    status: String(formData.get("status") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };

  const parsed = updateCharacterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before saving changes.",
    };
  }

  const { data, error } = await supabase.rpc("update_character", {
    p_character_id: parsed.data.characterId,
    p_name: parsed.data.name,
    p_status: parsed.data.status,
    p_notes: parsed.data.notes,
  });

  if (error) {
    return {
      status: "error",
      message: publicCharacterError(error.message),
    };
  }

  const updated = data?.[0];
  if (!updated) {
    return {
      status: "error",
      message: "The character could not be saved. Please try again.",
    };
  }

  revalidatePath("/characters");
  revalidatePath(`/characters/${parsed.data.characterId}`);

  return {
    status: "success",
    message: "Changes saved.",
  };
}
