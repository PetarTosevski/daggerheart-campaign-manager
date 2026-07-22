import { Check, Moon, Sun } from "lucide-react";

import {
  getCyclePhases,
  getPhaseName,
  type CampaignTime,
} from "@/lib/domain/campaign-time";

type PhaseStatus = "completed" | "current" | "upcoming";

const STATUS_LABEL: Record<PhaseStatus, string> = {
  completed: "completed",
  current: "current phase",
  upcoming: "upcoming",
};

// Shallow upward arc offsets (px) for the seven nodes. Applied on wider screens
// only so the row reads as a top-center crescent; the ends sit low and the
// centre rises. This is a static layout transform, not an animation.
const ARC_OFFSETS = [0, -10, -16, -18, -16, -10, 0] as const;

type CycleAccent = {
  completed: string;
  current: string;
  upcoming: string;
  nowPill: string;
  check: string;
};

const DAY_ACCENT: CycleAccent = {
  completed: "border-amber-300 bg-amber-100 text-amber-800",
  current: "border-amber-500 bg-amber-500/15 text-amber-900 ring-2 ring-amber-500",
  upcoming: "border-stone-200 bg-white/60 text-stone-400",
  nowPill: "bg-amber-500 text-white",
  check: "bg-amber-500 text-white",
};

const NIGHT_ACCENT: CycleAccent = {
  completed: "border-indigo-300 bg-indigo-100 text-indigo-800",
  current: "border-indigo-400 bg-indigo-400/20 text-indigo-950 ring-2 ring-indigo-400",
  upcoming: "border-stone-200 bg-white/60 text-stone-400",
  nowPill: "bg-indigo-500 text-white",
  check: "bg-indigo-500 text-white",
};

/**
 * Persistent, display-only campaign timeline.
 *
 * Renders the seven phases of the current cycle as a responsive crescent,
 * marking each phase completed, current, or upcoming. It contains no
 * advancement logic and never mutates state: every value is derived from the
 * canonical `CampaignTime` via the campaign-time domain module.
 */
export function CampaignTimeline({
  current,
  campaignName,
}: {
  current: CampaignTime;
  campaignName?: string;
}) {
  const phases = getCyclePhases(current.currentCycle);
  const isDay = current.currentCycle === "DAY";
  const cycleLabel = isDay ? "Day Cycle" : "Night Cycle";
  const accent = isDay ? DAY_ACCENT : NIGHT_ACCENT;
  const CycleIcon = isDay ? Sun : Moon;
  const currentPhase = getPhaseName(
    current.currentCycle,
    current.currentCycleDay,
  );

  return (
    <section aria-label="Campaign timeline" className="w-full">
      {/* Always-visible summary: week, cycle, and phase remain on every screen
          size, including mobile, so campaign information is never removed. */}
      <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium text-stone-700">
        <CycleIcon
          aria-hidden="true"
          className={isDay ? "size-4 text-amber-600" : "size-4 text-indigo-500"}
        />
        <span>
          Week {current.currentWeek}
          <span aria-hidden="true"> · </span>
          {cycleLabel}
          <span aria-hidden="true"> · </span>
          <span className="text-stone-900">{currentPhase}</span>
        </span>
      </p>

      <ol
        aria-label={`${cycleLabel} phases`}
        className="mt-2 flex items-end justify-center gap-0.5 sm:gap-1.5"
      >
        {phases.map((phase, index) => {
          const day = index + 1;
          const status: PhaseStatus =
            day < current.currentCycleDay
              ? "completed"
              : day === current.currentCycleDay
                ? "current"
                : "upcoming";
          const isCurrent = status === "current";

          return (
            <li
              key={phase}
              aria-label={`Day ${day}, ${phase}, ${STATUS_LABEL[status]}`}
              aria-current={isCurrent ? "step" : undefined}
              style={{ ["--arc" as string]: `${ARC_OFFSETS[index]}px` }}
              className="flex w-9 flex-col items-center sm:w-14 sm:[transform:translateY(var(--arc))]"
            >
              <span
                className={[
                  "relative flex size-7 items-center justify-center rounded-full border sm:size-9 motion-safe:transition-colors",
                  accent[status],
                ].join(" ")}
              >
                <CycleIcon aria-hidden="true" className="size-3.5 sm:size-4" />
                {status === "completed" ? (
                  <Check
                    aria-hidden="true"
                    className={`absolute -right-1 -bottom-1 size-3.5 rounded-full p-0.5 ${accent.check}`}
                  />
                ) : null}
              </span>

              {/* Non-color cue for the current phase (shape + text), in addition
                  to aria-current and the screen-reader status below. */}
              {isCurrent ? (
                <span
                  aria-hidden="true"
                  className={`mt-1 rounded-full px-1.5 text-[9px] font-semibold tracking-wide uppercase ${accent.nowPill}`}
                >
                  Now
                </span>
              ) : null}

              {/* Condensed labels on tablet, full on desktop, hidden on mobile.
                  Decorative here: the accessible name comes from the list
                  item's aria-label so labels are never read twice. */}
              <span
                aria-hidden="true"
                className="mt-1 hidden max-w-[4.5rem] text-center text-[10px] leading-tight text-stone-500 md:block lg:text-xs"
              >
                {phase}
              </span>
            </li>
          );
        })}
      </ol>

      {campaignName ? (
        <p className="sr-only">Campaign: {campaignName}</p>
      ) : null}
    </section>
  );
}

/**
 * Neutral placeholder shown while canonical campaign time is loading. It shows
 * no week, cycle, or phase values so no fabricated Week 1 state is ever
 * displayed.
 */
export function CampaignTimelineFallback() {
  return (
    <section
      aria-label="Campaign timeline"
      aria-busy="true"
      className="w-full"
    >
      <p className="text-center text-sm text-stone-400">Loading campaign time…</p>
      <ol
        aria-hidden="true"
        className="mt-2 flex items-end justify-center gap-0.5 sm:gap-1.5"
      >
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className="flex w-9 flex-col items-center sm:w-14">
            <span className="size-7 animate-pulse rounded-full border border-stone-200 bg-stone-200/70 sm:size-9 motion-reduce:animate-none" />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Neutral state shown in the shell when the GM owns no campaign yet. It avoids
 * the misleading "No active campaign" wording (Task 009A): nothing is wrong —
 * there simply is no campaign to time until the GM creates one.
 */
export function CampaignTimelineEmpty() {
  return (
    <section aria-label="Campaign timeline" className="w-full">
      <p className="text-center text-sm text-stone-400">No campaign yet</p>
    </section>
  );
}
