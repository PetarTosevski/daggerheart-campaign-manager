"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  History,
  LoaderCircle,
  Moon,
  PencilLine,
  Sun,
  TriangleAlert,
} from "lucide-react";

import {
  changeCampaignTimeAction,
  type CampaignTimeActionState,
} from "@/app/(app)/dashboard/campaign-time-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  CampaignTimeData,
  CampaignTimeHistoryEvent,
} from "@/lib/data/campaign-time";
import {
  getNextCampaignTime,
  formatCampaignTime,
  getCyclePhases,
  isCampaignCycleDay,
  type CampaignCycle,
  type CampaignTime,
} from "@/lib/domain/campaign-time";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { CAMPAIGN_TIME_NOTE_MAX_LENGTH } from "@/lib/validation/campaign-time";

const initialState: CampaignTimeActionState = { status: "idle" };
const timestampFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const fieldClassName =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:cursor-not-allowed disabled:opacity-60";

function sameCampaignTime(first: CampaignTime, second: CampaignTime): boolean {
  return (
    first.currentWeek === second.currentWeek &&
    first.currentCycle === second.currentCycle &&
    first.currentCycleDay === second.currentCycleDay
  );
}

function EventHistory({ events }: { events: CampaignTimeHistoryEvent[] }) {
  return (
    <Card className="border-stone-200/80 bg-white/85 shadow-[0_18px_60px_-35px_rgba(41,37,36,0.45)]">
      <CardHeader className="border-b border-stone-100 pb-5">
        <div className="flex items-center gap-2 text-stone-500">
          <History className="size-4" />
          <span className="text-xs font-semibold tracking-[0.16em] uppercase">
            Audit trail
          </span>
        </div>
        <CardTitle className="text-xl text-stone-900">Time history</CardTitle>
        <CardDescription>
          Newest first · original transitions are never silently edited
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {events.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <CalendarClock className="mx-auto size-8 text-stone-400" />
            <p className="mt-3 font-medium text-stone-800">
              No campaign-time changes yet
            </p>
            <p className="mt-1 text-sm text-stone-500">
              The first committed advance or correction will appear here.
            </p>
          </div>
        ) : (
          <ol
            aria-label="Recent campaign-time changes"
            className="divide-y divide-stone-100"
          >
            {events.map((event) => (
              <li key={event.id} className="space-y-2 px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="bg-stone-100 text-stone-700 capitalize"
                      >
                        {event.eventType}
                      </Badge>
                      {event.correctsEventId ? (
                        <span className="text-xs text-amber-800">
                          Compensating event
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 flex flex-wrap items-center gap-1 text-sm font-medium text-stone-700">
                      <span>{formatCampaignTime(event.previous)}</span>
                      <ChevronRight className="size-3.5 shrink-0" />
                      <span>{formatCampaignTime(event.next)}</span>
                    </p>
                    {event.note ? (
                      <p className="mt-1 text-sm text-stone-500">{event.note}</p>
                    ) : null}
                  </div>
                  <time
                    dateTime={event.createdAt}
                    className="shrink-0 text-right text-xs leading-5 text-stone-500"
                  >
                    {timestampFormatter.format(new Date(event.createdAt))}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function CampaignTimeTracker({
  campaignId,
  initialIdempotencyKey,
  data,
}: {
  campaignId: string;
  initialIdempotencyKey: string;
  data: CampaignTimeData;
}) {
  const hydrated = useHydrated();
  const [state, formAction, pending] = useActionState(
    changeCampaignTimeAction,
    initialState,
  );
  const displayedCurrent = state.current ?? data.current;
  const next = getNextCampaignTime(displayedCurrent);
  const idempotencyKey =
    state.nextRequestKey ?? state.requestKey ?? initialIdempotencyKey;
  const [targetWeek, setTargetWeek] = useState(displayedCurrent.currentWeek);
  const [targetCycle, setTargetCycle] = useState<CampaignCycle>(
    displayedCurrent.currentCycle,
  );
  const [targetCycleDay, setTargetCycleDay] = useState<number>(
    displayedCurrent.currentCycleDay,
  );

  useEffect(() => {
    if (state.status === "success") {
      window.location.reload();
    }
  }, [state.requestKey, state.status]);

  const correctionTarget = useMemo<CampaignTime | null>(() => {
    if (
      !Number.isInteger(targetWeek) ||
      targetWeek < 1 ||
      !isCampaignCycleDay(targetCycleDay)
    ) {
      return null;
    }
    return {
      currentWeek: targetWeek,
      currentCycle: targetCycle,
      currentCycleDay: targetCycleDay,
    };
  }, [targetCycle, targetCycleDay, targetWeek]);
  const correctionTargetValid = correctionTarget !== null;
  const correctionChangesState =
    correctionTarget !== null &&
    !sameCampaignTime(displayedCurrent, correctionTarget);
  const phases = getCyclePhases(displayedCurrent.currentCycle);
  const displayedHistory = state.event
    ? [state.event, ...data.history].filter(
        (event, index, events) =>
          events.findIndex((candidate) => candidate.id === event.id) === index,
      )
    : data.history;
  const latestEventId = displayedHistory[0]?.id ?? "";
  const CycleIcon = displayedCurrent.currentCycle === "DAY" ? Sun : Moon;

  return (
    <section aria-labelledby="campaign-time-heading" className="space-y-6">
      <div className="flex items-center gap-2 text-[#6b303b]">
        <CalendarClock className="size-5" />
        <span className="text-xs font-semibold tracking-[0.16em] uppercase">
          Campaign calendar
        </span>
      </div>

      {state.status !== "idle" ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            state.status === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {state.status === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{state.message}</span>
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
        <Card className="overflow-hidden border-0 bg-[linear-gradient(145deg,#18352f_0%,#245148_55%,#132d29_100%)] text-stone-50 shadow-[0_24px_70px_-30px_rgba(24,53,47,0.75)]">
          <CardHeader className="relative border-b border-white/10 pb-5">
            <div
              aria-hidden="true"
              className="absolute -top-16 -right-12 size-48 rounded-full bg-amber-200/10 blur-3xl"
            />
            <CardTitle
              id="campaign-time-heading"
              className="font-heading text-2xl tracking-tight"
            >
              Campaign time
            </CardTitle>
            <CardDescription className="text-emerald-50/70">
              Advance one narrative day at a time after previewing the result.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-7 pt-1">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-100">
                <CycleIcon className="size-6" />
              </div>
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-emerald-100/70 uppercase">
                  Current position
                </p>
                <output
                  aria-live="polite"
                  className="font-heading mt-1 block text-2xl font-semibold text-white sm:text-3xl"
                >
                  {formatCampaignTime(displayedCurrent)}
                </output>
                <p className="mt-1 text-sm text-emerald-50/65">
                  Cycle day {displayedCurrent.currentCycleDay} of 7
                </p>
              </div>
            </div>

            <ol
              aria-label={`${displayedCurrent.currentCycle === "DAY" ? "Day" : "Night"} Cycle phases`}
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {phases.map((phase, index) => {
                const active = index + 1 === displayedCurrent.currentCycleDay;
                return (
                  <li
                    key={phase}
                    aria-current={active ? "step" : undefined}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      active
                        ? "border-amber-200/50 bg-amber-100/15 text-amber-50"
                        : "border-white/10 bg-white/5 text-emerald-50/65"
                    }`}
                  >
                    <span className="block text-[0.65rem] opacity-65">
                      Day {index + 1}
                    </span>
                    <span className="mt-0.5 block font-medium">{phase}</span>
                  </li>
                );
              })}
            </ol>

            <form action={formAction} className="space-y-4">
              <input type="hidden" name="campaignId" value={campaignId} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={idempotencyKey}
                readOnly
              />
              <input type="hidden" name="intent" value="advance" />

              <div className="rounded-xl border border-white/12 bg-black/10 p-4">
                <p className="text-xs font-semibold tracking-[0.14em] text-emerald-100/65 uppercase">
                  Preview — no changes yet
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm font-medium text-white">
                  <span>{formatCampaignTime(displayedCurrent)}</span>
                  <ChevronRight className="size-4 shrink-0 text-amber-100" />
                  <span>{formatCampaignTime(next)}</span>
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="campaign-time-advance-note" className="text-sm font-medium">
                  Advance note <span className="font-normal text-emerald-50/60">(optional)</span>
                </label>
                <Textarea
                  id="campaign-time-advance-note"
                  name="note"
                  maxLength={CAMPAIGN_TIME_NOTE_MAX_LENGTH}
                  disabled={pending}
                  className="min-h-18 border-white/15 bg-black/10 text-white placeholder:text-emerald-50/40"
                  placeholder="What moved the campaign forward?"
                />
              </div>

              <Button
                type="submit"
                disabled={!hydrated || pending || !idempotencyKey}
                className="w-full bg-amber-200 text-stone-950 hover:bg-amber-100"
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CalendarClock />
                )}
                {pending ? "Advancing…" : "Confirm advance one day"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <EventHistory events={displayedHistory} />

          <details className="group rounded-xl border border-stone-200 bg-white/75 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-medium text-stone-800">
              <PencilLine className="size-4 text-amber-800" />
              Correct campaign time
              <ChevronRight className="ml-auto size-4 transition-transform group-open:rotate-90" />
            </summary>
            <form action={formAction} className="space-y-4 border-t border-stone-200 px-5 py-5">
              <input type="hidden" name="campaignId" value={campaignId} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={idempotencyKey}
                readOnly
              />
              <input type="hidden" name="intent" value="correction" />
              <input
                type="hidden"
                name="correctsEventId"
                value={latestEventId}
              />

              <p className="text-sm leading-relaxed text-stone-600">
                Set a different valid canonical state. This adds a compensating
                event and keeps the original history.
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="campaign-time-week" className="text-sm font-medium text-stone-800">
                    Week
                  </label>
                  <input
                    id="campaign-time-week"
                    name="targetWeek"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={targetWeek}
                    disabled={pending}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      setTargetWeek(Number.isNaN(value) ? 0 : value);
                    }}
                    className={fieldClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="campaign-time-cycle" className="text-sm font-medium text-stone-800">
                    Cycle
                  </label>
                  <select
                    id="campaign-time-cycle"
                    name="targetCycle"
                    value={targetCycle}
                    disabled={pending}
                    onChange={(event) => setTargetCycle(event.currentTarget.value as CampaignCycle)}
                    className={fieldClassName}
                  >
                    <option value="DAY">Day</option>
                    <option value="NIGHT">Night</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="campaign-time-cycle-day" className="text-sm font-medium text-stone-800">
                    Cycle day
                  </label>
                  <input
                    id="campaign-time-cycle-day"
                    name="targetCycleDay"
                    type="number"
                    min={1}
                    max={7}
                    step={1}
                    required
                    value={targetCycleDay}
                    disabled={pending}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      setTargetCycleDay(Number.isNaN(value) ? 0 : value);
                    }}
                    className={fieldClassName}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-stone-100 px-3 py-3 text-sm text-stone-700">
                <span className="font-medium">Correction preview:</span>{" "}
                {correctionTarget
                  ? formatCampaignTime(correctionTarget)
                  : "Enter valid values."}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="campaign-time-correction-note" className="text-sm font-medium text-stone-800">
                  Correction note <span className="font-normal text-stone-500">(optional)</span>
                </label>
                <Textarea
                  id="campaign-time-correction-note"
                  name="note"
                  maxLength={CAMPAIGN_TIME_NOTE_MAX_LENGTH}
                  disabled={pending}
                  className="min-h-18 border-stone-300 bg-white text-stone-900"
                  placeholder="Why is this correction needed?"
                />
              </div>

              <Button
                type="submit"
                variant="outline"
                disabled={
                  !hydrated ||
                  pending ||
                  !idempotencyKey ||
                  !correctionTargetValid ||
                  !correctionChangesState
                }
                className="w-full border-amber-800/30 text-amber-900 hover:bg-amber-50"
              >
                {pending ? <LoaderCircle className="animate-spin" /> : <PencilLine />}
                {pending ? "Correcting…" : "Commit correction"}
              </Button>
            </form>
          </details>
        </div>
      </div>
    </section>
  );
}
