import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H1.1 (docs/tasks/TASK-HUD-H1.1.md): with the HUD on, the party hangs as banners from the gold rod
// top-left (Main: x = 24, 182, 340, 498; yours 270 px, allies 238 px), each a button "Open <name>'s sheet" that opens
// the sheet panel (H2.1). HP pips show HP left; every text says HP marked (answer 2). Live: a change on
// one screen shows on the other.

const banners = (page: Page) => page.getByRole("list", { name: "The party" });
const banner = (page: Page, name: string) => banners(page).getByRole("button", { name: `Open ${name}'s sheet` });

/** A banner's x / width / height, relative to the HUD's top-left corner. */
async function geometry(page: Page, name: string) {
  const hud = await page.getByTestId("combat-hud").boundingBox();
  const box = await banner(page, name).boundingBox();
  if (!hud || !box) throw new Error(`no box for ${name}`);
  return { x: Math.round(box.x - hud.x), y: Math.round(box.y - hud.y), w: Math.round(box.width), h: Math.round(box.height) };
}

test("the party banners: Main's row, marked HP text, the sheet opens, changes show live on the other screen", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client } = s;
  const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }

    // The player's row: Moss (theirs) first with the gold trim, then the allies, every 158 px from x = 24.
    await expect(banners(player).getByRole("button")).toHaveCount(4);
    const labels = await banners(player).getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(labels[0]).toBe("Open Moss's sheet");
    expect(new Set(labels)).toEqual(new Set(["Open Moss's sheet", "Open Brannoc's sheet", "Open Vex's sheet", "Open Oriel's sheet"]));
    const names = labels.map((l) => l!.replace(/^Open (.*)'s sheet$/, "$1"));
    const boxes = [];
    for (const name of names) boxes.push(await geometry(player, name));
    expect(boxes.map((b) => b.x)).toEqual([24, 182, 340, 498]);
    expect(boxes.map((b) => b.w)).toEqual([146, 146, 146, 146]);
    expect(boxes.map((b) => b.h)).toEqual([270, 238, 238, 238]);
    expect(boxes.every((b) => b.y === 8)).toBe(true);
    await expect(banner(player, "Moss")).toHaveClass(/hbn-you/);
    await expect(banner(player, "Moss")).toHaveAccessibleDescription(/^Moss, 0 of \d+ Hit Points marked, 0 of \d+ Stress marked/);

    // The GM sees the same four banners; none is theirs.
    await expect(banners(gm).getByRole("button")).toHaveCount(4);
    await expect(banners(gm).locator(".hbn-you")).toHaveCount(0);
    await expectNoSeriousA11yViolations(player);
    await expectNoSeriousA11yViolations(gm);

    // The banner opens Moss’s sheet panel (H2.1, not modal); the open banner drops 8 px.
    await banner(player, "Moss").click();
    const drawer = player.getByRole("complementary", { name: "Moss’s sheet" });
    await expect(drawer).toBeVisible();
    await expect(banner(player, "Moss")).toHaveAttribute("data-open", "true");
    await expect(banner(player, "Moss")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 8)");
    // The HUD keeps its frame while a sheet is open (sheet-ui.css styles a global .sh-open; banners.css guards it).
    await expect(player.getByTestId("combat-hud")).toHaveCSS("border-radius", "0px");
    await expect(player.getByTestId("combat-hud")).toHaveCSS("display", "block");
    await expectNoSeriousA11yViolations(player);

    // Live, player → GM: the player marks two HP in the sheet panel; the GM's banner of Moss says 2 marked and lights 2 fewer pips.
    const hp = drawer.getByRole("group", { name: "Hit Points" });
    await hp.getByRole("button", { name: /^Mark 1 / }).click();
    await hp.getByRole("button", { name: /^Mark 1 / }).click();
    await expect(banner(gm, "Moss")).toHaveAccessibleDescription(/^Moss, 2 of (\d+) Hit Points marked/);
    const gmHp = banner(gm, "Moss").getByRole("img", { name: /Hit Points marked$/ });
    const max = await gmHp.locator("i").count();
    await expect(gmHp.locator("i.on")).toHaveCount(max - 2);
    await expect(banner(player, "Moss")).toHaveAccessibleDescription(/^Moss, 2 of \d+ Hit Points marked/);

    // Esc closes the panel: the banner comes back up and keeps the focus.
    await player.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(banner(player, "Moss")).not.toHaveAttribute("data-open", "true");
    await expect(banner(player, "Moss")).toBeFocused();

    // Live, GM → player: Brannoc gains a Hope and turns Vulnerable; the player's Brannoc banner follows.
    const before = Number(await banner(player, "Brannoc").locator(".hud-seal b").textContent());
    await client.mutation(api.characters.adjustResource, { characterId: brannoc.characterId, resource: "hope", delta: 1 });
    await client.mutation(api.characters.toggleCondition, { characterId: brannoc.characterId, condition: "vulnerable" });
    await expect(banner(player, "Brannoc").locator(".hud-seal b")).toHaveText(String(before + 1));
    await expect(banner(player, "Brannoc")).toContainText("Vulnerable");
    await expect(banner(player, "Brannoc")).toHaveAccessibleDescription(new RegExp(`Hope ${before + 1} of \\d+, Vulnerable$`));
  } finally {
    await s.close();
  }
});
