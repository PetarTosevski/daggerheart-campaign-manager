import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";

// First: it mocks Reanimated before any screen module loads it.
import { resetMotionTest } from "../../theme/mock-reanimated";

import { api } from "../../../src/convex";
import { JournalScreen, journalHref, parseJournalTab, type JournalNavigate, type JournalParams } from "../../../src/features/journal";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { baseQueries, gmLogQueries, gmPlanQueries, inCampaign, live, planned, played, playerLogQueries, spotlight } from "./fixture";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

// The ExpoCrypto native module is missing in some installs (dcm-gdzi.40).
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-1" }));

beforeEach(() => {
  resetMotionTest();
  mockPush.mockReset();
});

function journal(params: JournalParams, onNavigate: JournalNavigate = () => undefined) {
  return inCampaign(<JournalScreen onNavigate={onNavigate} params={params} />);
}

const ok = (_args: unknown) => Promise.resolve(null);

/** The functions a GM-only part of the Journal reads; a player's render must subscribe to none of them. */
const GM_READS = [
  fn(api.sessionPrep.get),
  fn(api.journalTally.tally),
  fn(api.sessionWrap.get),
  fn(api.sessionWrap.after),
  fn(api.charactersReads.partySummary),
];

test("the URL helpers: ?tab= picks the sub-tab (Sessions by default) and links carry s / sv / page", () => {
  expect(parseJournalTab("notes")).toBe("notes");
  expect(parseJournalTab("bogus")).toBe("sessions");
  expect(parseJournalTab(null)).toBe("sessions");
  expect(journalHref("c1", "notes")).toBe("/campaign/c1/journal?tab=notes");
  expect(journalHref("c1", "sessions", { s: "s 1", sv: "log" })).toBe("/campaign/c1/journal?tab=sessions&s=s%201&sv=log");
});

// ---------------------------------------------------------------- the session list

test("a player's Sessions list: the sessions they may see, Campaign so far, no Plan or Start", async () => {
  const screen = await renderAsPlayer(journal({}), { queries: baseQueries("player") });
  expect(screen.getByRole("header", { name: "Journal" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Sessions 1" }).props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByRole("tab", { name: "Notes · 2 pages" })).toBeTruthy();
  expect(screen.getByText("The Bridge")).toBeTruthy();
  expect(screen.getByLabelText("Hours at the table: 4")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Plan session/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Start session/ })).toBeNull();
  expect(screen.client.subscribed).toEqual([
    fn(api.campaigns.get),
    fn(api.sessionRecords.list),
    fn(api.notesThreads.threads),
    fn(api.notes.journal),
    fn(api.sessions.current),
    fn(api.sessionRecords.summary),
  ]);
});

test("the GM's Sessions list: + Plan session N creates the next session and opens it on Plan", async () => {
  const onNavigate = jest.fn<JournalNavigate>();
  const create = jest.fn((_args: unknown) => Promise.resolve({ sessionId: "session-3" }));
  const screen = await renderAsGm(journal({}, onNavigate), {
    queries: baseQueries("gm"),
    mutations: { [fn(api.sessionRecords.create)]: create },
  });
  expect(screen.getByRole("button", { name: "Start session 2" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Plan session 3" }));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ tab: "sessions", s: "session-3", sv: "plan" }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ campaignId: "campaign-1", idempotencyKey: "uuid-1" }));
});

test("tapping a session opens it; All sessions goes back to the list", async () => {
  const onNavigate = jest.fn<JournalNavigate>();
  const screen = await renderAsPlayer(journal({}, onNavigate), { queries: baseQueries("player") });
  await fireEvent.press(screen.getByRole("button", { name: /^Session 1: The Bridge/ }));
  expect(onNavigate).toHaveBeenCalledWith({ tab: "sessions", s: played._id });
});

// ---------------------------------------------------------------- Start and End

test("the GM starts the selected planned session and lands on its Log & recap", async () => {
  const onNavigate = jest.fn<JournalNavigate>();
  const start = jest.fn((_args: unknown) => Promise.resolve({ sessionId: "session-2", alreadyStarted: false, notes: [], features: [], reminders: [] }));
  const screen = await renderAsGm(journal({}, onNavigate), {
    queries: baseQueries("gm"),
    mutations: { [fn(api.sessions.start)]: start },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Start session 2" }));
  expect(screen.getByText("Start-of-session features are given out: Prayer Dice, Luckbringer’s Hope and the moon die.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Confirm start session" }));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ tab: "sessions", s: "session-2", sv: "log" }));
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ campaignId: "campaign-1", sessionId: "session-2" }));
  expect(screen.getByText("Session started.")).toBeTruthy();
});

test("with 'A new session opens on' set to the Combat Map, Start goes to the map", async () => {
  const onNavigate = jest.fn<JournalNavigate>();
  const start = jest.fn((_args: unknown) => Promise.resolve({ sessionId: "session-2", alreadyStarted: false }));
  const screen = await renderAsGm(journal({}, onNavigate), {
    queries: baseQueries("gm", undefined, { sessionOpensOn: "combatMap" }),
    mutations: { [fn(api.sessions.start)]: start },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Start session 2" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm start session" }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/campaign/campaign-1/combat-map"));
  expect(onNavigate).not.toHaveBeenCalled();
});

test("the GM ends the live session and reads the report; a player sees the live chip only", async () => {
  const end = jest.fn((_args: unknown) => Promise.resolve({ tokens: 0, fearGained: 0, fearLost: 0, journeyEnds: [] }));
  const queries = { ...baseQueries("gm", [live, played]), [fn(api.sessions.current)]: { startedAt: 1, extraCharacters: false, n: 2 } };
  const screen = await renderAsGm(journal({}), { queries, mutations: { [fn(api.sessions.end)]: end } });
  expect(screen.getByText("Session 2 · live")).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Allow extra characters this session" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "End session" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm end session" }));
  await waitFor(() => expect(screen.getByText("Session ended.")).toBeTruthy());
  expect(end).toHaveBeenCalledWith(expect.objectContaining({ campaignId: "campaign-1", idempotencyKey: "uuid-1" }));

  const player = await renderAsPlayer(journal({}), {
    queries: { ...baseQueries("player", [{ ...live, startedAt: undefined }]), [fn(api.sessions.current)]: { startedAt: 1, extraCharacters: false, n: 2 } },
  });
  expect(player.getByText("Session 2 · live")).toBeTruthy();
  expect(player.queryByRole("button", { name: "End session" })).toBeNull();
  expect(player.queryByRole("switch")).toBeNull();
});

// ---------------------------------------------------------------- the GM's session

test("the GM's session opens on Plan: scenes, GM prep and Battle Points, no log reads", async () => {
  const addScene = jest.fn(ok);
  const setState = jest.fn(ok);
  const screen = await renderAsGm(journal({ s: planned._id }), {
    queries: gmPlanQueries(),
    mutations: { [fn(api.sessionPrep.addScene)]: addScene, [fn(api.sessionPrep.setSceneState)]: setState },
  });
  expect(screen.getByRole("tab", { name: "Plan" }).props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByRole("header", { name: "Planned scenes" })).toBeTruthy();
  expect(screen.getByDisplayValue("Ambush")).toBeTruthy();
  expect(screen.getByText("Encounter · Bridge ambush")).toBeTruthy();
  expect(screen.getByText("Bandit Leader · Leader · 3")).toBeTruthy();
  expect(screen.getByRole("header", { name: "Battle points · Scene 2" })).toBeTruthy();
  expect(screen.getByText("6 / 14")).toBeTruthy();
  expect(screen.getByText("•  A rumour to drop")).toBeTruthy();
  expect(screen.getByText("Next")).toBeTruthy();
  expect(screen.client.subscribed).toContain(fn(api.sessionPrep.get));
  expect(screen.client.subscribed).not.toContain(fn(api.journalLog.list));
  // Scene 3 (exploration) can be played; the Combat scene plays from the map.
  await fireEvent.press(screen.getByRole("button", { name: "Scene 3 options" }));
  await fireEvent.press(screen.getByRole("button", { name: "Play this scene" }));
  expect(setState).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: planned._id, sceneId: "s3", state: "playing" });
  await fireEvent.press(screen.getByRole("button", { name: "Scene 2 options" }));
  expect(screen.getByText("Plays when its encounter goes on the Combat Map.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Add scene" }));
  expect(addScene).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: planned._id });
});

test("the GM's Log & recap: the log with hide / delete / add, the recap, tally, spotlight, threads, After the session", async () => {
  const onNavigate = jest.fn<JournalNavigate>();
  const hide = jest.fn(ok);
  const remove = jest.fn(ok);
  const add = jest.fn(ok);
  const reset = jest.fn(ok);
  const screen = await renderAsGm(journal({ s: played._id, sv: "log" }, onNavigate), {
    queries: gmLogQueries(),
    mutations: {
      [fn(api.journalLog.hide)]: hide,
      [fn(api.sessionPlay.removeLog)]: remove,
      [fn(api.sessionPlay.addLog)]: add,
      [fn(api.sessionPlay.resetSpotlight)]: reset,
    },
  });
  expect(screen.getByText("Written by the Combat Map as you play · edit anything")).toBeTruthy();
  expect(screen.queryByText("Fear +1")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Show 1 hidden" }));
  expect(screen.getByText("Fear +1")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Hide log line: Vex rolled 14 with Hope" }));
  expect(hide).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: played._id, source: "feed", sourceId: "a1" });
  await fireEvent.press(screen.getByRole("button", { name: "Delete log line: The bridge burns" }));
  expect(remove).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: played._id, logId: "g1" });
  await fireEvent.changeText(screen.getByLabelText("New log entry"), "  The ferryman flees ");
  await fireEvent.press(screen.getByRole("button", { name: "Add log entry" }));
  expect(add).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: played._id, text: "The ferryman flees", idempotencyKey: "uuid-1" });

  expect(screen.getByText("They held the ford.")).toBeTruthy();
  expect(screen.getByLabelText("Fear gained: 3")).toBeTruthy();
  expect(screen.getByLabelText("Vex: 3 spotlight moments")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Reset spotlight" }));
  expect(reset).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: played._id });
  expect(screen.getByText("Vex reached level 4.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "In Notes: Session 1: The Bridge" }));
  expect(onNavigate).toHaveBeenCalledWith({ tab: "notes", view: null, page: "p1" });
});

test("the GM's heading: rename in place and Mark as played from Session options", async () => {
  const setTitle = jest.fn(ok);
  const setPlayed = jest.fn(ok);
  const screen = await renderAsGm(journal({ s: "session-2", sv: "log" }), {
    queries: { ...gmLogQueries() },
    mutations: { [fn(api.sessionRecords.setTitle)]: setTitle, [fn(api.sessionRecords.setPlayed)]: setPlayed },
  });
  await fireEvent.press(screen.getByRole("button", { name: "The Chapel" }));
  const input = screen.getByLabelText("Session 2 title");
  await fireEvent.changeText(input, "The Chapel in the Briar");
  await fireEvent(input, "blur");
  expect(setTitle).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: "session-2", title: "The Chapel in the Briar" });
  await fireEvent.press(screen.getByRole("button", { name: "Session options" }));
  await fireEvent.press(screen.getByRole("button", { name: "Mark as played" }));
  expect(setPlayed).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: "session-2", played: true });
});

// ---------------------------------------------------------------- the player's session

test("a player's session: always Log & recap, read-only log, the recap they can write, no GM parts", async () => {
  const setRecap = jest.fn(ok);
  // `sv=plan` from a shared link: players never get the plan.
  const screen = await renderAsPlayer(journal({ s: played._id, sv: "plan" }), {
    queries: playerLogQueries(),
    mutations: { [fn(api.sessionWrap.setRecap)]: setRecap },
  });
  expect(screen.queryByRole("tablist", { name: "Session view" })).toBeNull();
  expect(screen.getByText("Written by the Combat Map as you play")).toBeTruthy();
  expect(screen.getByText("Vex rolled 14 with Hope")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Hide log line|Delete log line/ })).toBeNull();
  expect(screen.queryByLabelText("New log entry")).toBeNull();
  expect(screen.queryByRole("button", { name: "Session options" })).toBeNull();
  expect(screen.queryByRole("header", { name: "Session tally" })).toBeNull();
  expect(screen.queryByRole("header", { name: "After the session" })).toBeNull();
  // The GM keeps the spotlight to themself: the read is null and nothing shows.
  expect(screen.queryByRole("header", { name: "Spotlight" })).toBeNull();
  expect(screen.getByText("Find the ferryman")).toBeTruthy();
  for (const name of GM_READS) expect(screen.client.subscribed).not.toContain(name);

  expect(screen.getByText("They held the ford.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Edit recap" }));
  await fireEvent.changeText(screen.getByLabelText("Recap"), "They held the ford and lost the cart.");
  await fireEvent.press(screen.getByRole("button", { name: "Save recap" }));
  expect(setRecap).toHaveBeenCalledWith({ campaignId: "campaign-1", sessionId: played._id, recap: "They held the ford and lost the cart." });
});

test("a player sees the spotlight bars (no Reset) when the GM shares the balance", async () => {
  const screen = await renderAsPlayer(journal({ s: played._id }), { queries: playerLogQueries(spotlight) });
  expect(screen.getByRole("header", { name: "Spotlight" })).toBeTruthy();
  expect(screen.getByLabelText("Ash: 1 spotlight moment")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reset spotlight" })).toBeNull();
});

test("a player opening a planned session id sees 'not available' and loads nothing for it", async () => {
  const screen = await renderAsPlayer(journal({ s: "session-2" }), { queries: playerLogQueries() });
  expect(screen.getByText("That session isn't available. Pick one from the list.")).toBeTruthy();
  expect(screen.client.subscribed).not.toContain(fn(api.journalLog.list));
});

// ---------------------------------------------------------------- Notes

for (const role of ["player", "gm"] as const) {
  const render = role === "gm" ? renderAsGm : renderAsPlayer;

  test(`a ${role}: Open threads opens Notes on its threads view; the Notes tab hosts the notes`, async () => {
    const onNavigate = jest.fn<JournalNavigate>();
    const screen = await render(journal({}, onNavigate), { queries: baseQueries(role) });
    await fireEvent.press(screen.getByRole("button", { name: "Open threads: 0" }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "notes", view: "threads" });

    const notes = await render(journal({ tab: "notes", view: "threads" }), { queries: baseQueries(role) });
    expect(notes.getByRole("tab", { name: "Notes · 2 pages" }).props.accessibilityState).toEqual({ selected: true });
    expect(notes.queryByText("All sessions")).toBeNull();
    expect(notes.client.subscribed).not.toContain(fn(api.sessionRecords.summary));
    expect(notes.client.subscribed).toContain(fn(api.notes.journal));
  });
}
