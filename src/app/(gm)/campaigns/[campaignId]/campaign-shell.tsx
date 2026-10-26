"use client";

import { useMutation, usePreloadedQuery, useQuery, type Preloaded } from "convex/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Users } from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

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

/** False until the browser first goes idle after mount (at most about 2 s), so background work waits for the page. */
function useAfterIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setIdle(true), { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setIdle(true), 1000);
    return () => window.clearTimeout(id);
  }, []);
  return idle;
}

const CampaignNav = memo(function CampaignNav({ campaignId, isGm }: { campaignId: string; isGm: boolean }) {
  const pathname = usePathname();
  // Full prefetch of every tab (PF1, user answer Q3) starts once the page is idle, so the tabs' payloads and code do
  // not compete with the open page's own; until then the default prefetch fetches the shell down to the loading boundary.
  const fullPrefetch = useAfterIdle();
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
            // Fully prefetched, a first click renders at once (the tab's RSC payload and code are here) and the router
            // cache serves revisits.
            prefetch={fullPrefetch ? true : null}
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

const skeletonBlock = "rounded-[14px] border border-[#253338] bg-[#141e22] motion-safe:animate-pulse";

/**
 * The loading skeleton of a campaign page (PF1): the dashboard boards' dark panels in the page grid, announced politely
 * (role=status, aria-busy). The campaign segment's loading.tsx shows it while a tab's server payload is on its way, and
 * the shell shows it while the campaign summary loads.
 */
export function CampaignSectionLoading({ label = "Loading page" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="campaign-loading"
      className="mx-auto grid max-w-[1344px] grid-cols-1 gap-6 px-4 py-7 sm:px-12 lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-6">
        <div className="h-7 w-48 rounded-md bg-[#18242a] motion-safe:animate-pulse" />
        <div className={cn(skeletonBlock, "h-[220px]")} />
        <div className={cn(skeletonBlock, "h-[160px]")} />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className={cn(skeletonBlock, "h-[180px]")} />
        <div className={cn(skeletonBlock, "h-[120px]")} />
      </div>
    </div>
  );
}

const MemoTome = memo(CampaignTome);
const MemoPlayersDialog = memo(PlayersDialog);

/** `campaigns.get` as the campaign layout preloads it on the server (PF4, CL5). */
export type PreloadedCampaign = Preloaded<typeof api.campaigns.get>;

type ShellProps = { campaignId: string; preloaded: PreloadedCampaign | null; children: ReactNode };

/**
 * Shared campaign chrome from the dashboard boards: art header and section nav. With the layout's preloaded summary the
 * shell renders the campaign at once (on the server and at hydration) and keeps it live through the same subscription;
 * without it (the server read failed) it reads the campaign on the client and shows the skeleton meanwhile.
 */
export function CampaignShell({ campaignId, preloaded, children }: ShellProps) {
  return preloaded ? (
    <PreloadedCampaignShell preloaded={preloaded}>{children}</PreloadedCampaignShell>
  ) : (
    <LiveCampaignShell campaignId={campaignId}>{children}</LiveCampaignShell>
  );
}

function PreloadedCampaignShell({ preloaded, children }: { preloaded: PreloadedCampaign; children: ReactNode }) {
  return <CampaignShellView campaign={useSameContent(usePreloadedQuery(preloaded))}>{children}</CampaignShellView>;
}

/**
 * Keeps the previous summary while nothing a campaign page reads has changed, so `useCampaign()` readers do not all
 * re-render for nothing right after a load: the first live `campaigns.get` result is a new object equal to the preloaded
 * one, and the shell's own `markOpened` write changes only `lastOpenedAt` (read by Load Campaign, not by any campaign
 * page). Real changes pass through in the same render, so the not-found switch still wins over the page's own failing
 * queries.
 */
function useSameContent(value: CampaignSummary | null): CampaignSummary | null {
  const [kept, setKept] = useState(value);
  if (kept !== value && pageContent(kept) !== pageContent(value)) {
    setKept(value);
    return value;
  }
  return kept;
}

function pageContent(summary: CampaignSummary | null): string {
  return JSON.stringify(summary === null ? null : { ...summary, lastOpenedAt: 0 });
}

/** The shell while the campaign summary loads: the header band and the page skeleton. */
export function CampaignShellLoading() {
  return (
    <div className="min-h-screen bg-[#0d1417] font-sans text-[#e6ecea]">
      <div aria-hidden="true" className="h-[92px] border-b border-[#1c272b] bg-[#101a1d]" />
      <CampaignSectionLoading label="Loading campaign" />
    </div>
  );
}

const noSubscription = () => () => undefined;

/**
 * False in the server render and during hydration, true from then on (and at once on client navigations). The shell
 * keeps the page out of the server HTML and renders it right after hydration, in the same task, so its queries still
 * go out with campaigns.get. Server-rendered, the page would sit in a streamed Suspense boundary that React reveals up
 * to 300 ms later; any context change above it meanwhile (Convex auth confirming, for one) makes React drop that HTML
 * and render the page again, with both copies in the DOM for a moment. Its art would also compete with the scripts for
 * bandwidth before hydration.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function LiveCampaignShell({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  return <CampaignShellView campaign={useQuery(api.campaigns.get, { campaignId })}>{children}</CampaignShellView>;
}

function CampaignShellView({ campaign, children }: { campaign: CampaignSummary | null | undefined; children: ReactNode }) {
  const markOpened = useMutation(api.campaigns.markOpened);
  const pathname = usePathname();
  const [playersOpen, setPlayersOpen] = useState(false);
  const [tomeChapter, setTomeChapter] = useState<TomeChapterId | null>(null);
  const openOverview = useCallback(() => setTomeChapter("overview"), []);
  const closeTome = useCallback(() => setTomeChapter(null), []);
  const closePlayers = useCallback(() => setPlayersOpen(false), []);
  const hydrated = useHydrated();

  const foundId = campaign ? campaign._id : null;
  useEffect(() => {
    if (foundId) void markOpened({ campaignId: foundId }).catch(() => undefined);
  }, [foundId, markOpened]);

  if (campaign === undefined) return <CampaignShellLoading />;
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
          {art.src ? (
            // The header art is the page's LCP element (CL10): resized and re-encoded by next/image, and preloaded
            // (`preload` is Next 16's name for the deprecated `priority`).
            <Image
              src={art.src}
              alt=""
              fill
              preload
              sizes="100vw"
              className="object-cover"
              style={{ objectPosition: art.position }}
            />
          ) : null}
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
        {/* The page renders from hydration on, not into the server HTML (see useHydrated). */}
        {hydrated ? children : <CampaignSectionLoading />}
        <MemoTome campaign={campaign} chapter={tomeChapter} onChapter={setTomeChapter} onClose={closeTome} />
        {campaign.role === "gm" ? (
          <MemoPlayersDialog campaignId={campaign._id} open={playersOpen} onClose={closePlayers} />
        ) : null}
      </div>
      </OpenTomeContext.Provider>
    </CampaignContext.Provider>
  );
}
