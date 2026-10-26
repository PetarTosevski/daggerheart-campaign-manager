import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { validateCustom, fromSrd } from "../../../src/lib/adversaries/custom";
import { ADVERSARIES } from "../../../src/lib/srd/adversaries";
import { openAdversaries, visual } from "./helpers";

// A5 (D8): custom adversaries at 1440 and 390: the custom section with a custom stat block, and the parchment
// editor dialog with its live preview. No Adversaries board counterpart (the board has no custom adversaries); judged
// against the board's tokens (parchment, stat block, H&F pill shape for the "Custom" pill).

test("A5 custom adversaries: section, custom stat block and editor dialog at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openAdversaries(page);
  const bear = validateCustom(fromSrd(ADVERSARIES.find((a) => a.id === "bear")!));
  await client.mutation(api.customAdversaries.create, {
    campaignId,
    adversary: { ...bear, name: "Cave Bear", hp: 9, motives: "Guard the cave, maul intruders" },
    basedOn: "bear",
    idempotencyKey: crypto.randomUUID(),
  });
  const custom = page.getByRole("region", { name: "Custom adversaries" });
  const block = custom.getByRole("article", { name: "Cave Bear stat block" });
  await expect(block).toBeVisible();
  const { shoot } = visual(page, "A5");

  await shoot(custom, "section");
  await shoot(custom.getByRole("region", { name: "Custom stat block" }), "statblock");

  await block.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Cave Bear" });
  await expect(editor.getByRole("article", { name: "Cave Bear stat block" })).toBeVisible();
  await shoot(editor, "editor");
});
