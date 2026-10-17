"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Users } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { BackLink, Wordmark } from "@/components/brand/brand";
import { frameName } from "@/lib/campaign-display";
import { frameHasMechanic } from "@/lib/frames";
import { brandButton } from "@/components/brand/buttons";
import { campaignArt } from "@/lib/campaign-art";
import { CAMPAIGN_SECTIONS } from "@/lib/campaign-sections";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../convex/campaigns";
import type { TomeChapterId } from "@/lib/frames/tomes";

import { CampaignTome } from "./campaign-tome";
import { PlayersDialog } from "./players-dialog";
import { TimeArc } from "./time-arc";

type CampaignContextValue = { campaign: CampaignSummary; openTome: (chapter: TomeChapterId) => void };

const CampaignContext = createContext<CampaignContextValue | null>(null);

function useCampaignContext(): CampaignContextValue {
  const value = useContext(CampaignContext);
  if (!value) throw new Error("useCampaign must be used inside CampaignShell");
  return value;
}

export function useCampaign(): CampaignSummary {
  return useCampaignContext().campaign;
}

/** Opens the campaign's tome at a chapter. */
export function useOpenTome(): (chapter: TomeChapterId) => void {
  return useCampaignContext().openTome;
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
function DashboardHero({ campaign, onOpenTome }: { campaign: CampaignSummary; onOpenTome: () => void }) {
  return (
    <div className="relative mx-auto flex max-w-[1344px] flex-col gap-9 px-4 pt-2 pb-8 sm:px-12">
      {frameHasMechanic(campaign.frameId, "campaignTime") ? (
        <TimeArc campaignId={campaign._id} readOnly={campaign.role !== "gm"} />
      ) : null}
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
      <button
        type="button"
        onClick={onOpenTome}
        className="inline-flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-full border border-white/30 bg-black/35 px-[22px] text-[15px] text-parchment hover:bg-black/50"
      >
        <BookOpen className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
        Open the Tome
      </button>
      </div>
    </div>
  );
}

/** Shared campaign chrome from the dashboard boards: art header and section nav. */
export function CampaignShell({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const markOpened = useMutation(api.campaigns.markOpened);
  const pathname = usePathname();
  const [playersOpen, setPlayersOpen] = useState(false);
  const [tomeChapter, setTomeChapter] = useState<TomeChapterId | null>(null);
  const contextValue = useMemo(() => (campaign ? { campaign, openTome: setTomeChapter } : null), [campaign]);

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
    <CampaignContext.Provider value={contextValue}>
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
            <div className="flex flex-wrap items-center gap-2">
              <CampaignNav campaignId={campaign._id} />
              {campaign.role === "gm" ? (
                <button
                  type="button"
                  onClick={() => setPlayersOpen(true)}
                  aria-haspopup="dialog"
                  className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-black/35 px-3.5 text-[14px] text-[#e6ecea] hover:bg-black/50"
                >
                  <Users className="size-4" aria-hidden="true" />
                  Players
                </button>
              ) : (
                <span className="inline-flex min-h-12 items-center rounded-xl bg-black/35 px-3.5 text-[13px] tracking-[0.16em] text-fear uppercase">
                  Player
                </span>
              )}
            </div>
          </div>
          {pathname === `/campaigns/${campaign._id}` ? (
            <DashboardHero campaign={campaign} onOpenTome={() => setTomeChapter("overview")} />
          ) : null}
        </section>
        {children}
        <CampaignTome
          campaign={campaign}
          chapter={tomeChapter}
          onChapter={setTomeChapter}
          onClose={() => setTomeChapter(null)}
        />
        {campaign.role === "gm" ? (
          <PlayersDialog campaignId={campaign._id} open={playersOpen} onClose={() => setPlayersOpen(false)} />
        ) : null}
      </div>
    </CampaignContext.Provider>
  );
}
