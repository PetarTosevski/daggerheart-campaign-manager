import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, cardsForDomains, COMMUNITIES, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd";
import { readEmailedCode, signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
/** Allowlisted in scripts/e2e-setup.mjs; signs in only with email + password, never through the test sign-in. */
const PASSWORD_ONLY_EMAIL = "e2e-password-only@example.test";
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
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;

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
  await expect(dialog.getByRole("list", { name: "Players in this campaign" })).toContainText("e2e-player");

  // GM changes show up for the player without reloading.
  await dialog.getByRole("button", { name: "Close players" }).click();
  await page.getByRole("button", { name: "Fear 4 of 12" }).click();
  await expect(player.page.getByTestId("fear-value")).toHaveText("IV");
  await player.close();
});

test("an email invite shows the campaign in the player's Load Campaign", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page, "beast-feast");
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(
    dialog.getByText("Email invites work for accounts that sign in with Google. Players who use a password should join with the code above."),
  ).toBeVisible();
  await dialog.getByLabel("Player email").fill(PLAYER);
  await dialog.getByRole("button", { name: "Invite" }).click();
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

test("email + password: create an account (or sign in if it exists)", async ({ page }) => {
  // Password-only: no spec may sign this email in through the test sign-in (docs/testing.md).
  const email = PASSWORD_ONLY_EMAIL;
  const password = "correct-horse-battery";
  await page.goto("/signin");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Name").fill("Pass Word");
  await signUp.getByLabel("Email").fill(email);
  await signUp.getByLabel("Password").fill(password);
  await signUp.getByRole("button", { name: "Create account" }).click();

  // Sign-up stops at the code step (the e2e backend sends no email: the code is read from /e2e/code). If the account already exists,
  // sign up fails with an alert; sign in instead.
  const codeForm = page.getByRole("form", { name: "Enter the code" });
  const outcome = await Promise.race([
    codeForm.waitFor().then(() => "code"),
    signUp.getByRole("alert").waitFor().then(() => "exists"),
  ]);
  if (outcome === "code") {
    await codeForm.getByLabel("6-digit code").fill(await readEmailedCode(email));
    await codeForm.getByRole("button", { name: "Verify email" }).click();
  } else {
    await page.getByRole("button", { name: "Have an account? Sign in" }).click();
    const signIn = page.getByRole("form", { name: "Sign in with email" });
    await signIn.getByLabel("Email").fill(email);
    await signIn.getByLabel("Password").fill(password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/signin");
  const signIn = page.getByRole("form", { name: "Sign in with email" });
  await signIn.getByLabel("Email").fill(PASSWORD_ONLY_EMAIL);
  await signIn.getByLabel("Password").fill("not-the-password");
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(signIn.getByRole("alert")).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL("/signin");
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
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const player = await playerPage(browser);
  await player.page.goto(`/join/${code}`);
  await player.page.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.page.getByRole("heading", { level: 1, name })).toBeVisible();

  const first = unique("Gale");
  const second = unique("Hale");
  await createCharacter(player.page, campaignId, first);
  await expect(createCharacter(player.page, campaignId, second)).rejects.toThrow();

  // The switch shows only while a session runs, and only to the GM (on the Sessions tab's live card, D10 S3).
  await page.goto(`/campaigns/${campaignId}/sessions`);
  await page.getByRole("button", { name: "+ New session" }).click();
  const liveCard = page.getByRole("region", { name: "Live session" });
  const allow = page.getByRole("switch", { name: /Allow extra characters this session/ });
  await expect(liveCard.getByRole("button", { name: "Start session" })).toBeVisible();
  await expect(allow).toHaveCount(0);
  await liveCard.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
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
  await liveCard.getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(allow).toHaveCount(0);
  await expect(player.page.getByRole("article", { name: second }).getByTestId("extra-active-warning")).toHaveText("2 active: send one away");
  await expect(createCharacter(player.page, campaignId, unique("Ivo"))).rejects.toThrow();

  await player.page.getByRole("article", { name: second }).getByRole("button", { name: `Send ${second} away` }).click();
  await expect(player.page.getByTestId("extra-active-warning")).toHaveCount(0);
  await player.close();
});
