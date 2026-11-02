import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { PanelBoundary } from "../../../src/features/dashboard/chrome";
import { PartyBlock } from "../../../src/features/dashboard/party";
import { RestLauncher } from "../../../src/features/dashboard/rests";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { ERROR_TEXT, campaignId, character, failQuery, restState } from "./fixtures";

jest.mock("expo-crypto", () => {
  let keys = 0;
  return {
    randomUUID: () => {
      keys += 1;
      return `00000000-0000-4000-8000-${String(keys).padStart(12, "0")}`;
    },
  };
});

beforeEach(() => {
  resetMotionTest();
});

const briar = character();
const ash = character({
  _id: "char-2",
  status: "dead",
  sheet: { name: "Ash", level: 1, hp: 0, hpMax: 6, stress: 0, stressMax: 6, hope: 0, scars: 0 },
});

const openRest = restState({
  open: {
    _id: "rest-open",
    kind: "short",
    startedAt: 1,
    gmOverride: false,
    choices: [{ characterId: "char-1", moves: [{ move: "tendToWounds" }, { move: "clearStress" }] }],
    moves: [],
  },
  last: null,
});

function ui(isGm: boolean, offline = false) {
  return (
    <OfflineFrame offline={offline}>
      <PartyBlock campaignId={campaignId} isGm={isGm} />
    </OfflineFrame>
  );
}

test("a player with no open rest does not mount Rest or afterRest", async () => {
  const screen = await renderAsPlayer(ui(false), {
    queries: {
      "characters:partySummary": [briar],
      "rests:current": restState(),
    },
  });
  expect(screen.getByText("Briar")).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Rest" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start short rest" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["characters:partySummary", "rests:current"]);
  expect(screen.client.subscribed).not.toContain("countdownTracks:afterRest");
});

test("an open rest shows the player's moves and hides Finish", async () => {
  const screen = await renderAsPlayer(ui(false), {
    queries: {
      "characters:partySummary": [briar],
      "rests:current": openRest,
    },
  });
  expect(screen.getByText("Short rest under way. Each player picks two moves on their sheet.")).toBeTruthy();
  expect(screen.getByText("Briar: Tend to Wounds, Clear Stress")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Finish rest" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
  expect(screen.client.subscribed).not.toContain("countdownTracks:afterRest");
});

test("the GM starts, finishes, undoes, and sees a long-rest tick only after a finished long rest", async () => {
  const starts: { kind: string }[] = [];
  const idle = await renderAsGm(ui(true), {
    queries: {
      "characters:partySummary": [briar],
      "rests:current": restState({ shortRestsSinceLong: 3 }),
      "countdownTracks:afterRest": { restId: "rest-1", lines: [], reminders: [] },
    },
    mutations: {
      "rests:start": (args) => {
        starts.push(args as { kind: string });
        return null;
      },
    },
  });
  expect(idle.getByText("3 of 3 short rests")).toBeTruthy();
  expect(idle.getByText("Three short rests taken: the next rest must be a long rest (CB 105).")).toBeTruthy();
  expect(idle.getByText("Last: Long rest · GM gained 1 Fear")).toBeTruthy();
  const short = idle.getByRole("button", { name: "Start short rest" });
  expect(short.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(idle.getByRole("button", { name: "Start long rest" }));
  expect(starts).toEqual([expect.objectContaining({ kind: "long", campaignId })]);
  expect(idle.client.subscribed).toContain("countdownTracks:afterRest");

  const finishes: { restId: string }[] = [];
  const running = await renderAsGm(ui(true), {
    queries: {
      "characters:partySummary": [briar, ash],
      "rests:current": openRest,
    },
    mutations: {
      "rests:finish": (args) => {
        finishes.push(args as { restId: string });
        return null;
      },
    },
  });
  await fireEvent.press(running.getByRole("button", { name: "Finish rest" }));
  expect(finishes).toEqual([expect.objectContaining({ restId: "rest-open" })]);
  expect(running.getByRole("button", { name: "Revive Ash" })).toBeTruthy();
  expect(running.client.subscribed).not.toContain("countdownTracks:afterRest");
});

test("rests cover loading, an empty party, a failed query, and offline", async () => {
  const loading = await renderAsGm(ui(true), { queries: {} });
  expect(loading.getByText("Loading the party")).toBeTruthy();
  expect(loading.getByText("Loading rests")).toBeTruthy();

  const empty = await renderAsPlayer(ui(false), {
    queries: { "characters:partySummary": [], "rests:current": restState({ last: null }) },
  });
  expect(empty.getByText("No characters yet. Open the Party tab to create the first hero.")).toBeTruthy();
  expect(empty.queryByRole("header", { name: "Rest" })).toBeNull();

  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = await renderAsPlayer(
    <PanelBoundary title="Rest">
      <RestLauncher campaignId={campaignId} isGm={false} party={[briar]} />
    </PanelBoundary>,
    { queries: { "rests:current": failQuery } },
  );
  expect(broken.getByRole("header", { name: "Rest" })).toBeTruthy();
  expect(broken.getByText(ERROR_TEXT)).toBeTruthy();

  const offline = await renderAsGm(ui(true, true), {
    queries: {
      "characters:partySummary": [briar],
      "rests:current": restState({ last: null }),
      "countdownTracks:afterRest": { restId: "rest-1", lines: [], reminders: [] },
    },
  });
  expect(offline.getByText("Showing the last update.")).toBeTruthy();
  const start = offline.getByRole("button", { name: "Start long rest" });
  expect(start.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(start);
  expect(offline.client.called).not.toContain("rests:start");
});
