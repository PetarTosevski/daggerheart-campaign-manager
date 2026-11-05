import { expect, test } from "@jest/globals";
import { useMutation, useQuery } from "convex/react";
import { Text } from "react-native";

import { api } from "../../src/convex";
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
    queries: { "campaigns:fear": 4 },
  });
  expect(screen.getByText("4")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:fear"]);

  const marked = await renderAsPlayer(<MarkOpened />);
  expect(marked.client.called).toEqual(["campaigns:markOpened"]);

  await expect(renderAsPlayer(<SetFear />)).rejects.toThrow("Player called GM function fear:set");
});

test("a GM render may subscribe to a GM query", async () => {
  const screen = await renderAsGm(<GmList />, { queries: { "encounters:list": [] } });
  expect(screen.client.subscribed).toEqual(["encounters:list"]);
  expect(screen.client.role).toBe("gm");
});
