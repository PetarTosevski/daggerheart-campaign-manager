import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";

import { configMessages } from "../../../../../src/lib/errors/config";
import { CAP_USER_TEXT, COMPOSER_LABEL, WEB_TOGGLE_GROUP_LABEL, WEB_TOGGLE_ON, questionsLeftLabel } from "../../../../../src/lib/lorekeeper/copy";
import { api } from "../../../src/convex";
import { LorekeeperChat } from "../../../src/features/lorekeeper/chat";
import { resetSelectionForTests } from "../../../src/features/lorekeeper/selection";
import type { LorekeeperChatProps } from "../../../src/features/lorekeeper/slots";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, conversationId, lorekeeperQueries } from "./fixture";

beforeEach(() => {
  resetMotionTest();
  resetSelectionForTests();
});

const chat = (isGm: boolean): LorekeeperChatProps => ({ campaignId, access: { isGm }, variant: "page" });
const rules = (canAsk: boolean, webAllowed: boolean) => ({ [fn(api.lorekeeper.access)]: { available: true, canAsk, webAllowed } });
const flags = (lorekeeperWeb: boolean) => ({
  [fn(api.features.mine)]: { journal: true, dice3d: true, phoneLayout: true, lorekeeperWeb, spriteTokens: true, shareLinks: true },
});

test("both roles subscribe to lorekeeper.access and features.mine", async () => {
  const player = await renderAsPlayer(<LorekeeperChat {...chat(false)} />, { queries: lorekeeperQueries("player") });
  expect(player.client.subscribed).toContain(fn(api.lorekeeper.access));
  expect(player.client.subscribed).toContain(fn(api.features.mine));
  const gm = await renderAsGm(<LorekeeperChat {...chat(true)} />, { queries: lorekeeperQueries("gm") });
  expect(gm.client.subscribed).toContain(fn(api.lorekeeper.access));
});

test("GM only: a player cannot ask and is told why", async () => {
  const screen = await renderAsPlayer(<LorekeeperChat {...chat(false)} />, {
    queries: lorekeeperQueries("player", rules(false, true)),
  });
  expect(screen.getByText(configMessages.LOREKEEPER_GM_ONLY)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ask" }).props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByLabelText(COMPOSER_LABEL).props.editable).toBe(false);
});

test("everyone may ask: a player's composer is open", async () => {
  const screen = await renderAsPlayer(<LorekeeperChat {...chat(false)} />, {
    queries: lorekeeperQueries("player", rules(true, true)),
  });
  expect(screen.queryByText(configMessages.LOREKEEPER_GM_ONLY)).toBeNull();
  expect(screen.getByRole("button", { name: "Ask" }).props.accessibilityState?.disabled).toBeFalsy();
});

test("the GM can always ask (access answers canAsk true for the owner)", async () => {
  const screen = await renderAsGm(<LorekeeperChat {...chat(true)} />, { queries: lorekeeperQueries("gm") });
  expect(screen.queryByText(configMessages.LOREKEEPER_GM_ONLY)).toBeNull();
});

test("the web toggle shows only when the campaign and the admin switch both allow it", async () => {
  const both = await renderAsGm(<LorekeeperChat {...chat(true)} />, { queries: lorekeeperQueries("gm") });
  expect(both.getByLabelText(WEB_TOGGLE_GROUP_LABEL)).toBeTruthy();

  const campaignOff = await renderAsGm(<LorekeeperChat {...chat(true)} />, { queries: lorekeeperQueries("gm", rules(true, false)) });
  expect(campaignOff.queryByLabelText(WEB_TOGGLE_GROUP_LABEL)).toBeNull();

  const switchOff = await renderAsGm(<LorekeeperChat {...chat(true)} />, { queries: lorekeeperQueries("gm", flags(false)) });
  expect(switchOff.queryByLabelText(WEB_TOGGLE_GROUP_LABEL)).toBeNull();

  const loading = await renderAsGm(<LorekeeperChat {...chat(true)} />, {
    queries: lorekeeperQueries("gm", { [fn(api.features.mine)]: undefined }),
  });
  expect(loading.queryByText(WEB_TOGGLE_ON)).toBeNull();
});

test("with web search not allowed an ask never requests it", async () => {
  const asked: unknown[] = [];
  const screen = await renderAsGm(<LorekeeperChat {...chat(true)} />, {
    queries: lorekeeperQueries("gm", rules(true, false)),
    mutations: {
      [fn(api.lorekeeper.ask)]: (args) => {
        asked.push(args);
        return { conversationId, answerId: "msg-a9" };
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText(COMPOSER_LABEL), "Fear?");
  await fireEvent.press(screen.getByRole("button", { name: "Ask" }));
  await waitFor(() => expect(asked).toHaveLength(1));
  expect(asked[0]).toMatchObject({ campaignId, conversationId, question: "Fear?", webSearch: false });
});

test("daily limits show: questions left near the cap, and the cap notice when spent", async () => {
  const near = await renderAsPlayer(<LorekeeperChat {...chat(false)} />, {
    queries: lorekeeperQueries("player", {
      [fn(api.lorekeeperUsage.mine)]: { questionsLeft: 3, webSearchesLeft: 10, campaignCapReached: false, deploymentCapReached: false, shortAnswers: false },
    }),
  });
  expect(near.getByText(questionsLeftLabel(3))).toBeTruthy();

  const spent = await renderAsPlayer(<LorekeeperChat {...chat(false)} />, {
    queries: lorekeeperQueries("player", {
      [fn(api.lorekeeperUsage.mine)]: { questionsLeft: 0, webSearchesLeft: 10, campaignCapReached: false, deploymentCapReached: false, shortAnswers: false },
    }),
  });
  expect(spent.getByText(CAP_USER_TEXT)).toBeTruthy();
});

test("Copy opens the share sheet with the answer", async () => {
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: Share.sharedAction } as Awaited<ReturnType<typeof Share.share>>);
  const screen = await renderAsPlayer(<LorekeeperChat {...chat(false)} />, { queries: lorekeeperQueries("player") });
  await fireEvent.press(screen.getByRole("button", { name: "Copy" }));
  expect(share).toHaveBeenCalledTimes(1);
  expect((share.mock.calls[0]?.[0] as { message: string }).message).toContain("Melee is adjacent.");
  await waitFor(() => expect(screen.getByText("Shared")).toBeTruthy());
  share.mockRestore();
});
