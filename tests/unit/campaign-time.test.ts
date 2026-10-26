import { describe, expect, it } from "vitest";

import {
  getNextCampaignTime,
  formatCampaignTime,
  getPhaseName,
  monthOf,
  weekInMonth,
  withCycleDay,
  WEEKS_PER_MONTH,
} from "@/lib/domain/campaign-time";

describe("getPhaseName", () => {
  it("maps every Day cycle day to its phase", () => {
    expect(getPhaseName("DAY", 1)).toBe("Dawn");
    expect(getPhaseName("DAY", 2)).toBe("Sunrise");
    expect(getPhaseName("DAY", 3)).toBe("Morning");
    expect(getPhaseName("DAY", 4)).toBe("High Noon");
    expect(getPhaseName("DAY", 5)).toBe("Afternoon");
    expect(getPhaseName("DAY", 6)).toBe("Sunset");
    expect(getPhaseName("DAY", 7)).toBe("Nautical Twilight");
  });

  it("maps every Night cycle day to its phase", () => {
    expect(getPhaseName("NIGHT", 1)).toBe("Nightfall");
    expect(getPhaseName("NIGHT", 2)).toBe("Moonrise");
    expect(getPhaseName("NIGHT", 3)).toBe("Deep Night");
    expect(getPhaseName("NIGHT", 4)).toBe("Midnight");
    expect(getPhaseName("NIGHT", 5)).toBe("Witching Hour");
    expect(getPhaseName("NIGHT", 6)).toBe("Small Hours");
    expect(getPhaseName("NIGHT", 7)).toBe("Nautical Dawn");
  });

  it("rejects cycle days outside 1-7", () => {
    expect(() => getPhaseName("DAY", 0)).toThrow(RangeError);
    expect(() => getPhaseName("DAY", 8)).toThrow(RangeError);
    expect(() => getPhaseName("NIGHT", 1.5)).toThrow(RangeError);
  });

  it("rejects an unsupported cycle at runtime", () => {
    expect(() =>
      getPhaseName("TWILIGHT" as never, 1),
    ).toThrow(RangeError);
  });
});

describe("getNextCampaignTime", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)(
    "advances Day Cycle day %i without changing week or cycle",
    (currentCycleDay) => {
      expect(
        getNextCampaignTime({
          currentWeek: 4,
          currentCycle: "DAY",
          currentCycleDay,
        }),
      ).toEqual({
        currentWeek: 4,
        currentCycle: "DAY",
        currentCycleDay: currentCycleDay + 1,
      });
    },
  );

  it.each([1, 2, 3, 4, 5, 6] as const)(
    "advances Night Cycle day %i without changing week or cycle",
    (currentCycleDay) => {
      expect(
        getNextCampaignTime({
          currentWeek: 9,
          currentCycle: "NIGHT",
          currentCycleDay,
        }),
      ).toEqual({
        currentWeek: 9,
        currentCycle: "NIGHT",
        currentCycleDay: currentCycleDay + 1,
      });
    },
  );

  it("crosses from Day Cycle day 7 to the next Night Cycle week", () => {
    expect(
      getNextCampaignTime({
        currentWeek: 1,
        currentCycle: "DAY",
        currentCycleDay: 7,
      }),
    ).toEqual({
      currentWeek: 2,
      currentCycle: "NIGHT",
      currentCycleDay: 1,
    });
  });

  it("crosses from Night Cycle day 7 to the next Day Cycle week", () => {
    expect(
      getNextCampaignTime({
        currentWeek: 12,
        currentCycle: "NIGHT",
        currentCycleDay: 7,
      }),
    ).toEqual({
      currentWeek: 13,
      currentCycle: "DAY",
      currentCycleDay: 1,
    });
  });

  it("rejects invalid week, cycle, and cycle-day state", () => {
    expect(() =>
      getNextCampaignTime({
        currentWeek: 0,
        currentCycle: "DAY",
        currentCycleDay: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      getNextCampaignTime({
        currentWeek: 1,
        currentCycle: "INVALID" as never,
        currentCycleDay: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      getNextCampaignTime({
        currentWeek: 1,
        currentCycle: "DAY",
        currentCycleDay: 8 as never,
      }),
    ).toThrow(RangeError);
  });
});

describe("formatCampaignTime", () => {
  it("formats the initial campaign state as Month 1 · Week 1 · Day 1", () => {
    expect(
      formatCampaignTime({
        currentWeek: 1,
        currentCycle: "DAY",
        currentCycleDay: 1,
      }),
    ).toBe("Month 1 · Week 1 · Day 1");
  });

  it("formats a later state correctly", () => {
    expect(
      formatCampaignTime({
        currentWeek: 8,
        currentCycle: "DAY",
        currentCycleDay: 4,
      }),
    ).toBe("Month 2 · Week 4 · Day 4");
  });

  it("formats a night state correctly", () => {
    expect(
      formatCampaignTime({
        currentWeek: 3,
        currentCycle: "NIGHT",
        currentCycleDay: 6,
      }),
    ).toBe("Month 1 · Week 3 · Day 6");
  });

  it("rejects a week below 1", () => {
    expect(() =>
      formatCampaignTime({
        currentWeek: 0,
        currentCycle: "DAY",
        currentCycleDay: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("months", () => {
  it("groups four weeks into each month", () => {
    expect(WEEKS_PER_MONTH).toBe(4);
    expect([1, 4, 5, 8, 9].map(monthOf)).toEqual([1, 1, 2, 2, 3]);
    expect([1, 4, 5, 8, 9].map(weekInMonth)).toEqual([1, 4, 1, 4, 1]);
  });
});

describe("withCycleDay", () => {
  const start = { currentWeek: 2, currentCycle: "NIGHT", currentCycleDay: 3 } as const;

  it("sets the day within the current week", () => {
    expect(withCycleDay(start, 6)).toEqual({ ...start, currentCycleDay: 6 });
  });

  it("rejects an unchanged or invalid day", () => {
    expect(() => withCycleDay(start, 3)).toThrow(RangeError);
    expect(() => withCycleDay(start, 0)).toThrow(RangeError);
    expect(() => withCycleDay(start, 8)).toThrow(RangeError);
  });
});
