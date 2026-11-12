"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { tickCountdown } from "@/lib/domain/countdowns/advanced";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../convex/countdowns";

/** A reminder as the rest panel shows it: "Tick Storm? 4 (1d6 2 + 2 PCs)", or "Tick Invasion? 1" for a fixed amount. */
export function reminderText(r: { name: string; amount: number; rollText: string | null }): string {
  return `Tick ${r.name}? ${r.amount}${r.rollText === null ? "" : ` (${r.rollText})`}`;
}

/** A row after the reminder's tick, by the same tickCountdown the server runs; a refused move leaves it as it is. */
function ticked(c: CountdownView, amount: number): CountdownView {
  if (c.currentValue === null || c.startingValue === null || c.status !== "active") return c;
  try {
    const { next } = tickCountdown(
      { startingValue: c.startingValue, currentValue: c.currentValue, status: c.status, repeat: c.repeat ?? undefined, triggerCount: c.triggerCount ?? 0 },
      amount,
    );
    return { ...c, ...next };
  } catch {
    return c;
  }
}

/**
 * What the latest rest did to the dashboard's countdowns, for the GM (plan rest-ticks RT2; before it, long-term only,
 * K4). Every countdown type and both rests: a finished long rest fires "On long rest", a short rest and an interrupted
 * long rest "On short rest" (Q1). Automatic settings show what they ticked (long-term with the step text, GM only);
 * Reminder settings ask "Tick <name>? <amount> (<roll>)" with the amount the rest already rolled, and one click ticks
 * exactly that (a chase pair's both rows). Undoing the rest takes every one of these ticks back. The export keeps its
 * K4 name for the rest launcher.
 */
export function LongTermAfterRest({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const state = useQuery(api.countdownTracks.afterRest, { campaignId });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Id<"countdowns"> | null>(null);
  // Optimistic (CL4): the reminder turns into a line and the card(s) move by the stored amount.
  const tick = useMutation(api.countdownTracks.tickOnRest).withOptimisticUpdate((store, { countdownId }) => {
    const panel = store.getQuery(api.countdownTracks.afterRest, { campaignId });
    const reminder = panel?.reminders.find((r) => r.countdownId === countdownId);
    if (!panel || !reminder) return;
    const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
    const row = list?.find((c) => c._id === countdownId);
    const value = Math.max(0, reminder.currentValue - reminder.amount);
    const line =
      row?.mode === "longTerm"
        ? value === 0
          ? `${reminder.name}: final event`
          : `${reminder.name}: ${value} left`
        : `${reminder.name} ticks ${reminder.amount}${reminder.rollText === null ? "" : ` (${reminder.rollText})`}`;
    store.setQuery(
      api.countdownTracks.afterRest,
      { campaignId },
      {
        ...panel,
        reminders: panel.reminders.filter((r) => r.countdownId !== countdownId),
        lines: [...panel.lines, { countdownId, name: reminder.name, currentValue: value, line }],
      },
    );
    if (list === undefined) return;
    // A chase pair moves both rows by the same amount.
    const partner = row?.chase?.partnerId;
    store.setQuery(
      api.countdowns.listByCampaign,
      { campaignId },
      list.map((c) => (c._id === countdownId || c._id === partner ? ticked(c, reminder.amount) : c)),
    );
  });

  if (state === undefined) {
    return (
      <p role="status" className="m-0 text-[14px] text-[#9fb0ab]">
        Loading countdowns…
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
  const rest = state.kind === "long" ? "long rest" : "short rest";

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[#2a3a40] bg-[#10181b] px-3 py-2.5" data-testid="rest-long-term">
      <h3 className="m-0 text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Countdowns</h3>
      {state.lines.length > 0 ? (
        <ul aria-label={`Countdowns ticked by this ${rest}`} className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-[#e6ecea]">
          {state.lines.map((l) => (
            <li key={l.countdownId}>{l.line}</li>
          ))}
        </ul>
      ) : null}
      {state.reminders.length > 0 ? (
        <ul aria-label="Countdown reminders" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {state.reminders.map((r) => (
            <li key={r.countdownId} className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-[#c9d2cf]" data-testid="rest-reminder">
              <span>{reminderText(r)}</span>
              <BrandButton
                variant="neutral"
                size="sm"
                disabled={pending !== null}
                onClick={() => void fire(r.countdownId)}
                aria-label={`Tick ${r.name}`}
                title={`${r.currentValue} left now`}
              >
                Tick −{r.amount}
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
