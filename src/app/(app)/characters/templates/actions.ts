"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  buildTemplateObjectPath,
  MAX_PDF_SIZE_BYTES,
  PDF_MIME_TYPE,
  TEMPLATE_STORAGE_BUCKET,
} from "@/lib/domain/sheet-templates";
import { PdfValidationError, validatePdfUpload } from "@/lib/pdf/validate";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  archiveTemplateVersionSchema,
  uploadTemplateVersionSchema,
} from "@/lib/validation/sheet-templates";

export type TemplateVersionActionState = {
  status: "idle" | "success" | "error";
  message?: string;
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

function publicVersionError(message: string): string {
  const known = [
    "Template not found or access denied.",
    "Version not found or access denied.",
    "The template is not active.",
    "The PDF size is invalid.",
    "The PDF page count is invalid.",
    "The storage path is invalid.",
  ];
  return (
    known.find((k) => message.includes(k)) ??
    "The upload could not be saved. Nothing was changed; please try again."
  );
}

export async function uploadTemplateVersionAction(
  _previousState: TemplateVersionActionState,
  formData: FormData,
): Promise<TemplateVersionActionState> {
  const parsed = uploadTemplateVersionSchema.safeParse({
    templateId: String(formData.get("templateId") ?? ""),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a PDF file to upload." };
  }
  if (file.size > MAX_PDF_SIZE_BYTES) {
    return { status: "error", message: "The PDF exceeds the 25 MB limit." };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before uploading.",
    };
  }

  // Resolve the template's campaign server-side (RLS scopes this to the owner)
  // rather than trusting a client-supplied campaign id.
  const { data: template, error: templateError } = await supabase
    .from("sheet_templates")
    .select("id, campaign_id, status")
    .eq("id", parsed.data.templateId)
    .maybeSingle();

  if (templateError) {
    return { status: "error", message: "Unable to load the template." };
  }
  if (!template) {
    return { status: "error", message: "Template not found or access denied." };
  }
  if (template.status !== "active") {
    return { status: "error", message: "The template is not active." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let validated;
  try {
    validated = await validatePdfUpload({ bytes, mimeType: file.type });
  } catch (error) {
    if (error instanceof PdfValidationError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "The PDF could not be validated." };
  }

  const versionId = randomUUID();
  const objectPath = buildTemplateObjectPath(
    template.campaign_id,
    template.id,
    versionId,
  );

  // Immutable upload: a new version always writes a new path; existing objects
  // are never overwritten (upsert disabled, and storage has no update policy).
  const { error: uploadError } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .upload(objectPath, bytes, {
      contentType: PDF_MIME_TYPE,
      upsert: false,
    });

  if (uploadError) {
    return {
      status: "error",
      message: "The PDF could not be stored. Please try again.",
    };
  }

  const { error: rpcError } = await supabase.rpc(
    "create_sheet_template_version",
    {
      p_template_id: template.id,
      p_version_id: versionId,
      p_source_object_path: objectPath,
      p_original_filename: file.name || "source.pdf",
      p_size_bytes: validated.size,
      p_checksum: validated.checksum,
      p_page_count: validated.pageCount,
    },
  );

  if (rpcError) {
    // Roll back the orphaned object so a failed insert leaves no stray upload.
    await supabase.storage.from(TEMPLATE_STORAGE_BUCKET).remove([objectPath]);
    return { status: "error", message: publicVersionError(rpcError.message) };
  }

  revalidatePath("/characters/templates");
  revalidatePath(`/characters/templates/${template.id}`);

  return {
    status: "success",
    message: `Uploaded ${validated.pageCount}-page PDF as a new version.`,
  };
}

export async function archiveTemplateVersionAction(
  _previousState: TemplateVersionActionState,
  formData: FormData,
): Promise<TemplateVersionActionState> {
  const parsed = archiveTemplateVersionSchema.safeParse({
    versionId: String(formData.get("versionId") ?? ""),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
    };
  }

  const { authenticated, supabase } = await requireAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Your session expired. Sign in again before archiving.",
    };
  }

  const { data, error } = await supabase.rpc(
    "archive_sheet_template_version",
    { p_version_id: parsed.data.versionId },
  );

  if (error) {
    return { status: "error", message: publicVersionError(error.message) };
  }

  const result = data?.[0];
  if (!result) {
    return {
      status: "error",
      message: "The version could not be archived. Please try again.",
    };
  }

  revalidatePath("/characters/templates");
  revalidatePath(`/characters/templates/${result.returned_template_id}`);

  return { status: "success", message: "Version archived." };
}
