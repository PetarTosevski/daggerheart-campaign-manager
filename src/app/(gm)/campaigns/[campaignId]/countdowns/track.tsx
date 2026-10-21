"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { COUNTDOWN_STEP_TEXT_MAX, validateSteps, type CountdownRestMode, type CountdownStep } from "@/lib/domain/countdowns/advanced";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../../../convex/countdowns";

/**
 * Long-term countdowns on the dashboard (plan countdowns-advanced K4; CB p.164): "create small boxes for each tick.
 * Starting from the first and working towards the last, write some events that may occur along the way that foreshadow
 * the final event ... During a long rest, you should generally tick down a relevant long-term countdown once."
 * The track shows one box per tick (the value it lands on; 0 is the final event), the current step and the next one,
 * the GM's inline step editor and the "On long rest: Automatic / Reminder" switch (Q3). Players never get step text.
 */

/** One keyed intent per click with its error kept for an aria-live region (as useIntent, for a mutation with an optimistic update). */
export function useKeyed<A extends { idempotencyKey: string }, R>(run: (args: A) => Promise<R>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function fire(args: Omit<A, "idempotencyKey">): Promise<R | undefined> {
    setError(null);
    setPending(true);
    try {
      return await run({ ...args, idempotencyKey: crypto.randomUUID() } as A);
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { fire, error, pending };
}

/** The track after one step write, as the server computes it (validateSteps); a refused write leaves it as it is. */
export function withStep(steps: readonly CountdownStep[], start: number, value: number, text: string, news: boolean): CountdownStep[] {
  const others = steps.filter((s) => s.value !== value);
  const written = text.trim() === "" ? others : [...others, { value, text, ...(news ? { news: true } : {}) }];
  try {
    return validateSteps(start, written);
  } catch {
    return [...steps];
  }
}

const INPUT = "min-h-11 w-full min-w-0 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[14px] text-[#e6ecea]";

/** A step's label: "7", or "0 · Final event". */
export function stepLabel(value: number): string {
  return value === 0 ? "0 · Final event" : String(value);
}

/**
 * One line per value from the start down to 0 (0 = the final event), each with its text and a "News reaches the party"
 * box. `onStep` gets every change in the dialog (`live`), or a line once it is left (blur / Enter) or its box clicked on
 * the card.
 */
export function StepEditor({
  start,
  steps,
  onStep,
  live,
  disabled,
  label,
}: {
  start: number;
  steps: readonly CountdownStep[];
  onStep: (value: number, text: string, news: boolean) => void;
  live: boolean;
  disabled?: boolean;
  label: string;
}) {
  const values = Array.from({ length: start + 1 }, (_, k) => start - k);
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {values.map((value) => (
        <StepLine
          key={value}
          value={value}
          step={steps.find((s) => s.value === value) ?? null}
          onStep={onStep}
          live={live}
          disabled={disabled}
        />
      ))}
    </ol>
  );
}

function StepLine({
  value,
  step,
  onStep,
  live,
  disabled,
}: {
  value: number;
  step: CountdownStep | null;
  onStep: (value: number, text: string, news: boolean) => void;
  live: boolean;
  disabled?: boolean;
}) {
  // A draft only while the GM types; otherwise the line shows the stored step (no props copied into state).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? step?.text ?? "";
  const news = step?.news === true;
  const commit = () => {
    if (draft === null) return;
    if (draft.trim() !== (step?.text ?? "")) onStep(value, draft, news);
    setDraft(null);
  };
  const final = value === 0;
  return (
    <li className="grid grid-cols-[64px_1fr] items-center gap-2 sm:grid-cols-[84px_1fr_auto]" data-testid={`step-${value}`}>
      <span className={cn("text-[13px] tabular-nums", final ? "font-semibold text-[#ffb4ae]" : "text-[#9fb2b6]")}>{stepLabel(value)}</span>
      <input
        aria-label={final ? "Final event" : `Step at ${value}`}
        maxLength={COUNTDOWN_STEP_TEXT_MAX}
        value={text}
        disabled={disabled}
        placeholder={final ? "What finally happens" : "Optional foreshadowing"}
        onChange={(e) => {
          if (live) onStep(value, e.target.value, news);
          else setDraft(e.target.value);
        }}
        onBlur={live ? undefined : commit}
        onKeyDown={(e) => {
          if (!live && e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className={INPUT}
      />
      <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2 pl-[72px] text-[12px] text-[#c9d2cf] sm:col-span-1 sm:pl-0">
        <input
          type="checkbox"
          aria-label={`News reaches the party at ${value}`}
          checked={news}
          disabled={disabled || text.trim() === ""}
          onChange={(e) => onStep(value, text, e.target.checked)}
          className="size-4 flex-none accent-[var(--brand)]"
        />
        News reaches the party
      </label>
    </li>
  );
}

const REST_MODES: { mode: CountdownRestMode; label: string; hint: string }[] = [
  { mode: "auto", label: "Automatic", hint: "Each finished long rest ticks it once." },
  { mode: "remind", label: "Reminder", hint: "A finished long rest asks you to tick it; nothing moves by itself." },
];

/** "On long rest: Automatic / Reminder" (Q3) as two pressed buttons. */
export function RestModeSwitch({ value, onChange, disabled }: { value: CountdownRestMode; onChange: (mode: CountdownRestMode) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="On long rest" className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-[#9fb2b6]">On long rest</span>
      <span className="flex overflow-hidden rounded-full border border-[#33444a]">
        {REST_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            aria-pressed={value === m.mode}
            title={m.hint}
            disabled={disabled}
            onClick={() => onChange(m.mode)}
            className={cn(
              "min-h-11 cursor-pointer px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
              value === m.mode ? "bg-brand font-semibold text-brand-ink" : "bg-transparent text-[#c9d2cf]",
            )}
          >
            {m.label}
          </button>
        ))}
      </span>
    </div>
  );
}

/** The track on a long-term countdown's card: the boxes, the current and next step, the editor and the rest switch. */
export function LongTermTrack({
  countdown,
  campaignId,
  readOnly,
  progress,
}: {
  countdown: CountdownView;
  campaignId: Id<"campaigns">;
  readOnly: boolean;
  progress: { value: number; start: number };
}) {
  const [editing, setEditing] = useState(false);
  const patchList = (store: OptimisticLocalStore, id: Id<"countdowns">, change: (c: CountdownView) => CountdownView) => {
    const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
    if (list === undefined) return;
    store.setQuery(
      api.countdowns.listByCampaign,
      { campaignId },
      list.map((c) => (c._id === id ? change(c) : c)),
    );
  };
  // Optimistic (CL4): the track moves on the edit, computed by the same validateSteps the server runs.
  const setStep = useKeyed(
    useMutation(api.countdownTracks.setStep).withOptimisticUpdate((store, { countdownId, value, text, news }) =>
      patchList(store, countdownId, (c) =>
        c.steps === null || c.startingValue === null ? c : { ...c, steps: withStep(c.steps, c.startingValue, value, text, news === true) },
      ),
    ),
  );
  const setRestMode = useKeyed(
    useMutation(api.countdownTracks.setRestMode).withOptimisticUpdate((store, { countdownId, restMode }) =>
      patchList(store, countdownId, (c) => ({ ...c, restMode })),
    ),
  );

  const { value, start } = progress;
  const steps = countdown.steps; // null for players (D12)
  const name = countdown.name ?? "Hidden countdown";
  const at = (v: number) => steps?.find((s) => s.value === v) ?? null;
  const boxes = Array.from({ length: start }, (_, k) => start - 1 - k);
  const done = countdown.status === "completed";
  const current = at(value);
  const next = value > 0 ? at(value - 1) : null;

  return (
    <div className="flex flex-col gap-2.5" data-testid="long-term-track">
      <ol
        aria-label={`${name}: ${start - value} of ${start} ticks`}
        className="m-0 flex list-none flex-wrap gap-1.5 rounded-[10px] bg-[linear-gradient(180deg,rgba(0,0,0,0.25),rgba(122,82,24,0.12))] p-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)]"
      >
        {boxes.map((v) => {
          const ticked = v >= value;
          const isCurrent = v === value && value < start;
          const step = at(v);
          return (
            <li
              key={v}
              data-value={v}
              data-ticked={ticked}
              data-current={isCurrent}
              aria-label={`${v === 0 ? "Final event" : `Box ${v}`}${ticked ? ", ticked" : ""}${step ? `: ${step.text}` : ""}`}
              title={step ? `${stepLabel(v)}: ${step.text}` : stepLabel(v)}
              className={cn(
                "relative flex h-8 min-w-8 flex-1 basis-8 items-center justify-center rounded-md border text-[12px] font-semibold tabular-nums",
                ticked ? "border-transparent bg-brand text-brand-ink" : "border-dashed border-[rgba(217,166,74,0.45)] bg-[rgba(10,16,18,0.6)] text-[#8fa3a8]",
                isCurrent && "ring-2 ring-[#f4efe6] ring-offset-1 ring-offset-[#141e22]",
                v === 0 && !ticked && "border-solid border-danger-line text-[#ffb4ae]",
                v === 0 && ticked && "bg-[#e0605a] text-white",
              )}
            >
              {v}
              {step?.news ? (
                <span aria-hidden="true" className="absolute -top-1.5 -right-1 text-[12px] text-[#e6c88a]">
                  *
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {steps === null ? null : (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <p data-testid="track-current" className="m-0 rounded-lg border border-brand bg-[#1d2a2e] px-3 py-2 text-[#e6ecea]">
            <span className="mr-2 text-[11px] tracking-[0.12em] text-brand uppercase">
              {done ? "Final event" : value === start ? `Start · ${value}` : `Now · ${value}`}
            </span>
            {current ? current.text : <span className="text-[#8fa3a8] italic">No step written</span>}
            {current?.news ? <span className="ml-2 text-[12px] text-[#e6c88a]">News reaches the party</span> : null}
          </p>
          {value > 0 ? (
            <p data-testid="track-next" className="m-0 px-3 text-[#9fb2b6]">
              <span className="mr-2 text-[11px] tracking-[0.12em] uppercase">Next · {stepLabel(value - 1)}</span>
              {next ? next.text : <span className="italic">No step written</span>}
            </p>
          ) : null}
        </div>
      )}

      {readOnly || steps === null ? null : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {countdown.restMode === null ? null : (
              <RestModeSwitch
                value={countdown.restMode}
                disabled={countdown.status === "cancelled"}
                onChange={(restMode) => void setRestMode.fire({ campaignId, countdownId: countdown._id, restMode })}
              />
            )}
            <button
              type="button"
              aria-expanded={editing}
              onClick={() => setEditing((e) => !e)}
              className="min-h-11 cursor-pointer text-[13px] text-[#c9d2cf] underline-offset-4 hover:underline"
            >
              {editing ? "Done editing" : "Edit steps"}
            </button>
          </div>
          {countdown.armed === false ? (
            <p className="m-0 text-[12px] text-[#8fa3a8]">Not armed: long rests leave it alone. Switch Armed on to follow long rests.</p>
          ) : null}
          {editing ? (
            <StepEditor
              label={`Steps of ${name}`}
              start={start}
              steps={steps}
              live={false}
              onStep={(v, text, news) => void setStep.fire({ campaignId, countdownId: countdown._id, value: v, text, news })}
            />
          ) : null}
          <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
            {setStep.error ?? setRestMode.error}
          </p>
        </>
      )}
    </div>
  );
}
