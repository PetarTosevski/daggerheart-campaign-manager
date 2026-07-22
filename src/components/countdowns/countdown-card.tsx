"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CirclePause,
  CirclePlay,
  History,
  LoaderCircle,
  Minus,
  Plus,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import {
  operateCountdownAction,
  type CountdownActionState,
} from "@/app/(app)/dashboard/countdown-actions";
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
import {
  canAdvanceCountdown,
  canCancelCountdown,
  canPauseCountdown,
  canResumeCountdown,
  canReverseCountdown,
  type CountdownStatus,
} from "@/lib/domain/countdowns";
import type { CountdownSummary } from "@/lib/data/countdowns";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { COUNTDOWN_REASON_MAX_LENGTH } from "@/lib/validation/countdowns";

const initialState: CountdownActionState = { status: "idle" };
const timestampFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusStyles: Record<CountdownStatus, string> = {
  active: "border-emerald-700/20 bg-emerald-50 text-emerald-800",
  paused: "border-amber-700/20 bg-amber-50 text-amber-800",
  completed: "border-sky-700/20 bg-sky-50 text-sky-800",
  cancelled: "border-stone-500/20 bg-stone-100 text-stone-600",
};

export function CountdownCard({
  countdown,
  initialIdempotencyKey,
}: {
  countdown: CountdownSummary;
  initialIdempotencyKey: string;
}) {
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    operateCountdownAction,
    initialState,
  );
  const idempotencyKey =
    state.nextRequestKey ?? state.requestKey ?? initialIdempotencyKey;

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      window.location.reload();
    }
  }, [state.requestKey, state.status]);

  const status = countdown.status as CountdownStatus;
  const percentRemaining = Math.round(
    (countdown.current_value / countdown.starting_value) * 100,
  );
  const canAdvance =
    hydrated && !pending && canAdvanceCountdown(status, countdown.current_value);
  const canReverse =
    hydrated &&
    !pending &&
    canReverseCountdown(
      status,
      countdown.current_value,
      countdown.starting_value,
    );

  return (
    <Card
      data-testid="countdown-card"
      className="overflow-hidden border-stone-200/80 bg-white/90 shadow-[0_18px_55px_-38px_rgba(41,37,36,0.5)]"
    >
      <CardHeader className="border-b border-stone-100 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {countdown.category}
              </Badge>
              <Badge variant="outline" className={`capitalize ${statusStyles[status]}`}>
                {status}
              </Badge>
            </div>
            <CardTitle className="text-xl text-stone-900">
              {countdown.name}
            </CardTitle>
            {countdown.description ? (
              <CardDescription className="mt-1 leading-relaxed">
                {countdown.description}
              </CardDescription>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-3xl font-semibold tabular-nums text-[#4b2028]">
              {countdown.current_value}
            </p>
            <p className="text-xs text-stone-500">
              of {countdown.starting_value} remaining
            </p>
          </div>
        </div>

        <div
          role="progressbar"
          aria-label={`${countdown.name}: ${countdown.current_value} of ${countdown.starting_value} remaining`}
          aria-valuemin={0}
          aria-valuemax={countdown.starting_value}
          aria-valuenow={countdown.current_value}
          className="mt-4 h-2 overflow-hidden rounded-full bg-stone-200"
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#9f5f24,#5b2832)] transition-[width]"
            style={{ width: `${percentRemaining}%` }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-1">
        {countdown.consequence ? (
          <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2.5">
            <p className="text-xs font-semibold tracking-[0.12em] text-amber-900 uppercase">
              Narrative consequence
            </p>
            <p className="mt-1 text-sm leading-relaxed text-amber-950">
              {countdown.consequence}
            </p>
          </div>
        ) : null}

        <form ref={formRef} action={formAction} className="space-y-3">
          <input type="hidden" name="countdownId" value={countdown.id} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={idempotencyKey}
            readOnly
          />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-1.5">
              <label htmlFor={`countdown-reason-${countdown.id}`} className="text-sm font-medium text-stone-800">
                Reason <span className="font-normal text-stone-500">(optional)</span>
              </label>
              <Textarea
                id={`countdown-reason-${countdown.id}`}
                name="reason"
                maxLength={COUNTDOWN_REASON_MAX_LENGTH}
                disabled={pending}
                className="min-h-10 resize-y border-stone-300 bg-white py-2 text-stone-900"
                placeholder="What changed?"
                aria-invalid={Boolean(state.fieldErrors?.reason)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`countdown-mode-${countdown.id}`} className="text-sm font-medium text-stone-800">
                Event type
              </label>
              <select
                id={`countdown-mode-${countdown.id}`}
                name="eventMode"
                defaultValue="operation"
                disabled={pending}
                className="h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-700/20"
              >
                <option value="operation">Normal change</option>
                <option value="correction">Correction</option>
              </select>
            </div>
          </div>

          {state.fieldErrors?.reason?.[0] ? (
            <p className="text-xs text-red-700">{state.fieldErrors.reason[0]}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button
              type="submit"
              name="intent"
              value="advance"
              disabled={!canAdvance}
              className="bg-[#4b2028] text-white hover:bg-[#652c37]"
              aria-label={`Advance ${countdown.name} by 1`}
            >
              {pending ? <LoaderCircle className="animate-spin" /> : <Minus />}
              Advance
            </Button>
            <Button
              type="submit"
              name="intent"
              value="reverse"
              variant="outline"
              disabled={!canReverse}
              aria-label={`Reverse ${countdown.name} by 1`}
            >
              <Plus />
              Reverse
            </Button>

            {status === "paused" ? (
              <Button
                type="submit"
                name="intent"
                value="resume"
                variant="outline"
                disabled={!hydrated || pending || !canResumeCountdown(status)}
                aria-label={`Resume ${countdown.name}`}
              >
                <CirclePlay />
                Resume
              </Button>
            ) : (
              <Button
                type="submit"
                name="intent"
                value="pause"
                variant="outline"
                disabled={!hydrated || pending || !canPauseCountdown(status)}
                aria-label={`Pause ${countdown.name}`}
              >
                <CirclePause />
                Pause
              </Button>
            )}

            <Button
              type="submit"
              name="intent"
              value="cancel"
              variant="ghost"
              disabled={!hydrated || pending || !canCancelCountdown(status)}
              className="col-span-2 text-stone-600 hover:bg-red-50 hover:text-red-800 sm:col-span-3"
              aria-label={`Cancel ${countdown.name}`}
            >
              <XCircle />
              Cancel countdown
            </Button>
          </div>

          {state.status !== "idle" ? (
            <div
              role={state.status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
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
        </form>

        <details className="group rounded-lg border border-stone-200 bg-stone-50/70">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-stone-700 outline-none focus-visible:ring-2 focus-visible:ring-amber-700/30">
            <span className="flex items-center gap-2">
              <History className="size-4" />
              Event history ({countdown.events.length})
            </span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          {countdown.events.length === 0 ? (
            <p className="border-t border-stone-200 px-3 py-4 text-sm text-stone-500">
              No changes recorded yet.
            </p>
          ) : (
            <ol aria-label={`${countdown.name} event history`} className="divide-y divide-stone-200 border-t border-stone-200">
              {countdown.events.map((event) => (
                <li key={event.id} className="px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {event.event_type}
                      </Badge>
                      <span className="font-mono font-medium tabular-nums text-stone-700">
                        {event.previous_value} → {event.new_value}
                      </span>
                      {event.previous_status !== event.new_status ? (
                        <span className="text-xs text-stone-500">
                          {event.previous_status} → {event.new_status}
                        </span>
                      ) : null}
                    </div>
                    <time dateTime={event.created_at} className="text-xs text-stone-500">
                      {timestampFormatter.format(new Date(event.created_at))}
                    </time>
                  </div>
                  {event.reason ? (
                    <p className="mt-1.5 leading-relaxed text-stone-600">
                      {event.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
