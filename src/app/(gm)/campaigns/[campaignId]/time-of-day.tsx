"use client";

import { DIM_PHASE_BADGE, LIGHT_LEVELS, LIGHT_LEVEL_LABEL, type LightLevel } from "@/lib/domain/combat-map/light";
import { useCampaignLight, useSetTimeOfDay } from "@/components/combat-map/vision/use-campaign-light";
import { cn } from "@/lib/utils";

import type { Id } from "../../../../../convex/_generated/dataModel";

const ICON: Readonly<Record<LightLevel, string>> = { day: "☀", dim: "◐", night: "☾" };

const NOTE: Readonly<Record<LightLevel, string>> = {
  day: "Full light on every map.",
  dim: DIM_PHASE_BADGE,
  night: "Night: light sources matter.",
};

/**
 * The campaign's time of day (dcm-bxp.54, user 2026-10-30) in the dashboard header, where the time arc sits in the
 * Witherwild: a Day / Dim / Night segmented control for the GM (edit access), read-only for players. Every map of the
 * campaign follows it; the Combat Map header's dropdown sets the same value (`campaigns.setTimeOfDay`). Only rendered
 * for frames without campaign time.
 */
export function TimeOfDay({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const light = useCampaignLight(campaignId);
  const setter = useSetTimeOfDay(campaignId);
  if (light === undefined) return <div className="h-[86px]" aria-busy="true" />;
  if (light === null) return null;
  return (
    <section aria-label="Time of day" className="flex flex-col items-center gap-2 self-center" data-testid="time-of-day">
      <span className="text-[11px] tracking-[0.24em] text-[#e6ecea] uppercase opacity-80">Time of day</span>
      {light.canSet ? (
        <div role="group" aria-label="Set the time of day" className="flex rounded-full border border-white/20 bg-black/45 p-1">
          {LIGHT_LEVELS.map((level) => {
            const on = level === light.light;
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (!on) void setter.set(level);
                }}
                className={cn(
                  "inline-flex min-h-11 min-w-[88px] cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-semibold",
                  on ? "bg-[#e3b45a]/25 text-[#f3cf86] shadow-[inset_0_0_0_1px_#8a6d2a]" : "text-[#c9d2cf] hover:bg-white/5",
                )}
              >
                <span aria-hidden="true">{ICON[level]}</span>
                {LIGHT_LEVEL_LABEL[level]}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-4 text-[15px] font-semibold text-[#f3cf86]" data-testid="time-of-day-value">
          <span aria-hidden="true">{ICON[light.light]}</span>
          {LIGHT_LEVEL_LABEL[light.light]}
        </span>
      )}
      <span className="text-[13px] text-[#c9d2cf]">{NOTE[light.light]}</span>
      <p role="status" aria-live="polite" className="m-0 min-h-0 text-[13px] text-danger empty:hidden">
        {setter.error}
      </p>
    </section>
  );
}
