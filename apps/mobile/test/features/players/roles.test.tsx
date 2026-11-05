import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { PlayersScreen } from "../../../src/features/players";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { accessEmptyCode, gmQueries, inCampaign, playerQueries } from "./fixture";

beforeEach(() => {
  resetMotionTest();
});

test("a player sees the table and never subscribes to members.access", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <PlayersScreen />), {
    queries: playerQueries(),
  });
  expect(screen.getByRole("header", { name: "Players" })).toBeTruthy();
  expect(screen.getByText(/Ash/)).toBeTruthy();
  expect(screen.getByText(/Nikola/)).toBeTruthy();
  expect(screen.queryByTestId("join-code")).toBeNull();
  expect(screen.queryByRole("button", { name: "Invite player" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove Nikola" })).toBeNull();
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.get), fn(api.members.roster)]);
  expect(screen.client.subscribed).not.toContain(fn(api.members.access));
});

test("the GM can invite, rotate the join code, and remove a player", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const writeText = jest.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.assign(globalThis.navigator, { clipboard: { writeText } });

  const screen = await renderAsGm(inCampaign("gm", <PlayersScreen />), {
    queries: gmQueries(),
    mutations: {
      [fn(api.members.invite)]: (args) => {
        calls.push({ name: "invite", args });
        return "invite-2";
      },
      [fn(api.members.rotateJoinCode)]: (args) => {
        calls.push({ name: "rotate", args });
        return "ABCD1234";
      },
      [fn(api.members.removePlayer)]: (args) => {
        calls.push({ name: "remove", args });
        return null;
      },
      [fn(api.members.revokeInvite)]: (args) => {
        calls.push({ name: "revoke", args });
        return null;
      },
    },
  });

  expect(screen.getByTestId("join-code").props.children).toBe("K7QM-3XRP");
  expect(screen.getByText(/friend@example\.test/)).toBeTruthy();
  expect(screen.getByText(/nikola@example\.test/)).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Copy join link" }));
  expect(writeText).toHaveBeenCalledWith("https://dualityheart.com/join/K7QM-3XRP");

  await fireEvent.press(screen.getByRole("button", { name: "New code" }));
  expect(calls.find((row) => row.name === "rotate")?.args).toEqual({
    campaignId: "campaign-1",
    replace: true,
  });

  await fireEvent.changeText(screen.getByLabelText("Player email"), "new@example.test");
  await fireEvent.press(screen.getByRole("button", { name: "Invite player" }));
  expect(calls.find((row) => row.name === "invite")?.args).toEqual({
    campaignId: "campaign-1",
    email: "new@example.test",
  });

  await fireEvent.press(screen.getByRole("button", { name: "Revoke invite for friend@example.test" }));
  expect(calls.find((row) => row.name === "revoke")?.args).toEqual({ inviteId: "invite-1" });

  await fireEvent.press(screen.getByRole("button", { name: "Remove Nikola" }));
  expect(calls.find((row) => row.name === "remove")?.args).toEqual({
    campaignId: "campaign-1",
    userId: "player-1",
  });
});

test("the GM gets a join code on first open when none exists yet", async () => {
  const screen = await renderAsGm(inCampaign("gm", <PlayersScreen />), {
    queries: gmQueries({ [fn(api.members.access)]: accessEmptyCode }),
    mutations: {
      [fn(api.members.rotateJoinCode)]: () => "WXYZ5678",
    },
  });
  expect(screen.client.called).toContain(fn(api.members.rotateJoinCode));
  expect(screen.getByTestId("join-code").props.children).toBe("…");
});

test("loading, unreadable roster, and offline GM controls", async () => {
  const loading = await renderAsPlayer(inCampaign("player", <PlayersScreen />), {
    queries: { [fn(api.campaigns.get)]: playerQueries()[fn(api.campaigns.get)] },
  });
  expect(loading.getByRole("progressbar", { name: "Loading players" })).toBeTruthy();

  const broken = await renderAsPlayer(inCampaign("player", <PlayersScreen />), {
    queries: playerQueries({ [fn(api.members.roster)]: { bad: true } }),
  });
  expect(broken.getByText("The roster could not be read.")).toBeTruthy();

  const calls: unknown[] = [];
  const offline = await renderAsGm(inCampaign("gm", <PlayersScreen />, true), {
    queries: gmQueries(),
    mutations: {
      [fn(api.members.removePlayer)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(offline.getByText("Showing the last update.")).toBeTruthy();
  const remove = offline.getByRole("button", { name: "Remove Nikola" });
  expect(remove.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(remove);
  expect(calls).toEqual([]);
});
