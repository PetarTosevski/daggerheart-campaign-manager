import { expect as baseExpect, test } from "@playwright/test";

import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { gmAndPlayer } from "./live";

// D12 H19 (.omc/plans/d12-hardening.yaml; analysis section 4): session start and end reach the player without a
// reload. The player keeps two tabs open, the dashboard and their Seraph's sheet. The GM starts Session 1 from the
// dashboard's hero: the player's dashboard shows the 'Session 1 in progress' chip and the sheet the two Prayer Dice
// (a start-of-session feature). The GM ends it from the live card: the chip goes, the dice go, and the Last Session
// card says it was played. Rule checks live in sessions-live / dashboard / session-features specs.

// Live updates on a heavily loaded machine can take longer than the default 5 s; nothing here waits on a timer.
const expect = baseExpect.configure({ timeout: 15_000 });

/** characterA as a level-1 Seraph (Divine Wielder, Strength 2): two Prayer Dice at session start. */
function seraph() {
  return {
    classId: "seraph",
    subclassId: "divine-wielder",
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    domainCards: cardsForDomains(getClass("seraph")!.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
  };
}

/** Runs the gmAndPlayer setup again when the loaded local backend times out a Convex function (rolled back). */
async function retryOnTimeout<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 4 || !String(error).includes("timed out")) throw error;
    }
  }
}

test("session start and end reach the player's dashboard chip and sheet features live", async ({ browser }) => {
  test.setTimeout(150_000);
  const { gm, player, campaignId, characterId, characterName, close } = await retryOnTimeout(() => gmAndPlayer(browser, { draft: seraph() }));
  try {
    // ---- The player's second tab: the sheet. No dice and no chip before the session.
    const sheet = await player.context().newPage();
    await sheet.goto(`/campaigns/${campaignId}/party/${characterId}`);
    await expect(sheet.getByRole("heading", { name: characterName }).first()).toBeVisible();
    const held = sheet.getByRole("list", { name: "Held dice" }).getByRole("listitem");
    await expect(held).toHaveCount(0);
    const hero = player.getByRole("region", { name: "Campaign header" });
    const chip = hero.getByText("Session 1 in progress");
    await expect(hero.getByTestId("hero-session")).toHaveText("No sessions yet");
    await expect(chip).toHaveCount(0);

    // ---- The GM starts Session 1 from the dashboard (confirm first); the GM lands on Play.
    await gm.getByRole("region", { name: "Campaign header" }).getByRole("button", { name: "Start Session", exact: true }).click();
    await gm.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
    await expect(gm).toHaveURL(/\/sessions\?s=[^&]+&stage=play$/);
    const liveCard = gm.getByRole("region", { name: "Live session" });
    await expect(liveCard).toContainText("Session in progress");

    // The player's dashboard: the chip (not a link) and the session line. The sheet: two Prayer Dice.
    await expect(chip).toBeVisible();
    await expect(hero.getByRole("link", { name: "Session 1 in progress" })).toHaveCount(0);
    await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
    await expect(held).toHaveCount(2);
    await expect(held.first()).toHaveText(/^Prayer d4: [1-4]$/);

    // ---- The GM ends it from the live card: the chip and the dice go; the Last Session card follows.
    await liveCard.getByRole("button", { name: "End session" }).click();
    await gm.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
    await expect(gm).toHaveURL(/stage=wrap/);
    await expect(chip).toHaveCount(0);
    await expect(held).toHaveCount(0);
    await expect(player.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText(
      "Session 1 was played, but no recap was written. Add one in the session's Wrap-up.",
    );
    // The player never gets the GM's controls.
    await expect(hero.getByRole("button", { name: "Start Session", exact: true })).toHaveCount(0);
  } finally {
    await close();
  }
});
