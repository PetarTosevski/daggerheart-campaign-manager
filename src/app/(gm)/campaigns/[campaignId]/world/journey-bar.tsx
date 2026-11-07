"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { JOURNEY_SPEEDS, JOURNEY_SPEED_LABELS, type JourneySpeed } from "@/lib/domain/travel/journey";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { shownProgress, useJourneyProgress, type JourneyView } from "./use-journey";

const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const oneDecimal = (n: number) => (Math.floor(n * 10) / 10).toFixed(1);

/** Slow / Normal / Fast (6 / 3 / 1 s of real time per travel day), as aria-pressed buttons. */
export function SpeedPicker({ value, onPick, disabled = false }: { value: JourneySpeed; onPick: (s: JourneySpeed) => void; disabled?: boolean }) {
  return (
    <span role="group" aria-label="Walking speed" className="inline-flex flex-wrap items-center gap-1">
      {JOURNEY_SPEEDS.map((s) => (
        <BrandButton key={s} variant="neutral" aria-pressed={value === s} disabled={disabled} onClick={() => onPick(s)}>
          {JOURNEY_SPEED_LABELS[s]}
        </BrandButton>
      ))}
    </span>
  );
}

// Optimistic updates (rule 12): Stop freezes the token where it is drawn now; the server's answer replaces it.
type Store = OptimisticLocalStore;
type CampaignArgs = { campaignId: Id<"campaigns"> };

function stopLocally(store: Store, { campaignId }: CampaignArgs) {
  const current = store.getQuery(api.mapJourney.get, { campaignId });
  if (!current || current.status !== "moving") return;
  store.setQuery(api.mapJourney.get, { campaignId }, { ...current, status: "paused", baseDays: shownProgress(current, Date.now()), generation: current.generation + 1 });
}

function resumeLocally(store: Store, { campaignId }: CampaignArgs) {
  const current = store.getQuery(api.mapJourney.get, { campaignId });
  if (!current || current.status !== "paused") return;
  store.setQuery(api.mapJourney.get, { campaignId }, { ...current, status: "moving", startedAt: Date.now(), generation: current.generation + 1 });
}

function cancelLocally(store: Store, { campaignId }: CampaignArgs) {
  store.setQuery(api.mapJourney.get, { campaignId }, null);
}

function setSpeedLocally(store: Store, { campaignId, speed }: CampaignArgs & { speed: JourneySpeed }) {
  const current = store.getQuery(api.mapJourney.get, { campaignId });
  if (!current) return;
  const now = Date.now();
  const moving = current.status === "moving";
  store.setQuery(api.mapJourney.get, { campaignId }, moving ? { ...current, speed, baseDays: shownProgress(current, now), startedAt: now } : { ...current, speed });
}

/**
 * The bar above the map while the party is on the road (world journey MJ1): how far it is and how many campaign days
 * have passed, for everyone; Stop / Resume / Cancel and the speed for the GM. Stop freezes the token at once
 * (optimistic update); the server settles the days.
 */
export function JourneyBar({ campaignId, journey, canControl }: { campaignId: Id<"campaigns">; journey: JourneyView; canControl: boolean }) {
  const progress = useJourneyProgress(journey) ?? journey.baseDays;
  const [error, setError] = useState<string | null>(null);
  const args = { campaignId };

  const stop = useMutation(api.mapJourney.stop).withOptimisticUpdate(stopLocally);
  const resume = useMutation(api.mapJourney.resume).withOptimisticUpdate(resumeLocally);
  const cancel = useMutation(api.mapJourney.cancel).withOptimisticUpdate(cancelLocally);
  const setSpeed = useMutation(api.mapJourney.setSpeed).withOptimisticUpdate(setSpeedLocally);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: unknown) => setError(errorMessage(e)));
  };
  const keyed = () => ({ ...args, idempotencyKey: crypto.randomUUID() });

  const moving = journey.status === "moving";
  const shown = Math.min(progress, journey.totalDays);
  return (
    <div role="region" aria-label="The party's journey" data-testid="journey-bar" className="w-journey flex flex-wrap items-center gap-2 rounded-xl border border-[#e3b45a] bg-[#141e22] px-3.5 py-2.5">
      <span className="font-display text-[14px] font-bold text-[#f3cf86]">{moving ? "On the road" : "Stopped on the road"}</span>
      <span className="text-[14px] text-[#e6ecea]" data-testid="journey-status">
        Day {oneDecimal(shown)} of {oneDecimal(journey.totalDays)} · {daysText(journey.daysPassed)} passed
      </span>
      {canControl ? (
        <>
          <span className="flex-1" />
          <SpeedPicker value={journey.speed} onPick={(speed) => speed !== journey.speed && run(setSpeed({ ...args, speed }))} />
          {moving ? (
            <BrandButton variant="confirm" onClick={() => run(stop(keyed()))}>
              ⏸ Stop
            </BrandButton>
          ) : (
            <BrandButton variant="confirm" onClick={() => run(resume(keyed()))}>
              ▶ Resume
            </BrandButton>
          )}
          <BrandButton variant="cancel" onClick={() => run(cancel(keyed()))}>
            Cancel trip
          </BrandButton>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 w-full text-[13px] text-[#ff9a92]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
