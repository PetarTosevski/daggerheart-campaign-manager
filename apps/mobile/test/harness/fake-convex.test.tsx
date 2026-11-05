import { expect, test } from "@jest/globals";
import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { Text } from "react-native";

import { api } from "../../src/convex";
import { fn, scanPublicFunctions } from "./convex-functions";
import { renderAsGm, renderAsPlayer } from "./render";

function GmList() {
  useQuery(api.encounters.list, {} as never);
  return null;
}

function SkippedGmList() {
  useQuery(api.encounters.list, "skip");
  useQuery(api.encounters.list, "skip");
  return null;
}

function FearValue() {
  const value = useQuery(api.campaigns.fear, { campaignId: "c" } as never);
  return <Text>{String(value)}</Text>;
}

function FearTwice() {
  useQuery(api.campaigns.fear, { campaignId: "c" } as never);
  useQuery(api.campaigns.fear, { campaignId: "c" } as never);
  return null;
}

function MarkOpened() {
  const markOpened = useMutation(api.campaigns.markOpened);
  markOpened({ campaignId: "c" } as never);
  return null;
}

function SetFear() {
  const setFear = useMutation(api.fear.set);
  setFear({} as never);
  return null;
}

test("a player render that subscribes to a GM query fails and names it", async () => {
  await expect(renderAsPlayer(<GmList />)).rejects.toThrow(
    "Player subscribed to GM function encounters:list",
  );
});

test("passing skip does not subscribe and does not fail", async () => {
  const screen = await renderAsPlayer(<SkippedGmList />);
  expect(screen.client.subscribed).toEqual([]);
  expect(screen.client.called).toEqual([]);
});

test("a duplicate subscription is reported", async () => {
  await expect(renderAsPlayer(<FearTwice />)).rejects.toThrow(
    "Duplicate subscription campaigns:fear",
  );
});

test("a player render records a query and a mutation, and a GM call fails naming it", async () => {
  const screen = await renderAsPlayer(<FearValue />, {
    queries: { [fn(api.campaigns.fear)]: 4 },
  });
  expect(screen.getByText("4")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:fear"]);

  const marked = await renderAsPlayer(<MarkOpened />);
  expect(marked.client.called).toEqual(["campaigns:markOpened"]);

  await expect(renderAsPlayer(<SetFear />)).rejects.toThrow("Player called GM function fear:set");
});

test("a GM render may subscribe to a GM query", async () => {
  const screen = await renderAsGm(<GmList />, { queries: { [fn(api.encounters.list)]: [] } });
  expect(screen.client.subscribed).toEqual(["encounters:list"]);
  expect(screen.client.role).toBe("gm");
});

/** `adversaryActions.pending` moved to `adversaryActionsReads.pending`; `anyApi` still builds the old reference. */
const stalePending = anyApi.adversaryActions.pending;

function StaleQuery() {
  useQuery(stalePending, { campaignId: "c" });
  return null;
}

function StaleMutation() {
  const run = useMutation(anyApi.adversaryActions.renamedAway);
  run({});
  return null;
}

test("the public function scan lists queries, mutations and actions but not internal ones", () => {
  const names = scanPublicFunctions();
  expect(names).toContain("adversaryActionsReads:pending");
  expect(names).toContain("adversaryActions:respond");
  expect(names).toContain("auth:signIn");
  expect(names).not.toContain("adversaryActions:pending");
  expect(names.some((name) => name.startsWith("lib/functions:"))).toBe(false);
});

test("a mock key built from a moved or renamed reference throws", () => {
  expect(fn(api.adversaryActionsReads.pending)).toBe("adversaryActionsReads:pending");
  expect(() => fn(stalePending)).toThrow("Unknown Convex function adversaryActions:pending");
});

test("a hand-written mock key for a function that does not exist throws", async () => {
  await expect(
    renderAsPlayer(<FearValue />, { queries: { "campaigns:fear": 1, "adversaryActions:pending": [] } }),
  ).rejects.toThrow("Unknown Convex function adversaryActions:pending (mocked in queries)");
});

test("subscribing to or calling a function that does not exist throws", async () => {
  await expect(renderAsPlayer(<StaleQuery />)).rejects.toThrow(
    "Unknown Convex function adversaryActions:pending (subscribed)",
  );
  await expect(renderAsPlayer(<StaleMutation />)).rejects.toThrow(
    "Unknown Convex function adversaryActions:renamedAway (called as a mutation)",
  );
});
