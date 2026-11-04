"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { brandButton } from "@/components/brand/buttons";
import { useCampaignLight, useSetTimeOfDay } from "@/components/combat-map/vision/use-campaign-light";
import { formatCalendarDay } from "@/lib/domain/campaign-time";
import { DIM_PHASE_BADGE, LIGHT_LEVELS, LIGHT_LEVEL_LABEL, type LightLevel } from "@/lib/domain/combat-map/light";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { endDayNotice, UndoEndDay } from "./time-arc";

const ICON: Readonly<Record<LightLevel, string>> = { day: "☀", dim: "◐", night: "☾" };

/** The light's one-line rule under its name. */
export const LIGHT_RULE: Readonly<Record<LightLevel, string>> = {
  day: "Full light on every map.",
  dim: DIM_PHASE_BADGE,
  night: "Night: light sources matter.",
};

/** The GM's click on the cycle: Day → Dim → Night → Day. Wrapping to Day never changes the date (End day does that). */
export function nextTimeOfDay(light: LightLevel): LightLevel {
  return LIGHT_LEVELS[(LIGHT_LEVELS.indexOf(light) + 1) % LIGHT_LEVELS.length]!;
}

/** The day after Week `week` · Day `day` outside the Witherwild: day 7 ends the week. */
export function nextCalendarDay(week: number, day: number): { week: number; day: number } {
  return day >= 7 ? { week: week + 1, day: 1 } : { week, day: day + 1 };
}

/**
 * End day (`campaignTime.endDay`, one intent with a fresh key), shown at once: the calendar moves to the next day and
 * the light goes back to Day, as the server does outside the Witherwild (TASK-LN3-CT answer Q2).
 */
function useEndDay(campaignId: Id<"campaigns">) {
  const mutate = useMutation(api.campaignTime.endDay).withOptimisticUpdate((store, args) => {
    const calendar = store.getQuery(api.campaignTime.calendar, { campaignId: args.campaignId });
    if (calendar !== undefined && !calendar.cycles) {
      store.setQuery(api.campaignTime.calendar, { campaignId: args.campaignId }, { ...calendar, ...nextCalendarDay(calendar.week, calendar.day) });
    }
    const light = store.getQuery(api.campaigns.timeOfDay, { campaignId: args.campaignId });
    if (light !== undefined && light.phase === null) store.setQuery(api.campaigns.timeOfDay, { campaignId: args.campaignId }, { ...light, light: "day" });
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function fire() {
    setError(null);
    setPending(true);
    try {
      return await mutate({ campaignId, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { fire, error, pending };
}

/**
 * The dashboard's campaign day card for every campaign without the Witherwild arc, core included (TASK-CORE-CALENDAR;
 * user 2026-11-02): one label "Week X · Day X", under it the time of day (icon, name and its rule; the GM's click
 * advances Day → Dim → Night → Day without changing the date, `campaigns.setTimeOfDay`), and the GM's End day, which
 * moves to the next day at once (no confirm) and resets the light to Day. Its Undo (and the feed's) rolls it back (CT2).
 * Players read it only.
 */
export function DayCard({ campaignId, readOnly = false }: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  const calendar = useQuery(api.campaignTime.calendar, { campaignId });
  const light = useCampaignLight(campaignId);
  const setter = useSetTimeOfDay(campaignId);
  const endDay = useEndDay(campaignId);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastEnd, setLastEnd] = useState<Id<"actionLog"> | null>(null);
  if (calendar === undefined || light === undefined) return <div className="h-[168px] w-full sm:w-[300px]" aria-busy="true" />;

  const level = light?.light ?? "day";
  const face = (
    <>
      <span className="flex items-center gap-2 text-[15px] font-semibold text-[#f3cf86]">
        <span aria-hidden="true">{ICON[level]}</span>
        {LIGHT_LEVEL_LABEL[level]}
      </span>
      <span className="text-[13px] font-normal text-[#c9d2cf]">{LIGHT_RULE[level]}</span>
    </>
  );
  // The server decides who sets the light (edit access, as the old Day / Dim / Night control); End day is the GM's.
  const canCycle = light?.canSet === true;

  return (
    <section
      aria-label="Campaign day"
      className="flex w-full flex-col gap-3 rounded-[14px] border border-[#2a3a40] bg-[#141e22] p-4 sm:w-[300px]"
      data-testid="campaign-day"
    >
      <p className="m-0 font-display text-[20px] leading-tight font-bold text-parchment" data-testid="campaign-day-label">
        {formatCalendarDay(calendar.week, calendar.day)}
      </p>
      {canCycle ? (
        <button
          type="button"
          aria-label={`Advance the time of day: now ${LIGHT_LEVEL_LABEL[level]}`}
          data-testid="time-of-day-cycle"
          onClick={() => void setter.set(nextTimeOfDay(level))}
          className={brandButton({ variant: "neutral", className: "flex-col gap-0.5" })}
        >
          {face}
        </button>
      ) : (
        <div className="flex flex-col items-start gap-0.5 px-1" data-testid="time-of-day-value">
          {face}
        </div>
      )}
      {readOnly ? null : (
        <button
          type="button"
          aria-label="End the day"
          disabled={endDay.pending}
          data-testid="end-day"
          onClick={() =>
            void endDay.fire().then((r) => {
              if (!r) return;
              setNotice(endDayNotice(r));
              setLastEnd(r.entryId);
            })
          }
          className={brandButton({ variant: "neutral" })}
        >
          End day
        </button>
      )}
      <p role="status" aria-live="polite" className="m-0 min-h-0 text-[13px] text-[#c9d2cf] empty:hidden" data-testid="end-day-notice">
        {notice}
      </p>
      {lastEnd !== null && !readOnly ? (
        <UndoEndDay
          entryId={lastEnd}
          onUndone={() => {
            setLastEnd(null);
            setNotice("End day undone.");
          }}
        />
      ) : null}
      <p role="status" aria-live="polite" className="m-0 min-h-0 text-[13px] text-danger empty:hidden">
        {endDay.error ?? setter.error}
      </p>
    </section>
  );
}
