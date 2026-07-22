import { Clock3, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FearHistoryEvent } from "@/lib/data/fear";

const timestampFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function FearHistory({ events }: { events: FearHistoryEvent[] }) {
  return (
    <Card className="border-stone-200/80 bg-white/85 shadow-[0_18px_60px_-35px_rgba(41,37,36,0.45)] backdrop-blur">
      <CardHeader className="border-b border-stone-100 pb-5">
        <div className="flex items-center gap-2 text-stone-500">
          <History className="size-4" />
          <span className="text-xs font-semibold tracking-[0.16em] uppercase">
            Audit trail
          </span>
        </div>
        <CardTitle className="text-xl text-stone-900">Recent history</CardTitle>
        <CardDescription>
          Newest first · adjustments are never silently edited
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        {events.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-stone-100 text-stone-500">
              <Clock3 className="size-5" />
            </div>
            <p className="mt-4 font-medium text-stone-800">No Fear changes yet</p>
            <p className="mt-1 text-sm text-stone-500">
              The first adjustment will appear here with its result.
            </p>
          </div>
        ) : (
          <ol aria-label="Recent Fear changes" className="divide-y divide-stone-100">
            {events.map((event) => (
              <li key={event.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={`font-mono text-lg font-semibold tabular-nums ${
                          event.amount > 0 ? "text-rose-700" : "text-emerald-700"
                        }`}
                      >
                        {event.amount > 0 ? "+" : ""}
                        {event.amount}
                      </span>
                      <span className="text-sm font-medium text-stone-600">
                        {event.previous_value} → {event.new_value}
                      </span>
                      <Badge
                        variant="secondary"
                        className="bg-stone-100 text-stone-600 capitalize"
                      >
                        {event.event_type}
                      </Badge>
                  </div>
                  <time
                    dateTime={event.created_at}
                    className="shrink-0 text-right text-xs leading-5 text-stone-500"
                  >
                    {timestampFormatter.format(new Date(event.created_at))}
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
