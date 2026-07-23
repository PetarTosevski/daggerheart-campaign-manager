import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import { TEMPLATE_SIGNED_URL_TTL_SECONDS } from "@/lib/data/sheet-templates";
import { TEMPLATE_STORAGE_BUCKET } from "@/lib/domain/sheet-templates";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type RuntimeField = Pick<
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
  | "is_required"
>;

export type RuntimeValue = { value: string | null; updated_at: string };

export type CharacterSheetRuntimeData =
  | { state: "no-template"; characterId: string; characterName: string }
  | {
      state: "no-version";
      characterId: string;
      characterName: string;
      templateName: string | null;
      /** True when the template has a published active version to assign. */
      canAssign: boolean;
    }
  | {
      state: "ready";
      characterId: string;
      characterName: string;
      templateName: string | null;
      version: { id: string; version_number: number; page_count: number };
      signedUrl: string | null;
      fields: RuntimeField[];
      values: Record<string, RuntimeValue>;
    };

const RUNTIME_FIELD_COLUMNS =
  "id, field_key, label, field_type, page_number, x, y, width, height, configuration, is_required";

/**
 * Loads everything the Character Sheet runtime needs, scoped to the owner's
 * campaign by RLS. Returns a discriminated state so the UI can render the
 * no-template / no-pinned-version / ready cases explicitly. Returns null when the
 * character is unknown/inaccessible (caller renders a safe not-found).
 *
 * The character's PINNED version is always used — never the template's current
 * active version — so publishing a new version cannot change this character.
 */
export async function getCharacterSheetRuntimeData(
  supabase: SupabaseClient<Database>,
  characterId: string,
): Promise<CharacterSheetRuntimeData | null> {
  noStore();

  const { data: character, error } = await supabase
    .from("characters")
    .select(
      "id, name, campaign_id, sheet_template_id, sheet_template_version_id",
    )
    .eq("id", characterId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load the character sheet.");
  }
  if (!character) {
    return null;
  }

  if (!character.sheet_template_id) {
    return {
      state: "no-template",
      characterId: character.id,
      characterName: character.name,
    };
  }

  const { data: template, error: templateError } = await supabase
    .from("sheet_templates")
    .select("name, active_version_id")
    .eq("id", character.sheet_template_id)
    .maybeSingle();

  if (templateError) {
    throw new Error("Unable to load the character sheet.");
  }
  const templateName = template?.name ?? null;

  if (!character.sheet_template_version_id) {
    // Can we assign? Only when the template's active version is published.
    let canAssign = false;
    if (template?.active_version_id) {
      const { data: activeVersion } = await supabase
        .from("sheet_template_versions")
        .select("layout_status")
        .eq("id", template.active_version_id)
        .maybeSingle();
      canAssign = activeVersion?.layout_status === "published";
    }
    return {
      state: "no-version",
      characterId: character.id,
      characterName: character.name,
      templateName,
      canAssign,
    };
  }

  const [versionResult, fieldsResult, valuesResult] = await Promise.all([
    supabase
      .from("sheet_template_versions")
      .select("id, version_number, page_count, source_object_path")
      .eq("id", character.sheet_template_version_id)
      .maybeSingle(),
    supabase
      .from("sheet_template_fields")
      .select(RUNTIME_FIELD_COLUMNS)
      .eq("template_version_id", character.sheet_template_version_id)
      .eq("is_active", true)
      .order("page_number", { ascending: true })
      .order("display_order", { ascending: true }),
    supabase
      .from("character_sheet_values")
      .select("template_field_id, value, updated_at")
      .eq("character_id", character.id),
  ]);

  if (versionResult.error || fieldsResult.error || valuesResult.error) {
    throw new Error("Unable to load the character sheet.");
  }
  if (!versionResult.data) {
    // Pinned version row is gone (e.g., deleted); treat as needing reassignment.
    return {
      state: "no-version",
      characterId: character.id,
      characterName: character.name,
      templateName,
      canAssign: false,
    };
  }

  const { data: signed } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .createSignedUrl(
      versionResult.data.source_object_path,
      TEMPLATE_SIGNED_URL_TTL_SECONDS,
    );

  const values: Record<string, RuntimeValue> = {};
  for (const row of valuesResult.data ?? []) {
    values[row.template_field_id] = {
      value: row.value,
      updated_at: row.updated_at,
    };
  }

  return {
    state: "ready",
    characterId: character.id,
    characterName: character.name,
    templateName,
    version: {
      id: versionResult.data.id,
      version_number: versionResult.data.version_number,
      page_count: versionResult.data.page_count,
    },
    signedUrl: signed?.signedUrl ?? null,
    fields: fieldsResult.data ?? [],
    values,
  };
}
