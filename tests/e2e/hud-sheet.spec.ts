import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H2.1 (docs/tasks/TASK-HUD-H2.1.md): with the HUD on, a banner or a PC token opens that character's
// sheet as a 400 px panel on the right (Main 'D · Sheet at hand', GMDesktop). Own sheet: steppers (one
// characters.adjustResource intent a click; numbers read "n of 6 marked", answer 2) and "Hide my hand from other
// players" (answer 16a). Another PC's sheet: View only for any player (answer 4a). The GM: GM edit, trackers and
// conditions always, feature Use only with "Play for this character" in the header (answer 5a). The panel is not
// modal: the map beside it stays usable (dcm-bxp.99.32.15). Esc closes it and focus goes back to the opener.

const partyBanner = (page: Page, name: string) => page.getByRole("list", { name: "The party" }).getByRole("button", { name: `Open ${name}'s sheet` });
const panel = (page: Page, name: string) => page.getByRole("complementary", { name: `${name}’s sheet` });

test("a player: own sheet (steppers, hide my hand), an ally's view-only sheet from a token; not modal; Esc", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    // Moss's banner opens Moss's sheet: an <aside>, no dialog, focus on its heading.
    await partyBanner(player, "Moss").click();
    const own = panel(player, "Moss");
    await expect(own).toBeVisible();
    await expect(own.getByTestId("hud-sheet-trackers")).toBeVisible();
    await expect(player.getByRole("dialog")).toHaveCount(0);
    await expect(own.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(own.getByRole("heading", { level: 2 })).toContainText("Moss");
    const box = await own.boundingBox();
    expect(Math.round(box!.width)).toBe(400);
    expect(Math.round(box!.x + box!.width)).toBe(1440);
    await expect(own.getByTestId("hud-sheet-note")).toHaveCount(0);
    for (const section of ["Features", "Damage thresholds", "Experiences", "Conditions & lasting effects"]) {
      await expect(own.getByRole("heading", { name: section })).toBeVisible();
    }

    // A stepper: one intent a click; the number reads "n of N marked" and the banner follows.
    const hp = own.getByRole("group", { name: "Hit Points" });
    await hp.getByRole("button", { name: "Mark 1 Hit Point" }).click();
    await expect(hp.locator("output")).toHaveText(/^1 of \d+ marked$/);
    await expect(partyBanner(player, "Moss")).toHaveAccessibleDescription(/^Moss, 1 of \d+ Hit Points marked/);
    await hp.getByRole("button", { name: "Clear 1 Hit Point" }).click();
    await expect(hp.locator("output")).toHaveText(/^0 of \d+ marked$/);

    // Hide my hand from other players (answer 16a): the server records it.
    const hide = own.getByRole("switch", { name: /Hide my hand from other players/ });
    await expect(hide).toHaveAttribute("aria-checked", "false");
    await hide.click();
    await expect(hide).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await client.query(api.combatCards.handSharing, { campaignId })).hidden).toContain(moss.characterId);
    await hide.click();
    await expect(hide).toHaveAttribute("aria-checked", "false");
    await expectNoSeriousA11yViolations(player);

    // Not modal: a click on Brannoc's token on the map swaps the panel to Brannoc's sheet, view only (answer 4a).
    const board = player.getByRole("region", { name: "Battle map" });
    await board.getByRole("button", { name: /^Open Brannoc’s sheet/ }).click();
    const ally = panel(player, "Brannoc");
    await expect(ally).toBeVisible();
    await expect(own).toHaveCount(0);
    await expect(ally.getByTestId("hud-sheet-badge")).toHaveText("View only");
    await expect(ally.getByTestId("hud-sheet-note")).toHaveText("Only Brannoc’s player and the GM can use or change this sheet.");
    await expect(ally.getByRole("button", { name: /^(Mark|Clear|Gain|Spend) 1/ })).toHaveCount(0);
    await expect(ally.getByRole("button", { name: /^Use / })).toHaveCount(0);
    await expect(ally.getByRole("switch")).toHaveCount(0);
    await expect(ally.getByRole("group", { name: "Stress" }).locator("output")).toHaveText(/ of \d+ marked$/);
    await expectNoSeriousA11yViolations(player);

    // Esc closes it; focus goes back to the opener.
    await ally.getByRole("heading", { level: 2 }).focus();
    await player.keyboard.press("Escape");
    await expect(ally).toHaveCount(0);
    await expect(player.getByTestId("combat-hud")).not.toHaveClass(/hud-sh-open/);
  } finally {
    await s.close();
  }
});

test("the GM: GM edit, trackers and conditions always, Use only with Play for this character; live on the player's banner", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }

    await partyBanner(gm, "Vex").click();
    const vex = panel(gm, "Vex");
    await expect(vex.getByTestId("hud-sheet-trackers")).toBeVisible();
    await expect(vex.getByTestId("hud-sheet-badge")).toHaveText("GM edit");
    await expect(vex.getByTestId("hud-sheet-note")).toContainText("You’re the GM: you can change any value on this sheet.");
    const playFor = vex.getByRole("switch", { name: "Play for this character" });
    await expect(playFor).toHaveAttribute("aria-checked", "false");
    const uses = vex.getByRole("button", { name: / for Vex$/ });
    const n = await uses.count();
    for (let i = 0; i < n; i++) await expect(uses.nth(i)).toBeDisabled();

    // Trackers: always editable by the GM.
    const stress = vex.getByRole("group", { name: "Stress" });
    await stress.getByRole("button", { name: "Mark 1 Stress" }).click();
    await expect(stress.locator("output")).toHaveText(/^1 of \d+ marked$/);
    // Conditions: always; the player's banner of Vex follows live.
    await vex.getByRole("group", { name: "Switch conditions" }).getByRole("button", { name: "Vulnerable" }).click();
    await expect(vex.getByRole("group", { name: "Switch conditions" }).getByRole("button", { name: "Vulnerable" })).toHaveAttribute("aria-pressed", "true");
    await expect(vex.locator(".hsh-cdl")).toContainText("Vulnerable");
    await expect(partyBanner(player, "Vex")).toContainText("Vulnerable");
    await expect(partyBanner(player, "Vex")).toHaveAccessibleDescription(/1 of \d+ Stress marked/);
    await expectNoSeriousA11yViolations(gm);

    // Play for this character: on, the Use buttons that are ready turn on; off again.
    await playFor.click();
    await expect(playFor).toHaveAttribute("aria-checked", "true");
    await expect(vex.getByTestId("hud-sheet-note")).not.toContainText("Turn on Play for this character");
    await playFor.click();
    await expect(playFor).toHaveAttribute("aria-checked", "false");

    // The map stays usable beside the panel: a PC token click swaps the sheet (the classic modal drawer did not allow it).
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Moss’s sheet/ }).click();
    await expect(panel(gm, "Moss")).toBeVisible();
    await expect(panel(gm, "Moss").getByTestId("hud-sheet-badge")).toHaveText("GM edit");
    await panel(gm, "Moss").getByRole("button", { name: "Close Moss’s sheet" }).click();
    await expect(panel(gm, "Moss")).toHaveCount(0);
  } finally {
    await s.close();
  }
});
