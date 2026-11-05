import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { JournalScreen, journalHref, parseJournalTab, type JournalTab } from "../../../src/features/journal";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { inCampaign, listQueries } from "../sessions/fixture";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

// The ExpoCrypto native module is missing in some installs (dcm-gdzi.40); these tests never create a session.
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-1" }));

beforeEach(() => {
  resetMotionTest();
});

function journal(role: "gm" | "player", tab: JournalTab, onTab: (tab: JournalTab) => void = () => undefined) {
  return inCampaign(role, <JournalScreen onTab={onTab} tab={tab} />);
}

test("the sub-tab comes from ?tab=, Sessions by default", () => {
  expect(parseJournalTab("notes")).toBe("notes");
  expect(parseJournalTab("sessions")).toBe("sessions");
  expect(parseJournalTab("")).toBe("sessions");
  expect(parseJournalTab("bogus")).toBe("sessions");
  expect(parseJournalTab(null)).toBe("sessions");
  expect(journalHref("c1", "notes")).toBe("/campaign/c1/journal?tab=notes");
  expect(journalHref("c1", "sessions")).toBe("/campaign/c1/journal?tab=sessions");
});

for (const role of ["player", "gm"] as const) {
  const render = role === "gm" ? renderAsGm : renderAsPlayer;

  test(`a ${role} on the Sessions sub-tab sees the sessions list, and pressing Notes asks for the Notes tab`, async () => {
    const onTab = jest.fn<(tab: JournalTab) => void>();
    const screen = await render(journal(role, "sessions", onTab), { queries: listQueries(role) });
    expect(screen.getByRole("tab", { name: "Sessions" }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole("tab", { name: "Notes" }).props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByRole("header", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByText("The Bridge")).toBeTruthy();
    expect(screen.client.subscribed).toContain("sessionRecords:list");
    await fireEvent.press(screen.getByRole("tab", { name: "Notes" }));
    expect(onTab).toHaveBeenCalledWith("notes");
  });

  test(`a ${role} on the Notes sub-tab gets the Notes screen and not the sessions list`, async () => {
    const screen = await render(journal(role, "notes"), { queries: listQueries(role) });
    expect(screen.getByRole("tab", { name: "Notes" }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByRole("header", { name: "Sessions" })).toBeNull();
    expect(screen.client.subscribed).not.toContain("sessionRecords:list");
    expect(screen.client.subscribed.some((name) => name.startsWith("notes"))).toBe(true);
  });
}
