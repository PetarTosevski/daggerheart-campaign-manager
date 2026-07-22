import { Suspense } from "react";
import { redirect } from "next/navigation";

import {
  CampaignTimeline,
  CampaignTimelineEmpty,
  CampaignTimelineFallback,
} from "@/components/campaign-timeline/campaign-timeline";
import { GlobalHeader } from "@/components/layout/global-header";
import { PrimaryNavigation } from "@/components/layout/primary-navigation";
import { getCampaignTimelineState } from "@/lib/data/campaign-time";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Async server component that loads canonical campaign time and renders the
 * persistent timeline. Isolated behind its own Suspense boundary so the shell
 * chrome mounts immediately and the timeline streams in without a fabricated
 * loading state.
 */
async function PersistentCampaignTimeline() {
  const supabase = await createSupabaseServerClient();
  const state = await getCampaignTimelineState(supabase);

  if (!state) {
    return <CampaignTimelineEmpty />;
  }

  return (
    <CampaignTimeline current={state.current} campaignName={state.campaignName} />
  );
}

/**
 * Authenticated application shell. Verifies the Supabase session on the server
 * and mounts the persistent primary navigation and campaign timeline once. The
 * shell is preserved across route navigation, so changing routes never
 * recreates it or the timeline.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  let hasUser = false;
  let userEmail: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    hasUser = Boolean(user);
    userEmail = user?.email ?? null;
  } catch {
    hasUser = false;
  }

  if (!hasUser) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PrimaryNavigation userEmail={userEmail} />
      <GlobalHeader>
        <Suspense fallback={<CampaignTimelineFallback />}>
          <PersistentCampaignTimeline />
        </Suspense>
      </GlobalHeader>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
