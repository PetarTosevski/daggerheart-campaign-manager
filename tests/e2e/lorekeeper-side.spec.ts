import { execFileSync } from "node:child_process";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { gmAndPlayer } from "./live";

// D13 L7: the Lorekeeper's sidebar cards and the drawer, with the e2e fake model (convex/lib/claude.ts,
// LOREKEEPER_FAKE_MODEL, honoured only on the local e2e deployment). The GM switches a book off and the player sees
// 'Off'; a player's 'Ask the GM' lands in the GM's Table rulings card, where pinning resolves it (and Dismiss resolves
// another); the drawer opens from the Party page and answers a chip question; at 390 the cards fold under
// 'Library & rulings' and the drawer takes the full width.
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

function side(page: Page) {
  const aside = page.getByRole("complementary", { name: "Library and rulings" });
  return {
    aside,
    library: aside.getByRole("region", { name: "Library" }),
    legend: aside.getByRole("region", { name: "How answers are marked" }),
    rulings: aside.getByRole("region", { name: "Table rulings" }),
  };
}

function chatIn(scope: Locator) {
  return {
    composer: scope.getByRole("group", { name: "Ask the Lorekeeper" }),
    answers: scope.getByRole("log", { name: "Conversation" }).getByRole("article", { name: "The Lorekeeper's answer" }),
  };
}

test("the GM switches a book off and the player sees Off; legend and Add PDF help", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { gm, player, campaignId } = table;
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { library, legend } = side(gm);
    const header = gm.getByRole("region", { name: "The Lorekeeper" });
    await expect(library.getByText("The Lorekeeper only answers from these books. Turn one off to leave it out.")).toBeVisible();

    // The board's three legend rows.
    await expect(legend.getByText("From the rules")).toBeVisible();
    await expect(legend.getByText("Quoted from your books, with the book and section.")).toBeVisible();
    await expect(legend.getByText("Rules unclear")).toBeVisible();
    await expect(legend.getByText("Not in your books")).toBeVisible();

    // The core book is on; the GM's pill is a switch; the header pill counts the books switched on.
    const core = library.getByRole("switch", { name: /^Daggerheart Core Rulebook: / });
    await expect(core).toHaveAttribute("aria-checked", "true");
    await expect(core).toHaveText("Indexed");
    const before = Number(((await header.locator(".lk-indexpill").textContent()) ?? "").split(" ")[0]);
    expect(before).toBeGreaterThan(0);
    // House rules (notes) is off by default (Q7).
    await expect(library.getByRole("switch", { name: /^House rules \(notes\): / })).toHaveAttribute("aria-checked", "false");

    await core.click();
    await expect(core).toHaveAttribute("aria-checked", "false");
    await expect(core).toHaveText("Off");
    await expect(header.locator(".lk-indexpill")).toHaveText(`${before - 1} ${before - 1 === 1 ? "book" : "books"} indexed`);

    // The player reads the same library, without switches.
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const playerLibrary = side(player).library;
    const row = playerLibrary.getByRole("listitem").filter({ hasText: "Daggerheart Core Rulebook" });
    await expect(row.getByText("Off", { exact: true })).toBeVisible();
    await expect(playerLibrary.getByRole("switch")).toHaveCount(0);
    await expect(playerLibrary.getByRole("button", { name: "＋ Add PDF" })).toHaveCount(0);

    // Back on: the player's open page follows without a reload.
    await core.click();
    await expect(core).toHaveAttribute("aria-checked", "true");
    await expect(row.getByText("Indexed", { exact: true })).toBeVisible();

    // '＋ Add PDF' explains the local ingest script (Q6).
    await library.getByRole("button", { name: "＋ Add PDF" }).click();
    const help = gm.getByRole("dialog", { name: "Add a PDF" });
    await expect(help.getByText("pnpm lorekeeper:ingest <book> <text file>")).toBeVisible();
    await help.getByRole("button", { name: "Got it" }).click();
    await expect(help).toBeHidden();
  } finally {
    await table.close();
  }
});

test("a player's Ask the GM appears in the GM's Rulings card; pinning resolves it, Dismiss resolves another", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { gm, player, campaignId, client } = table;
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const playerChat = chatIn(player.getByRole("region", { name: "The Lorekeeper" }));
    await expect(side(player).rulings.getByText("No rulings yet.")).toBeVisible();
    await expect(side(player).rulings.getByText("0 pinned")).toBeVisible();

    await playerChat.composer.getByRole("button", { name: "Do Hexes stack?" }).click();
    const hex = playerChat.answers.filter({ hasText: "Rules unclear" });
    await expect(hex.getByRole("button", { name: "Ask the GM" })).toBeVisible({ timeout: 60_000 });
    await hex.getByRole("button", { name: "Ask the GM" }).click();
    await expect(hex.getByRole("button", { name: "Sent to the GM" })).toBeDisabled();

    // The GM's card lists the request with who asked.
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { rulings } = side(gm);
    const asks = rulings.getByRole("list", { name: "Questions for the GM" });
    const ask = asks.getByRole("listitem").filter({ hasText: "Two of us are Witches. Do our Hexes stack on the same bandit?" });
    await expect(ask.getByText(/^Asked by (Liriel|e2e-player)/)).toBeVisible();

    // Pin a ruling: prefilled from the question and the GM call; pinning resolves the ask.
    await ask.getByRole("button", { name: "Pin a ruling" }).click();
    const pin = gm.getByRole("dialog", { name: "Pin a ruling" });
    await expect(pin.getByRole("textbox", { name: "Title" })).toHaveValue("Two of us are Witches. Do our Hexes stack on the same bandit?");
    await expect(pin.getByRole("textbox", { name: "Ruling" })).toHaveValue("Apply only the strongest Hex, and say so at the table.");
    await pin.getByRole("textbox", { name: "Title" }).fill("Hexes don’t stack");
    await pin.getByRole("button", { name: "Pin ruling" }).click();
    await expect(pin).toBeHidden();
    await expect(asks).toHaveCount(0);
    const ruling = rulings.getByRole("listitem").filter({ hasText: "Hexes don’t stack" });
    await expect(ruling.getByText("Apply only the strongest Hex, and say so at the table.")).toBeVisible();
    await expect(ruling.getByText("Pinned by the GM")).toBeVisible();
    await expect(rulings.getByText("1 pinned")).toBeVisible();
    await expect.poll(async () => (await client.query(api.lorekeeperAsks.listOpen, { campaignId })).length).toBe(0);

    // The player's card shows the ruling (read only), and the answer can be sent again.
    const playerRulings = side(player).rulings;
    await expect(playerRulings.getByText("Hexes don’t stack")).toBeVisible();
    await expect(playerRulings.getByRole("button", { name: /^Edit|^Unpin/ })).toHaveCount(0);
    await expect(hex.getByRole("button", { name: "Ask the GM" })).toBeVisible();

    // A second request, dismissed: it leaves the card and no ruling is added.
    await hex.getByRole("button", { name: "Ask the GM" }).click();
    await expect(asks.getByRole("listitem")).toHaveCount(1);
    await asks.getByRole("button", { name: "Dismiss" }).click();
    await expect(asks).toHaveCount(0);
    await expect(rulings.getByText("1 pinned")).toBeVisible();

    // The GM edits the ruling's text, then unpins it.
    await ruling.getByRole("button", { name: "Edit Hexes don’t stack" }).click();
    const edit = gm.getByRole("dialog", { name: "Edit ruling" });
    await edit.getByRole("textbox", { name: "Ruling" }).fill("Only the biggest Hex penalty applies to a target.");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    await expect(ruling.getByText("Only the biggest Hex penalty applies to a target.")).toBeVisible();
    await expect(playerRulings.getByText("Only the biggest Hex penalty applies to a target.")).toBeVisible();

    await ruling.getByRole("button", { name: "Unpin Hexes don’t stack" }).click();
    const confirm = gm.getByRole("dialog", { name: "Unpin this ruling?" });
    await confirm.getByRole("button", { name: "Unpin", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(rulings.getByText("No rulings yet.")).toBeVisible();
    await expect(playerRulings.getByText("No rulings yet.")).toBeVisible();
  } finally {
    await table.close();
  }
});

test("the drawer opens from the Party page and answers a chip question; full width at 390", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { player, campaignId } = table;

    // No pill on the Lorekeeper page itself.
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    await expect(side(player).library).toBeVisible();
    await expect(player.getByRole("button", { name: "Ask the Lorekeeper" })).toHaveCount(0);

    await player.goto(`/campaigns/${campaignId}/party`);
    const pill = player.getByRole("button", { name: "Ask the Lorekeeper" });
    await pill.click();
    const drawer = player.getByRole("dialog", { name: "The Lorekeeper" });
    await expect(drawer.getByRole("heading", { name: "The Lorekeeper" })).toBeVisible();
    await expect(drawer.getByText("The Lorekeeper is open")).toBeVisible();
    await expect(player.locator('button[aria-haspopup="dialog"][aria-expanded="true"]')).toHaveText("The Lorekeeper is open");
    const panel = drawer.locator(".lk-drawerpanel");
    await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(440);

    const { composer, answers } = chatIn(drawer);
    await composer.getByRole("button", { name: "Critical hits" }).click();
    const crit = answers.filter({ hasText: "From the rules" });
    await expect(crit.getByRole("button", { name: /^📖 Daggerheart Core Rulebook · p\.\d+$/ })).toBeVisible();
    await expect(crit.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 40_000 });

    // ✕ closes; focus returns to the pill.
    await drawer.getByRole("button", { name: "Close the Lorekeeper" }).click();
    await expect(drawer).toBeHidden();
    await expect(pill).toBeFocused();

    // Escape closes too, and the conversation is still there on reopening.
    await pill.click();
    await expect(chatIn(drawer).answers.filter({ hasText: "From the rules" })).toBeVisible();
    await player.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // 390: the drawer takes the full width, no sideways scroll; the Lorekeeper page folds its cards.
    await player.setViewportSize({ width: 390, height: 844 });
    await pill.click();
    await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(390);
    await expect(drawer.getByText("The Lorekeeper is open")).toBeHidden();
    await drawer.getByRole("button", { name: "Close the Lorekeeper" }).click();
    await expect.poll(() => player.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const fold = player.getByRole("button", { name: "Library & rulings" });
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(side(player).library).toBeHidden();
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(side(player).library.getByText("Daggerheart Core Rulebook")).toBeVisible();
    await expect(side(player).rulings).toBeVisible();
    await expect.poll(() => player.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await table.close();
  }
});
