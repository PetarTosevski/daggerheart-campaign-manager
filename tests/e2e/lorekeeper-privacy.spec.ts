import type { ConvexHttpClient } from "convex/browser";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { lorekeeperMessages } from "../../src/lib/errors/lorekeeper";
import { signInAsTestGm } from "./fixtures";
import { gmAndPlayer } from "./live";
import { convexAs } from "./visual/helpers";

// D13 L9: the Lorekeeper's privacy in the browser, with the e2e fake model (scripts/e2e-setup.mjs).
//
// - A private conversation (Q3) of the first player is not readable by the second player: not by id (the Convex
//   functions answer LOREKEEPER_NOT_FOUND, the GM's too), not from the Conversations menu, not by URL (the
//   Lorekeeper has no conversation URLs; an id in the address shows nothing), and a shared conversation the second
//   player has open turns into the not-found card the moment its asker makes it private.
// - No page source, HTTP response or WebSocket frame that the GM or either player receives contains 'ANTHROPIC' or
//   'sk-ant'.
// - A GM canary (a hidden codex entry's name, players' text and GM notes, and a known entry's GM notes) never
//   reaches a player: not in any Lorekeeper answer, nor anywhere else on the wire.

test.describe.configure({ timeout: 240_000 });
// `configure` returns a new expect; it does not change the imported one.
const expect = baseExpect.configure({ timeout: 30_000 });

const PLAYER2_EMAIL = "e2e-player2@example.test";
const SECRETS = [/ANTHROPIC/i, /sk-ant/i];

/** Everything a page receives: HTTP response bodies and WebSocket frames (Convex query results arrive there). */
function recordWire(page: Page) {
  const texts: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (response) => {
    pending.push(
      response.text().then(
        (body) => {
          texts.push(`${response.url()}\n${body}`);
        },
        () => undefined,
      ),
    );
  });
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      texts.push(typeof payload === "string" ? payload : payload.toString("utf8"));
    });
  });
  return {
    /** All received text so far plus the current page source. */
    async all(): Promise<string[]> {
      await Promise.all(pending);
      return [...texts, await page.content()];
    },
  };
}

/** The first match of any pattern in any text, with some context, or null. */
function findAny(texts: string[], patterns: (RegExp | string)[]): string | null {
  for (const text of texts) {
    for (const pattern of patterns) {
      const index = typeof pattern === "string" ? text.indexOf(pattern) : text.search(pattern);
      if (index !== -1) return `${String(pattern)} in: …${text.slice(Math.max(0, index - 120), index + 120)}…`;
    }
  }
  return null;
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  return call.then(
    () => "ok",
    (error: { data?: { code?: string } }) => error.data?.code,
  );
}

async function secondPlayer(browser: Browser, client: ConvexHttpClient, campaignId: Id<"campaigns">) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const wire = recordWire(page);
  await signInAsTestGm(page, PLAYER2_EMAIL);
  await expect(page).toHaveURL("/");
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await page.goto(`/join/${code}`);
  await page.getByRole("button", { name: "Join campaign" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}`);
  return { context, page, wire, client: await convexAs(page) };
}

function chat(page: Page) {
  const column = page.getByRole("region", { name: "The Lorekeeper" });
  const log = column.getByRole("log", { name: "Conversation" });
  return {
    column,
    log,
    composer: column.getByRole("group", { name: "Ask the Lorekeeper" }),
    answers: log.getByRole("article", { name: "The Lorekeeper's answer" }),
  };
}

test("private conversations stay private, no key reaches a browser, and GM secrets never reach a player", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const gmWire = recordWire(table.gm);
  const playerWire = recordWire(table.player);
  const other = await secondPlayer(browser, table.client, table.campaignId);
  try {
    const { gm, player, campaignId, client, playerClient } = table;

    // The GM's canaries: a hidden (secret) codex entry, and the GM notes of an entry the party knows.
    const canary = `CANARY${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { entryId: hidden } = await client.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.codex.update, {
      entryId: hidden,
      patch: { name: `${canary} the Hidden`, role: `${canary} spy`, pdesc: `${canary} players' text`, gmn: `${canary} GM notes` },
    });
    const { entryId: known } = await client.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.codex.update, { entryId: known, patch: { name: "Marlow", known: true, gmn: `${canary} known GM notes` } });
    // Control: the canaries are really stored and the GM reads them.
    expect(JSON.stringify(await client.query(api.codex.list, { campaignId }))).toContain(canary);
    expect(JSON.stringify(await client.query(api.codex.entryText, { entryId: known }))).toContain(canary);

    // 1. The first player asks in a private conversation ('Private' pressed before the first question).
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const mine = chat(player);
    await expect(mine.composer.getByRole("textbox", { name: "Your question" })).toBeEnabled(); // hydrated
    await mine.composer.getByRole("button", { name: "Private" }).click();
    await expect(mine.composer.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    await mine.composer.getByRole("button", { name: "Critical hits" }).click();
    await expect(mine.answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();
    const lists = await playerClient.query(api.lorekeeper.listConversations, { campaignId });
    const secret = lists.mine[0]!;
    expect(secret.visibility).toBe("private");

    // 2. By id: the second player and the GM get LOREKEEPER_NOT_FOUND from every reader, and cannot ask into it.
    const paginationOpts = { numItems: 20, cursor: null };
    for (const reader of [other.client, client]) {
      expect(await codeOf(reader.query(api.lorekeeper.getConversation, { campaignId, conversationId: secret._id }))).toBe("LOREKEEPER_NOT_FOUND");
      expect(await codeOf(reader.query(api.lorekeeper.listMessages, { campaignId, conversationId: secret._id, paginationOpts }))).toBe("LOREKEEPER_NOT_FOUND");
    }
    expect(await codeOf(other.client.mutation(api.lorekeeper.ask, { campaignId, conversationId: secret._id, question: "Hello?", webSearch: false }))).toBe(
      "LOREKEEPER_NOT_FOUND",
    );
    expect((await other.client.query(api.lorekeeper.listConversations, { campaignId })).shared.map((c) => c._id)).not.toContain(secret._id);

    // 3. In the browser: not in the second player's Conversations menu, and not by URL.
    await other.page.goto(`/campaigns/${campaignId}/lorekeeper`);
    const theirs = chat(other.page);
    await expect(theirs.composer.getByRole("textbox", { name: "Your question" })).toBeEnabled();
    await theirs.column.getByRole("button", { name: "Conversations" }).click();
    await expect(theirs.column.getByRole("region", { name: "Your conversations" })).toBeVisible();
    await expect(theirs.column.getByRole("button", { name: /If my Hope and Fear dice match/ })).toHaveCount(0);
    for (const url of [`/campaigns/${campaignId}/lorekeeper?conversation=${secret._id}`, `/campaigns/${campaignId}/lorekeeper/${secret._id}`]) {
      await other.page.goto(url);
      await expect(other.page.locator("body")).not.toContainText("If my Hope and Fear dice match");
      await expect(other.page.locator("body")).not.toContainText("The rule is stated plainly");
    }

    // 4. The not-found card: the second player has the first player's shared conversation open; its asker makes it
    // private, and the second player's view turns into 'That conversation isn't there anymore.' at once.
    await mine.column.getByRole("button", { name: "Conversations" }).click();
    await mine.column.getByRole("button", { name: /New conversation/ }).click();
    const privateToggle = mine.composer.getByRole("button", { name: "Private" });
    if ((await privateToggle.getAttribute("aria-pressed")) === "true") await privateToggle.click();
    await expect(privateToggle).toHaveAttribute("aria-pressed", "false");
    await mine.composer.getByRole("button", { name: "How far is Close?" }).click();
    await expect(mine.answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();

    await other.page.goto(`/campaigns/${campaignId}/lorekeeper`);
    await expect(theirs.composer.getByRole("textbox", { name: "Your question" })).toBeEnabled();
    await theirs.column.getByRole("button", { name: "Conversations" }).click();
    const shared = theirs.column.getByRole("region", { name: "Shared in the campaign" });
    await shared.getByRole("button", { name: /How far away is Close range\?/ }).click();
    await expect(theirs.log.getByText("How far away is Close range?")).toBeVisible();
    await expect(shared.getByRole("button", { name: /If my Hope and Fear dice match/ })).toHaveCount(0);

    await privateToggle.click();
    await expect(privateToggle).toHaveAttribute("aria-pressed", "true");
    await expect(theirs.column.getByText(lorekeeperMessages.LOREKEEPER_NOT_FOUND)).toBeVisible();
    await expect(theirs.column.getByText("How far away is Close range?")).toHaveCount(0);

    // 5. The GM's page and drawer too (the GM receives the most: no key there either).
    await gm.goto(`/campaigns/${campaignId}/party`);
    await expect(gm.getByRole("article", { name: table.characterName })).toBeVisible(); // hydrated
    await gm.getByRole("button", { name: "Ask the Lorekeeper" }).click();
    await expect(gm.getByRole("dialog", { name: "The Lorekeeper" })).toBeVisible();
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    await expect(chat(gm).composer).toBeVisible();

    // 6. The wire: no key anywhere; no canary in anything a player received.
    const gmTexts = await gmWire.all();
    const playerTexts = await playerWire.all();
    const otherTexts = await other.wire.all();
    expect(playerTexts.some((t) => t.includes("The rule is stated plainly")), "the player's wire holds their answers").toBe(true);
    for (const [who, texts] of [
      ["GM", gmTexts],
      ["player", playerTexts],
      ["second player", otherTexts],
    ] as const) {
      expect(findAny(texts, SECRETS), `${who}: no API key name or key`).toBeNull();
    }
    expect(findAny(playerTexts, [canary]), "player: no GM canary").toBeNull();
    expect(findAny(otherTexts, [canary]), "second player: no GM canary").toBeNull();
  } finally {
    await other.context.close();
    await table.close();
  }
});
