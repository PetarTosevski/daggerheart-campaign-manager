import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { bardDraft, expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// Dice follow-ups (plan followups-5 F8), at 1440 and 390: the GM folds the secret roll form and it stays folded after
// a reload (dcm-bxp.34); a Moon Witch's damage roll under a Waxing moon names the automatic +2 (dcm-bxp.66); the Tag
// Team partner who picks the roll in their own box, never having opened the panel, sees the confirmation (dcm-bxp.67).
// Seeding (internal sessionFeatures:seedForE2e, local e2e backend only) sets Mira's mastery, level and moon die.

type Seed = { characterId: string; subclassRank?: "mastery"; level?: number; hope?: number; moonDie?: number };
function seed(args: Seed): void {
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "sessionFeatures:seedForE2e", JSON.stringify(args)], { stdio: "pipe" });
}

const moonWitchDraft = (name: string) => ({
  ...bardDraft(name),
  classId: "witch",
  subclassId: "moon",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
  primaryWeaponId: "dagger",
  experiences: ["Night walker", "Herbalist"],
  domainCards: cardsForDomains(getClass("witch")!.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id),
});

const diceBox = (page: Page) => page.getByRole("region", { name: "Dice", exact: true });

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("GM roll form folds and remembers it; Waxing Moon +2 named on damage; the Tag Team partner sees the pick", async ({ page }) => {
      test.setTimeout(180_000);
      const { client, campaignId } = await openSessions(page);
      await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
      const create = async (draft: object) =>
        (await client.mutation(api.characters.create, { campaignId, draft: draft as never, idempotencyKey: crypto.randomUUID() })).characterId as Id<"characters">;
      const tag = crypto.randomUUID().slice(0, 6);
      const mira = await create(moonWitchDraft(`Mira ${tag}`));
      const bryn = await create(bardDraft(`Bryn ${tag}`));
      const kaiName = `Kai ${tag}`;
      const kai = await create(bardDraft(kaiName));
      seed({ characterId: mira, subclassRank: "mastery", level: 7, moonDie: 2 });
      seed({ characterId: bryn, hope: 3 });

      // ---- dcm-bxp.34: the secret roll form folds; the feed stays; a reload keeps it folded.
      await page.goto(`/campaigns/${campaignId}`);
      const toggle = page.getByRole("button", { name: "Secret GM roll" });
      const form = page.getByRole("form", { name: "GM roll" });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(form).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(form).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Roll Feed" })).toHaveAttribute("aria-expanded", "true");
      await page.reload();
      await expect(page.getByRole("button", { name: "Secret GM roll" })).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("form", { name: "GM roll" })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await page.getByRole("button", { name: "Secret GM roll" }).click();
      await expect(page.getByRole("form", { name: "GM roll" })).toBeVisible();

      // ---- dcm-bxp.66: a damage roll under a Waxing moon names the +2 in the result and in Roll options.
      await page.goto(`/campaigns/${campaignId}/party/${mira}`);
      const box = diceBox(page);
      await box.getByText("Damage", { exact: true }).click();
      await expect(box.getByText("Waxing Moon +2 (always)")).toBeVisible();
      await box.getByRole("button", { name: "Roll", exact: true }).click();
      // Dagger 1d8+1 at Proficiency 3 (level 7): the flat part is 1 + 2.
      await expect(box.getByTestId("last-roll")).toContainText(/Primary: Dagger \(\dd8\+1\) · Waxing Moon \+2 \(.*\+ 3\)/);
      await expectNoHorizontalScroll(page);
      const feed = await client.query(api.feed.list, { campaignId, paginationOpts: { numItems: 1, cursor: null } });
      expect(feed.page[0]!.summary).toMatch(/Waxing Moon \+2\)$/);

      // ---- dcm-bxp.67: Bryn starts a Tag Team with Kai; Kai's box (panel never opened) picks and confirms.
      await client.mutation(api.rolls.tagTeam, {
        characterId: bryn,
        partnerId: kai,
        initiator: { trait: "presence", modifier: 0 },
        partner: { trait: "presence", modifier: 0 },
        idempotencyKey: crypto.randomUUID(),
      });
      await page.goto(`/campaigns/${campaignId}/party/${kai}`);
      const kaiBox = diceBox(page);
      await kaiBox.getByRole("button", { name: `Use ${kaiName}’s roll` }).click();
      const panel = kaiBox.getByRole("region", { name: "Tag Team Roll" });
      await expect(panel.getByRole("status")).toContainText(`${kaiName}’s roll counts for both`);
      await expect(kaiBox.getByRole("button", { name: `Use ${kaiName}’s roll` })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await panel.getByRole("button", { name: "Close" }).click();
      await expect(kaiBox.getByRole("button", { name: "Tag Team Roll…" })).toBeVisible();
    });
  });
}
