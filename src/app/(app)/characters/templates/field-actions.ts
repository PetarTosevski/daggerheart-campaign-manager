"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  buildTemplateObjectPath,
  findFieldSetError,
  TEMPLATE_STORAGE_BUCKET,
  type SheetFieldDefinition,
} from "@/lib/domain/sheet-templates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import {
  publishTemplateVersionSchema,
  reviseTemplateVersionSchema,
  saveTemplateFieldsSchema,
} from "@/lib/validation/sheet-template-fields";

export type FieldEditorActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  /** Set when a revision is created so the client can navigate to it. */
  newVersionId?: string;
  /** Bumped on each result so client effects re-run on repeated saves. */
  token?: string;
};

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

function publicFieldError(message: string): string {
  const known = [
    "Template version not found or access denied.",
    "Published layouts cannot be edited; create a revision.",
    "Only a published version can be revised.",
    "The storage path is invalid.",
    "This version is already published.",
  ];
  return (
    known.find((k) => message.includes(k)) ??
    "The layout could not be saved. Nothing was changed; please try again."
  );
}

export async function saveTemplateFieldsAction(
  _previousState: FieldEditorActionState,
  formData: FormData,
): Promise<FieldEditorActionState> {
  let rawFields: unknown;
  try {
    rawFields = JSON.parse(String(formData.get("fields") ?? "[]"));
  } catch {
    return { status: "error", message: "The field data was malformed.", token: randomUUID() };
  }

  const parsed = saveTemplateFieldsSchema.safeParse({
    templateVersionId: String(formData.get("templateVersionId") ?? ""),
    fields: rawFields,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted fields.",
      token: randomUUID(),
    };
  }

  const pageCount = Number(formData.get("pageCount") ?? 0);
  const setError = findFieldSetError(
    parsed.data.fields as SheetFieldDefinition[],
    Number.isFinite(pageCount) && pageCount > 0 ? pageCount : Number.MAX_SAFE_INTEGER,
  );
  if (setError) {
    return { status: "error", message: setError, token: randomUUID() };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again.", token: randomUUID() };
  }

  const { error } = await supabase.rpc("save_sheet_template_fields", {
    p_template_version_id: parsed.data.templateVersionId,
    p_fields: parsed.data.fields as unknown as Json,
  });

  if (error) {
    return { status: "error", message: publicFieldError(error.message), token: randomUUID() };
  }

  revalidatePath(`/characters/templates`);
  return {
    status: "success",
    message: `Saved ${parsed.data.fields.filter((f) => f.is_active).length} field(s).`,
    token: randomUUID(),
  };
}

export async function publishTemplateVersionAction(
  _previousState: FieldEditorActionState,
  formData: FormData,
): Promise<FieldEditorActionState> {
  const parsed = publishTemplateVersionSchema.safeParse({
    templateVersionId: String(formData.get("templateVersionId") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", message: "Select a valid template version.", token: randomUUID() };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again.", token: randomUUID() };
  }

  const { data, error } = await supabase.rpc("publish_sheet_template_version", {
    p_template_version_id: parsed.data.templateVersionId,
  });

  if (error) {
    return { status: "error", message: publicFieldError(error.message), token: randomUUID() };
  }
  if (!data?.[0]) {
    return { status: "error", message: "The version could not be published.", token: randomUUID() };
  }

  revalidatePath(`/characters/templates`);
  return { status: "success", message: "Layout published.", token: randomUUID() };
}

export async function reviseTemplateVersionAction(
  _previousState: FieldEditorActionState,
  formData: FormData,
): Promise<FieldEditorActionState> {
  const parsed = reviseTemplateVersionSchema.safeParse({
    sourceVersionId: String(formData.get("sourceVersionId") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", message: "Select a valid template version.", token: randomUUID() };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Your session expired. Sign in again.", token: randomUUID() };
  }

  // Load the source version to build the new immutable object path and to copy
  // the PDF (scoped to the owner by RLS).
  const { data: source, error: sourceError } = await supabase
    .from("sheet_template_versions")
    .select("id, campaign_id, template_id, source_object_path, layout_status")
    .eq("id", parsed.data.sourceVersionId)
    .maybeSingle();

  if (sourceError || !source) {
    return { status: "error", message: "Template version not found or access denied.", token: randomUUID() };
  }
  if (source.layout_status !== "published") {
    return { status: "error", message: "Only a published version can be revised.", token: randomUUID() };
  }

  const newVersionId = randomUUID();
  const newPath = buildTemplateObjectPath(
    source.campaign_id,
    source.template_id,
    newVersionId,
  );

  // Copy the immutable PDF object to the new version's path.
  const { error: copyError } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .copy(source.source_object_path, newPath);

  if (copyError) {
    return { status: "error", message: "The PDF could not be copied for the revision.", token: randomUUID() };
  }

  const { data, error } = await supabase.rpc("create_sheet_template_revision", {
    p_source_version_id: parsed.data.sourceVersionId,
    p_new_version_id: newVersionId,
    p_new_object_path: newPath,
  });

  if (error || !data?.[0]) {
    // Roll back the copied object so a failed revision leaves no orphan.
    await supabase.storage.from(TEMPLATE_STORAGE_BUCKET).remove([newPath]);
    return {
      status: "error",
      message: error ? publicFieldError(error.message) : "The revision could not be created.",
      token: randomUUID(),
    };
  }

  revalidatePath(`/characters/templates`);
  revalidatePath(`/characters/templates/${source.template_id}`);
  return {
    status: "success",
    message: "Created a new draft revision.",
    newVersionId,
    token: randomUUID(),
  };
}
