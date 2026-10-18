import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

// Headless Chromium only offers software WebGL behind this switch.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

function bardDraft(name: string) {
  return {
    classId: "bard",
    subclassId: "troubadour",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
    name,
    pronouns: "she/her",
    description: "",
    primaryWeaponId: "rapier",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Wandering minstrel", "Silver tongue"],
    domainCards: ["deft-deceiver", "book-of-ava"],
    connections: [],
  };
}

/** The GM starts a campaign and creates a character for it through the API, then opens its sheet. */
async function gmSheet(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Dice 3D");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2]!;

  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  const hero = unique("Liriel");
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: bardDraft(hero),
    idempotencyKey: crypto.randomUUID(),
  });
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const box = page.getByRole("region", { name: "Dice", exact: true });
  return { campaignId, hero, box };
}

/** "Hope d12: 7" → 7, in the order the dice list shows them. */
async function shownValues(dice: ReturnType<Page["getByRole"]>): Promise<string> {
  const labels = await dice.getByRole("listitem").evaluateAll((items) => items.map((li) => li.getAttribute("aria-label") ?? ""));
  return labels.map((l) => /: (\d+)/.exec(l)?.[1] ?? "?").join(",");
}

test("with reduced motion, 3D is off by default and no canvas appears even when switched on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { box } = await gmSheet(page);
  const toggle = box.getByRole("checkbox", { name: "3D dice" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toBeVisible();
  await expect(box.getByTestId("dice-3d")).toHaveCount(0);
});

test("with the toggle on, the dice land in 3D on the server's values, and the feed shows the same values", async ({ page }) => {
  const { campaignId, hero, box } = await gmSheet(page);
  await expect(box.getByRole("checkbox", { name: "3D dice" })).toBeChecked();
  await box.getByRole("button", { name: "Increase Advantage", exact: true }).click();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  const canvas = box.getByTestId("dice-3d");
  await expect(canvas).toBeVisible();
  // The result shows once the dice have settled (at most 2.5 s of animation).
  await expect(box.getByTestId("last-roll")).toBeVisible({ timeout: 10_000 });
  const values = await canvas.getAttribute("data-values");
  expect(values).toMatch(/^\d+,\d+,\d+$/);
  expect(await shownValues(box.getByRole("region", { name: "Last roll" }).getByRole("list", { name: "Dice" }))).toBe(values);

  await page.goto(`/campaigns/${campaignId}`);
  const row = page.getByRole("list", { name: "Rolls" }).getByRole("listitem").filter({ hasText: `${hero}: Agility action roll` });
  await expect(row).toBeVisible();
  expect(await shownValues(row.getByRole("list", { name: "Dice" }))).toBe(values);
});

test("without WebGL the roll falls back to 2D without an error", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { box } = await gmSheet(page);
  await expect(box.getByRole("checkbox", { name: "3D dice" })).toBeChecked();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toBeVisible();
  await expect(box.getByTestId("dice-3d")).toHaveCount(0);
  expect(errors).toEqual([]);
});
