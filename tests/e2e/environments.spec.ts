import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoHorizontalScroll, openAdversaries } from "./visual/helpers";

// EV1: the Adversaries page's Environment tab: the environment stat blocks of the Core Rulebook and (with the Hope &
// Fear switch on) Hope & Fear, with search, Order / Tier / Type / Book chips, collapsible tiers and a parchment stat
// block whose potential adversaries open in the Catalogue tab.

const list = (page: Page) => page.getByRole("region", { name: "Environment list" });
const statBlock = (page: Page) => page.getByRole("complementary", { name: "Environment stat block" });
const row = (page: Page, name: string) => list(page).getByRole("button", { name: new RegExp(`^${name}`) });

async function openEnvironmentTab(page: Page) {
  const tab = page.getByRole("tablist", { name: "Adversary views" }).getByRole("tab", { name: "Environment" });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Environment" })).toBeVisible();
}

test("the Environment tab lists the Core environments and searches them, apostrophes folded", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  await openEnvironmentTab(page);
  await expect(page.getByTestId("environment-count")).toHaveText("19 environments");
  await expect(list(page).getByRole("heading", { level: 3 })).toHaveText([/^Tier 1/, /^Tier 2/, /^Tier 3/, /^Tier 4/]);
  await expect(list(page).getByRole("group", { name: "Book", exact: true })).toHaveCount(0);
  // The first match is selected: Abandoned Grove (A–Z).
  await expect(row(page, "Abandoned Grove")).toHaveAttribute("aria-current", "true");

  await list(page).getByRole("searchbox", { name: "Search environments" }).fill("necromancer's");
  await expect(page.getByTestId("environment-count")).toHaveText("1 of 19 shown");
  await expect(row(page, "Necromancer’s Ossuary")).toHaveAttribute("aria-current", "true");
  await expect(statBlock(page).getByRole("heading", { level: 2, name: "Necromancer’s Ossuary" })).toBeVisible();
});

test("Tier and Type chips filter, a second click clears, tiers collapse, and the empty state", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  await openEnvironmentTab(page);
  const tier = list(page).getByRole("group", { name: "Tier", exact: true });
  const type = list(page).getByRole("group", { name: "Type", exact: true });
  await type.getByRole("button", { name: "Event", exact: true }).click();
  await expect(page.getByTestId("environment-count")).toHaveText("6 of 19 shown");
  for (const t of await list(page).locator(".adc-type").allTextContents()) expect(t).toBe("Event");
  await tier.getByRole("button", { name: "3", exact: true }).click();
  await expect(list(page).getByRole("heading", { level: 3 })).toHaveText([/^Tier 3/]);
  await expect(list(page).locator(".adc-item")).toHaveText([/^Castle Siege/, /^Pitched Battle/]);
  await tier.getByRole("button", { name: "3", exact: true }).click();
  await expect(tier.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await type.getByRole("button", { name: "Event", exact: true }).click();
  await expect(page.getByTestId("environment-count")).toHaveText("19 environments");

  // Folding Tier 1 hides its rows but keeps its heading.
  const tier1 = list(page).getByRole("button", { name: /^Tier 1/ });
  await tier1.click();
  await expect(tier1).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, "Raging River")).toHaveCount(0);
  await expect(row(page, "Cult Ritual")).toBeVisible();
  await tier1.click();
  await expect(row(page, "Raging River")).toBeVisible();

  // Book order puts the Core blocks in page order: Ambushed (p.243) before Bustling Marketplace.
  await list(page).getByRole("group", { name: "Order", exact: true }).getByRole("button", { name: "Book order" }).click();
  await expect(list(page).locator(".adc-item").nth(1)).toHaveText(/^Ambushed/);
  await list(page).getByRole("group", { name: "Order", exact: true }).getByRole("button", { name: "A–Z" }).click();

  await list(page).getByRole("searchbox", { name: "Search environments" }).fill("zzzz no such place");
  await expect(list(page).getByText("No environments match these filters. Clear the search or pick another tier or type.")).toBeVisible();
  await expect(statBlock(page).locator(".adc-sb")).toHaveCount(0);
});

test("the stat block shows impulses, difficulty, adversaries, badges and questions; an adversary opens in the Catalogue", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  await openEnvironmentTab(page);
  await row(page, "Raging River").click();
  const block = statBlock(page);
  await expect(block.getByRole("heading", { level: 2, name: "Raging River" })).toBeVisible();
  await expect(block.getByText("Tier 1 Traversal")).toBeVisible();
  await expect(block.getByText("Bar crossing, carry away the unready, divide the land")).toBeVisible();
  await expect(block.getByTestId("environment-difficulty")).toHaveText("10");
  const feature = (name: string) => block.locator(".adc-feat").filter({ has: page.locator(".adc-feat-h strong", { hasText: new RegExp(`^${name}$`) }) });
  const undertow = feature("Undertow");
  await expect(undertow.locator(".adc-kind")).toHaveText(["Action", "Fear 1"]);
  await expect(undertow.locator(".env-q")).toHaveText("What trinkets and baubles lie along the bottom of the riverbed? Do predators swim these rivers?");
  await expect(undertow.locator(".env-q")).toHaveCSS("font-style", "italic");
  await expect(block.getByText("Core Rulebook · p. 245")).toBeVisible();

  // A countdown badge (Mountain Pass, "Icy Winds").
  await row(page, "Mountain Pass").click();
  await expect(feature("Icy Winds").locator(".adc-kind")).toHaveText(["Reaction", "Countdown (Loop 4)"]);

  // Potential adversaries open in a panel right in the Environment tab; Close dismisses it.
  await row(page, "Raging River").click();
  await block.getByRole("button", { name: "Show the Glass Snake stat block" }).click();
  await expect(page.getByRole("tab", { name: "Environment" })).toHaveAttribute("aria-selected", "true");
  const opened = page.getByRole("region", { name: "Glass Snake, opened from Raging River" });
  await expect(opened.getByRole("heading", { level: 2, name: "Glass Snake" })).toBeVisible();
  await expect(opened.getByRole("button", { name: "Add Glass Snake to an encounter" })).toBeVisible();
  await expect(opened.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
  await opened.getByRole("button", { name: "Close" }).click();
  await expect(opened).toHaveCount(0);
  await expect(statBlock(page).getByRole("heading", { level: 2, name: "Raging River" })).toBeVisible();
  await expect(row(page, "Raging River")).toHaveAttribute("aria-current", "true");
});

test("Hope & Fear environments and adversary links follow the campaign's switch", async ({ page }) => {
  const { client, campaignId } = await openAdversaries(page, "witherwild");
  await openEnvironmentTab(page);
  await list(page).getByRole("searchbox", { name: "Search environments" }).fill("mine");
  await expect(row(page, "Abandoned Mine")).toHaveCount(0);

  await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  await expect(row(page, "Abandoned Mine")).toBeVisible();
  await list(page).getByRole("searchbox", { name: "Search environments" }).fill("");
  await expect(page.getByTestId("environment-count")).toHaveText("47 environments · 19 core, 28 Hope & Fear");
  await list(page).getByRole("group", { name: "Book", exact: true }).getByRole("button", { name: "Hope & Fear" }).click();
  await expect(page.getByTestId("environment-count")).toHaveText("28 of 47 shown");
  await row(page, "Abandoned Mine").click();
  const block = statBlock(page);
  await expect(block.getByRole("img", { name: "Hope and Fear" })).toBeVisible();
  await expect(block.getByText("Hope & Fear · p. 99")).toBeVisible();
  // The mine's Hope & Fear adversaries are links while the switch is on.
  await expect(block.getByRole("button", { name: "Show the Darkweave Crawler stat block" })).toBeVisible();

  await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
  await expect(page.getByTestId("environment-count")).toHaveText("19 environments");
  await expect(list(page).getByRole("group", { name: "Book", exact: true })).toHaveCount(0);
  // Core environments still link Core adversaries but not Hope & Fear ones.
  await list(page).getByRole("searchbox", { name: "Search environments" }).fill("raging");
  await expect(statBlock(page).getByRole("button", { name: "Show the Bear stat block" })).toBeVisible();
});

test("at 390 px the stat block follows the list, picking a row brings it into view, 44 px targets, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdversaries(page, "witherwild");
  await openEnvironmentTab(page);
  await row(page, "Raging River").click();
  await expect(statBlock(page).getByRole("heading", { level: 2, name: "Raging River" })).toBeInViewport();
  const [listBox, blockBox] = await Promise.all([list(page).boundingBox(), statBlock(page).boundingBox()]);
  expect(blockBox!.y).toBeGreaterThan(listBox!.y + listBox!.height - 1);
  for (const target of [
    page.getByRole("tab", { name: "Environment" }),
    list(page).getByRole("group", { name: "Type", exact: true }).getByRole("button", { name: "Traversal" }),
    row(page, "Raging River"),
    list(page).getByRole("button", { name: /^Tier 1/ }),
  ]) {
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page);
});
