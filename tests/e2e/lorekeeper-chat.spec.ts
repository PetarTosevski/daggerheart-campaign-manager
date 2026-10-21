import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { gmAndPlayer } from "./live";

// D13 L6: the Lorekeeper's chat column with the e2e fake model (convex/lib/claude.ts, LOREKEEPER_FAKE_MODEL, honoured
// only on the local e2e deployment). A player asks via the 'Critical hits' chip and sees the streamed 'From the rules'
// answer with a quote chip, asks the Hex question and sees 'Rules unclear' with a GM call, stops an answer, keeps the
// history over a reload, and sends the unclear answer to the GM, who pins it as a table ruling.
//
// Until L9 moves it into scripts/e2e-setup.mjs, this spec turns the fake model on and ingests the invented mini-book
// (tests/fixtures/lorekeeper/mini-book.txt) as the core book on the e2e backend itself. Never the real API.

test.describe.configure({ timeout: 180_000 });
expect.configure({ timeout: 20_000 });

test.beforeAll(() => {
  const env = { ...process.env, E2E_CONVEX_PORT: process.env.E2E_CONVEX_PORT ?? "3212" };
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "env", "set", "--", "LOREKEEPER_FAKE_MODEL", "true"], { env, stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/lorekeeper-ingest.mjs", "core", "tests/fixtures/lorekeeper/mini-book.txt", "--e2e"], { env, stdio: "ignore" });
});

function chat(page: Page) {
  const column = page.getByRole("region", { name: "The Lorekeeper" });
  return {
    column,
    log: column.getByRole("log", { name: "Conversation" }),
    composer: column.getByRole("group", { name: "Ask the Lorekeeper" }),
    answers: column.getByRole("log", { name: "Conversation" }).getByRole("article", { name: "The Lorekeeper's answer" }),
  };
}

test("a player asks, stops an answer, keeps the history; the GM pins the unclear answer", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { player, gm, campaignId, client } = table;
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { log, composer, answers } = chat(player);
    await expect(log.getByText("Ask me anything about the rules in your books.")).toBeVisible();

    // 1. The 'Critical hits' chip: the question bubble at once, then the streamed 'From the rules' answer.
    await composer.getByRole("button", { name: "Critical hits" }).click();
    const question = log.locator(".lk-q").filter({ hasText: "If my Hope and Fear dice match on an attack" });
    await expect(question.getByText("You")).toBeVisible();
    const crit = answers.filter({ hasText: "From the rules" });
    await expect(crit.getByRole("button", { name: /^📖 Daggerheart Core Rulebook · p\.\d+$/ })).toBeVisible();
    await expect(crit.getByText(/The rule is stated plainly in your books/)).toBeVisible();
    await expect(crit.getByRole("button", { name: "Open in the book" })).toBeVisible();

    // 'Open in the book' shows the page text in a dialog (Q5).
    await crit.getByRole("button", { name: "Open in the book" }).click();
    const book = player.getByRole("dialog", { name: /^Daggerheart Core Rulebook · p\.\d+$/ });
    await expect(book.locator(".lk-pagetext")).toBeVisible();
    await book.getByRole("button", { name: /^Close daggerheart core rulebook/ }).click();
    await expect(book).toBeHidden();

    // 2. The Hex chip: 'Rules unclear' with a Suggested GM call, checked again by the stronger model (Q2).
    await expect(composer.getByRole("button", { name: "Do Hexes stack?" })).toBeEnabled();
    await composer.getByRole("button", { name: "Do Hexes stack?" }).click();
    const hex = answers.filter({ hasText: "Rules unclear" });
    await expect(hex.getByText("Suggested GM call")).toBeVisible({ timeout: 40_000 });
    await expect(hex.getByText("Apply only the strongest Hex, and say so at the table.")).toBeVisible();
    await expect(hex.getByText("Checked again with a stronger model")).toBeVisible();
    // The actions show once the retry has finished.
    await expect(hex.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 40_000 });

    // 3. Stop (Q11): 'Ask' becomes 'Stop' while the answer streams; Stop ends it.
    const box = composer.getByRole("textbox", { name: "Your question" });
    await box.fill("What happens when the twin dice match?");
    await box.press("Enter");
    await composer.getByRole("button", { name: "Stop" }).click();
    await expect(log.getByText("Stopped.")).toBeVisible();
    await expect(composer.getByRole("button", { name: "Ask" })).toBeVisible();

    // 4. A reload keeps the history (the chat opens the latest conversation).
    await player.reload();
    await expect(chat(player).log.locator(".lk-q")).toHaveCount(3);
    await expect(chat(player).answers.filter({ hasText: "Rules unclear" })).toBeVisible();

    // 5. The player sends the unclear answer to the GM; the GM opens the shared conversation and pins it.
    const hexAgain = chat(player).answers.filter({ hasText: "Rules unclear" });
    await hexAgain.getByRole("button", { name: "Ask the GM" }).click();
    await expect(hexAgain.getByRole("button", { name: "Sent to the GM" })).toBeDisabled();

    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    const gmChat = chat(gm);
    await gmChat.column.getByRole("button", { name: "Conversations" }).click();
    const sharedList = gmChat.column.getByRole("region", { name: "Shared in the campaign" });
    await sharedList.getByRole("button", { name: /If my Hope and Fear dice match/ }).click();
    const gmHex = gmChat.answers.filter({ hasText: "Rules unclear" });
    await gmHex.getByRole("button", { name: "Pin as table ruling" }).click();
    const pin = gm.getByRole("dialog", { name: "Pin as table ruling" });
    await expect(pin.getByRole("textbox", { name: "Title" })).toHaveValue("Two of us are Witches. Do our Hexes stack on the same bandit?");
    await expect(pin.getByRole("textbox", { name: "Ruling" })).toHaveValue("Apply only the strongest Hex, and say so at the table.");
    await pin.getByRole("textbox", { name: "Title" }).fill("Hexes don’t stack");
    await pin.getByRole("button", { name: "Pin ruling" }).click();
    await expect(pin).toBeHidden();
    await expect.poll(async () => (await client.query(api.lorekeeperRulings.list, { campaignId })).map((r) => r.title)).toContain("Hexes don’t stack");
  } finally {
    await table.close();
  }
});

test("the composer at 390 px: one column, no sideways scroll, a new conversation and delete", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { player, campaignId } = table;
    await player.setViewportSize({ width: 390, height: 844 });
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { column, composer, answers } = chat(player);
    await composer.getByRole("button", { name: "Critical hits" }).click();
    await expect(answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();
    await expect.poll(() => player.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Books only: the toggle is pressed and stays with the conversation.
    const toggle = composer.getByRole("group", { name: "Internet search" });
    await toggle.getByRole("button", { name: "Books only" }).click();
    await expect(toggle.getByRole("button", { name: "Books only" })).toHaveAttribute("aria-pressed", "true");

    // New conversation, then delete the first one from the menu (confirm dialog, Q10).
    await column.getByRole("button", { name: "Conversations" }).click();
    await column.getByRole("button", { name: /New conversation/ }).click();
    await expect(column.getByText("Ask me anything about the rules in your books.")).toBeVisible();
    await column.getByRole("button", { name: "Conversations" }).click();
    const mine = column.getByRole("region", { name: "Your conversations" });
    await mine.getByRole("button", { name: /^Delete “If my Hope and Fear dice match/ }).click();
    const confirm = player.getByRole("dialog", { name: "Delete this conversation?" });
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm).toBeHidden();
    await column.getByRole("button", { name: "Conversations" }).click();
    await expect(mine.getByText("No conversations yet.")).toBeVisible();
  } finally {
    await table.close();
  }
});
