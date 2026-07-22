import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import { getActiveCampaign, type CampaignRef } from "@/lib/data/characters";
import { TEMPLATE_STORAGE_BUCKET } from "@/lib/domain/sheet-templates";
import type { Database, Tables } from "@/lib/supabase/database.types";

/** Signed-URL lifetime for previewing a private template PDF (1 hour). */
export const TEMPLATE_SIGNED_URL_TTL_SECONDS = 3600;

export type TemplateVersionSummary = Pick<
  Tables<"sheet_template_versions">,
  | "id"
  | "version_number"
  | "original_filename"
  | "size_bytes"
  | "page_count"
  | "status"
  | "layout_status"
  | "created_at"
>;

export type SheetTemplateListItem = Pick<
  Tables<"sheet_templates">,
  "id" | "name" | "is_blank_template" | "status" | "active_version_id"
> & {
  className: string | null;
  activeVersion: TemplateVersionSummary | null;
  versionCount: number;
};

export type SheetTemplatesListData = {
  campaign: CampaignRef;
  templates: SheetTemplateListItem[];
};

export type SheetTemplateDetailData = {
  campaign: CampaignRef;
  template: Pick<
    Tables<"sheet_templates">,
    "id" | "name" | "is_blank_template" | "status" | "active_version_id"
  >;
  className: string | null;
  versions: TemplateVersionSummary[];
  activeVersion:
    | (TemplateVersionSummary & { signedUrl: string | null })
    | null;
};

const VERSION_COLUMNS =
  "id, version_number, original_filename, size_bytes, page_count, status, layout_status, created_at";

export async function getSheetTemplatesListData(
  supabase: SupabaseClient<Database>,
): Promise<SheetTemplatesListData | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) {
    return null;
  }

  const [templatesResult, classesResult, versionsResult] = await Promise.all([
    supabase
      .from("sheet_templates")
      .select("id, name, is_blank_template, status, active_version_id, class_id")
      .eq("campaign_id", campaign.id)
      .order("is_blank_template", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("character_classes")
      .select("id, name")
      .eq("campaign_id", campaign.id),
    supabase
      .from("sheet_template_versions")
      .select(`${VERSION_COLUMNS}, template_id`)
      .eq("campaign_id", campaign.id),
  ]);

  if (templatesResult.error || classesResult.error || versionsResult.error) {
    throw new Error("Unable to load sheet templates.");
  }

  const classNames = new Map(
    (classesResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const versions = versionsResult.data ?? [];
  const versionsById = new Map(versions.map((row) => [row.id, row]));
  const countByTemplate = new Map<string, number>();
  for (const version of versions) {
    countByTemplate.set(
      version.template_id,
      (countByTemplate.get(version.template_id) ?? 0) + 1,
    );
  }

  const templates: SheetTemplateListItem[] = (templatesResult.data ?? []).map(
    (row) => {
      const active = row.active_version_id
        ? (versionsById.get(row.active_version_id) ?? null)
        : null;
      return {
        id: row.id,
        name: row.name,
        is_blank_template: row.is_blank_template,
        status: row.status,
        active_version_id: row.active_version_id,
        className: row.class_id ? (classNames.get(row.class_id) ?? null) : null,
        activeVersion: active
          ? {
              id: active.id,
              version_number: active.version_number,
              original_filename: active.original_filename,
              size_bytes: active.size_bytes,
              page_count: active.page_count,
              status: active.status,
              layout_status: active.layout_status,
              created_at: active.created_at,
            }
          : null,
        versionCount: countByTemplate.get(row.id) ?? 0,
      };
    },
  );

  return { campaign, templates };
}

export async function getSheetTemplateDetailData(
  supabase: SupabaseClient<Database>,
  templateId: string,
): Promise<SheetTemplateDetailData | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) {
    return null;
  }

  const { data: template, error: templateError } = await supabase
    .from("sheet_templates")
    .select("id, name, is_blank_template, status, active_version_id, class_id")
    .eq("id", templateId)
    .eq("campaign_id", campaign.id)
    .maybeSingle();

  if (templateError) {
    throw new Error("Unable to load the sheet template.");
  }
  if (!template) {
    return null;
  }

  const [classResult, versionsResult] = await Promise.all([
    template.class_id
      ? supabase
          .from("character_classes")
          .select("name")
          .eq("id", template.class_id)
          .eq("campaign_id", campaign.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("sheet_template_versions")
      .select(`${VERSION_COLUMNS}, source_object_path`)
      .eq("campaign_id", campaign.id)
      .eq("template_id", templateId)
      .order("version_number", { ascending: false }),
  ]);

  if (classResult.error || versionsResult.error) {
    throw new Error("Unable to load the sheet template.");
  }

  const versions = versionsResult.data ?? [];
  const activeRow = template.active_version_id
    ? versions.find((row) => row.id === template.active_version_id)
    : undefined;

  let activeVersion: SheetTemplateDetailData["activeVersion"] = null;
  if (activeRow) {
    const { data: signed } = await supabase.storage
      .from(TEMPLATE_STORAGE_BUCKET)
      .createSignedUrl(activeRow.source_object_path, TEMPLATE_SIGNED_URL_TTL_SECONDS);
    activeVersion = {
      id: activeRow.id,
      version_number: activeRow.version_number,
      original_filename: activeRow.original_filename,
      size_bytes: activeRow.size_bytes,
      page_count: activeRow.page_count,
      status: activeRow.status,
      layout_status: activeRow.layout_status,
      created_at: activeRow.created_at,
      signedUrl: signed?.signedUrl ?? null,
    };
  }

  return {
    campaign,
    template: {
      id: template.id,
      name: template.name,
      is_blank_template: template.is_blank_template,
      status: template.status,
      active_version_id: template.active_version_id,
    },
    className: classResult.data?.name ?? null,
    versions: versions.map((row) => ({
      id: row.id,
      version_number: row.version_number,
      original_filename: row.original_filename,
      size_bytes: row.size_bytes,
      page_count: row.page_count,
      status: row.status,
      layout_status: row.layout_status,
      created_at: row.created_at,
    })),
    activeVersion,
  };
}

// ---------------------------------------------------------------------------
// Task 011B — Template field editor data
// ---------------------------------------------------------------------------

export type TemplateFieldRow = Pick<
  Tables<"sheet_template_fields">,
  | "id"
  | "field_key"
  | "label"
  | "field_type"
  | "page_number"
  | "x"
  | "y"
  | "width"
  | "height"
  | "configuration"
  | "display_order"
  | "is_required"
  | "is_active"
>;

export type TemplateEditorData = {
  campaign: CampaignRef;
  template: { id: string; name: string };
  version: Pick<
    Tables<"sheet_template_versions">,
    | "id"
    | "template_id"
    | "version_number"
    | "page_count"
    | "status"
    | "layout_status"
    | "published_at"
  >;
  fields: TemplateFieldRow[];
  signedUrl: string | null;
};

const FIELD_COLUMNS =
  "id, field_key, label, field_type, page_number, x, y, width, height, configuration, display_order, is_required, is_active";

/**
 * Loads a single template version and its field definitions for the editor,
 * scoped to the owner's active campaign and the given template. Returns null for
 * an unknown/inaccessible version so callers can respond with a safe not-found.
 */
export async function getTemplateEditorData(
  supabase: SupabaseClient<Database>,
  templateId: string,
  versionId: string,
): Promise<TemplateEditorData | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) {
    return null;
  }

  const { data: version, error: versionError } = await supabase
    .from("sheet_template_versions")
    .select(
      "id, template_id, version_number, page_count, status, layout_status, published_at, source_object_path",
    )
    .eq("id", versionId)
    .eq("template_id", templateId)
    .eq("campaign_id", campaign.id)
    .maybeSingle();

  if (versionError) {
    throw new Error("Unable to load the template version.");
  }
  if (!version) {
    return null;
  }

  const [templateResult, fieldsResult] = await Promise.all([
    supabase
      .from("sheet_templates")
      .select("id, name")
      .eq("id", templateId)
      .eq("campaign_id", campaign.id)
      .maybeSingle(),
    supabase
      .from("sheet_template_fields")
      .select(FIELD_COLUMNS)
      .eq("template_version_id", versionId)
      .eq("campaign_id", campaign.id)
      .order("page_number", { ascending: true })
      .order("display_order", { ascending: true }),
  ]);

  if (templateResult.error || fieldsResult.error || !templateResult.data) {
    throw new Error("Unable to load the template version.");
  }

  const { data: signed } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .createSignedUrl(version.source_object_path, TEMPLATE_SIGNED_URL_TTL_SECONDS);

  return {
    campaign,
    template: { id: templateResult.data.id, name: templateResult.data.name },
    version: {
      id: version.id,
      template_id: version.template_id,
      version_number: version.version_number,
      page_count: version.page_count,
      status: version.status,
      layout_status: version.layout_status,
      published_at: version.published_at,
    },
    fields: fieldsResult.data ?? [],
    signedUrl: signed?.signedUrl ?? null,
  };
}
