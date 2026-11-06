import { expect as baseExpect, test, type Page } from "@playwright/test";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { appBar, artHeader, gear } from "./config/helpers";
import { signInAsTestGm } from "./fixtures";
import { E2E_OWNER_EMAIL, openFromOverview, setAppOwner } from "./owner";
import { convexAs } from "./visual/helpers";

// Plan config AU7 (Q27 b, N1 changed; server AD13, Overview AU1): the app owner opens another GM's campaign from App
// admin › Overview. Every campaign page (dashboard, Journal, Combat Map) shows 'Read-only view · You are not in this
// campaign. Nothing can be changed here.' (role=status), with no gear and no Players button; a write is refused.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

// The shared e2e owner (tests/e2e/owner.ts): every owner spec uses the same account, so none hands the role away.
const OWNER = E2E_OWNER_EMAIL;
const BANNER = "Read-only view · You are not in this campaign. Nothing can be changed here.";

const banner = (page: Page) => page.getByTestId("owner-view-banner");

async function expectReadOnlyChrome(page: Page) {
  await expect(banner(page)).toHaveText(BANNER);
  await expect(banner(page)).toHaveAttribute("role", "status");
  await expect(page.getByRole("button", { name: "Campaign settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Players", exact: true })).toHaveCount(0);
}

test("the owner opens another GM's campaign read-only from the Overview: banner on every page, no settings, writes refused", async ({ browser }) => {
  const gmContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const gm = await gmContext.newPage();
  const owner = await ownerContext.newPage();
  try {
    // Another GM's campaign (the default e2e GM account).
    await signInAsTestGm(gm);
    await expect(gm).toHaveURL("/");
    const gmClient = await convexAs(gm);
    const name = `Owner view ${crypto.randomUUID().slice(0, 8)}`;
    const { campaignId } = await gmClient.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: crypto.randomUUID() });

    await signInAsTestGm(owner, OWNER);
    await expect(owner).toHaveURL("/");
    setAppOwner();

    // Overview › Campaigns › Open: logs the visit, then the read-only dashboard (newest campaigns first).
    await owner.goto("/admin?tab=overview");
    await openFromOverview(owner, name);
    await expect(owner).toHaveURL(`/campaigns/${campaignId}`);
    await expect(owner.getByRole("heading", { level: 1, name })).toBeVisible();
    await expectReadOnlyChrome(owner);
    await expect(gear(artHeader(owner))).toHaveCount(0);
    await expect(owner.getByRole("button", { name: "Start Session" })).toHaveCount(0);
    await expectNoSeriousA11yViolations(owner);

    // The Journal reads, with the banner.
    await owner.goto(`/campaigns/${campaignId}/journal`);
    await expect(owner.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
    await expectReadOnlyChrome(owner);
    await expectNoSeriousA11yViolations(owner);

    // The Combat Map's app bar has no gear either.
    await owner.setViewportSize({ width: 1440, height: 900 });
    await owner.goto(`/campaigns/${campaignId}/combat-map`);
    await expect(appBar(owner)).toBeVisible();
    await expect(gear(appBar(owner))).toHaveCount(0);
    await expectReadOnlyChrome(owner);
    await expectNoSeriousA11yViolations(owner);

    // A write is refused (the owner is an outsider to every mutation, AD13) and changes nothing.
    const ownerClient = await convexAs(owner);
    const write = ownerClient.mutation(api.campaigns.markOpened, { campaignId });
    await expect(write).rejects.toBeInstanceOf(ConvexError);
    await write.catch((error: ConvexError<{ code: string }>) => expect(["NOT_FOUND", "FORBIDDEN", "OWNER_VIEW_READ_ONLY"]).toContain(error.data.code));
    const gmView = await gmClient.query(api.campaigns.get, { campaignId });
    expect(gmView?.name).toBe(name);
  } finally {
    await gmContext.close();
    await ownerContext.close();
  }
});
