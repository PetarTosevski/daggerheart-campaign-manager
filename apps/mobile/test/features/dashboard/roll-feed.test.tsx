import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { RollFeed } from "../../../src/features/dashboard/roll-feed";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { ERROR_TEXT, actionRoll, campaignId, failQuery } from "./fixtures";

const seenPages: unknown[][] = [];

jest.mock("expo-crypto", () => {
  let keys = 0;
  return {
    randomUUID: () => {
      keys += 1;
      return `00000000-0000-4000-8000-${String(keys).padStart(12, "0")}`;
    },
  };
});

jest.mock("convex/react", () => {
  const actual = jest.requireActual("convex/react") as {
    useQuery: (ref: unknown, ...args: unknown[]) => unknown;
    useMutation: (ref: unknown) => (args?: unknown) => unknown;
    useAction: (ref: unknown) => (args?: unknown) => unknown;
    usePaginatedQuery: (ref: unknown, ...args: unknown[]) => unknown;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fake = require("../../harness/mock-convex-react") as typeof actual & { hasActiveClient: () => boolean };
  return {
    ...actual,
    useQuery: (ref: unknown, ...args: unknown[]) =>
      fake.hasActiveClient() ? fake.useQuery(ref, ...args) : actual.useQuery(ref, ...args),
    useMutation: (ref: unknown) => (fake.hasActiveClient() ? fake.useMutation(ref) : actual.useMutation(ref)),
    useAction: (ref: unknown) => (fake.hasActiveClient() ? fake.useAction(ref) : actual.useAction(ref)),
    usePaginatedQuery: (ref: unknown, ...args: unknown[]) => {
      seenPages.push(args);
      return fake.hasActiveClient()
        ? fake.usePaginatedQuery(ref, ...args)
        : actual.usePaginatedQuery(ref, ...args);
    },
  };
});

beforeEach(() => {
  resetMotionTest();
  seenPages.length = 0;
});

function ui(isGm: boolean, offline = false) {
  return (
    <OfflineFrame offline={offline}>
      <RollFeed campaignId={campaignId} isGm={isGm} />
    </OfflineFrame>
  );
}

const page = {
  results: [actionRoll({ revealable: true, visibility: "gm" })],
  status: "CanLoadMore" as const,
  loadMore: jest.fn(),
};

test("the feed asks for 15 rows and shows the server dice", async () => {
  const loadMore = jest.fn();
  const screen = await renderAsPlayer(ui(false), {
    queries: {
      "feed:list": { ...page, loadMore, results: [actionRoll()] },
    },
  });
  expect(seenPages).toContainEqual([{ campaignId }, { initialNumItems: 15 }]);
  expect(screen.getByLabelText("Hope d12: 8")).toBeTruthy();
  expect(screen.getByLabelText("Fear d12: 3")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Show older rolls" }));
  expect(loadMore).toHaveBeenCalledWith(15);
  expect(screen.queryByRole("button", { name: "Roll in secret" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear feed" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete from the feed: Briar rolls" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["feed:list"]);
  expect(screen.client.subscribed).not.toContain("countdownRolls:countedRows");
});

test("the GM can roll, reveal, delete, undo, and tick only after opening the sheet", async () => {
  const calls: unknown[] = [];
  const record = (args: unknown) => {
    calls.push(args);
    return null;
  };
  const screen = await renderAsGm(ui(true), {
    queries: {
      "feed:list": page,
      "countdownRolls:countedRows": ["row-1"],
      "countdownRolls:preview": {
        countdowns: [{ countdownId: "cd-1", name: "The Lure", amount: 2, ticked: false }],
      },
    },
    mutations: {
      "rolls:gmRoll": record,
      "rolls:reveal": record,
      "feed:remove": record,
      "actionLog:undo": record,
      "countdownRolls:applyRoll": record,
    },
  });
  expect(screen.client.subscribed).toEqual(["feed:list", "countdownRolls:countedRows"]);
  expect(screen.client.subscribed).not.toContain("countdownRolls:preview");

  await fireEvent.press(screen.getByRole("button", { name: "Roll in secret" }));
  await fireEvent.press(screen.getByRole("button", { name: "Reveal Briar rolls" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete from the feed: Briar rolls" }));
  await fireEvent.press(screen.getByRole("button", { name: "Undo Briar rolls" }));
  expect(screen.client.called).toEqual(["rolls:gmRoll", "rolls:reveal", "feed:remove", "actionLog:undo"]);

  await fireEvent.press(screen.getByRole("button", { name: "Tick countdowns for Briar rolls" }));
  expect(screen.client.subscribed).toContain("countdownRolls:preview");
  expect(screen.getByText("The Lure: tick 2")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Apply roll to countdowns" }));
  expect(calls.some((args) => {
    const call = args as { countdownIds?: string[] };
    return Array.isArray(call.countdownIds) && call.countdownIds[0] === "cd-1";
  })).toBe(true);
});

test("the feed covers loading, empty, error, and an offline secret roll", async () => {
  const loading = await renderAsPlayer(ui(false), { queries: {} });
  expect(loading.getByText("Loading rolls")).toBeTruthy();

  const empty = await renderAsPlayer(ui(false), { queries: { "feed:list": [] } });
  expect(empty.getByText("No rolls yet. Roll from a character sheet and it shows up here for everyone.")).toBeTruthy();

  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = await renderAsPlayer(ui(false), { queries: { "feed:list": failQuery } });
  expect(broken.getByRole("header", { name: "Roll Feed" })).toBeTruthy();
  expect(broken.getByText(ERROR_TEXT)).toBeTruthy();

  const offline = await renderAsGm(ui(true, true), { queries: { "feed:list": [] } });
  expect(offline.getByText("Showing the last update.")).toBeTruthy();
  const secret = offline.getByRole("button", { name: "Roll in secret" });
  expect(secret.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(secret);
  expect(offline.client.called).not.toContain("rolls:gmRoll");
});
