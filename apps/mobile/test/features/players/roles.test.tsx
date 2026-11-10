import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { PlayersScreen } from "../../../src/features/players";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignSummary } from "../../harness/records";
import { accessEmptyCode, campaignRecord, gmQueries, gmRoster, inCampaign, playerQueries } from "./fixture";

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
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: Share.sharedAction } as Awaited<ReturnType<typeof Share.share>>);

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

  await fireEvent.press(screen.getByRole("button", { name: "Share join link" }));
  expect(share).toHaveBeenCalledWith({ message: "https://dualityheart.com/join/K7QM-3XRP" });
  await waitFor(() => expect(screen.getByText("Link shared")).toBeTruthy());
  share.mockRestore();

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
  expect(calls.find((row) => row.name === "remove")).toBeUndefined();
  await fireEvent.press(screen.getByRole("button", { name: "Confirm remove Nikola" }));
  expect(calls.find((row) => row.name === "remove")?.args).toEqual({
    campaignId: "campaign-1",
    userId: "player-1",
  });
});

test("with no join code yet, nothing is written until the GM taps Make a join code", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign("gm", <PlayersScreen />), {
    queries: gmQueries({ [fn(api.members.access)]: accessEmptyCode }),
    mutations: {
      [fn(api.members.rotateJoinCode)]: (args) => {
        calls.push(args);
        return "WXYZ5678";
      },
    },
  });
  expect(screen.client.called).toEqual([]);
  expect(screen.getByTestId("join-code").props.children).toBe("…");
  expect(screen.queryByRole("button", { name: "Share join link" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New code" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Make a join code" }));
  expect(calls).toEqual([{ campaignId: "campaign-1" }]);
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
  expect(offline.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const remove = offline.getByRole("button", { name: "Remove Nikola" });
  expect(remove.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(remove);
  expect(calls).toEqual([]);
});

const coGmRoster = {
  ...gmRoster,
  players: [
    { userId: "player-1", name: "Nikola", email: "nikola@example.test", joinedAt: 1, coGm: false },
    { userId: "player-2", name: "Vesna", email: "vesna@example.test", joinedAt: 2, coGm: true },
  ],
};

test("the creator promotes a member to co-GM and back, and invites as co-GM", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const screen = await renderAsGm(inCampaign("gm", <PlayersScreen />), {
    queries: gmQueries({ [fn(api.members.roster)]: coGmRoster }),
    mutations: {
      [fn(api.members.setCoGm)]: (args) => {
        calls.push({ name: "setCoGm", args });
        return null;
      },
      [fn(api.members.invite)]: (args) => {
        calls.push({ name: "invite", args });
        return "invite-3";
      },
    },
  });
  // Co-GMs first, with the badge; the creator reads as "You".
  expect(screen.getByText(/^You/)).toBeTruthy();
  const names = screen.getAllByText(/Nikola|Vesna/).map((node) => String((node.props.children as unknown[])[0]));
  expect(names).toEqual(["Vesna", "Nikola"]);
  expect(screen.getByText(/· Co-GM/)).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Make co-GM: Nikola" }));
  await fireEvent.press(screen.getByRole("button", { name: "Remove co-GM: Vesna" }));
  expect(calls.filter((row) => row.name === "setCoGm").map((row) => row.args)).toEqual([
    { campaignId: "campaign-1", userId: "player-1", coGm: true },
    { campaignId: "campaign-1", userId: "player-2", coGm: false },
  ]);

  await fireEvent.press(screen.getByRole("radio", { name: "Co-GM" }));
  await fireEvent.changeText(screen.getByLabelText("Player email"), "cogm@example.test");
  await fireEvent.press(screen.getByRole("button", { name: "Invite player" }));
  expect(calls.find((row) => row.name === "invite")?.args).toEqual({
    campaignId: "campaign-1",
    email: "cogm@example.test",
    asCoGm: true,
  });
});

test("a co-GM removes players but not co-GMs, and cannot promote or invite as co-GM", async () => {
  const screen = await renderAsGm(inCampaign("gm", <PlayersScreen />), {
    queries: gmQueries({
      [fn(api.campaigns.get)]: campaignSummary({ ...campaignRecord("gm"), isCreator: false }),
      [fn(api.members.roster)]: coGmRoster,
    }),
  });
  expect(screen.getByRole("button", { name: "Remove Nikola" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove Vesna" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Make co-GM: Nikola" })).toBeNull();
  expect(screen.queryByRole("radiogroup", { name: "Invite as" })).toBeNull();
  expect(screen.getByText(/^Ash/)).toBeTruthy();
});
