import { execFileSync } from "node:child_process";

import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import {
  BOOKS_ONLY_MISS,
  CAP_CAMPAIGN_TEXT,
  RETRIED_NOTE,
  RETRY_THINKING_TEXT,
  STOPPED_EARLY_NOTE,
  THINKING_TEXT,
  WEB_DISCLAIMER_TITLE,
  WEB_THINKING_TEXT,
} from "../../src/lib/lorekeeper/copy";
import { costMicros, reserveMicros, PRIMARY_MODEL } from "../../src/lib/lorekeeper/pricing";
import { expectNoSeriousA11yViolations } from "./a11y";
import { gmAndPlayer } from "./live";

// D13 L9: the Lorekeeper end to end with the e2e fake model (convex/lib/claude.ts, LOREKEEPER_FAKE_MODEL; set with the
// mini-book ingest by scripts/e2e-setup.mjs, honoured only on the local e2e deployment, never the real API).
//
// 1. Two browsers: the player asks the board's four samples (from the rules; unclear with a GM call, checked again by
//    the stronger model and searched online (L10); the internet block with its disclaimer; the books-only miss with
//    the toggle off), stops an answer before it is ready (L12's note), and the GM pins a ruling from the drawer over
//    the Party page, which the player sees live in Table rulings. The phases (books -> stronger model -> internet,
//    L11/L12) are recorded in order, and answer text only ever grows: a shown text that is replaced fails the run.
// 2. The caps message: a campaign budget lowered to just above one question's worst case; the fake usage of the
//    first answer passes it and the composer turns off for every member.
// 3. axe on the page and the open drawer, and the keyboard path through composer, chips, toggle, actions and ✕.

test.describe.configure({ timeout: 240_000 });
// `configure` returns a new expect; it does not change the imported one.
const expect = baseExpect.configure({ timeout: 30_000 });

/** A question none of the mini-book's words answer (its search terms: familiar, pilot, airship). */
const OFF_BOOK = "Can my familiar pilot an airship?";

/** The backend env (scripts/convex-e2e.mjs targets the e2e deployment only). */
function convexEnv(args: string[]) {
  const env = { ...process.env, E2E_CONVEX_PORT: process.env.E2E_CONVEX_PORT ?? "3212" };
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "env", ...args], { env, stdio: "ignore" });
}

function chat(scope: Page) {
  const column = scope.getByRole("region", { name: "The Lorekeeper" });
  const log = column.getByRole("log", { name: "Conversation" });
  return {
    column,
    log,
    composer: column.getByRole("group", { name: "Ask the Lorekeeper" }),
    answers: log.getByRole("article", { name: "The Lorekeeper's answer" }),
  };
}

type Seen = { events: string[]; swaps: string[] };

/**
 * Starts recording the page's conversation (L11, L12; the whole document is observed, because the log is mounted
 * again when the first question creates the conversation): `events` gets each new phase text ('phase:<text>') and, once per
 * card, the first text an in-flight answer shows ('text'), in order; `swaps` gets every card text that does not
 * extend the text the same card showed before. Each call starts a fresh record.
 */
async function watch(page: Page) {
  await page.evaluate(() => {
    const root = document.body;
    type W = { __lkObserver?: MutationObserver; __lkSeen?: Seen };
    const w = window as unknown as W;
    w.__lkObserver?.disconnect();
    const seen: Seen = { events: [], swaps: [] };
    w.__lkSeen = seen;
    const texts = new WeakMap<Element, string>();
    const shown = new WeakSet<Element>();
    for (const article of root.querySelectorAll("article.lk-a")) {
      texts.set(article, article.querySelector(":scope > .lk-ab > p")?.textContent ?? "");
      shown.add(article);
    }
    let phase = "";
    const check = () => {
      const now = [...root.querySelectorAll(".lk-thinking [role=status], .lk-a [role=status]")].map((s) => s.textContent ?? "").at(-1) ?? "";
      if (now && now !== phase) {
        seen.events.push(`phase:${now}`);
        phase = now;
      }
      for (const article of root.querySelectorAll("article.lk-a")) {
        const text = article.querySelector(":scope > .lk-ab > p")?.textContent ?? "";
        const before = texts.get(article) ?? "";
        if (!text.startsWith(before)) seen.swaps.push(`${before} -> ${text}`);
        texts.set(article, text);
        if (text && article.getAttribute("aria-busy") === "true" && !shown.has(article)) {
          shown.add(article);
          seen.events.push("text");
        }
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    w.__lkObserver = observer;
  });
}

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __lkSeen: Seen }).__lkSeen);

async function ask(composer: Locator, question: string) {
  const box = composer.getByRole("textbox", { name: "Your question" });
  await expect(box).toBeEnabled();
  await box.fill(question);
  await box.press("Enter");
}

test("four board samples, an early Stop, and the GM pins a ruling from the drawer that the player sees live", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { player, gm, campaignId } = table;
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { composer, answers } = chat(player);
    await expect(composer.getByRole("textbox", { name: "Your question" })).toBeEnabled(); // hydrated, model available
    const rulings = player.getByRole("region", { name: "Table rulings" });
    await expect(rulings.getByText("No rulings yet.")).toBeVisible();
    await expect(composer.getByRole("button", { name: "Search the internet too" })).toHaveAttribute("aria-pressed", "true");

    // 1. From the rules: the first pass is final, so it streams under 'Searching your books…'.
    await watch(player);
    await composer.getByRole("button", { name: "Critical hits" }).click();
    const crit = answers.filter({ hasText: "From the rules" });
    await expect(crit.getByRole("button", { name: /^📖 Daggerheart Core Rulebook · p\.\d+$/ })).toBeVisible();
    await expect(crit.getByRole("button", { name: "Copy" })).toBeVisible();
    let record = await seen(player);
    expect(record.swaps).toEqual([]);
    expect(record.events).toEqual([`phase:${THINKING_TEXT}`, "text"]);

    // 2. Rules unclear: hidden while Sonnet and Opus check, then the kept book answer shows as the internet pass
    // starts (L10: an unclear answer is searched online too) and the web part writes out under it.
    await watch(player);
    await composer.getByRole("button", { name: "Do Hexes stack?" }).click();
    const hex = answers.filter({ hasText: "Rules unclear" });
    await expect(hex.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 60_000 });
    record = await seen(player);
    expect(record.swaps).toEqual([]);
    expect(record.events).toEqual([`phase:${THINKING_TEXT}`, `phase:${RETRY_THINKING_TEXT}`, `phase:${WEB_THINKING_TEXT}`, "text"]);
    await expect(hex.getByText(RETRIED_NOTE)).toBeVisible();
    await expect(hex.getByText("Suggested GM call")).toBeVisible();
    await expect(hex.getByText("Apply only the strongest Hex, and say so at the table.")).toBeVisible();
    await expect(hex.getByText(WEB_DISCLAIMER_TITLE)).toBeVisible();
    await expect(hex.getByRole("button", { name: "Ask the GM" })).toBeVisible();

    // 3. Not in the books, internet search on: books -> stronger model -> internet, then the internet block with the
    // board's disclaimer and result cards (site shown, links rel=noopener nofollow).
    await watch(player);
    await ask(composer, OFF_BOOK);
    // (The Hex card above also carries the web note; this one is the only 'Not in your books' card so far.)
    const web = answers.filter({ hasText: "Not in your books" }).filter({ hasText: "Online, players describe" });
    await expect(web.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 60_000 });
    record = await seen(player);
    expect(record.swaps).toEqual([]);
    expect(record.events).toEqual([`phase:${THINKING_TEXT}`, `phase:${RETRY_THINKING_TEXT}`, `phase:${WEB_THINKING_TEXT}`, "text"]);
    await expect(web.getByText(WEB_DISCLAIMER_TITLE)).toBeVisible();
    await expect(web.getByText(/not text from Daggerheart\. Your GM decides\./)).toBeVisible();
    const link = web.getByRole("link", { name: "Table talk: how we run it" });
    await expect(link).toHaveAttribute("rel", "noopener nofollow");
    await expect(link).toHaveAttribute("href", "https://example.com/forum/thread-1");
    await expect(web.locator(".lk-res .d").first()).toHaveText("example.com");

    // 4. The books-only miss: with 'Books only' the same question ends in the board's miss text, only 'Ask the GM',
    // and nothing shows before it (the stronger model's 'none' is replaced by the miss, so it stays hidden).
    await composer.getByRole("button", { name: "Books only" }).click();
    await expect(composer.getByRole("button", { name: "Books only" })).toHaveAttribute("aria-pressed", "true");
    await watch(player);
    await ask(composer, OFF_BOOK);
    const miss = answers.filter({ hasText: BOOKS_ONLY_MISS });
    await expect(miss.getByRole("button", { name: "Ask the GM" })).toBeVisible({ timeout: 60_000 });
    await expect(miss.getByRole("button", { name: "Copy" })).toHaveCount(0);
    await expect(miss.getByText(WEB_DISCLAIMER_TITLE)).toHaveCount(0);
    record = await seen(player);
    expect(record.swaps).toEqual([]);
    expect(record.events).toEqual([`phase:${THINKING_TEXT}`, `phase:${RETRY_THINKING_TEXT}`]);

    // 5. Stop before an answer is ready (L12): the hidden first pass is cut off, the card says why, no actions.
    await watch(player);
    await ask(composer, "Two of us are Witches. Do our Hexes stack on the same bandit?");
    await composer.getByRole("button", { name: "Stop" }).click();
    const stopped = answers.filter({ hasText: STOPPED_EARLY_NOTE });
    await expect(stopped.getByText("Stopped.")).toBeVisible();
    await expect(stopped.getByRole("button")).toHaveCount(0);
    expect((await seen(player)).swaps).toEqual([]);
    await expect(composer.getByRole("button", { name: "Ask" })).toBeVisible();

    // 6. The GM, on the Party page, asks in the drawer and pins the unclear answer; the player's open Lorekeeper page
    // shows the ruling in Table rulings without a reload.
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(`/campaigns/${campaignId}/party`);
    await expect(gm.getByRole("article", { name: table.characterName })).toBeVisible(); // hydrated
    const pill = gm.getByRole("button", { name: "Ask the Lorekeeper" });
    await pill.click();
    const drawer = gm.getByRole("dialog", { name: "The Lorekeeper" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("group", { name: "Ask the Lorekeeper" }).getByRole("button", { name: "Do Hexes stack?" }).click();
    const gmHex = drawer.getByRole("article", { name: "The Lorekeeper's answer" }).filter({ hasText: "Rules unclear" });
    await gmHex.getByRole("button", { name: "Pin as table ruling" }).click({ timeout: 60_000 });
    const pin = gm.getByRole("dialog", { name: "Pin as table ruling" });
    await expect(pin.getByRole("textbox", { name: "Ruling" })).toHaveValue("Apply only the strongest Hex, and say so at the table.");
    await pin.getByRole("textbox", { name: "Title" }).fill("Hexes don’t stack");
    await pin.getByRole("button", { name: "Pin ruling" }).click();
    await expect(pin).toBeHidden();

    await expect(rulings.getByText("Hexes don’t stack")).toBeVisible();
    await expect(rulings.getByText("Apply only the strongest Hex, and say so at the table.")).toBeVisible();
    await expect(rulings.getByText("1 pinned")).toBeVisible();
    await expect(rulings.getByText(/^Pinned by the GM/)).toBeVisible();
    await drawer.getByRole("button", { name: "Close the Lorekeeper" }).click();
    await expect(pill).toBeFocused();
  } finally {
    await table.close();
  }
});

test("the caps message appears once the fake usage passes a lowered campaign budget", async ({ browser }) => {
  // The fake model reports 1,200 input and 180 output tokens per pass. The budget is one worst-case reservation plus
  // half of that real cost: the first question fits, and after it settles the next one's worst case no longer does.
  const reserve = reserveMicros(PRIMARY_MODEL);
  const actual = costMicros({ input: 1200, output: 180, cacheRead: 0, cacheWrite: 0, webSearches: 0 }, PRIMARY_MODEL);
  const budgetUsd = (reserve + Math.floor(actual / 2)) / 1_000_000;
  const table = await gmAndPlayer(browser);
  convexEnv(["set", "--", "LOREKEEPER_CAMPAIGN_MONTHLY_USD", String(budgetUsd)]);
  try {
    const { gm, player, campaignId } = table;
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const gmChat = chat(gm);
    const playerChat = chat(player);
    await expect(playerChat.composer.getByRole("textbox", { name: "Your question" })).toBeEnabled();
    await expect(gmChat.composer.getByRole("textbox", { name: "Your question" })).toBeEnabled();

    await gmChat.composer.getByRole("button", { name: "Critical hits" }).click();
    await expect(gmChat.answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();

    // Every member's composer turns off with the reason, live.
    for (const side of [gmChat, playerChat]) {
      await expect(side.composer.getByRole("alert")).toHaveText(CAP_CAMPAIGN_TEXT);
      await expect(side.composer.getByRole("textbox", { name: "Your question" })).toBeDisabled();
    }
    // The server refuses too (the composer is not the gate).
    const refused = await table.playerClient
      .mutation(api.lorekeeper.ask, { campaignId, question: "How far away is Close range?", webSearch: false })
      .then(() => null, (error: { data?: { code?: string } }) => error.data?.code);
    expect(refused).toBe("LOREKEEPER_CAP_CAMPAIGN");
  } finally {
    convexEnv(["remove", "--", "LOREKEEPER_CAMPAIGN_MONTHLY_USD"]);
    await table.close();
  }
});

test("axe on the page and the open drawer; composer, chips, toggle, actions and ✕ by keyboard", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { gm, campaignId } = table;
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    const { composer, answers } = chat(gm);
    await expect(composer.getByRole("textbox", { name: "Your question" })).toBeEnabled();
    await composer.getByRole("button", { name: "Critical hits" }).click();
    await expect(answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();
    await expectNoSeriousA11yViolations(gm);

    // Tab from the top of the page: every control is reached, and each has a name.
    const reached = await tabThrough(gm, 80);
    expect(reached.filter((r) => !r.name), `unnamed focus stops: ${JSON.stringify(reached.filter((r) => !r.name))}`).toEqual([]);
    const names = reached.map((r) => r.name);
    for (const name of ["Critical hits", "How far is Close?", "Do Hexes stack?", "Holding breath", "Your question", "Search the internet too", "Books only", "Open in the book", "Pin as table ruling", "Copy"]) {
      expect(names, `Tab reaches “${name}”`).toContain(name);
    }

    // The drawer over the Party page: axe inside the dialog, keyboard to ✕, Escape and focus back on the pill.
    await gm.goto(`/campaigns/${campaignId}/party`);
    // The roster comes from Convex, so the page is hydrated once it shows (a key press before that is lost).
    await expect(gm.getByRole("article", { name: table.characterName })).toBeVisible();
    const pill = gm.getByRole("button", { name: "Ask the Lorekeeper" });
    await pill.focus();
    await gm.keyboard.press("Enter");
    const drawer = gm.getByRole("dialog", { name: "The Lorekeeper" });
    await expect(drawer.getByRole("article", { name: "The Lorekeeper's answer" }).filter({ hasText: "From the rules" })).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: ".lk-drawerdlg" });
    const inDrawer = (await tabThrough(gm, 60)).map((r) => r.name);
    for (const name of ["Close the Lorekeeper", "Critical hits", "Your question", "Books only", "Copy"]) {
      expect(inDrawer, `Tab reaches “${name}” in the drawer`).toContain(name);
    }
    await drawer.getByRole("button", { name: "Close the Lorekeeper" }).focus();
    await gm.keyboard.press("Enter");
    await expect(drawer).toBeHidden();
    await expect(pill).toBeFocused();
    await gm.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await gm.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(pill).toBeFocused();
  } finally {
    await table.close();
  }
});

/** Presses Tab `max` times and returns each focused element's accessible name (aria-label, labelledby, text). */
async function tabThrough(page: Page, max: number): Promise<{ tag: string; name: string }[]> {
  const out: { tag: string; name: string }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    out.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { tag: "body", name: "body" };
        const labelled = el.getAttribute("aria-labelledby");
        const byId = labelled ? labelled.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
        const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "" : "";
        const name = (el.getAttribute("aria-label") || byId || label || el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
        return { tag: el.tagName.toLowerCase(), name };
      }),
    );
  }
  return out;
}
