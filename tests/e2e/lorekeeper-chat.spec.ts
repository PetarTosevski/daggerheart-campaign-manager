import { execFileSync } from "node:child_process";

import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { CAP_CAMPAIGN_TEXT, EMPTY_INTRO, NEW_CONVERSATION_LABEL, NOT_SET_UP } from "../../src/lib/lorekeeper/copy";
import { gmAndPlayer } from "./live";

// D13 L6: the Lorekeeper's chat column with the e2e fake model (convex/lib/claude.ts, LOREKEEPER_FAKE_MODEL, honoured
// only on the local e2e deployment). A player asks via the 'Critical hits' chip and sees the streamed 'From the rules'
// answer with a quote chip, asks the Hex question and sees 'Rules unclear' with a GM call, stops an answer, keeps the
// history over a reload, and sends the unclear answer to the GM, who pins it as a table ruling. L11: the Hex answer
// shows no provisional text, only 'Checking again with a stronger model…' and 'Searching the internet…'. L12: the kept
// book answer then shows under 'Searching the internet…' and the web part writes out under it; with 'Books only' the
// retry writes out live. Answer text only ever grows: a MutationObserver fails the run if a shown text is replaced.
//
// `pnpm e2e:setup` (scripts/e2e-setup.mjs) turns the fake model on and ingests the invented mini-book
// (tests/fixtures/lorekeeper/mini-book.txt) as the core book; rerun it once per checkout after pulling. Never the real API.

test.describe.configure({ timeout: 180_000 });
// `configure` returns a new expect; it does not change the imported one (dcm-bxp.82.8).
const expect = baseExpect.configure({ timeout: 20_000 });

type Seen = { events: string[]; swaps: string[] };

/**
 * Watches the conversation log (L11, L12): `events` lists each new phase text ('phase:<text>') and the first time an
 * in-flight answer shows text ('text'), in order; `swaps` lists every answer text that did not extend the text the
 * same card showed before (text must only grow, never be replaced).
 */
async function watchAnswers(log: ReturnType<typeof chat>["log"]) {
  await log.evaluate((root) => {
    const seen = { events: [] as string[], swaps: [] as string[] };
    (window as unknown as { __lkSeen: typeof seen }).__lkSeen = seen;
    const texts = new WeakMap<Element, string>();
    const textShown = new WeakSet<Element>();
    let phase = "";
    const check = () => {
      const statuses = [...root.querySelectorAll(".lk-thinking [role=status]")].map((status) => status.textContent ?? "");
      const now = statuses.at(-1) ?? "";
      if (now && now !== phase) {
        seen.events.push(`phase:${now}`);
        phase = now;
      }
      for (const article of root.querySelectorAll("article.lk-a")) {
        const text = article.querySelector(":scope > .lk-ab > p")?.textContent ?? "";
        const before = texts.get(article) ?? "";
        if (!text.startsWith(before)) seen.swaps.push(`${before} -> ${text}`);
        texts.set(article, text);
        if (text && article.getAttribute("aria-busy") === "true" && !textShown.has(article)) {
          textShown.add(article);
          seen.events.push("text");
        }
      }
    };
    new MutationObserver(check).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

const readSeen = (page: Page) => page.evaluate(() => (window as unknown as { __lkSeen: Seen }).__lkSeen);

/** LK1: the log is scrolled to its end, the composer is on screen and the document is exactly one screen tall. */
async function expectPinnedAndFixed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const log = document.querySelector<HTMLElement>(".lk-stream")!;
        const compose = document.querySelector<HTMLElement>(".lk-compose")!.getBoundingClientRect();
        return {
          atEnd: log.scrollHeight - log.scrollTop - log.clientHeight < 48,
          composerOnScreen: compose.bottom <= window.innerHeight + 1 && compose.top >= 0,
          pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        };
      }),
    )
    .toEqual({ atEnd: true, composerOnScreen: true, pageScrolls: false });
}

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
    // L11/L12: the first pass and the retry stay hidden behind their phases; the kept book answer shows when the
    // internet pass starts (under 'Searching the internet…') and the web part writes out under it. The observer
    // records the phases and the first text in order, and every text that was replaced instead of extended.
    await expect(composer.getByRole("button", { name: "Do Hexes stack?" })).toBeEnabled();
    await watchAnswers(log);
    await composer.getByRole("button", { name: "Do Hexes stack?" }).click();
    const hex = answers.filter({ hasText: "Rules unclear" });
    // The web part is added at the end; the GM call comes with the book answer.
    await expect(hex.getByText("From the internet · unofficial.")).toBeVisible({ timeout: 40_000 });
    await expect(hex).not.toHaveAttribute("aria-busy", "true");
    const seen = await readSeen(player);
    expect(seen.swaps).toEqual([]);
    expect(seen.events).toEqual(["phase:Searching your books…", "phase:Checking again with a stronger model…", "phase:Searching the internet…", "text"]);
    // The final answer: the book answer, then the web note under it, with the internet block (search is on by default).
    await expect(hex.getByText(/^The books describe one Hex at a time[\s\S]*Online, players describe/)).toBeVisible();
    await expect(hex.getByText("Suggested GM call")).toBeVisible();
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
    // LK1: it opens on the newest message (bottom of the log, composer visible), and the page itself does not scroll.
    await expectPinnedAndFixed(player);
    await chat(player).log.evaluate((el) => (el.scrollTop = 0));
    await expect(chat(player).column.getByRole("button", { name: "Jump to latest" })).toBeVisible();
    await chat(player).column.getByRole("button", { name: "Jump to latest" }).click();
    await expectPinnedAndFixed(player);

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
    await expectPinnedAndFixed(player);
    // Tablet and desktop widths keep the same one-screen page.
    for (const size of [{ width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
      await player.setViewportSize(size);
      await expectPinnedAndFixed(player);
    }
    await player.setViewportSize({ width: 390, height: 844 });

    // Books only: the toggle is pressed and stays with the conversation.
    const toggle = composer.getByRole("group", { name: "Internet search" });
    await toggle.getByRole("button", { name: "Books only" }).click();
    await expect(toggle.getByRole("button", { name: "Books only" })).toHaveAttribute("aria-pressed", "true");

    // L12: with 'Books only' the stronger model's answer is final, so it writes out live once the retry starts.
    await watchAnswers(chat(player).log);
    await composer.getByRole("button", { name: "Do Hexes stack?" }).click();
    const hex = answers.filter({ hasText: "Rules unclear" });
    await expect(hex.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 40_000 });
    await expect(hex.getByText("Suggested GM call")).toBeVisible();
    await expect(hex.getByText("From the internet · unofficial.")).toHaveCount(0);
    const seen = await readSeen(player);
    expect(seen.swaps).toEqual([]);
    expect(seen.events).toEqual(["phase:Searching your books…", "phase:Checking again with a stronger model…", "text"]);

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

function convexEnv(args: string[]) {
  const env = { ...process.env, E2E_CONVEX_PORT: process.env.E2E_CONVEX_PORT ?? "3212" };
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "env", ...args], { env, stdio: "ignore" });
}

/** The notice's box lies inside the viewport with the page scrolled to the top (seen without scrolling). */
async function expectOnFirstScreen(page: Page, notice: Locator) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await notice.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

// dcm-bxp.82.10: the cap / not-set-up notice takes the question box's spot and is on the first screen at 1440x900 and
// 390x844, with a conversation in the column; 'not set up' is said once (the intro has no text then).
test("the cap and not-set-up notices are seen without scrolling; 'not set up' is said once", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { player, campaignId } = table;
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { column, composer, answers } = chat(player);
    await composer.getByRole("button", { name: "Critical hits" }).click();
    await expect(answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();

    convexEnv(["set", "--", "LOREKEEPER_CAMPAIGN_MONTHLY_USD", "0"]);
    try {
      await player.goto(`/campaigns/${campaignId}/lorekeeper`);
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await player.setViewportSize(viewport);
        const notice = composer.getByRole("alert");
        await expect(notice).toHaveText(CAP_CAMPAIGN_TEXT);
        await expect(composer.getByRole("textbox", { name: "Your question" })).toBeDisabled();
        await expectOnFirstScreen(player, notice);
      }
    } finally {
      convexEnv(["remove", "--", "LOREKEEPER_CAMPAIGN_MONTHLY_USD"]);
    }

    // Not set up (no key, fake model off): said once, by the notice, also in an empty conversation.
    convexEnv(["remove", "--", "LOREKEEPER_FAKE_MODEL"]);
    try {
      await player.goto(`/campaigns/${campaignId}/lorekeeper`);
      await column.getByRole("button", { name: "Conversations" }).click();
      await column.getByRole("button", { name: NEW_CONVERSATION_LABEL }).click();
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await player.setViewportSize(viewport);
        const notice = composer.getByRole("alert");
        await expect(notice).toHaveText(NOT_SET_UP);
        await expect(column.getByText(NOT_SET_UP)).toHaveCount(1);
        await expect(column.getByText(EMPTY_INTRO)).toHaveCount(0);
        await expectOnFirstScreen(player, notice);
      }
    } finally {
      convexEnv(["set", "--", "LOREKEEPER_FAKE_MODEL", "true"]);
    }
  } finally {
    await table.close();
  }
});
