import { expect, test } from "@jest/globals";

import { shortSessionDate } from "../../../../../src/lib/dates";
import { clock } from "../../../../../src/lib/journal/log";
import { headingLine } from "../../../../../src/lib/journal/sessions";

test("session dates read day then month, the website's Journal format", () => {
  expect(shortSessionDate("2025-11-02")).toBe("Sun 2 Nov");
  expect(shortSessionDate(undefined)).toBe("No date set");
  expect(shortSessionDate("someday")).toBe("someday");
});

test("times are 24-hour and the heading line joins number, date and start", () => {
  const at = new Date(2025, 10, 2, 19, 5).getTime();
  expect(clock(at)).toBe("19:05");
  expect(headingLine({ n: 6, date: "2025-11-02", startedAt: at })).toBe("Session 6 · Sun 2 Nov · 19:05");
  expect(headingLine({ n: 7, date: undefined, startedAt: undefined })).toBe("Session 7 · No date set");
});
