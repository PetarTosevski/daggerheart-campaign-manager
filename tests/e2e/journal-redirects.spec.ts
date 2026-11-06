import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs } from "./visual/helpers";

// Journal JX1 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JX1.md): the campaign nav reads Dashboard, Party,
// Codex, World Map, Combat Map, Adversaries, Journal, Lorekeeper (user 2026-11-03); the old /sessions and /notes routes
// answer with a server redirect to the matching Journal sub-tab and view (?s kept; stage prep -> sv=plan, play and wrap
// -> sv=log, anything else dropped; the notes params view / page / journal kept); the dashboard's Last Session card
// opens the Journal.

let page: Page;
let campaignId: Id<"campaigns">;
let sessionId: Id<"sessions">;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  page = await browser.newPage();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Redirects ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  ({ sessionId } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: crypto.randomUUID() }));
});

test.afterAll(async () => {
  await page?.close();
});

const base = () => `/campaigns/${campaignId}`;

/** The server answers the old URL with a redirect to `to` before any page renders. */
async function expectServerRedirect(from: string, to: string) {
  const response = await page.request.get(`${base()}${from}`, { maxRedirects: 0 });
  expect(response.status(), `${from} answers with a redirect`).toBeGreaterThanOrEqual(300);
  expect(response.status(), `${from} answers with a redirect`).toBeLessThan(400);
  const location = new URL(response.headers()["location"] ?? "", "http://localhost");
  expect(location.pathname + location.search, `${from} redirect target`).toBe(`${base()}${to}`);
}

test("the nav shows Journal where Sessions was; Sessions and Notes are gone; the Last Session card opens the Journal", async () => {
  await page.goto(base());
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Party", "Codex", "World Map", "Combat Map", "Adversaries", "Journal", "Lorekeeper"]);
  const last = page.getByRole("region", { name: "Last Session" });
  await expect(last.getByRole("link", { name: "All sessions" })).toHaveCount(0);
  await last.getByRole("link", { name: "Open the Journal" }).click();
  await expect(page).toHaveURL(`${base()}/journal`);
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Journal" })).toHaveAttribute("aria-current", "page");
});

test("/sessions redirects to the Journal's Sessions sub-tab: ?s kept, Prep -> Plan, Play and Wrap-up -> Log & recap", async () => {
  const s = sessionId;
  await expectServerRedirect("/sessions", "/journal?tab=sessions");
  await expectServerRedirect(`/sessions?s=${s}`, `/journal?tab=sessions&s=${s}`);
  await expectServerRedirect(`/sessions?s=${s}&stage=prep`, `/journal?tab=sessions&s=${s}&sv=plan`);
  await expectServerRedirect(`/sessions?s=${s}&stage=play`, `/journal?tab=sessions&s=${s}&sv=log`);
  await expectServerRedirect(`/sessions?s=${s}&stage=wrap`, `/journal?tab=sessions&s=${s}&sv=log`);
  await expectServerRedirect(`/sessions?stage=bogus&other=1`, "/journal?tab=sessions");

  // In the browser: the old Play URL lands on the session's Log & recap, the Prep URL on its Plan.
  const view = page.getByRole("tablist", { name: "Session view" });
  await page.goto(`${base()}/sessions?s=${s}&stage=play`);
  await expect(page).toHaveURL(new RegExp(`/journal\\?.*s=${s}`));
  await expect(page.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: /^Sessions/ })).toHaveAttribute("aria-selected", "true");
  await expect(view.getByRole("tab", { name: "Log & recap" })).toHaveAttribute("aria-selected", "true");
  await page.goto(`${base()}/sessions?s=${s}&stage=prep`);
  await expect(page).toHaveURL(/sv=plan/);
  await expect(view.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
});

test("/notes redirects to the Journal's Notes sub-tab with view, page and journal kept", async () => {
  await expectServerRedirect("/notes", "/journal?tab=notes");
  await expectServerRedirect("/notes?view=threads", "/journal?tab=notes&view=threads");
  await expectServerRedirect("/notes?page=template-1", "/journal?tab=notes&page=template-1");
  await expectServerRedirect("/notes?view=journal&journal=abc", "/journal?tab=notes&view=journal&journal=abc");
  await expectServerRedirect("/notes?view=bin&x=1", "/journal?tab=notes&view=bin");

  const tabs = page.getByRole("tablist", { name: "Journal" });
  const paperColumn = page.getByRole("region", { name: "Journal page" });
  await page.goto(`${base()}/notes`);
  await expect(page).toHaveURL(`${base()}/journal?tab=notes`);
  await expect(tabs.getByRole("tab", { name: /^Notes/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Game Master", pressed: true })).toBeVisible();
  await page.goto(`${base()}/notes?page=template-1`);
  await expect(paperColumn.getByRole("article", { name: "Page" }).getByLabel("Page title")).toHaveValue("Rumors & hooks");
  await page.goto(`${base()}/notes?view=threads`);
  await expect(paperColumn.getByRole("article", { name: "Open threads" })).toBeVisible();
});
