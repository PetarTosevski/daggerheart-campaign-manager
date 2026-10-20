import { describe, expect, it } from "vitest";

import {
  addTally,
  dashboardNumber,
  dueCharacters,
  EMPTY_TALLY,
  encounterRoleList,
  formatSessionDate,
  headerLine,
  isSessionDate,
  lastPlayedSession,
  lastSessionText,
  liveSession,
  newestFirst,
  NO_DATE,
  NO_SESSION_ENCOUNTER,
  nextPlannedSession,
  nextSessionLine,
  sessionEncounterTitle,
  sessionTitle,
  type SessionSummaryInput,
  spotlight,
  statusLabel,
  TALLY_ROWS,
  windowTally,
  type FearHistoryRow,
  type RestRow,
} from "@/lib/domain/sessions";
import type { AdversaryType } from "@/lib/srd/types";

const en = { locale: "en-GB" };

describe("status (B1)", () => {
  it("labels the three statuses as the chip does", () => {
    expect(statusLabel("planned")).toBe("Planned");
    expect(statusLabel("live")).toBe("Live");
    expect(statusLabel("played")).toBe("Played");
  });

  it("lists the newest session first without changing the input", () => {
    const input = [{ n: 1 }, { n: 4 }, { n: 2 }];
    expect(newestFirst(input).map((s) => s.n)).toEqual([4, 2, 1]);
    expect(input.map((s) => s.n)).toEqual([1, 4, 2]);
  });

  it("calls a missing or blank title 'Untitled session'", () => {
    expect(sessionTitle(undefined)).toBe("Untitled session");
    expect(sessionTitle("   ")).toBe("Untitled session");
    expect(sessionTitle("The Bridge at Dawn")).toBe("The Bridge at Dawn");
  });

  it("formats a date with weekday, day, month and year, and 'No date set' without one", () => {
    expect(formatSessionDate("2026-10-24", en)).toBe("Sat, 24 Oct 2026");
    expect(formatSessionDate("2026-10-24", { locale: "en-US" })).toBe("Sat, Oct 24, 2026");
    expect(formatSessionDate("2026-10-24", { ...en, weekday: false })).toBe("24 Oct 2026");
    expect(formatSessionDate(undefined)).toBe(NO_DATE);
    expect(formatSessionDate(null)).toBe("No date set");
    expect(formatSessionDate("")).toBe("No date set");
  });

  it("never shifts the day with the time zone (Jan 1 stays Jan 1)", () => {
    expect(formatSessionDate("2027-01-01", { ...en, weekday: false })).toBe("1 Jan 2027");
  });

  it("returns an unparsable date as written (the board's fallback)", () => {
    expect(formatSessionDate("someday", en)).toBe("someday");
  });

  it("accepts only real YYYY-MM-DD calendar dates", () => {
    expect(isSessionDate("2026-10-24")).toBe(true);
    expect(isSessionDate("2028-02-29")).toBe(true);
    expect(isSessionDate("2026-02-29")).toBe(false);
    expect(isSessionDate("2026-13-01")).toBe(false);
    expect(isSessionDate("2026-1-01")).toBe(false);
    expect(isSessionDate("2026-10-24T00:00")).toBe(false);
    expect(isSessionDate("")).toBe(false);
  });
});

describe("summary (B1, B9)", () => {
  const sessions: SessionSummaryInput[] = [
    { n: 1, status: "played", recap: "We crossed the bridge." },
    { n: 2, status: "played", recap: "" },
    { n: 3, status: "planned", date: "2026-11-07" },
    { n: 4, status: "planned", date: "2026-10-31" },
    { n: 5, status: "planned" },
  ];

  it("writes the header line with the first planned session's date", () => {
    expect(headerLine(sessions, en)).toBe("5 sessions · 2 played · Next: Sat, 7 Nov 2026");
  });

  it("drops 'Next' when no planned session has a date, and says '1 session' for one", () => {
    expect(headerLine([{ n: 1, status: "planned" }], en)).toBe("1 session · 0 played");
    expect(headerLine([], en)).toBe("0 sessions · 0 played");
  });

  it("ignores the live session's date for 'Next' (planned only)", () => {
    const s: SessionSummaryInput[] = [{ n: 1, status: "live", date: "2026-10-20" }];
    expect(headerLine(s, en)).toBe("1 session · 0 played");
    expect(nextSessionLine(s, en)).toBe("Next session not scheduled");
  });

  it("finds the live, last played and next planned sessions", () => {
    expect(liveSession(sessions)).toBeNull();
    expect(lastPlayedSession(sessions)?.n).toBe(2);
    expect(nextPlannedSession(sessions)?.n).toBe(3);
  });

  it("shows the live session's number first, else the last played, else 'No sessions yet'", () => {
    expect(dashboardNumber([...sessions, { n: 6, status: "live" }])).toBe("Session 6");
    expect(dashboardNumber(sessions)).toBe("Session 2");
    expect(dashboardNumber([{ n: 1, status: "planned" }])).toBe("No sessions yet");
    expect(dashboardNumber([])).toBe("No sessions yet");
  });

  it("writes the next session line without a weekday, or 'not scheduled'", () => {
    expect(nextSessionLine(sessions, en)).toBe("Next session 7 Nov 2026");
    expect(nextSessionLine([{ n: 1, status: "played" }], en)).toBe("Next session not scheduled");
  });

  it("shows the last played recap", () => {
    const s: SessionSummaryInput[] = [
      { n: 1, status: "played", recap: "Old news." },
      { n: 2, status: "played", recap: "We crossed the bridge." },
    ];
    expect(lastSessionText(s)).toBe("We crossed the bridge.");
  });

  it("falls back to 'Session N was played, but no recap was written' for a blank recap", () => {
    expect(lastSessionText(sessions)).toBe(
      "Session 2 was played, but no recap was written. Add one in the session's Wrap-up.",
    );
  });

  it("falls back to 'No sessions played yet' when nothing was played", () => {
    expect(lastSessionText([{ n: 1, status: "live", recap: "In progress" }])).toBe(
      "No sessions played yet. Write a recap in a session's Wrap-up stage and it will appear here.",
    );
  });
});

describe("spotlight (B4, CB p.176)", () => {
  it("rings the characters with the lowest count", () => {
    const rows = [
      { characterId: "a", count: 2 },
      { characterId: "b", count: 1 },
    ];
    expect(spotlight(["a", "b", "c"], rows)).toEqual([
      { characterId: "a", count: 2, due: false },
      { characterId: "b", count: 1, due: false },
      { characterId: "c", count: 0, due: true },
    ]);
    expect(dueCharacters(["a", "b"], rows)).toEqual(["b"]);
  });

  it("marks every character due when all counts are equal (also with no rows)", () => {
    expect(dueCharacters(["a", "b"], [])).toEqual(["a", "b"]);
    expect(
      dueCharacters(
        ["a", "b"],
        [
          { characterId: "a", count: 3 },
          { characterId: "b", count: 3 },
        ],
      ),
    ).toEqual(["a", "b"]);
  });

  it("ignores rows of characters not listed (inactive) and returns nothing for an empty party", () => {
    expect(dueCharacters(["a"], [{ characterId: "gone", count: 0 }, { characterId: "a", count: 4 }])).toEqual(["a"]);
    expect(spotlight([], [{ characterId: "a", count: 1 }])).toEqual([]);
  });
});

describe("tally (Q3, B7)", () => {
  const fear = (action: string, before: number, after: number, at: number): FearHistoryRow => ({
    kind: "fear",
    action,
    before,
    after,
    at,
  });
  const rest = (kind: "short" | "long", status: RestRow["status"], startedAt: number): RestRow => ({
    kind,
    status,
    startedAt,
  });

  it("counts increases as gained and decreases as spent, for every action", () => {
    const rows = [
      fear("gain", 2, 4, 1),
      fear("adjust", 4, 5, 2),
      fear("set", 5, 8, 3),
      fear("spend", 8, 6, 4),
      fear("adjust", 6, 5, 5),
      fear("set", 5, 2, 6),
    ];
    expect(windowTally(rows, [])).toEqual({ fearGained: 6, fearSpent: 6, shortRests: 0, longRests: 0 });
  });

  it("an undone Fear gain cancels the gain instead of counting as spent", () => {
    const rows = [fear("gain", 3, 5, 1), fear("undo", 5, 3, 2)];
    expect(windowTally(rows, [])).toEqual(EMPTY_TALLY);
  });

  it("an undo that gives Fear back cancels Fear spent", () => {
    const rows = [fear("spend", 5, 3, 1), fear("undo", 3, 4, 2)];
    expect(windowTally(rows, [])).toMatchObject({ fearGained: 0, fearSpent: 1 });
  });

  it("an undo of a change from before the window cancels nothing below zero", () => {
    expect(windowTally([fear("undo", 5, 3, 1)], [])).toMatchObject({ fearGained: 0, fearSpent: 0 });
  });

  it("applies rows in time order whatever order they come in", () => {
    const rows = [fear("undo", 5, 3, 2), fear("gain", 3, 5, 1)];
    expect(windowTally(rows, [])).toMatchObject({ fearGained: 0, fearSpent: 0 });
  });

  it("ignores no-change rows and rows of other kinds", () => {
    const rows: FearHistoryRow[] = [fear("set", 4, 4, 1), { kind: "countdown", action: "advance", before: 1, after: 9, at: 2 }];
    expect(windowTally(rows, [])).toEqual(EMPTY_TALLY);
  });

  it("counts finished rests only (open and interrupted rests are not counted)", () => {
    const rests = [
      rest("short", "finished", 1),
      rest("short", "finished", 2),
      rest("short", "interrupted", 3),
      rest("long", "finished", 4),
      rest("long", "open", 5),
    ];
    expect(windowTally([], rests)).toEqual({ fearGained: 0, fearSpent: 0, shortRests: 2, longRests: 1 });
  });

  it("counts only the rows inside the window when one is given", () => {
    const rows = [fear("gain", 0, 1, 99), fear("gain", 1, 3, 100), fear("spend", 3, 2, 200), fear("gain", 2, 5, 201)];
    const rests = [rest("short", "finished", 50), rest("short", "finished", 150), rest("long", "finished", 250)];
    expect(windowTally(rows, rests, { from: 100, to: 200 })).toEqual({
      fearGained: 2,
      fearSpent: 1,
      shortRests: 1,
      longRests: 0,
    });
    expect(windowTally(rows, rests, { from: 100 })).toEqual({ fearGained: 5, fearSpent: 1, shortRests: 1, longRests: 1 });
  });

  it("a restarted session adds the new window to the stored tally (B7)", () => {
    const first = windowTally([fear("gain", 0, 2, 10)], [rest("short", "finished", 11)], { from: 0, to: 20 });
    const stored = addTally(undefined, first);
    expect(stored).toEqual({ fearGained: 2, fearSpent: 0, shortRests: 1, longRests: 0 });
    const rows = [fear("gain", 0, 2, 10), fear("spend", 2, 1, 110), fear("gain", 1, 4, 120)];
    const second = windowTally(rows, [rest("long", "finished", 130)], { from: 100 });
    expect(addTally(stored, second)).toEqual({ fearGained: 5, fearSpent: 1, shortRests: 1, longRests: 1 });
    expect(addTally(null, EMPTY_TALLY)).toEqual(EMPTY_TALLY);
  });

  it("names the four rows in the board's order", () => {
    expect(TALLY_ROWS.map((r) => r.label)).toEqual(["Fear gained", "Fear spent", "Short rests", "Long rests"]);
  });
});

describe("session encounter title (B11)", () => {
  const of = (...types: (AdversaryType | null)[]) => types.map((type) => ({ type }));

  it("writes 'Session N: 1× Leader, 2× Bruiser' in the board's role order (cost order, not input order)", () => {
    expect(sessionEncounterTitle({ n: 3, instances: of("Bruiser", "Leader", "Bruiser") })).toBe(
      "Session 3: 1× Leader, 2× Bruiser",
    );
  });

  it("orders every role as the board does and counts a Minion group as one entry", () => {
    expect(
      encounterRoleList(
        of("Solo", "Bruiser", "Leader", "Standard", "Skulk", "Ranged", "Horde", "Support", "Social", "Minion", "Minion"),
      ),
    ).toBe(
      "2× Minion group, 1× Social, 1× Support, 1× Horde, 1× Ranged, 1× Skulk, 1× Standard, 1× Leader, 1× Bruiser, 1× Solo",
    );
  });

  it("lists unknown types last", () => {
    expect(encounterRoleList(of(null, "Solo"))).toBe("1× Solo, 1× Adversary");
  });

  it("says 'no adversaries planned' for an empty encounter and the disabled title without one", () => {
    expect(sessionEncounterTitle({ n: 2, instances: [] })).toBe("Session 2: no adversaries planned");
    expect(sessionEncounterTitle(null)).toBe(NO_SESSION_ENCOUNTER);
    expect(NO_SESSION_ENCOUNTER).toBe("No planned session with an encounter");
  });
});
