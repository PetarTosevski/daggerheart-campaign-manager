import { randomUUID } from "node:crypto";

import { Archive, Hourglass, Sparkles } from "lucide-react";

import { CountdownCard } from "@/components/countdowns/countdown-card";
import { CountdownCreateForm } from "@/components/countdowns/countdown-create-form";
import type { CountdownTrackerData } from "@/lib/data/countdowns";

export function CountdownTracker({
  campaignId,
  data,
}: {
  campaignId: string;
  data: CountdownTrackerData;
}) {
  return (
    <section aria-labelledby="countdowns-heading" className="mt-10 space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2 text-[#6b303b]">
            <Hourglass className="size-5" />
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Developing threads
            </span>
          </div>
          <h2 id="countdowns-heading" className="font-heading mt-2 text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">
            Countdowns
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-600">
            Track threats, projects, and consequences. Every operation is saved
            with its transition history.
          </p>
        </div>
        <p className="text-sm text-stone-500">
          {data.active.length} active · {data.historical.length} historical
        </p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.28fr)]">
        <CountdownCreateForm
          campaignId={campaignId}
          initialIdempotencyKey={randomUUID()}
        />

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-700" />
            <h3 className="font-semibold text-stone-900">Active countdowns</h3>
          </div>
          {data.active.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white/55 px-6 py-10 text-center">
              <Hourglass className="mx-auto size-8 text-stone-400" />
              <p className="mt-3 font-medium text-stone-800">No active countdowns</p>
              <p className="mt-1 text-sm text-stone-500">
                Create the first countdown to begin tracking a developing thread.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.active.map((countdown) => (
                <CountdownCard
                  key={countdown.id}
                  countdown={countdown}
                  initialIdempotencyKey={randomUUID()}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {data.historical.length > 0 ? (
        <div className="space-y-4 border-t border-stone-300/70 pt-6">
          <div className="flex items-center gap-2">
            <Archive className="size-4 text-stone-500" />
            <h3 className="font-semibold text-stone-900">
              Completed and cancelled
            </h3>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.historical.map((countdown) => (
              <CountdownCard
                key={countdown.id}
                countdown={countdown}
                initialIdempotencyKey={randomUUID()}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
