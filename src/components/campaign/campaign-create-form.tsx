"use client";

import { useActionState, useEffect } from "react";
import { LoaderCircle, Sprout, TriangleAlert } from "lucide-react";

import {
  createCampaignAction,
  type CreateCampaignState,
} from "@/app/(app)/dashboard/campaign-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { CAMPAIGN_DESCRIPTION_MAX_LENGTH } from "@/lib/validation/campaigns";

const initialState: CreateCampaignState = { status: "idle" };
const fieldClassName =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Empty-state control shown to an authenticated GM who owns no campaign yet.
 * Creating a campaign here is the supported way to initialize a fresh (or
 * freshly reset) environment; nothing is created merely by viewing the page.
 */
export function CampaignCreateForm() {
  const hydrated = useHydrated();
  const [state, formAction, pending] = useActionState(
    createCampaignAction,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") {
      // Reload so the dashboard reliably re-renders with the new campaign's
      // controls and the persistent timeline. router.refresh() did not reliably
      // reflect the same-route mutation in production, so we do a full reload.
      window.location.reload();
    }
  }, [state]);

  return (
    <Card className="mx-auto max-w-2xl border-stone-200 bg-white/85 shadow-xl shadow-stone-900/5">
      <CardHeader>
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
          <Sprout className="size-6" />
        </div>
        <CardTitle className="mt-2 text-center text-xl">
          No campaigns yet
        </CardTitle>
        <CardDescription className="text-center">
          Create your first campaign to begin managing your Witherwild campaign.
          It starts at Week 1, Day cycle, with Fear 0.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="campaign-name"
              className="text-sm font-medium text-stone-800"
            >
              Campaign name
            </label>
            <input
              id="campaign-name"
              name="name"
              required
              maxLength={100}
              disabled={pending}
              className={fieldClassName}
              placeholder="The Witherwild"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
            {state.fieldErrors?.name?.[0] ? (
              <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="campaign-description"
              className="text-sm font-medium text-stone-800"
            >
              Description{" "}
              <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <Textarea
              id="campaign-description"
              name="description"
              maxLength={CAMPAIGN_DESCRIPTION_MAX_LENGTH}
              disabled={pending}
              className="min-h-20 border-stone-300 bg-white text-stone-900"
              placeholder="A short note about this campaign."
            />
          </div>

          {state.status === "error" ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{state.message}</span>
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={!hydrated || pending}
            className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Sprout />}
            {pending ? "Creating…" : "Create campaign"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
