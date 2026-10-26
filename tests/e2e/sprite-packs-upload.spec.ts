import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// Sprite packs P8 (.omc/plans/sprite-packs.yaml): on /campaigns/<id>/combat-map/packs the GM creates a pack added
// to Forest, drops a 4 x 4 sheet (cut in the browser, D9), labels one cut "Standing stone" 1 x 1 blocking and
// uploads it; it shows in the pack, in the Setting picker's options and in a forest map's sprite sources. A player
// cannot open the screen, and an SVG renamed .png is never uploaded (the browser cannot decode it; the server
// deletes an SVG upload and returns ok: false).

const PLAYER = "e2e-player@example.test";
const FIXTURES = path.join(__dirname, "../fixtures/sprite-uploads");
const SHEET = path.join(FIXTURES, "props-4x4.png");
const SVG = path.join(FIXTURES, "svg-renamed.png");

/** The ConvexError code of a failed call ("ok" when it succeeds). */
const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e as { data?: { code?: string } }).data?.code);

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Packs ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

/** Opens the packs screen and creates a pack named `name` added to Forest through the UI. */
async function createForestPack(page: Page, campaignId: string, name: string) {
  await page.goto(`/campaigns/${campaignId}/combat-map/packs`);
  await expect(page.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
  const form = page.getByRole("region", { name: "New pack" });
  await form.getByLabel("Pack name").fill(name);
  await form.getByLabel("Setting").selectOption({ label: "Add to Forest" });
  await form.getByRole("button", { name: "Create pack" }).click();
  const pack = page.getByRole("region", { name, exact: true });
  await expect(pack).toBeVisible();
  return pack;
}

test("the GM uploads a sheet, labels one sprite and finds it in the Setting picker and the sprite sources", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const pack = await createForestPack(page, campaignId, "Moorland");
  await expect(pack.getByLabel("Setting")).toHaveValue("forest");

  // The sheet is cut in the browser: auto reads a 4 x 4 props sheet.
  const upload = pack.getByRole("region", { name: "Add sprites to Moorland" });
  await upload.getByTestId(/^sprite-file-/).setInputFiles(SHEET);
  const cuts = upload.getByRole("list", { name: "Cut sprites" });
  await expect(cuts.getByRole("listitem")).toHaveCount(16);
  await expect(upload.getByText("16 cuts · read as Props 4 × 4")).toBeVisible();

  await upload.getByRole("button", { name: "Select none" }).click();
  const first = cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" });
  await first.getByLabel("Upload").check();
  await first.getByLabel("Name").fill("Standing stone");
  const stone = cuts.getByRole("listitem", { name: "Cut 1: Standing stone" });
  await expect(stone.getByLabel("Width (squares)")).toHaveValue("1");
  await expect(stone.getByLabel("Height (squares)")).toHaveValue("1");
  await stone.getByLabel("Sight").selectOption({ label: "Blocks sight" });
  await expect(stone.getByLabel("Classic look")).toHaveValue("pillar");
  await upload.getByRole("button", { name: "Upload selected (1)" }).click();
  await expect(stone.getByText("Uploaded")).toBeVisible();

  // Saved in the pack with its labels and image.
  const saved = pack.getByRole("list", { name: "Sprites in Moorland" }).getByRole("listitem", { name: "Standing stone" });
  await expect(saved.getByRole("img", { name: "Standing stone" })).toBeVisible();
  await expect(saved.getByLabel("Sight")).toHaveValue("block");
  await expect(pack.getByText("1 / 64 sprites")).toBeVisible();

  const client = await convexAs(page);
  // The Setting picker lists the pack under Forest (P5 `settings`, Q3).
  const settings = await client.query(api.combatMapStyle.settings, { campaignId });
  expect(settings.packs.map((p) => [p.name, p.extends?.id ?? null])).toEqual([["Moorland", "forest"]]);
  // A forest map's sprite sources (what the editor lists, P9) carry the sprite with its traits and image link.
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } });
  const sources = await client.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
  expect(sources.sprites.map((s) => ("name" in s ? { name: s.name, w: s.w, h: s.h, sight: s.sight, hasUrl: typeof s.url === "string" } : null))).toEqual([
    { name: "Standing stone", w: 1, h: 1, sight: "block", hasUrl: true },
  ]);

  // Edit later: a label saves on change (optimistic), the server follows.
  await saved.getByLabel("Shadow").selectOption({ label: "Low" });
  await expect(saved.getByLabel("Shadow")).toHaveValue("low");
  await expect
    .poll(async () => (await client.query(api.spritePacks.packs, { campaignId }))[0]?.sprites[0]?.height)
    .toBe("low");

  // Delete with confirm: the first click asks, the second deletes.
  await saved.getByRole("button", { name: "Delete" }).click();
  await saved.getByRole("button", { name: "Confirm delete" }).click();
  await expect(pack.getByRole("list", { name: "Sprites in Moorland" })).toHaveCount(0);
  await expect.poll(async () => (await client.query(api.spritePacks.packs, { campaignId }))[0]?.sprites.length).toBe(0);
});

test("an SVG renamed .png is never uploaded, and an SVG upload is deleted by the server", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const pack = await createForestPack(page, campaignId, "Traps");
  const upload = pack.getByRole("region", { name: "Add sprites to Traps" });
  await upload.getByTestId(/^sprite-file-/).setInputFiles(SVG);
  await expect(upload.getByRole("alert")).toHaveText("Couldn’t read svg-renamed.png as an image.");
  await expect(upload.getByRole("list", { name: "Cut sprites" })).toHaveCount(0);

  // Straight to the server with its real type: rejected, deleted, ok: false (CF16, E7).
  const client = await convexAs(page);
  const packId = (await client.query(api.spritePacks.packs, { campaignId }))[0]!._id;
  const url = await client.mutation(api.spritePacks.spriteUploadUrl, { campaignId });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "image/svg+xml" }, body: readFileSync(SVG) });
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  const labels = {
    name: "Trap",
    category: "object",
    w: 1,
    h: 1,
    sight: "none",
    light: "none",
    height: "flat",
    footprint: "circle",
    classicKind: "rubble",
    px: { w: 64, h: 64 },
  } as const;
  expect(await client.mutation(api.spritePacks.attachSprite, { campaignId, packId, storageId, ...labels })).toMatchObject({ ok: false, code: "INVALID" });
  // The file is gone: a second attach finds nothing.
  expect(await codeOf(client.mutation(api.spritePacks.attachSprite, { campaignId, packId, storageId, ...labels }))).toBe("NOT_FOUND");
  expect((await client.query(api.spritePacks.packs, { campaignId }))[0]!.sprites).toEqual([]);
});

test("a player cannot open the packs screen or read the packs", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    await player.goto(`/campaigns/${campaignId}/combat-map/packs`);
    await expect(player).toHaveURL(`/campaigns/${campaignId}/combat-map`);
    await expect(player.getByRole("heading", { level: 1, name: "Sprite packs" })).toHaveCount(0);
    const client = await convexAs(player);
    expect(await codeOf(client.query(api.spritePacks.packs, { campaignId }))).toBe("FORBIDDEN");
    expect(await codeOf(client.mutation(api.spritePacks.spriteUploadUrl, { campaignId }))).toBe("FORBIDDEN");
  } finally {
    await close();
  }
});

test("the labelling grid fits a phone: no horizontal scroll at 390 px", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const pack = await createForestPack(page, campaignId, "Phone pack");
  const upload = pack.getByRole("region", { name: "Add sprites to Phone pack" });
  await upload.getByRole("button", { name: "Large 3 × 3" }).click();
  await upload.getByTestId(/^sprite-file-/).setInputFiles(SHEET);
  // Forced to 3 x 3, the 16 objects are still all cut, with a note.
  await expect(upload.getByRole("list", { name: "Cut sprites" }).getByRole("listitem")).toHaveCount(16);
  await expect(upload.getByRole("list", { name: "Cut notes" })).toContainText("found 16 sprites where the layout expects 9");
  await expectNoHorizontalScroll(page);
});
