import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, cardsForDomains, COMMUNITIES, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd";
import { closeCampaignSettings, gmJoinCode, openPlayers } from "./config/helpers";
import { readEmailedCode, signInAsTestGm } from "./fixtures";
import { endFromJournal, journalLiveChip, startFromJournal } from "./visual/helpers";

const PLAYER = "e2e-player@example.test";
/** Password sign-ups use a fresh, unique email each run (docs/testing.md); signup.spec.ts covers the sign-in page itself. */
const PASSWORD = "correct-horse-battery";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page, frameId = "witherwild") {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Shared");
  await page.goto(`/frames/${frameId}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

async function playerPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page, PLAYER);
  await expect(page).toHaveURL("/");
  return { page, close: () => context.close() };
}

test("a player joins with the GM's code and sees a read-only dashboard", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page);
  // Config SX (Q10 b): the header's Players button opens Campaign settings at Players, the one Players UI; a new
  // campaign has no link until the GM makes one.
  const dialog = await openPlayers(page);
  await expect(dialog.getByRole("list", { name: "People in this campaign" })).toContainText("Owner");
  await expect(dialog.getByText("No players yet. Share the link below.")).toBeVisible();
  const code = await gmJoinCode(page, { keepOpen: true });
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const player = await playerPage(browser);
  const badCode = "No campaign uses that code. Check it with your GM.";
  // A wrong code in a shared link is refused with the server's message.
  await player.page.goto("/join/NOPE-NOPE");
  await player.page.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.page.getByRole("main").getByRole("alert")).toHaveText(badCode);
  await player.page.goto("/");

  await player.page.getByRole("button", { name: /Join Campaign/ }).click();
  const join = player.page.getByRole("dialog", { name: "Join a campaign" });
  await join.getByLabel("Join code").fill("NOPE-NOPE");
  await player.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(join.getByRole("alert")).toHaveText(badCode);
  await join.getByLabel("Join code").fill(code.toLowerCase());
  await player.page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(player.page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(player.page.getByText("Player", { exact: true })).toBeVisible();
  await expect(player.page.getByRole("button", { name: "Players" })).toHaveCount(0);
  await expect(player.page.getByRole("button", { name: "Fear 3 of 12" })).toBeDisabled();
  await expect(player.page.getByRole("button", { name: "+ New countdown" })).toHaveCount(0);
  await expect(player.page.getByRole("button", { name: "Day 2: Sunrise" })).toBeDisabled();

  // The GM sees the player at the table, live.
  await expect(dialog.getByTestId("settings-member-e2e-player")).toBeVisible();

  // GM changes show up for the player without reloading.
  await closeCampaignSettings(page);
  await expect(page).not.toHaveURL(/settings=/);
  await page.getByRole("button", { name: "Fear 4 of 12" }).click();
  await expect(player.page.getByTestId("fear-value")).toHaveText("IV");
  await player.close();
});

test("an email invite shows the campaign in the player's Load Campaign", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page, "beast-feast");
  const dialog = await openPlayers(page);
  await dialog.getByLabel("Player email").fill(PLAYER);
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(dialog.getByText(`${PLAYER} · invited`)).toBeVisible();

  const player = await playerPage(browser);
  await player.page.goto("/campaigns");
  const band = player.page.locator("button[aria-expanded]", { hasText: name });
  await expect(band).toContainText("Player");
  if ((await band.getAttribute("aria-expanded")) !== "true") await band.click();
  await player.page.getByRole("button", { name: `Leave ${name}` }).click();
  await player.page.getByRole("alertdialog", { name: "Confirm leave" }).getByRole("button", { name: "Leave" }).click();
  await expect(band).toHaveCount(0);
  await player.close();
});

/** Signs up a fresh password account in its own browser context and stops at the code step (no session yet). */
async function passwordSignUp(browser: Browser, label: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  await page.goto("/signin");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Name").fill("New Player");
  await signUp.getByLabel("Email").fill(email);
  await signUp.getByLabel("Password").fill(PASSWORD);
  await signUp.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("form", { name: "Enter the code" })).toBeVisible();
  /** Enters the code the e2e backend recorded for this email; the account is then signed in. */
  const verify = async () => {
    const codeForm = page.getByRole("form", { name: "Enter the code" });
    await codeForm.getByLabel("6-digit code").fill(await readEmailedCode(email));
    await codeForm.getByRole("button", { name: "Verify email" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
  };
  return { page, email, verify, close: () => context.close() };
}

test("an email invite reaches a brand-new password account only after its code", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page, "beast-feast");
  const player = await passwordSignUp(browser, "invitee");
  const dialog = await openPlayers(page);
  await dialog.getByLabel("Player email").fill(player.email);
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(dialog.getByText(`${player.email} · invited`)).toBeVisible();

  // Before the code there is no session: the campaign list sends this browser to sign-in, and a password sign-in
  // stops at the code step again.
  const probe = await player.page.context().newPage();
  await probe.goto("/campaigns");
  await expect(probe).toHaveURL("/signin?next=%2Fcampaigns");
  const signIn = probe.getByRole("form", { name: "Sign in with email" });
  await signIn.getByLabel("Email").fill(player.email);
  await signIn.getByLabel("Password").fill(PASSWORD);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(probe.getByRole("form", { name: "Enter the code" })).toBeVisible();
  await expect(probe).toHaveURL(/\/signin/);
  await probe.close();

  // The emailed code verifies the address; the invite is then theirs.
  await player.verify();
  await player.page.goto("/campaigns");
  const band = player.page.locator("button[aria-expanded]", { hasText: name });
  await expect(band).toContainText("Player");
  await player.close();
});

test("a brand-new password account joins with the GM's code", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page);
  const code = await gmJoinCode(page, { keepOpen: true });
  const dialog = page.getByRole("dialog", { name: "Campaign settings" });

  const player = await passwordSignUp(browser, "joiner");
  await player.verify();
  await player.page.goto(`/join/${code}`);
  await player.page.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(player.page.getByText("Player", { exact: true })).toBeVisible();
  // The roster shows the new account by its name, live.
  await expect(dialog.getByTestId("settings-member-New Player")).toBeVisible();
  await player.close();
});

/** Creates a level-1 Warrior through the API as the signed-in user of `page` (the wizard has its own spec). */
async function createCharacter(page: Page, campaignId: string, name: string) {
  const token = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("__convexAuthJWT"));
    return k ? localStorage.getItem(k) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  const cls = getClass("warrior")!;
  await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: {
      classId: cls.id,
      subclassId: subclassesForClass("warrior")[0].id,
      ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
      communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      name,
      pronouns: "",
      description: "",
      primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
      armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
      potion: "Minor Health Potion",
      classItem: "",
      background: [],
      experiences: ["Sellsword", "Lockpick"],
      domainCards: cardsForDomains(cls.domains, 1).slice(0, 2).map((c) => c.id),
      connections: [],
    },
    idempotencyKey: crypto.randomUUID(),
  });
}

test("XC1: the GM allows extra characters for the session; they stay after it ends, with a roster warning", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page);
  const campaignId = new URL(page.url()).pathname.split("/")[2];
  const code = await gmJoinCode(page);
  const player = await playerPage(browser);
  await player.page.goto(`/join/${code}`);
  await player.page.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.page.getByRole("heading", { level: 1, name })).toBeVisible();

  const first = unique("Gale");
  const second = unique("Hale");
  await createCharacter(player.page, campaignId, first);
  await expect(createCharacter(player.page, campaignId, second)).rejects.toThrow();

  // The switch shows only while a session runs, and only to the GM (in the Journal live chip's menu, JH / Q10).
  await page.goto(`/campaigns/${campaignId}/journal`);
  const allow = page.getByRole("switch", { name: /Allow extra characters this session/ });
  await expect(page.getByRole("button", { name: "Start session 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session options" })).toHaveCount(0);
  await startFromJournal(page);
  await journalLiveChip(page).getByRole("button", { name: "Session options" }).click();
  await allow.check();
  await expect(allow).toBeChecked();
  await expect(player.page.getByRole("switch", { name: /Allow extra characters/ })).toHaveCount(0);

  // The checkbox flips optimistically; retry until the server has the allowance.
  await expect(() => createCharacter(player.page, campaignId, second)).toPass();
  await player.page.goto(`/campaigns/${campaignId}/party`);
  for (const hero of [first, second]) {
    await expect(player.page.getByRole("article", { name: hero }).getByTestId("extra-active-warning")).toHaveText("2 active: send one away");
  }

  // End: the allowance goes, the extras stay active, and the rule is back.
  await page.keyboard.press("Escape");
  await endFromJournal(page);
  await expect(allow).toHaveCount(0);
  await expect(player.page.getByRole("article", { name: second }).getByTestId("extra-active-warning")).toHaveText("2 active: send one away");
  await expect(createCharacter(player.page, campaignId, unique("Ivo"))).rejects.toThrow();

  await player.page.getByRole("article", { name: second }).getByRole("button", { name: `Send ${second} away` }).click();
  await expect(player.page.getByTestId("extra-active-warning")).toHaveCount(0);
  await player.close();
});
