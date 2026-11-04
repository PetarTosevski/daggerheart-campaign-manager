import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { bardDraft, convexAs } from "./visual/helpers";

// Plan config IMP (N3 a): the first signed-in load on a browser that still holds the old values moves them to the
// account once, with nothing to click, and removes the old keys (and the dead `dcm:combat-hud`). A second browser of
// the same account that holds other old values loses them: the first device wins.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

/**
 * The test sign-in form without `signInAsTestGm`'s reset of preferences and UI state to the defaults: those writes
 * would set the very values the import fills only while unset. A fresh account each run, so nothing leaks.
 */
async function signedIn(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/signin");
  const form = page.getByRole("form", { name: "Test sign-in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Secret").fill(process.env.E2E_AUTH_SECRET ?? "");
  await form.getByRole("button", { name: "Test sign-in" }).click();
  await expect(page).toHaveURL("/");
  return { context, page };
}

/** Writes `entries` to the page's localStorage. */
const seed = (page: Page, entries: Record<string, string>) =>
  page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, entries);

/** The app's keys still in localStorage (Convex Auth's own `__convexAuth*` keys and the display cache left out). */
const appKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith("__convexAuth") && k !== "dcm:display-prefs").sort());

test("old browser values move to the account once and the keys are removed; a later browser's are dropped", async ({ browser }) => {
  const email = `e2e-legacy-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const a = await signedIn(browser, email);
  const b = await signedIn(browser, email);
  try {
    const client = await convexAs(a.page);
    const { campaignId } = await client.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: `Legacy ${crypto.randomUUID().slice(0, 8)}`,
      idempotencyKey: crypto.randomUUID(),
    });
    const { characterId } = await client.mutation(api.characters.create, {
      campaignId,
      draft: bardDraft("Liriel"),
      idempotencyKey: crypto.randomUUID(),
    });
    // The first loads found nothing to import, so the account is not marked yet.
    expect((await client.query(api.preferences.get, {})).legacyImported).toBe(false);

    // ---- A: every key the app ever wrote, then a load.
    const wizard = { step: 3, name: "Ash" };
    const custom = { name: "Moonfall" };
    await seed(a.page, {
      "dcm.dice.settings": JSON.stringify({ threeD: false, sound: true }),
      [`dh.combat.handHidden:${campaignId}:${characterId}`]: "1",
      "dh.combat.names": "1",
      "dh.combat.rings": JSON.stringify(["t1", "t2"]),
      "dcm:adversary-sort": "book",
      "dcm:environment-sort": "book",
      "dcm:roll-feed-collapsed": "1",
      "dcm:gm-roll-form-collapsed": "1",
      "dcm:free-roll-form-open": "1",
      [`dh.characterWizard.${campaignId}`]: JSON.stringify(wizard),
      "dh.customDraft": JSON.stringify(custom),
      "dcm:combat-hud": JSON.stringify({ open: true }),
    });
    await a.page.reload();
    await expect.poll(() => appKeys(a.page)).toEqual([]);

    expect(await client.query(api.preferences.get, {})).toMatchObject({ legacyImported: true, dice3d: false, diceSound: true });
    expect(await client.query(api.uiState.get, {})).toEqual({
      tokenNames: true,
      rangeRings: ["t1", "t2"],
      adversarySort: "book",
      environmentSort: "book",
      rollFeedCollapsed: true,
      gmRollFormCollapsed: true,
      freeRollFormOpen: true,
    });
    expect(await client.query(api.preferences.folds, { campaignId })).toEqual([characterId]);
    const wizardDraft = await client.query(api.drafts.get, { kind: "characterWizard", campaignId });
    expect(JSON.parse(wizardDraft!.data)).toEqual(wizard);
    const customDraft = await client.query(api.drafts.get, { kind: "customFrame" });
    expect(JSON.parse(customDraft!.data)).toEqual(custom);

    // ---- B (same account, another browser): its old values are dropped, the account keeps A's.
    await seed(b.page, {
      "dcm.dice.settings": JSON.stringify({ threeD: true, sound: false }),
      "dh.combat.names": "0",
      [`dh.combat.handHidden:${campaignId}:${characterId}`]: "0",
      [`dh.characterWizard.${campaignId}`]: JSON.stringify({ step: 1, name: "Other" }),
      "dh.customDraft": JSON.stringify({ name: "Other" }),
      "dcm:combat-hud": "{}",
    });
    await b.page.reload();
    await expect.poll(() => appKeys(b.page)).toEqual([]);
    expect(await client.query(api.preferences.get, {})).toMatchObject({ dice3d: false, diceSound: true });
    expect((await client.query(api.uiState.get, {})).tokenNames).toBe(true);
    expect(await client.query(api.preferences.folds, { campaignId })).toEqual([characterId]);
    expect(JSON.parse((await client.query(api.drafts.get, { kind: "characterWizard", campaignId }))!.data)).toEqual(wizard);
    expect(JSON.parse((await client.query(api.drafts.get, { kind: "customFrame" }))!.data)).toEqual(custom);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
