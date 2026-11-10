import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { CampaignProvider, useCampaign } from "../../src/shell/campaign-provider";
import { MoreSheet } from "../../src/shell/more-sheet";
import { TabBar } from "../../src/shell/tab-bar";
import { renderAsGm, renderAsPlayer } from "../harness";
import { campaignSummary } from "../harness/records";

beforeEach(() => {
  resetMotionTest();
});

const campaign = campaignSummary({
  _id: "campaign-1",
  name: "The Table",
  role: "player" as const,
});

function SheetFromQuery() {
  const loaded = useCampaign();
  return <MoreSheet isGm={loaded.role === "gm"} onClose={() => undefined} onSelect={() => undefined} open />;
}

test("the tab bar shows the four sections and More", async () => {
  const onSelect = jest.fn();
  const onMore = jest.fn();
  const screen = await render(<TabBar active="party" bottomInset={0} onMore={onMore} onSelect={onSelect} />);
  expect(screen.getByRole("tab", { name: "Dashboard" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Party" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Combat Map" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Journal" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Sessions" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Party" }).props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByRole("tab", { name: "Dashboard" }).props.accessibilityState).toEqual({ selected: false });
  await fireEvent.press(screen.getByRole("button", { name: "More" }));
  expect(onMore).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("tab", { name: "Journal" }));
  expect(onSelect).toHaveBeenCalledWith("journal");
});

test("a player More sheet has no Adversaries", async () => {
  const screen = await render(<MoreSheet isGm={false} onClose={() => undefined} onSelect={() => undefined} open />);
  expect(screen.getByRole("button", { name: "Codex" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "World Map" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Notes" })).toBeNull();
  expect(screen.getByRole("button", { name: "Lorekeeper" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Players" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tome" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Switch campaign" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Adversaries" })).toBeNull();
});

test("the GM More sheet lists Adversaries", async () => {
  const onSelect = jest.fn();
  const screen = await render(<MoreSheet isGm onClose={() => undefined} onSelect={onSelect} open />);
  await fireEvent.press(screen.getByRole("button", { name: "Adversaries" }));
  expect(onSelect).toHaveBeenCalledWith("adversaries");
});

test("More uses the role from campaigns.get", async () => {
  const asPlayer = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <SheetFromQuery />
    </CampaignProvider>,
    { queries: { "campaigns:get": campaign } },
  );
  expect(asPlayer.queryByRole("button", { name: "Adversaries" })).toBeNull();
  expect(asPlayer.client.subscribed).not.toContain("encounters:list");

  const asGm = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <SheetFromQuery />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...campaign, role: "gm" } } },
  );
  expect(asGm.getByRole("button", { name: "Adversaries" })).toBeTruthy();
  expect(asGm.client.subscribed).toEqual(["campaigns:get"]);
});
