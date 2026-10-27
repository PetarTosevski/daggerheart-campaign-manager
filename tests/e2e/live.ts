// Two-browser fixture for the D12 live-update specs (.omc/plans/d12-hardening.yaml, H1; used by H18-H19).
// The GM and a player each get their own browser context, both signed in and on the campaign dashboard, so a spec
// can change something on one screen and expect it on the other without reloading. Usage: docs/tasks/TASK-D12-H1.md.

import type { ConvexHttpClient } from "convex/browser";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublishedFrameId } from "../../src/lib/frames";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, type Draft } from "./visual/helpers";

/** The player account of the e2e backend (`pnpm e2e:setup`). */
export const E2E_PLAYER_EMAIL = "e2e-player@example.test";

export type LiveTable = {
  /** The GM's page, on the campaign dashboard. */
  gm: Page;
  /** The player's page (second browser context), on the same dashboard. */
  player: Page;
  campaignId: Id<"campaigns">;
  campaignName: string;
  /** characterA: created by the GM, then assigned to the player. */
  characterId: Id<"characters">;
  characterName: string;
  /** Convex client signed in as the GM, for seeding. */
  client: ConvexHttpClient;
  /** Convex client signed in as the player. */
  playerClient: ConvexHttpClient;
  /** Closes both browser contexts. */
  close: () => Promise<void>;
};

async function signedInPage(browser: Browser, email?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  return { context, page };
}

/**
 * The GM creates a campaign of `frame` through `convexAs` (plus its join code and characterA, a level-1 Bard;
 * `draft` overrides fields, `extra` goes to `characters.create` as is), the player joins by code through the
 * /join link in a second context, the GM assigns characterA to the player, and both pages end on the dashboard.
 * Call `close()` at the end of the test.
 */
export async function gmAndPlayer(
  browser: Browser,
  {
    frame = "witherwild",
    draft = {},
    extra = {},
  }: { frame?: PublishedFrameId; draft?: Partial<Draft>; extra?: Record<string, unknown> } = {},
): Promise<LiveTable> {
  const gmSide = await signedInPage(browser);
  const client = await convexAs(gmSide.page);
  const campaignName = `Live ${crypto.randomUUID().slice(0, 8)}`;
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId: frame, name: campaignName, idempotencyKey: crypto.randomUUID() });
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  const characterName = draft.name ?? "Liriel";
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: { ...bardDraft(characterName), ...draft },
    ...extra,
    idempotencyKey: crypto.randomUUID(),
  });

  const playerSide = await signedInPage(browser, E2E_PLAYER_EMAIL);
  await playerSide.page.goto(`/join/${code}`);
  await playerSide.page.getByRole("button", { name: "Join campaign" }).click();
  await expect(playerSide.page).toHaveURL(`/campaigns/${campaignId}`);
  const playerClient = await convexAs(playerSide.page);

  const roster = await client.query(api.members.roster, { campaignId });
  const playerRow = roster.players.find((p) => "email" in p && p.email === E2E_PLAYER_EMAIL);
  expect(playerRow, `${E2E_PLAYER_EMAIL} in the roster`).toBeTruthy();
  await client.mutation(api.characters.assignOwner, { characterId, ownerId: playerRow!.userId });

  await gmSide.page.goto(`/campaigns/${campaignId}`);
  for (const page of [gmSide.page, playerSide.page]) {
    await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  }

  return {
    gm: gmSide.page,
    player: playerSide.page,
    campaignId,
    campaignName,
    characterId,
    characterName,
    client,
    playerClient,
    close: async () => {
      await Promise.all([gmSide.context.close(), playerSide.context.close()]);
    },
  };
}
