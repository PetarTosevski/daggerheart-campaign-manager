"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Users } from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { BackLink, Wordmark } from "@/components/brand/brand";
import { Modal } from "@/components/brand/modal";
import { SlotBoundary } from "@/components/party/session/boundary";
import { frameName } from "@/lib/campaign-display";
import { frameHasMechanic } from "@/lib/frames";
import { brandButton } from "@/components/brand/buttons";
import { campaignArt } from "@/lib/campaign-art";
import { formatSessionDate } from "@/lib/domain/sessions";
import { useIntent } from "@/lib/use-intent";
import { CAMPAIGN_SECTIONS, visibleToPlayers } from "@/lib/campaign-sections";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../convex/campaigns";
import type { TomeChapterId } from "@/lib/frames/tomes";

import { CampaignTome } from "./campaign-tome";
import { PlayersDialog } from "./players-dialog";
import { TimeArc } from "./time-arc";

/*
 * The shell's context is split by how often each part changes (PF7). `CampaignContext` holds the campaign summary,
 * which changes only when the campaign itself is edited (name, tome, options, players); `OpenTomeContext` holds a
 * setter that never changes. The live GM Fear is in neither: `useCampaignFear()` reads its own small query, so a
 * Fear click re-renders only the components that show Fear.
 */
const CampaignContext = createContext<CampaignSummary | null>(null);
const OpenTomeContext = createContext<((chapter: TomeChapterId) => void) | null>(null);

export function useCampaign(): CampaignSummary {
  const campaign = useContext(CampaignContext);
  if (!campaign) throw new Error("useCampaign must be used inside CampaignShell");
  return campaign;
}

/** Opens the campaign's tome at a chapter. */
export function useOpenTome(): (chapter: TomeChapterId) => void {
  const openTome = useContext(OpenTomeContext);
  if (!openTome) throw new Error("useOpenTome must be used inside CampaignShell");
  return openTome;
}

/** The campaign's live GM Fear (`campaigns.fear`; undefined while loading). Wrap the reader in an error boundary (CL1). */
export function useCampaignFear(): number | undefined {
  return useQuery(api.campaigns.fear, { campaignId: useCampaign()._id });
}

/**
 * Renders `children` with the live GM Fear once it has loaded (nothing before). Only this subtree re-renders on a Fear
 * change; put it inside the reader's error boundary.
 */
export function WithFear({ children }: { children: (fear: number) => ReactNode }) {
  const fear = useCampaignFear();
  return fear === undefined ? null : children(fear);
}

const CampaignNav = memo(function CampaignNav({ campaignId, isGm }: { campaignId: string; isGm: boolean }) {
  const pathname = usePathname();
  const base = `/campaigns/${campaignId}`;
  return (
    <nav aria-label="Campaign sections" className="flex flex-wrap gap-1 rounded-xl bg-black/35 p-1">
      {CAMPAIGN_SECTIONS.filter((section) => isGm || visibleToPlayers(section)).map((section) => {
        const href = section.slug ? `${base}/${section.slug}` : base;
        const current = pathname === href;
        return (
          <Link
            key={section.label}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-lg px-3.5 text-[14px]",
              current ? "bg-brand text-brand-ink" : "text-[#e6ecea] hover:bg-white/10",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
});

function TierLevel({ campaign }: { campaign: CampaignSummary }) {
  return (
    <span>
      Tier {campaign.tier} · Level {campaign.level}
    </span>
  );
}

/**
 * The hero line (D10 S7, B9; board CampaignHub l.137): 'Session N' (the live one, else the last played) or 'No sessions
 * yet', 'Tier · Level', and 'Next session <date>' in the viewer's locale or 'Next session not scheduled'. Every member.
 */
function HeroSessionLine({ campaign }: { campaign: CampaignSummary }) {
  const summary = useQuery(api.sessionWrap.dashboard, { campaignId: campaign._id });
  if (summary === undefined) {
    return (
      <>
        <span role="status">Loading sessions…</span>
        <span aria-hidden="true">·</span>
        <TierLevel campaign={campaign} />
      </>
    );
  }
  const next = summary.nextDate ? `Next session ${formatSessionDate(summary.nextDate, { weekday: false })}` : summary.nextSessionLine;
  return (
    <>
      <span data-testid="hero-session">{summary.dashboardNumber}</span>
      <span aria-hidden="true">·</span>
      <TierLevel campaign={campaign} />
      <span aria-hidden="true">·</span>
      <span data-testid="hero-next-session">{next}</span>
    </>
  );
}

const heroPill =
  "inline-flex min-h-[52px] cursor-pointer items-center rounded-full bg-brand px-[30px] font-display text-[16px] font-bold tracking-[0.1em] text-brand-ink hover:brightness-110 disabled:cursor-default disabled:opacity-60";

/**
 * GM: 'Start Session' (B8) starts the newest planned session, creating one when there is none, and opens it on Play;
 * while a session is live the pill reads 'Session N in progress' and opens it. Players see a chip while one is live.
 */
function HeroSessionAction({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const summary = useQuery(api.sessionWrap.dashboard, { campaignId });
  const start = useIntent(api.sessions.start);
  const router = useRouter();
  // A confirm before starting (user 2026-10-20), as the Sessions tab's live card has.
  const [confirm, setConfirm] = useState(false);
  if (summary === undefined) return null;
  const sessions = `/campaigns/${campaignId}/sessions`;
  const play = (sessionId: string) => `${sessions}?s=${sessionId}&stage=play`;

  if (summary.live) {
    const label = `Session ${summary.live.n} in progress`;
    return isGm ? (
      <Link href={play(summary.live.sessionId)} className={heroPill}>
        {label}
      </Link>
    ) : (
      <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#3f6a4a] bg-black/45 px-4 text-[14px] text-[#d8f0e0]">
        <span aria-hidden="true" className="size-2 rounded-full bg-[#56e0a8] shadow-[0_0_8px_#3fd39a]" />
        {label}
      </span>
    );
  }
  if (!isGm) return null;

  async function startSession() {
    setConfirm(false);
    const result = await start.fire({ campaignId });
    // Without a sessionId the server found one already live (alreadyStarted); the Sessions tab shows it.
    if (result) router.push(result.sessionId ? play(result.sessionId) : sessions);
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" className={heroPill} disabled={start.pending} onClick={() => setConfirm(true)}>
        Start Session
      </button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Start the session?" className="max-w-[480px]">
        <p className="m-0 text-[16px] text-[#c9d2cf]">
          The next planned session starts (a new one if none is planned) and start-of-session features (such as Prayer Dice) are given out.
        </p>
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            className="min-h-11 cursor-pointer rounded-[10px] border border-[#33444a] bg-transparent px-4 text-[14px] text-[#e6ecea] hover:bg-white/5"
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="min-h-11 cursor-pointer rounded-full border border-[#2f7a4f] bg-[#1f5236] px-5 text-[14px] font-semibold text-[#e6fff0] hover:bg-[#256342]"
            onClick={() => void startSession()}
          >
            Start session
          </button>
        </div>
      </Modal>
      {start.error ? (
        <span role="alert" className="text-[14px] text-[#f0a8a0]">
          {start.error}
        </span>
      ) : null}
    </span>
  );
}

/** Title block of the dashboard header ("ACTIVE CAMPAIGN · THE WITHERWILD"). Memoized: it re-renders only with the campaign. */
const DashboardHero = memo(function DashboardHero({ campaign, onOpenTome }: { campaign: CampaignSummary; onOpenTome: () => void }) {
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
          <SlotBoundary fallback={<TierLevel campaign={campaign} />}>
            <HeroSessionLine campaign={campaign} />
          </SlotBoundary>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onOpenTome}
        className="inline-flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-full border border-white/30 bg-black/35 px-[22px] text-[15px] text-parchment hover:bg-black/50"
      >
        <BookOpen className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
        Open the Tome
      </button>
      <SlotBoundary fallback={null}>
        <HeroSessionAction campaignId={campaign._id} isGm={campaign.role === "gm"} />
      </SlotBoundary>
      </div>
      </div>
    </div>
  );
});

const MemoTome = memo(CampaignTome);
const MemoPlayersDialog = memo(PlayersDialog);

/** Shared campaign chrome from the dashboard boards: art header and section nav. */
export function CampaignShell({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const markOpened = useMutation(api.campaigns.markOpened);
  const pathname = usePathname();
  const [playersOpen, setPlayersOpen] = useState(false);
  const [tomeChapter, setTomeChapter] = useState<TomeChapterId | null>(null);
  const openOverview = useCallback(() => setTomeChapter("overview"), []);
  const closeTome = useCallback(() => setTomeChapter(null), []);
  const closePlayers = useCallback(() => setPlayersOpen(false), []);

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
      <OpenTomeContext.Provider value={setTomeChapter}>
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
              <CampaignNav campaignId={campaign._id} isGm={campaign.role === "gm"} />
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
            <DashboardHero campaign={campaign} onOpenTome={openOverview} />
          ) : null}
        </section>
        {children}
        <MemoTome campaign={campaign} chapter={tomeChapter} onChapter={setTomeChapter} onClose={closeTome} />
        {campaign.role === "gm" ? (
          <MemoPlayersDialog campaignId={campaign._id} open={playersOpen} onClose={closePlayers} />
        ) : null}
      </div>
      </OpenTomeContext.Provider>
    </CampaignContext.Provider>
  );
}
