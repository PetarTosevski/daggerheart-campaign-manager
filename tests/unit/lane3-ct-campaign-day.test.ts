import { describe, expect, it } from "vitest";

import { formatCalendarDay, passDay } from "@/lib/domain/campaign-time";

describe("passDay (plan lanes-2 CT)", () => {
  it("moves to the next day within a week", () => {
    expect(passDay({ currentWeek: 3, currentCycle: "DAY", currentCycleDay: 4 }, false)).toEqual({
      next: { currentWeek: 3, currentCycle: "DAY", currentCycleDay: 5 },
      newWeek: false,
    });
  });

  it("passes a week after day 7 and keeps the cycle without the Witherwild clock", () => {
    expect(passDay({ currentWeek: 1, currentCycle: "DAY", currentCycleDay: 7 }, false)).toEqual({
      next: { currentWeek: 2, currentCycle: "DAY", currentCycleDay: 1 },
      newWeek: true,
    });
  });

  it("flips the Witherwild cycle on a new week", () => {
    expect(passDay({ currentWeek: 1, currentCycle: "DAY", currentCycleDay: 7 }, true).next.currentCycle).toBe("NIGHT");
    expect(passDay({ currentWeek: 2, currentCycle: "NIGHT", currentCycleDay: 7 }, true).next.currentCycle).toBe("DAY");
  });

  it("labels a calendar day", () => {
    expect(formatCalendarDay(2, 5)).toBe("Week 2 · Day 5");
  });
});
