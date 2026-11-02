import { expect, test } from "@jest/globals";

import AdversariesRoute from "../../app/campaign/[campaignId]/(gm)/adversaries";
import { CampaignProvider } from "../../src/shell/campaign-provider";
import { renderAsGm, renderAsPlayer } from "../harness";

const base = {
  _id: "campaign-1",
  name: "The Table",
};

test("a player who opens adversaries lands on the dashboard and does not subscribe to encounters:list", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Adversaries" })).toBeNull();
  expect(screen.getByText("Not built yet.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
  expect(screen.client.subscribed).not.toContain("encounters:list");
});

test("a GM query role opens the adversaries stub and subscribes to encounters:list", async () => {
  const screen = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "gm" } } },
  );
  expect(screen.getByRole("header", { name: "Adversaries" })).toBeTruthy();
  expect(screen.getByText("Not built yet.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "encounters:list"]);
});

test("the harness role does not decide the adversaries screen", async () => {
  const screen = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.client.subscribed).not.toContain("encounters:list");
});
