"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { BackLink, Wordmark } from "@/components/brand/brand";
import { frameName } from "@/lib/campaign-display";
import { frameHasMechanic } from "@/lib/frames";
import { brandButton } from "@/components/brand/buttons";
import { campaignArt } from "@/lib/campaign-art";
import { CAMPAIGN_SECTIONS } from "@/lib/campaign-sections";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../convex/campaigns";
import { TimeArc } from "./time-arc";

const CampaignContext = createContext<CampaignSummary | null>(null);

export function useCampaign(): CampaignSummary {
  const campaign = useContext(CampaignContext);
  if (!campaign) throw new Error("useCampaign must be used inside CampaignShell");
  return campaign;
}

function CampaignNav({ campaignId }: { campaignId: string }) {
  const pathname = usePathname();
  const base = `/campaigns/${campaignId}`;
  return (
    <nav aria-label="Campaign sections" className="flex flex-wrap gap-1 rounded-xl bg-black/35 p-1">
      {CAMPAIGN_SECTIONS.map((section) => {
        const href = section.slug ? `${base}/${section.slug}` : base;
        const current = pathname === href;
        return (
          <Link
            key={section.label}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-lg px-3.5 text-[14px]",
              current ? "bg-brand text-brand-ink" : "text-[#e6ecea] hover:bg-white/10",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Title block of the dashboard header ("ACTIVE CAMPAIGN · THE WITHERWILD"). */
function DashboardHero({ campaign }: { campaign: CampaignSummary }) {
  return (
    <div className="relative mx-auto flex max-w-[1344px] flex-col gap-9 px-4 pt-2 pb-8 sm:px-12">
      {frameHasMechanic(campaign.frameId, "campaignTime") ? <TimeArc campaignId={campaign._id} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[13px] tracking-[0.3em] text-[#c9d2cf] uppercase">
          Active campaign · {frameName(campaign.frameId)}
        </span>
        <h1 className="m-0 font-display text-[40px] leading-[1.05] font-bold tracking-[0.02em] text-parchment sm:text-[56px]">
          {campaign.name}
        </h1>
        <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-[#c9d2cf]">
          <span>No sessions yet</span>
          <span aria-hidden="true">·</span>
          <span>
            Tier {campaign.tier} · Level {campaign.level}
          </span>
        </p>
      </div>
      </div>
    </div>
  );
}

/** Shared campaign chrome from the dashboard boards: art header and section nav. */
export function CampaignShell({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const markOpened = useMutation(api.campaigns.markOpened);
  const pathname = usePathname();

  const foundId = campaign ? campaign._id : null;
  useEffect(() => {
    if (foundId) void markOpened({ campaignId: foundId }).catch(() => undefined);
  }, [foundId, markOpened]);

  if (campaign === undefined) {
    return <main className="min-h-screen bg-[#0d1417] p-12 text-muted-text">Loading campaign…</main>;
  }
  if (campaign === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#0d1417] p-6 text-center text-parchment">
        <h1 className="font-display text-[32px] font-bold">Campaign not found</h1>
        <p className="text-muted-text">It may have been deleted.</p>
        <Link href="/campaigns" className={brandButton({ variant: "solid", size: "lg" })}>
          Load a campaign
        </Link>
      </main>
    );
  }

  const art = campaignArt(campaign.frameId, campaign.custom?.background);

  return (
    <CampaignContext.Provider value={campaign}>
      <div className="relative min-h-screen overflow-hidden bg-[#0d1417] font-sans text-[#e6ecea]">
        <section aria-label="Campaign header" className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-no-repeat"
            style={{ backgroundImage: art.image, backgroundPosition: art.position }}
          />
          <div aria-hidden="true" className="absolute inset-0 bg-[rgb(6_12_14/0.62)]" />
          <div className="relative mx-auto flex max-w-[1344px] flex-wrap items-center justify-between gap-4 px-4 pt-[22px] pb-6 sm:px-12">
            <div className="flex flex-wrap items-center gap-[18px]">
              <BackLink href="/" label="Back to main menu" className="border-white/25 bg-black/30" />
              <Wordmark className="text-[26px] sm:text-[32px]" />
            </div>
            <CampaignNav campaignId={campaign._id} />
          </div>
          {pathname === `/campaigns/${campaign._id}` ? <DashboardHero campaign={campaign} /> : null}
        </section>
        {children}
      </div>
    </CampaignContext.Provider>
  );
}
