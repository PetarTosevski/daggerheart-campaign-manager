import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { TABLE_SETTING_DEFAULTS } from "../../../../../src/lib/config/campaign-settings";
import { api } from "../../../src/convex";
import { CampaignSettingsScreen } from "../../../src/features/settings/campaign-settings";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignRecord, inCampaign } from "../players/fixture";

const prefs = {
  dice3d: true,
  diceSound: false,
  diceVolume: 60,
  reduceMotion: false,
  textSize: "medium" as const,
  spotlightPing: true,
  legacyImported: true,
};

function campaign(role: "gm" | "player", extra: Record<string, unknown> = {}) {
  return {
    ...campaignRecord(role),
    settings: { ...TABLE_SETTING_DEFAULTS },
    archived: false,
    isCreator: role === "gm",
    ownerView: false,
    ...extra,
  };
}

beforeEach(() => {
  resetMotionTest();
});

test("a player sees only Preferences and never calls campaignSettings.set", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <CampaignSettingsScreen />), {
    queries: { [fn(api.campaigns.get)]: campaign("player"), [fn(api.preferences.get)]: prefs },
  });
  expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("header", { name: "Preferences" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Campaign settings" })).toBeNull();
  expect(screen.queryByRole("switch", { name: "Players see the GM’s Fear" })).toBeNull();
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.get), fn(api.preferences.get)]);
});

test("the GM changes each table setting with one single-field intent", async () => {
  const changes: unknown[] = [];
  const screen = await renderAsGm(inCampaign("gm", <CampaignSettingsScreen />), {
    queries: { [fn(api.campaigns.get)]: campaign("gm"), [fn(api.preferences.get)]: prefs },
    mutations: {
      [fn(api.campaignSettings.set)]: (args) => {
        changes.push(args);
        return null;
      },
    },
  });
  expect(screen.getByRole("header", { name: "Campaign settings" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Players see the GM’s Fear" }).props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });

  await fireEvent.press(screen.getByRole("switch", { name: "Players see the GM’s Fear" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Ask me" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Refuse" }));
  await fireEvent.press(screen.getByRole("switch", { name: "Show spotlight balance to players" }));
  await fireEvent.press(screen.getByRole("switch", { name: "Search the internet when the books don’t say" }));
  await fireEvent.press(screen.getByRole("radio", { name: "GM only" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Reset to number of PCs" }));
  await fireEvent.press(screen.getByRole("radio", { name: "Combat Map" }));
  await fireEvent.press(screen.getByRole("switch", { name: "Write the session log from the Combat Map" }));

  const campaignId = "campaign-1";
  await waitFor(() =>
    expect(changes).toEqual([
      { campaignId, change: { key: "playersSeeFear", value: false } },
      { campaignId, change: { key: "outOfRange", value: "refuse" } },
      { campaignId, change: { key: "spotlightToPlayers", value: true } },
      { campaignId, change: { key: "lorekeeperWeb", value: false } },
      { campaignId, change: { key: "lorekeeperAsk", value: "gm" } },
      { campaignId, change: { key: "fearAtStart", value: "pcs" } },
      { campaignId, change: { key: "sessionOpensOn", value: "combatMap" } },
      { campaignId, change: { key: "autoSessionLog", value: false } },
    ]),
  );
});

test("a refused change shows an alert", async () => {
  const screen = await renderAsGm(inCampaign("gm", <CampaignSettingsScreen />), {
    queries: { [fn(api.campaigns.get)]: campaign("gm"), [fn(api.preferences.get)]: prefs },
    mutations: {
      [fn(api.campaignSettings.set)]: () => {
        throw new Error("refused");
      },
    },
  });
  await fireEvent.press(screen.getByRole("switch", { name: "Players see the GM’s Fear" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
});

test("an archived campaign shows the settings read-only and sends nothing", async () => {
  const screen = await renderAsGm(inCampaign("gm", <CampaignSettingsScreen />), {
    queries: { [fn(api.campaigns.get)]: campaign("gm", { archived: true }), [fn(api.preferences.get)]: prefs },
  });
  const fear = screen.getByRole("switch", { name: "Players see the GM’s Fear" });
  expect(fear.props.accessibilityState).toEqual({ checked: true, disabled: true });
  await fireEvent.press(fear);
  expect(screen.client.called).not.toContain(fn(api.campaignSettings.set));
});
