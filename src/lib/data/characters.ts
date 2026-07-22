import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import type { Database, Tables } from "@/lib/supabase/database.types";

export type CampaignRef = {
  id: string;
  name: string;
};

export type CharacterClassOption = Pick<
  Tables<"character_classes">,
  "id" | "name" | "description" | "default_template_id" | "is_active"
>;

export type SheetTemplateOption = Pick<
  Tables<"sheet_templates">,
  "id" | "name" | "class_id" | "is_blank_template" | "status"
>;

export type CharacterListItem = Pick<
  Tables<"characters">,
  "id" | "name" | "status" | "created_at"
> & {
  className: string | null;
  templateName: string | null;
};

export type CharactersListData = {
  campaign: CampaignRef;
  characters: CharacterListItem[];
};

export type CharacterBuilderData = {
  campaign: CampaignRef;
  classes: CharacterClassOption[];
  templates: SheetTemplateOption[];
};

export type CharacterWorkspaceData = {
  campaign: CampaignRef;
  character: Pick<
    Tables<"characters">,
    "id" | "name" | "status" | "notes" | "created_at" | "updated_at"
  >;
  class: Pick<Tables<"character_classes">, "id" | "name" | "description"> | null;
  template: Pick<
    Tables<"sheet_templates">,
    "id" | "name" | "is_blank_template" | "status"
  > | null;
};

/**
 * Resolves the single active campaign the GM operates. Mirrors the selection
 * used by the Fear and countdown data modules so every workspace reads the same
 * campaign. Returns null when no active campaign exists.
 */
export async function getActiveCampaign(
  supabase: SupabaseClient<Database>,
): Promise<CampaignRef | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load the campaign.");
  }

  return data ?? null;
}

export async function getCharactersListData(
  supabase: SupabaseClient<Database>,
): Promise<CharactersListData | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) {
    return null;
  }

  const [charactersResult, classesResult, templatesResult] = await Promise.all([
    supabase
      .from("characters")
      .select("id, name, status, created_at, class_id, sheet_template_id")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("character_classes")
      .select("id, name")
      .eq("campaign_id", campaign.id),
    supabase
      .from("sheet_templates")
      .select("id, name")
      .eq("campaign_id", campaign.id),
  ]);

  if (charactersResult.error || classesResult.error || templatesResult.error) {
    throw new Error("Unable to load campaign characters.");
  }

  const classNames = new Map(
    (classesResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const templateNames = new Map(
    (templatesResult.data ?? []).map((row) => [row.id, row.name]),
  );

  const characters: CharacterListItem[] = (charactersResult.data ?? []).map(
    (row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      created_at: row.created_at,
      className: row.class_id ? (classNames.get(row.class_id) ?? null) : null,
      templateName: row.sheet_template_id
        ? (templateNames.get(row.sheet_template_id) ?? null)
        : null,
    }),
  );

  return { campaign, characters };
}

export async function getCharacterBuilderData(
  supabase: SupabaseClient<Database>,
): Promise<CharacterBuilderData | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) {
    return null;
  }

  const [classesResult, templatesResult] = await Promise.all([
    supabase
      .from("character_classes")
      .select("id, name, description, default_template_id, is_active")
      .eq("campaign_id", campaign.id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("sheet_templates")
      .select("id, name, class_id, is_blank_template, status")
      .eq("campaign_id", campaign.id)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (classesResult.error || templatesResult.error) {
    throw new Error("Unable to load the character builder.");
  }

  return {
    campaign,
    classes: classesResult.data ?? [],
    templates: templatesResult.data ?? [],
  };
}

/**
 * Loads one character's workspace data. Returns null for an unknown or
 * inaccessible id (RLS scopes reads to the owner's campaign), which callers
 * translate into a safe not-found response.
 */
export async function getCharacterWorkspaceData(
  supabase: SupabaseClient<Database>,
  characterId: string,
): Promise<CharacterWorkspaceData | null> {
  noStore();

  const campaign = await getActiveCampaign(supabase);
  if (!campaign) {
    return null;
  }

  const { data: character, error } = await supabase
    .from("characters")
    .select(
      "id, name, status, notes, created_at, updated_at, class_id, sheet_template_id",
    )
    .eq("id", characterId)
    .eq("campaign_id", campaign.id)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load the character.");
  }

  if (!character) {
    return null;
  }

  const [classResult, templateResult] = await Promise.all([
    character.class_id
      ? supabase
          .from("character_classes")
          .select("id, name, description")
          .eq("id", character.class_id)
          .eq("campaign_id", campaign.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    character.sheet_template_id
      ? supabase
          .from("sheet_templates")
          .select("id, name, is_blank_template, status")
          .eq("id", character.sheet_template_id)
          .eq("campaign_id", campaign.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (classResult.error || templateResult.error) {
    throw new Error("Unable to load the character.");
  }

  return {
    campaign,
    character: {
      id: character.id,
      name: character.name,
      status: character.status,
      notes: character.notes,
      created_at: character.created_at,
      updated_at: character.updated_at,
    },
    class: classResult.data,
    template: templateResult.data,
  };
}
