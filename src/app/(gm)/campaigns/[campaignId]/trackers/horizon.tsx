"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { lastPlayedSession, liveSession } from "@/lib/domain/sessions";
import { DOOM_TRACK, type DoomBox, type DoomTier } from "@/lib/frames/doom-track";
import {
  FIRST_ECHO,
  MAX_ECHOES,
  TIER_RULE_THRESHOLD,
  markRefusal,
  markedInTier,
  tierRuleActive,
  unmarkRefusal,
  type HorizonState,
} from "@/lib/frames/trackers/horizon";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { TRACKER_BTN, TrackerCard } from "./tracker-card";

/** Journey to Horizon: Soul Echoes (everyone) and the Doom Track (GM; occurred events shown to players). */
export function HorizonTracker({ campaign }: { campaign: CampaignSummary }) {
  const view = useQuery(api.trackers.horizon.get, { campaignId: campaign._id });
  if (view === undefined) return null;
  if (view.role === "player") {
    return (
      <>
        <SoulEchoes campaignId={campaign._id} value={view.echoesCollected} readOnly />
        <TrackerCard title="Doom Track" subtitle="Disasters that have befallen New Valloren.">
          {view.occurred.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {view.occurred.map((e) => (
                <li key={e.id} className="rounded-lg border border-[#2a3a40] px-3 py-2 font-serif text-[16px] text-[#e6ecea]">
                  <span className="mr-2 font-sans text-[12px] tracking-[0.12em] text-[#9fb2b6] uppercase">Tier {e.tier}</span>
                  {e.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[14px] text-[#9fb2b6]">No disasters have struck yet.</p>
          )}
        </TrackerCard>
      </>
    );
  }
  const state: HorizonState = { boxes: view.boxes, echoesCollected: view.echoesCollected };
  return (
    <>
      <SoulEchoes campaignId={campaign._id} value={view.echoesCollected} />
      <DoomTrack campaignId={campaign._id} state={state} partyTier={view.partyTier} />
    </>
  );
}

function SoulEchoes({ campaignId, value, readOnly = false }: { campaignId: Id<"campaigns">; value: number; readOnly?: boolean }) {
  const set = useIntent(api.trackers.horizon.setEchoes);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(n: number) {
    // Clicking the top lit pip lowers the count by one, as with Fear tokens.
    const next = n === value ? Math.max(FIRST_ECHO, n - 1) : n;
    if (next === value) return;
    const result = await set.fire({ campaignId, value: next });
    if (!result) return;
    if (result.horizonUnlocked) setNotice("All ten Soul Echoes: the way to Horizon is open.");
    else if (result.levelUps > 0) setNotice(result.levelUps === 1 ? "The party levels up." : `The party levels up ${result.levelUps} times.`);
    else setNotice(null);
  }

  return (
    <TrackerCard
      title="Soul Echoes"
      subtitle={`${value} of ${MAX_ECHOES} collected. The party levels up with each new Echo; all ten unlock Horizon.`}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Soul Echoes collected">
        {Array.from({ length: MAX_ECHOES }, (_, i) => {
          const n = i + 1;
          const lit = n <= value;
          return (
            <button
              key={n}
              type="button"
              aria-label={`Soul Echo ${n} of ${MAX_ECHOES}`}
              aria-pressed={lit}
              disabled={readOnly || set.pending}
              onClick={() => void choose(n)}
              className={cn(
                "size-10 rounded-full border font-display text-[14px] disabled:cursor-default",
                lit ? "border-[#e8c66a] bg-[#e8c66a]/20 text-[#f3dc93] shadow-[0_0_10px_rgba(232,198,106,0.45)]" : "border-[#33444a] text-[#8fa3a8]",
                !readOnly && "cursor-pointer hover:brightness-125",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="m-0 text-[14px] text-[#f3dc93] empty:hidden">
        {notice}
      </p>
      <p role="alert" className="m-0 text-[13px] text-danger empty:hidden">
        {set.error}
      </p>
    </TrackerCard>
  );
}

function DoomTrack({ campaignId, state, partyTier }: { campaignId: Id<"campaigns">; state: HorizonState; partyTier: number }) {
  const mark = useIntent(api.trackers.horizon.markBox);
  const unmark = useIntent(api.trackers.horizon.unmarkBox);
  const occur = useIntent(api.trackers.horizon.setOccurred);
  // Q6 (D10 S3): a mark is stamped with the live session's number, else the last played one's ('(session N)').
  const sessions = useQuery(api.sessionRecords.list, { campaignId });
  const sessionNumber = sessions ? (liveSession(sessions) ?? lastPlayedSession(sessions))?.n : undefined;
  const [notice, setNotice] = useState<string | null>(null);
  const pending = mark.pending || unmark.pending || occur.pending;
  const error = mark.error ?? unmark.error ?? occur.error;

  async function toggle(id: string, marked: boolean) {
    setNotice(null);
    if (marked) {
      await unmark.fire({ campaignId, boxId: id });
      return;
    }
    const result = await mark.fire({ campaignId, boxId: id, ...(sessionNumber !== undefined ? { session: sessionNumber } : {}) });
    if (result?.fear) {
      const { gained, lost } = result.fear;
      setNotice(`Gained ${gained} Fear${lost > 0 ? ` (${lost} lost at the cap)` : ""}.`);
    }
  }

  const ctx: BoxCtx = {
    state,
    partyTier,
    pending,
    onToggle: (id, marked) => void toggle(id, marked),
    onOccurred: (id, occurred) => void occur.fire({ campaignId, boxId: id, occurred }),
  };

  return (
    <TrackerCard
      title="Doom Track"
      gmOnly
      subtitle={`At the end of each session, mark a box in the party’s tier (Tier ${partyTier}) or below. Nested boxes need the box above. Players see an event once it has occurred.`}
    >
      <p role="status" aria-live="polite" className="m-0 text-[14px] text-[#c9b3ff] empty:hidden">
        {notice}
      </p>
      <p role="alert" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {DOOM_TRACK.map((tier) => (
          <TierSection key={tier.tier} tier={tier} ctx={ctx} />
        ))}
      </div>
    </TrackerCard>
  );
}

type BoxCtx = {
  state: HorizonState;
  partyTier: number;
  pending: boolean;
  onToggle: (id: string, marked: boolean) => void;
  onOccurred: (id: string, occurred: boolean) => void;
};

function TierSection({ tier, ctx }: { tier: DoomTier; ctx: BoxCtx }) {
  const count = markedInTier(ctx.state, tier.tier);
  const active = tierRuleActive(ctx.state, tier.tier);
  const locked = tier.tier > ctx.partyTier;
  const headingId = `doom-tier-${tier.tier}`;
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-2.5 rounded-xl border border-[#253338] p-4", locked && "opacity-75")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="m-0 font-display text-[16px] font-bold text-parchment">
          Tier {tier.tier}: {tier.title}
        </h4>
        <span className="flex items-center gap-2 text-[13px] text-[#9fb2b6]">
          {count} marked
          {active ? (
            <span className="rounded-full border border-[#8e2b2b] bg-[#3a1414] px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-[#ffd9d6] uppercase">
              Active
            </span>
          ) : null}
        </span>
      </div>
      <p className="m-0 text-[13px] text-[#9fb2b6] italic">
        {tier.rule}
        {tier.tier !== 4 && !active ? ` (${count}/${TIER_RULE_THRESHOLD})` : ""}
      </p>
      {locked ? <p className="m-0 text-[12px] text-[#9fb2b6]">Above the party’s tier.</p> : null}
      <BoxList boxes={tier.boxes} ctx={ctx} />
    </section>
  );
}

function BoxList({ boxes, ctx, nested = false }: { boxes: DoomBox[]; ctx: BoxCtx; nested?: boolean }) {
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-1.5 p-0", nested && "mt-1.5 ml-6 border-l border-[#253338] pl-3")}>
      {boxes.map((b) => (
        <BoxItem key={b.id} box={b} ctx={ctx} />
      ))}
    </ul>
  );
}

function BoxItem({ box, ctx }: { box: DoomBox; ctx: BoxCtx }) {
  const entry = ctx.state.boxes[box.id];
  const marked = entry?.marked === true;
  const allowed = marked ? unmarkRefusal(ctx.state, box.id) === null : markRefusal(ctx.state, box.id, ctx.partyTier) === null;
  const inputId = `doom-${box.id}`;
  return (
    <li>
      <div className="flex items-start gap-2.5">
        <input
          id={inputId}
          type="checkbox"
          checked={marked}
          disabled={!allowed || ctx.pending}
          onChange={() => ctx.onToggle(box.id, marked)}
          className="mt-1 size-4 shrink-0 cursor-pointer accent-[#8e2b2b] disabled:cursor-not-allowed"
        />
        <label
          htmlFor={inputId}
          className={cn("flex-1 text-[14px] leading-snug", marked ? "text-[#e6ecea]" : "text-[#b7c5c8]", !allowed && !marked && "text-[#6f8287]")}
        >
          {box.text}
          {entry?.session ? <span className="ml-1.5 text-[12px] text-[#9fb2b6]">(session {entry.session})</span> : null}
        </label>
        {marked ? (
          <button
            type="button"
            aria-pressed={entry.occurred}
            aria-label={`Occurred: ${box.text}`}
            disabled={ctx.pending}
            onClick={() => ctx.onOccurred(box.id, !entry.occurred)}
            className={cn(TRACKER_BTN, "min-h-8 shrink-0 px-2 text-[12px]", entry.occurred && "border-[#e8c66a] text-[#f3dc93]")}
          >
            {entry.occurred ? "Occurred" : "Not yet"}
          </button>
        ) : null}
      </div>
      {box.children ? <BoxList boxes={box.children} ctx={ctx} nested /> : null}
    </li>
  );
}
