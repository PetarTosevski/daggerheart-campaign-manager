import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, D10_VIEWPORTS, openSessions, visual } from "./helpers";

// D10 S7 visual spec (E2E_VISUAL=1): the dashboard's hero session line with Start Session, the Last Session card and
// Witherwild's Wither Tokens panel at 1440, 1024 and 390; empty, then seeded with the board's story (Liriel 2 Wither
// tokens, Brannoc 1; Session 1 played with a recap, Session 2 planned on 2026-10-24), then live (GM pill, player chip).
// Board counterparts: `node scripts/board-shots.mjs hub:last-session hub:wither-panel`
// (test-results/visual/board/hub-{last-session,wither-panel}-*.png). The hero has no board-shots region.

const RECAP = "The party crossed the river at dawn and met the ferryman, who warned them about the wither spreading through the Grove.";

test("D10 S7 dashboard session regions at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  const { client, campaignId } = await openSessions(page);
  await page.goto(`/campaigns/${campaignId}`);
  const hero = page.getByRole("region", { name: "Campaign header" });
  const last = page.getByRole("region", { name: "Last Session" });
  const wither = page.getByRole("region", { name: "Wither Tokens" });
  await expect(hero.getByTestId("hero-session")).toHaveText("No sessions yet");
  await expect(wither.getByTestId("wither-panel-count")).toBeVisible();

  const { shoot } = visual(page, "D10-S7", D10_VIEWPORTS);
  await shoot(hero, "hero-empty");
  await shoot(last, "last-session-empty");
  await shoot(wither, "wither-panel-empty");

  // The board's story.
  for (const [name, tokens] of [["Liriel", 2], ["Brannoc", 1]] as const) {
    const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft(name), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.wither.adjust, { campaignId, characterId: characterId as Id<"characters">, delta: tokens, idempotencyKey: crypto.randomUUID() });
  }
  const { sessionId: first } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.sessionRecords.setTitle, { campaignId, sessionId: first, title: "The Bridge at Dawn" });
  await client.mutation(api.sessionRecords.setPlayed, { campaignId, sessionId: first, played: true });
  await client.mutation(api.sessionWrap.setRecap, { campaignId, sessionId: first, recap: RECAP });
  const { sessionId: second } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.sessionRecords.setDate, { campaignId, sessionId: second, date: "2026-10-24" });
  await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
  await expect(last.getByTestId("last-session-text")).toHaveText(RECAP);
  await expect(wither.getByTestId("wither-panel-count")).toHaveText("3 on sheets · 17 in pool");
  await shoot(hero, "hero");
  await shoot(last, "last-session");
  await shoot(wither, "wither-panel");

  // Live: the GM's pill opens the session; a player sees the chip.
  await client.mutation(api.sessions.start, { campaignId, idempotencyKey: crypto.randomUUID() });
  await expect(hero.getByRole("link", { name: "Session 2 in progress" })).toBeVisible();
  await shoot(hero, "hero-live");

  await page.getByRole("button", { name: "Players" }).click();
  const players = page.getByRole("dialog", { name: "Players" });
  await expect(players.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await players.getByTestId("join-code").textContent())!;
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${code}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  const playerHero = player.getByRole("region", { name: "Campaign header" });
  await expect(playerHero.getByText("Session 2 in progress")).toBeVisible();
  const playerShots = visual(player, "D10-S7", D10_VIEWPORTS);
  await playerShots.shoot(playerHero, "hero-player-live");
  await playerShots.shoot(player.getByRole("region", { name: "Wither Tokens" }), "wither-panel-player");
  await context.close();
});
