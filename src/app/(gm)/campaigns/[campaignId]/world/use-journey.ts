"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";

import type { Point } from "@/lib/domain/travel";
import { pointAt, progressAt, remainingPath } from "@/lib/domain/travel/journey";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

export type JourneyView = NonNullable<FunctionReturnType<typeof api.mapJourney.get>>;

/** The campaign's trip (world journey MJ1), for every member; null when none, undefined while loading. */
export function useJourney(campaignId: Id<"campaigns">): JourneyView | null | undefined {
  return useQuery(api.mapJourney.get, { campaignId });
}

/**
 * The trip's progress (travel days) for drawing, from the stored start time. Purely visual: the server passes the
 * days (D6). The local clock is clamped between the days the server has passed and the next whole day, so a clock
 * that runs ahead waits at the boundary for the server's tick and one that runs behind catches up there.
 */
export function shownProgress(journey: JourneyView, nowMs: number): number {
  const p = progressAt(journey, nowMs);
  if (journey.status !== "moving") return p;
  return Math.max(Math.min(p, journey.daysPassed + 1, journey.totalDays), Math.min(journey.daysPassed, journey.totalDays), journey.baseDays);
}

/** The animated progress: a requestAnimationFrame loop while the trip moves (no writes, only a re-render per frame). */
export function useJourneyProgress(journey: JourneyView | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  const moving = journey?.status === "moving";
  useEffect(() => {
    if (!moving) return;
    let id = requestAnimationFrame(function frame() {
      setNow(Date.now());
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [moving]);
  if (!journey) return null;
  return shownProgress(journey, moving ? now : journey.startedAt);
}

/** Where the party token is drawn and the line still to walk, at `progress`. */
export function journeyPlace(journey: JourneyView, progress: number): { at: Point; remaining: Point[] } {
  return { at: pointAt(journey.points, journey.cum, progress), remaining: remainingPath(journey.points, journey.cum, progress) };
}
