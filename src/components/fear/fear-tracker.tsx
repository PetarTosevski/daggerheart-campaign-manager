"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Minus,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  adjustFearAction,
  type AdjustFearState,
} from "@/app/(app)/dashboard/fear-actions";
import { FearHistory } from "@/components/fear/fear-history";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  canDecreaseFear,
  canIncreaseFear,
  MAX_FEAR,
  MIN_FEAR,
} from "@/lib/domain/fear";
import type { FearHistoryEvent } from "@/lib/data/fear";

const initialAdjustFearState: AdjustFearState = { status: "idle" };

export function FearTracker({
  campaignId,
  currentFear,
  initialIdempotencyKey,
  history,
}: {
  campaignId: string;
  currentFear: number;
  initialIdempotencyKey: string;
  history: FearHistoryEvent[];
}) {
  const router = useRouter();
  const idempotencyKeyRef = useRef(initialIdempotencyKey);
  const formRef = useRef<HTMLFormElement>(null);
  const [committedEvents, setCommittedEvents] = useState<FearHistoryEvent[]>([]);
  const adjustFearWithLocalHistory = useCallback(
    async (previousState: AdjustFearState, formData: FormData) => {
      formData.set("idempotencyKey", idempotencyKeyRef.current);
      const nextState = await adjustFearAction(previousState, formData);
      const committedEvent = nextState.event;

      if (nextState.status === "success" && committedEvent) {
        idempotencyKeyRef.current = crypto.randomUUID();
        setCommittedEvents((events) =>
          events.some((event) => event.id === committedEvent.id)
            ? events
            : [committedEvent, ...events].slice(0, 12),
        );
      }

      return nextState;
    },
    [],
  );
  const [state, formAction, pending] = useActionState(
    adjustFearWithLocalHistory,
    initialAdjustFearState,
  );

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [router, state.requestKey, state.status]);

  const displayedFear =
    state.status === "success" && state.newValue !== undefined
      ? state.newValue
      : currentFear;
  const controlsReady = Boolean(initialIdempotencyKey) && !pending;
  const canDecrease = controlsReady && canDecreaseFear(displayedFear);
  const canIncrease = controlsReady && canIncreaseFear(displayedFear);
  const displayedHistory = [...committedEvents, ...history]
    .filter(
      (event, index, events) =>
        events.findIndex((candidate) => candidate.id === event.id) === index,
    )
    .slice(0, 12);

  return (
    <>
      <Card className="overflow-hidden border-0 bg-[linear-gradient(145deg,#2a1519_0%,#4b2028_52%,#241519_100%)] text-stone-50 shadow-[0_24px_70px_-30px_rgba(75,32,40,0.8)]">
      <CardHeader className="relative gap-2 border-b border-white/10 pb-5">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-16 size-52 rounded-full bg-amber-200/10 blur-3xl"
        />
        <div className="flex items-center gap-2 text-amber-100/80">
          <ShieldAlert className="size-4" />
          <span className="text-xs font-semibold tracking-[0.18em] uppercase">
            Campaign resource
          </span>
        </div>
        <CardTitle className="font-heading text-2xl tracking-tight">
          Fear
        </CardTitle>
        <CardDescription className="text-stone-300">
          Every committed change is saved with an audit event.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-7 pt-1 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-start">
        <section aria-labelledby="fear-total-heading" className="space-y-5">
          <div>
            <p
              id="fear-total-heading"
              className="text-xs font-medium tracking-[0.16em] text-stone-300 uppercase"
            >
              Current total
            </p>
            <div className="mt-1 flex items-end gap-2">
              <output
                aria-live="polite"
                aria-label={`Current Fear: ${displayedFear} out of ${MAX_FEAR}`}
                className="font-mono text-7xl leading-none font-semibold tabular-nums text-amber-100"
              >
                {displayedFear}
              </output>
              <span className="pb-1.5 text-lg text-stone-400">/ {MAX_FEAR}</span>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="grid grid-cols-6 gap-2"
            data-testid="fear-pips"
          >
            {Array.from({ length: MAX_FEAR }, (_, index) => (
              <span
                key={index}
                className={`h-2 rounded-full transition-colors ${
                  index < displayedFear
                    ? "bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.45)]"
                    : "bg-white/12"
                }`}
              />
            ))}
          </div>

          <p className="text-sm leading-relaxed text-stone-300">
            Fear is constrained to {MIN_FEAR}–{MAX_FEAR}. Controls lock at the
            boundary so an invalid value cannot be submitted.
          </p>
        </section>

        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaignId} />

          <div className="space-y-2">
            <label htmlFor="fear-event-type" className="text-sm font-medium">
              Change type
            </label>
            <select
              id="fear-event-type"
              name="eventType"
              defaultValue="adjustment"
              className="h-10 w-full rounded-md border border-white/15 bg-[#321b20] px-3 text-sm text-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-200/30"
            >
              <option value="adjustment">Adjustment</option>
              <option value="correction">Correction (compensating event)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button
              type="submit"
              name="direction"
              value="decrease"
              variant="outline"
              size="lg"
              disabled={!canDecrease}
              aria-label="Decrease Fear by 1"
              className="border-white/20 bg-white/5 text-stone-100 hover:bg-white/12 hover:text-white"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Minus />
              )}
              Decrease
            </Button>
            <Button
              type="submit"
              name="direction"
              value="increase"
              size="lg"
              disabled={!canIncrease}
              aria-label="Increase Fear by 1"
              className="bg-amber-200 text-stone-950 hover:bg-amber-100"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}
              Increase
            </Button>
          </div>

          {state.status !== "idle" ? (
            <div
              role={state.status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                state.status === "error"
                  ? "border-red-300/30 bg-red-950/30 text-red-100"
                  : "border-emerald-300/25 bg-emerald-950/25 text-emerald-100"
              }`}
            >
              {state.status === "success" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : (
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{state.message}</span>
            </div>
          ) : null}
        </form>
      </CardContent>
      </Card>
      <FearHistory events={displayedHistory} />
    </>
  );
}
