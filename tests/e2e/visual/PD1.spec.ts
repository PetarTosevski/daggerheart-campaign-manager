import { expect, test } from "@playwright/test";

import { signInAsTestGm } from "../fixtures";
import { expectNoHorizontalScroll, visual } from "./helpers";

// PD1: the World map's travel pace (the five travel methods, by terrain) and the "Travel speeds" legend at 1440
// and 390. Board counterpart: none (the board's header offered flat paces and had no speed legend).

test("PD1 travel pace and travel-speed legend at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("navigation", { name: "Campaign sections" }).getByRole("link", { name: "World" }).click();
  await expect(page.getByRole("application", { name: /^Map of/ })).toBeVisible();
  const { shoot } = visual(page, "PD1");
  const legend = page.getByRole("region", { name: "Travel speeds" });
  const section = page.getByRole("region", { name: /^Map of/ });

  await shoot(legend, "legend-foot");
  await page.getByLabel("Travel pace").selectOption({ label: "Boat · by terrain" });
  await page.getByLabel("March pace").selectOption("fast");
  await expect(legend.getByRole("listitem").filter({ hasText: "Water" })).toContainText("133 km/day");
  await shoot(legend, "legend-boat-forced");
  await shoot(section, "map");

  await legend.getByRole("button", { name: "Travel speeds" }).click();
  await expect(legend.getByRole("listitem")).toHaveCount(0);
  await shoot(legend, "legend-collapsed");

  await legend.getByRole("button", { name: "Travel speeds" }).click();
  await legend.getByRole("button", { name: "Edit speeds…" }).click();
  await shoot(page.getByRole("dialog", { name: "Travel speeds" }), "rules");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
});
