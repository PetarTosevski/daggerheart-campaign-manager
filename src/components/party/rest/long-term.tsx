"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { tickCountdown } from "@/lib/domain/countdowns/advanced";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The GM's long-term countdown lines after a finished long rest (plan countdowns-advanced K4; CB p.164 "During a long
 * rest, you should generally tick down a relevant long-term countdown once"). Countdowns set to Automatic show where
 * the rest moved them, with the step text (GM only); those set to Reminder ask "Tick <name>?" with a one-click tick
 * (user answer Q3). Undoing the rest takes every one of these ticks back.
 */
export function LongTermAfterRest({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const state = useQuery(api.countdownTracks.afterRest, { campaignId });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Id<"countdowns"> | null>(null);
  // Optimistic (CL4): the reminder turns into a line and the card moves, by the same tickCountdown the server runs.
  const tick = useMutation(api.countdownTracks.tickOnRest).withOptimisticUpdate((store, { countdownId }) => {
    const panel = store.getQuery(api.countdownTracks.afterRest, { campaignId });
    const reminder = panel?.reminders.find((r) => r.countdownId === countdownId);
    if (panel && reminder) {
      const value = Math.max(0, reminder.currentValue - 1);
      store.setQuery(
        api.countdownTracks.afterRest,
        { campaignId },
        {
          ...panel,
          reminders: panel.reminders.filter((r) => r.countdownId !== countdownId),
          lines: [...panel.lines, { countdownId, name: reminder.name, currentValue: value, line: value === 0 ? `${reminder.name}: final event` : `${reminder.name}: ${value} left` }],
        },
      );
    }
    const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
    if (list === undefined) return;
    store.setQuery(
      api.countdowns.listByCampaign,
      { campaignId },
      list.map((c) => {
        if (c._id !== countdownId || c.currentValue === null || c.startingValue === null) return c;
        try {
          const { next } = tickCountdown({ startingValue: c.startingValue, currentValue: c.currentValue, status: c.status, triggerCount: c.triggerCount ?? 0 }, 1);
          return { ...c, ...next };
        } catch {
          return c;
        }
      }),
    );
  });

  if (state === undefined) {
    return (
      <p role="status" className="m-0 text-[14px] text-[#9fb0ab]">
        Loading long-term countdowns…
      </p>
    );
  }
  if (state === null || (state.lines.length === 0 && state.reminders.length === 0)) return null;

  const fire = async (countdownId: Id<"countdowns">) => {
    setError(null);
    setPending(countdownId);
    try {
      await tick({ campaignId, restId: state.restId, countdownId, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[#2a3a40] bg-[#10181b] px-3 py-2.5" data-testid="rest-long-term">
      <h3 className="m-0 text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Long-term countdowns</h3>
      {state.lines.length > 0 ? (
        <ul aria-label="Long-term countdowns ticked by this rest" className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-[#e6ecea]">
          {state.lines.map((l) => (
            <li key={l.countdownId}>{l.line}</li>
          ))}
        </ul>
      ) : null}
      {state.reminders.length > 0 ? (
        <ul aria-label="Long-term countdown reminders" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {state.reminders.map((r) => (
            <li key={r.countdownId} className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-[#c9d2cf]">
              <span>
                Tick <strong className="text-parchment">{r.name}</strong>? ({r.currentValue} left)
              </span>
              <BrandButton size="sm" className="min-h-11" disabled={pending !== null} onClick={() => void fire(r.countdownId)} aria-label={`Tick ${r.name}`}>
                Tick −1
              </BrandButton>
            </li>
          ))}
        </ul>
      ) : null}
      <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error ?? ""}
      </p>
    </div>
  );
}
