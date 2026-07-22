import { randomUUID } from "node:crypto";

import { ShieldCheck } from "lucide-react";

import { CampaignCreateForm } from "@/components/campaign/campaign-create-form";
import { CampaignTimeTracker } from "@/components/campaign-time/campaign-time-tracker";
import { CountdownTracker } from "@/components/countdowns/countdown-tracker";
import { FearTracker } from "@/components/fear/fear-tracker";
import { Badge } from "@/components/ui/badge";
import { getCampaignTimeData } from "@/lib/data/campaign-time";
import { getCountdownTrackerData } from "@/lib/data/countdowns";
import { getFearTrackerData } from "@/lib/data/fear";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const tracker = await getFearTrackerData(supabase);
  const [campaignTime, countdowns] = tracker
    ? await Promise.all([
        getCampaignTimeData(supabase, tracker.campaign.id),
        getCountdownTrackerData(supabase, tracker.campaign.id),
      ])
    : [null, null];

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />

      <div className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-emerald-700/20 bg-emerald-50 text-emerald-800"
              >
                <ShieldCheck className="size-3" />
                GM workspace
              </Badge>
            </div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
              Campaign control
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
              Track campaign time, Fear, and developing countdowns with
              complete audit trails.
            </p>
          </div>
          {tracker ? (
            <div className="sm:text-right">
              <p className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
                Active campaign
              </p>
              <p className="mt-1 font-medium text-stone-900">
                {tracker.campaign.name}
              </p>
            </div>
          ) : null}
        </div>

        {tracker ? (
          <>
            {campaignTime ? (
              <CampaignTimeTracker
                campaignId={tracker.campaign.id}
                initialIdempotencyKey={randomUUID()}
                data={campaignTime}
              />
            ) : null}
            <div className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
              <FearTracker
                campaignId={tracker.campaign.id}
                currentFear={tracker.currentFear}
                initialIdempotencyKey={randomUUID()}
                history={tracker.history}
              />
            </div>
            {countdowns ? (
              <CountdownTracker
                campaignId={tracker.campaign.id}
                data={countdowns}
              />
            ) : null}
          </>
        ) : (
          <CampaignCreateForm />
        )}
      </div>
    </main>
  );
}
