import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";
import { Linking, Text } from "react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { api } from "../../src/convex";
import { CampaignProvider } from "../../src/shell/campaign-provider";
import { PhoneCombatMapGate, USE_THE_WEBSITE_TEXT } from "../../src/shell/combat-map-gate";
import { fn, renderAsPlayer } from "../harness";
import { campaign } from "../features/dashboard/fixtures";

const previous = process.env.EXPO_PUBLIC_PHONE_COMBAT_MAP;

beforeEach(() => {
  resetMotionTest();
  delete process.env.EXPO_PUBLIC_PHONE_COMBAT_MAP;
});

afterEach(() => {
  if (previous === undefined) delete process.env.EXPO_PUBLIC_PHONE_COMBAT_MAP;
  else process.env.EXPO_PUBLIC_PHONE_COMBAT_MAP = previous;
});

const flags = { journal: true, dice3d: true, phoneLayout: true, lorekeeperWeb: true, spriteTokens: true, shareLinks: true };

function gate() {
  return (
    <CampaignProvider campaignId="campaign-1">
      <PhoneCombatMapGate>
        <Text>The map</Text>
      </PhoneCombatMapGate>
    </CampaignProvider>
  );
}

test("with the phoneLayout switch on (and the build flag) the combat map opens", async () => {
  const screen = await renderAsPlayer(gate(), {
    queries: { [fn(api.campaigns.get)]: campaign("player"), [fn(api.features.mine)]: flags },
  });
  expect(screen.getByText("The map")).toBeTruthy();
});

test("with the phoneLayout switch off the phone says to use the website and links this campaign's map", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  const screen = await renderAsPlayer(gate(), {
    queries: { [fn(api.campaigns.get)]: campaign("player"), [fn(api.features.mine)]: { ...flags, phoneLayout: false } },
  });
  expect(screen.queryByText("The map")).toBeNull();
  expect(screen.getByText(USE_THE_WEBSITE_TEXT)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Open the website" }));
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/campaigns\/campaign-1\/combat-map$/));
});

test("the build flag off (EXPO_PUBLIC_PHONE_COMBAT_MAP=0) wins over the switch and reads nothing", async () => {
  process.env.EXPO_PUBLIC_PHONE_COMBAT_MAP = "0";
  const screen = await renderAsPlayer(gate(), {
    queries: { [fn(api.campaigns.get)]: campaign("player"), [fn(api.features.mine)]: flags },
  });
  expect(screen.getByText(USE_THE_WEBSITE_TEXT)).toBeTruthy();
  expect(screen.client.subscribed).not.toContain(fn(api.features.mine));
});
