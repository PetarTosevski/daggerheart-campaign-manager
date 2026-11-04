import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect as baseExpect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { E2E_OWNER_EMAIL, openFromOverview, setAppOwner } from "./owner";
import { convexAs } from "./visual/helpers";

// Plan config AX (Q16 a, Q17 changed, Q27 b, N1 changed): nobody but the app owner reaches App admin or any admin
// function. A GM and a player of a campaign get 'Not allowed' at /admin and FORBIDDEN from a direct call of every
// `appOwner*` function (the list is checked against the source, so a new admin function fails here until it is
// listed). The owner sees every tab, each passing axe, and opens a campaign they are not in read-only: a write is
// refused. The owner is the shared e2e owner (tests/e2e/owner.ts); every app-wide setting this spec touches is put
// back in `finally`.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const TABS = [
  { id: "overview", label: "Overview", heading: "Campaigns" },
  { id: "accounts", label: "Accounts", heading: "Who can join" },
  { id: "lorekeeper", label: "Lorekeeper", heading: "Book library" },
  { id: "features", label: "Feature switches", heading: "Feature switches" },
  { id: "maintenance", label: "Maintenance", heading: "Backups" },
] as const;

/** The ids the admin functions take, made for this run. */
type Ids = {
  campaignId: Id<"campaigns">;
  userId: Id<"users">;
  storageId: Id<"_storage">;
  requestId: Id<"lorekeeperLimitRequests">;
};

const MONTH = new Date().toISOString().slice(0, 7);
const DAY = new Date().toISOString().slice(0, 10);
const PAGE = { numItems: 5, cursor: null };

/**
 * Every public admin function (`appOwnerQuery` / `appOwnerMutation` / `appOwnerAction`) with valid arguments. The
 * arguments are chosen so that a leak would still change nothing that matters (an out-of-range number, the default
 * mode, an inert feature): the test must never be able to flip the shared backend.
 */
function adminCalls(ids: Ids): Record<string, (client: ConvexHttpClient) => Promise<unknown>> {
  return {
    "appAdmin.settings": (c) => c.query(api.appAdmin.settings, {}),
    "appAdmin.openCampaign": (c) => c.mutation(api.appAdmin.openCampaign, { campaignId: ids.campaignId }),
    "adminOverview.stats": (c) => c.query(api.adminOverview.stats, { month: MONTH }),
    "adminOverview.alerts": (c) => c.query(api.adminOverview.alerts, { day: DAY, month: MONTH }),
    "adminOverview.campaigns": (c) => c.query(api.adminOverview.campaigns, { paginationOpts: PAGE }),
    "adminOverview.audit": (c) => c.query(api.adminOverview.audit, { paginationOpts: PAGE }),
    "adminAccounts.setSignUpMode": (c) => c.mutation(api.adminAccounts.setSignUpMode, { mode: "open" }),
    "adminAccounts.setCap": (c) => c.mutation(api.adminAccounts.setCap, { cap: "campaignsApp", value: 0 }),
    "adminAccounts.accounts": (c) => c.query(api.adminAccounts.accounts, { paginationOpts: PAGE }),
    "adminAccounts.addTester": (c) => c.mutation(api.adminAccounts.addTester, { userId: ids.userId }),
    "adminAccounts.removeTester": (c) => c.mutation(api.adminAccounts.removeTester, { userId: ids.userId }),
    "adminLorekeeper.setLimit": (c) => c.mutation(api.adminLorekeeper.setLimit, { change: { field: "dailyQuestions", value: -1 } }),
    "adminLorekeeper.useByCampaign": (c) => c.query(api.adminLorekeeper.useByCampaign, { month: MONTH }),
    "adminLibrary.list": (c) => c.query(api.adminLibrary.list, {}),
    "adminLibrary.ingestStatus": (c) => c.query(api.adminLibrary.ingestStatus, { bookKey: "core" }),
    "adminLibrary.uploadUrl": (c) => c.mutation(api.adminLibrary.uploadUrl, {}),
    "adminLibrary.ingest": (c) => c.mutation(api.adminLibrary.ingest, { storageId: ids.storageId, bookKey: "houseRules", firstPrintedPage: 1 }),
    "features.list": (c) => c.query(api.features.list, {}),
    "features.setMode": (c) => c.mutation(api.features.setMode, { key: "shareLinks", mode: "everyone" }),
    "adminMaintenance.setReadOnly": (c) => c.mutation(api.adminMaintenance.setReadOnly, { on: false }),
    "adminMaintenance.keys": (c) => c.query(api.adminMaintenance.keys, {}),
    "adminMaintenance.backups": (c) => c.query(api.adminMaintenance.backups, {}),
    "adminExport.start": (c) => c.mutation(api.adminExport.start, {}),
    "adminExport.status": (c) => c.query(api.adminExport.status, {}),
    "lorekeeperLimitRequests.list": (c) => c.query(api.lorekeeperLimitRequests.list, { status: "pending", paginationOpts: PAGE }),
    "lorekeeperLimitRequests.decide": (c) => c.mutation(api.lorekeeperLimitRequests.decide, { requestId: ids.requestId, approve: false }),
    "lorekeeperLimitRequests.setCampaignLimits": (c) =>
      c.mutation(api.lorekeeperLimitRequests.setCampaignLimits, { campaignId: ids.campaignId, change: { field: "dailyQuestions", value: null } }),
  };
}

/** `module.fn` of every function the source defines with an `appOwner*` builder (convex/, without lib and _generated). */
function appOwnerFunctionsInSource(): string[] {
  const root = path.resolve("convex");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) {
        if (name !== "_generated" && name !== "lib") walk(file);
      } else if (name.endsWith(".ts")) {
        const mod = path.relative(root, file).replace(/\.ts$/, "").split(path.sep).join("/");
        for (const match of readFileSync(file, "utf8").matchAll(/export const (\w+) = appOwner(?:Query|Mutation|Action)\b/g)) {
          found.push(`${mod}.${match[1]}`);
        }
      }
    }
  };
  walk(root);
  return found.sort();
}

/** Asserts the call is refused with FORBIDDEN (the owner check, before any handler code). */
async function expectForbidden(name: string, call: Promise<unknown>) {
  const outcome = await call.then(
    () => "ok",
    (error: unknown) => (error instanceof ConvexError ? (error.data as { code?: string }).code : `not a ConvexError: ${String(error)}`),
  );
  expect(outcome, name).toBe("FORBIDDEN");
}

async function expectNotAllowed(page: Page) {
  await page.goto("/admin?tab=maintenance");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
  await expect(main.getByText("This page is for the app owner.")).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
}

test("only the owner reaches App admin: GM and player get 'Not allowed' and FORBIDDEN, the owner sees every tab and a read-only campaign", async ({ browser }) => {
  const run = crypto.randomUUID().slice(0, 8);
  // A fresh GM each run: limit requests are rate-limited per GM per day.
  const GM = `e2e-ax-gm-${run}@example.test`;
  const PLAYER = `e2e-ax-player-${run}@example.test`;
  const name = `Superadmin ${run}`;

  const ownerContext = await browser.newContext();
  const gmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const gm = await gmContext.newPage();
  const player = await playerContext.newPage();

  let ownerClient: ConvexHttpClient | null = null;
  let gmClient: ConvexHttpClient | null = null;
  let allowGmRequestsBefore: boolean | null = null;
  let requestId: Id<"lorekeeperLimitRequests"> | null = null;
  let storageId: Id<"_storage"> | null = null;
  let campaignId: Id<"campaigns"> | null = null;
  try {
    await signInAsTestGm(owner, E2E_OWNER_EMAIL);
    await expect(owner).toHaveURL("/");
    setAppOwner();
    ownerClient = await convexAs(owner);

    // A campaign the owner is not in: its GM and one player.
    await signInAsTestGm(gm, GM);
    await expect(gm).toHaveURL("/");
    gmClient = await convexAs(gm);
    ({ campaignId } = await gmClient.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: crypto.randomUUID() }));
    const { joinCode } = await gmClient.query(api.members.access, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code: joinCode! });

    // Real ids for the functions that take one. The GM's user id from the owner's account table.
    const accounts = await ownerClient.query(api.adminAccounts.accounts, { paginationOpts: { numItems: 50, cursor: null } });
    const userId = accounts.page.find((a) => a.email === GM)?.userId;
    expect(userId, "the new GM in the account table").toBeTruthy();
    // A stored file (the GM's own book upload URL; a text file, deleted again in `finally`).
    const uploadUrl = await gmClient.mutation(api.campaignBooks.uploadUrl, { campaignId });
    const uploaded = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "not a book" });
    storageId = ((await uploaded.json()) as { storageId: Id<"_storage"> }).storageId;
    // A limit request: the owner lets GMs ask (put back afterwards), the GM asks.
    allowGmRequestsBefore = (await ownerClient.query(api.appAdmin.settings, {})).lorekeeper.allowGmRequests;
    if (!allowGmRequestsBefore) await ownerClient.mutation(api.adminLorekeeper.setLimit, { change: { field: "allowGmRequests", value: true } });
    requestId = await gmClient.mutation(api.lorekeeperLimitRequests.request, { campaignId, wants: { dailyQuestions: 50 }, reason: "AX spec" });

    // ---- Every admin function, called directly by the GM and the player: FORBIDDEN.
    const calls = adminCalls({ campaignId, userId: userId!, storageId, requestId });
    expect(Object.keys(calls).sort(), "every appOwner* function in convex/ is called here").toEqual(appOwnerFunctionsInSource());
    for (const [who, client] of [
      ["GM", gmClient],
      ["player", playerClient],
    ] as const) {
      for (const [fn, call] of Object.entries(calls)) await expectForbidden(`${who}: ${fn}`, call(client));
    }

    // ---- /admin in the browser: 'Not allowed' for both.
    await expectNotAllowed(gm);
    await expectNotAllowed(player);

    // ---- The owner: every tab, axe on each.
    await owner.goto("/admin");
    await expect(owner.getByRole("heading", { level: 1, name: "App admin" })).toBeVisible();
    const tabs = owner.getByRole("tablist", { name: "Admin sections" });
    await expect(tabs.getByRole("tab")).toHaveText(TABS.map((t) => t.label));
    for (const tab of TABS) {
      await tabs.getByRole("tab", { name: tab.label }).click();
      await expect(tabs.getByRole("tab", { name: tab.label })).toHaveAttribute("aria-selected", "true");
      if (tab.id === "overview") await expect(owner).toHaveURL("/admin");
      else await expect(owner).toHaveURL(`/admin?tab=${tab.id}`);
      const panel = owner.getByRole("tabpanel", { name: tab.label });
      await expect(panel.getByRole("heading", { level: 3, name: tab.heading, exact: true })).toBeVisible();
      await expect(panel.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expectNoSeriousA11yViolations(owner);
    }

    // ---- The owner opens the campaign read-only from the Overview; a write is refused and changes nothing.
    await tabs.getByRole("tab", { name: "Overview" }).click();
    await openFromOverview(owner, name);
    await expect(owner).toHaveURL(`/campaigns/${campaignId}`);
    await expect(owner.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(owner.getByTestId("owner-view-banner")).toBeVisible();
    await expect(owner.getByRole("button", { name: "Campaign settings" })).toHaveCount(0);
    const ownerReads = await ownerClient.query(api.campaigns.get, { campaignId });
    expect(ownerReads?.ownerView).toBe(true);
    const fearBefore = await ownerClient.query(api.campaigns.fear, { campaignId });
    const write = ownerClient.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: crypto.randomUUID() });
    const code = await write.then(
      () => "ok",
      (error: unknown) => (error instanceof ConvexError ? (error.data as { code?: string }).code : String(error)),
    );
    expect(["NOT_FOUND", "FORBIDDEN", "OWNER_VIEW_READ_ONLY"]).toContain(code);
    expect(await gmClient.query(api.campaigns.fear, { campaignId })).toBe(fearBefore);
  } finally {
    // Put the shared backend back: the request declined, the switch as it was, the test file deleted.
    if (ownerClient && requestId) await ownerClient.mutation(api.lorekeeperLimitRequests.decide, { requestId, approve: false }).catch(() => {});
    if (ownerClient && allowGmRequestsBefore === false) {
      await ownerClient.mutation(api.adminLorekeeper.setLimit, { change: { field: "allowGmRequests", value: false } }).catch(() => {});
    }
    if (gmClient && campaignId && storageId) {
      await gmClient.mutation(api.campaignBooks.add, { campaignId, storageId, title: "not a book", firstPrintedPage: 1 }).catch(() => {});
    }
    await ownerContext.close();
    await gmContext.close();
    await playerContext.close();
  }
});
