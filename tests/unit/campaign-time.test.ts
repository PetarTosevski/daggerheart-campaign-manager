import { describe, expect, it } from "vitest";

import {
  getNextCampaignTime,
  formatCampaignTime,
  getPhaseName,
} from "@/lib/domain/campaign-time";

describe("getPhaseName", () => {
  it("maps every Day cycle day to its phase", () => {
    expect(getPhaseName("DAY", 1)).toBe("Dawn");
    expect(getPhaseName("DAY", 2)).toBe("Sunrise");
    expect(getPhaseName("DAY", 3)).toBe("Morning");
    expect(getPhaseName("DAY", 4)).toBe("Forenoon");
    expect(getPhaseName("DAY", 5)).toBe("Midday");
    expect(getPhaseName("DAY", 6)).toBe("Afternoon");
    expect(getPhaseName("DAY", 7)).toBe("Civil Twilight");
  });

  it("maps every Night cycle day to its phase", () => {
    expect(getPhaseName("NIGHT", 1)).toBe("Nautical Twilight");
    expect(getPhaseName("NIGHT", 2)).toBe("Astronomical Twilight");
    expect(getPhaseName("NIGHT", 3)).toBe("Evening");
    expect(getPhaseName("NIGHT", 4)).toBe("Night");
    expect(getPhaseName("NIGHT", 5)).toBe("Midnight");
    expect(getPhaseName("NIGHT", 6)).toBe("Dead of Night");
    expect(getPhaseName("NIGHT", 7)).toBe("Pre-Dawn");
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
  it("formats the initial campaign state as Week 1 Day Cycle Dawn", () => {
    expect(
      formatCampaignTime({
        currentWeek: 1,
        currentCycle: "DAY",
        currentCycleDay: 1,
      }),
    ).toBe("Week 1 • Day Cycle • Dawn");
  });

  it("formats a later state correctly", () => {
    expect(
      formatCampaignTime({
        currentWeek: 8,
        currentCycle: "DAY",
        currentCycleDay: 4,
      }),
    ).toBe("Week 8 • Day Cycle • Forenoon");
  });

  it("formats a night state correctly", () => {
    expect(
      formatCampaignTime({
        currentWeek: 3,
        currentCycle: "NIGHT",
        currentCycleDay: 6,
      }),
    ).toBe("Week 3 • Night Cycle • Dead of Night");
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
