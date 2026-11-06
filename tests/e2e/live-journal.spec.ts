import { expect as baseExpect, test } from "@playwright/test";

import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { gmAndPlayer } from "./live";
import { endFromJournal, journalLiveChip } from "./visual/helpers";

// Journal JX2 (plan .omc/plans/journal.yaml; the two-browser cases of the old live-sessions spec, D12 H19): session
// start and end reach the player without a reload. The player keeps three tabs open: the dashboard, their Seraph's
// sheet and the Journal. The GM starts Session 1 from the dashboard's hero and lands on the Journal's Log & recap: the
// player's dashboard shows the 'Session 1 in progress' chip, the sheet the two Prayer Dice (a start-of-session
// feature) and the Journal the read-only live chip. The GM ends it from the Journal header's live chip: the chips go,
// the dice go, and the Last Session card says it was played. Rule checks live in journal-header / dashboard /
// session-features specs.

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

test("session start and end reach the player's dashboard chip, sheet features and Journal live", async ({ browser }) => {
  test.setTimeout(150_000);
  const { gm, player, campaignId, characterId, characterName, close } = await retryOnTimeout(() => gmAndPlayer(browser, { draft: seraph() }));
  try {
    // ---- The player's other tabs: the sheet and the Journal. No dice, no chips before the session.
    const sheet = await player.context().newPage();
    await sheet.goto(`/campaigns/${campaignId}/party/${characterId}`);
    await expect(sheet.getByRole("heading", { name: characterName }).first()).toBeVisible();
    const held = sheet.getByRole("list", { name: "Held dice" }).getByRole("listitem");
    await expect(held).toHaveCount(0);
    const journal = await player.context().newPage();
    await journal.goto(`/campaigns/${campaignId}/journal`);
    await expect(journal.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
    await expect(journalLiveChip(journal)).toHaveCount(0);
    const hero = player.getByRole("region", { name: "Campaign header" });
    const chip = hero.getByText("Session 1 in progress");
    await expect(hero.getByTestId("hero-session")).toHaveText("No sessions yet");
    await expect(chip).toHaveCount(0);

    // ---- The GM starts Session 1 from the dashboard (confirm first) and lands on the Journal's Log & recap.
    await gm.getByRole("region", { name: "Campaign header" }).getByRole("button", { name: "Start Session", exact: true }).click();
    await gm.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
    await expect(gm).toHaveURL(/\/journal\?s=[^&]+&sv=log$/);
    await expect(journalLiveChip(gm)).toContainText("Session 1 · live");

    // The player's dashboard: the chip (not a link) and the session line. The sheet: two Prayer Dice. The Journal: the
    // read-only live chip.
    await expect(chip).toBeVisible();
    await expect(hero.getByRole("link", { name: "Session 1 in progress" })).toHaveCount(0);
    await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
    await expect(held).toHaveCount(2);
    await expect(held.first()).toHaveText(/^Prayer d4: [1-4]$/);
    await expect(journalLiveChip(journal)).toContainText("Session 1 · live");
    await expect(journalLiveChip(journal).getByRole("button")).toHaveCount(0);

    // ---- The GM ends it from the Journal's live chip: the chips and the dice go; the Last Session card follows.
    await endFromJournal(gm);
    await expect(chip).toHaveCount(0);
    await expect(held).toHaveCount(0);
    await expect(journalLiveChip(journal)).toHaveCount(0);
    await expect(player.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText(
      "Session 1 was played, but no recap was written. Add one in the Journal's Log & recap.",
    );
    // The player never gets the GM's controls.
    await expect(hero.getByRole("button", { name: "Start Session", exact: true })).toHaveCount(0);
    await expect(journal.getByRole("button", { name: /^Start session/ })).toHaveCount(0);
  } finally {
    await close();
  }
});
