// TASK-CORE-CALENDAR (dashboard hero redesign, user 2026-11-02): the day card of every campaign without the Witherwild
// arc. One label "Week X · Day X"; under it the time of day, which the GM's click advances Day → Dim → Night → Day
// without changing the date; End day at once (no confirm), shown optimistically with the light back to Day. Players
// read it only. convex/react is replaced by the query results held here; mutations are recorded and their optimistic
// updates captured.
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

let results: Record<string, unknown> = {};
let calls: { name: string; args: Record<string, unknown> }[] = [];
let optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};

type FakeStore = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => results[getFunctionName(ref as never)],
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const fn = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === "campaignTime:endDay" ? { week: 1, day: 4, cycle: "DAY", newWeek: false, ended: 0, entryId: "log1" } : null;
    };
    return Object.assign(fn, {
      withOptimisticUpdate: (update: (store: FakeStore, args: Record<string, unknown>) => void) => {
        optimistic[name] = update;
        return fn;
      },
    });
  },
}));

const { DayCard, nextCalendarDay, nextTimeOfDay } = await import("../../../src/app/(gm)/campaigns/[campaignId]/time-of-day");

const CAMPAIGN = "c1" as Id<"campaigns">;

function scene(light: "day" | "dim" | "night", canSet = true) {
  results = {
    "campaignTime:calendar": { week: 1, day: 3, cycles: false },
    "campaigns:timeOfDay": { phase: null, light, canSet },
  };
}

beforeEach(() => {
  calls = [];
  optimistic = {};
  scene("day");
});

describe("the cycle and the calendar", () => {
  it("advances Day → Dim → Night and wraps to Day", () => {
    expect(nextTimeOfDay("day")).toBe("dim");
    expect(nextTimeOfDay("dim")).toBe("night");
    expect(nextTimeOfDay("night")).toBe("day");
  });

  it("passes a day, and day 7 starts the next week", () => {
    expect(nextCalendarDay(1, 3)).toEqual({ week: 1, day: 4 });
    expect(nextCalendarDay(2, 7)).toEqual({ week: 3, day: 1 });
  });
});

describe("DayCard", () => {
  it("shows one label, the light and its rule", () => {
    render(<DayCard campaignId={CAMPAIGN} />);
    expect(screen.getByTestId("campaign-day-label")).toHaveTextContent("Week 1 · Day 3");
    expect(screen.getByRole("button", { name: "Advance the time of day: now Day" })).toHaveTextContent("DayFull light on every map.");
    expect(screen.getByRole("button", { name: "End the day" })).toHaveTextContent("End day");
  });

  it("the GM's click sets the next light, and at Night wraps to Day without ending the day", () => {
    scene("night");
    render(<DayCard campaignId={CAMPAIGN} />);
    fireEvent.click(screen.getByRole("button", { name: "Advance the time of day: now Night" }));
    expect(calls).toEqual([{ name: "campaigns:setTimeOfDay", args: { campaignId: CAMPAIGN, timeOfDay: "day" } }]);
  });

  it("End day fires one intent with a key and shows the next day and Day light at once", () => {
    scene("night");
    render(<DayCard campaignId={CAMPAIGN} />);
    fireEvent.click(screen.getByRole("button", { name: "End the day" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("campaignTime:endDay");
    expect(calls[0]!.args.idempotencyKey).toEqual(expect.any(String));

    const store = new Map<string, unknown>(Object.entries(results));
    const fake: FakeStore = {
      getQuery: (ref) => store.get(getFunctionName(ref as never)),
      setQuery: (ref, _args, value) => store.set(getFunctionName(ref as never), value),
    };
    optimistic["campaignTime:endDay"]!(fake, { campaignId: CAMPAIGN });
    expect(store.get("campaignTime:calendar")).toEqual({ week: 1, day: 4, cycles: false });
    expect(store.get("campaigns:timeOfDay")).toEqual({ phase: null, light: "day", canSet: true });
  });

  it("players read the day and the light only", () => {
    scene("dim", false);
    render(<DayCard campaignId={CAMPAIGN} readOnly />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("time-of-day-value")).toHaveTextContent("Dim");
    expect(screen.getByTestId("campaign-day-label")).toHaveTextContent("Week 1 · Day 3");
  });
});
