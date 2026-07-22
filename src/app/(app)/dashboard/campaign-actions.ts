"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCampaignSchema } from "@/lib/validation/campaigns";

export type CreateCampaignState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function createCampaignAction(
  _previousState: CreateCampaignState,
  formData: FormData,
): Promise<CreateCampaignState> {
  const input = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  };

  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the submitted values.",
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
      message: "Your session expired. Sign in again before creating a campaign.",
    };
  }

  // Insert through the caller's RLS-scoped client. The `campaigns_insert_own`
  // policy enforces owner_id = auth.uid(), and the create_initial_campaign_state
  // trigger atomically seeds the canonical starting state (Week 1, DAY, cycle
  // day 1, Fear 0). No service-role credentials are involved.
  const { error } = await supabase.from("campaigns").insert({
    owner_id: user.id,
    name: parsed.data.name,
    description: parsed.data.description === "" ? null : parsed.data.description,
  });

  if (error) {
    // 23505 = unique_violation: the owner already has a campaign with this name.
    if (error.code === "23505") {
      return {
        status: "error",
        message: "You already have a campaign with that name.",
        fieldErrors: { name: ["You already have a campaign with that name."] },
      };
    }
    return {
      status: "error",
      message:
        "The campaign could not be created. Nothing was changed; please try again.",
    };
  }

  // The client performs a full reload on success, which re-renders the dashboard
  // with the campaign controls and persistent timeline. A full reload (rather
  // than redirecting to the same route) avoids the App Router client cache
  // serving the stale empty state.
  return { status: "success", message: "Campaign created." };
}
