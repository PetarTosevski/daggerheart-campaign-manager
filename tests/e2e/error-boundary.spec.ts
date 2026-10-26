import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

// Error boundaries (plan d12-hardening H4, rule 11 / CL1). A failing query on Party, Codex and World shows the section's
// error.tsx under the campaign chrome (the section nav stays), with the mapped reason and a working 'Try again'; a
// malformed campaign id never leaves a blank page.
//
// No public function fails on demand for a campaign the GM owns (a malformed campaign id makes `campaigns.get` return
// null, so the shell shows 'Campaign not found' before any section renders). The spec therefore sits between the page
// and the Convex sync socket and turns the chosen query's results into a `QueryFailed` with a ConvexError payload,
// exactly what the server sends when a handler throws `ConvexError({ code: "NOT_FOUND" })`.

type Json = Record<string, unknown>;

/** Proxies the Convex sync socket; while `fail` names a function, its query results arrive as NOT_FOUND failures. */
async function failQueries(page: Page) {
  const state = { fail: null as string | null };
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws: WebSocketRoute) => {
    const server = ws.connectToServer();
    const paths = new Map<number, string>();
    let chunks: string[] = [];

    ws.onMessage((message) => {
      if (typeof message === "string") {
        const parsed = JSON.parse(message) as Json;
        if (parsed.type === "ModifyQuerySet") {
          for (const mod of parsed.modifications as Json[]) {
            if (mod.type === "Add") paths.set(mod.queryId as number, mod.udfPath as string);
          }
        }
      }
      server.send(message);
    });

    const rewrite = (transition: Json): Json => ({
      ...transition,
      modifications: (transition.modifications as Json[]).map((mod) =>
        mod.type === "QueryUpdated" && state.fail !== null && paths.get(mod.queryId as number) === state.fail
          ? { type: "QueryFailed", queryId: mod.queryId, errorMessage: "NOT_FOUND", logLines: [], errorData: { code: "NOT_FOUND" }, journal: mod.journal }
          : mod,
      ),
    });

    server.onMessage((message) => {
      if (typeof message !== "string") return ws.send(message);
      const parsed = JSON.parse(message) as Json;
      if (parsed.type === "Transition") return ws.send(JSON.stringify(rewrite(parsed)));
      if (parsed.type === "TransitionChunk") {
        // Reassemble a chunked transition, then hand the client one (rewritten) Transition.
        chunks.push(parsed.chunk as string);
        if (chunks.length < (parsed.totalParts as number)) return;
        const whole = JSON.parse(chunks.join("")) as Json;
        chunks = [];
        return ws.send(JSON.stringify(rewrite(whole)));
      }
      ws.send(message);
    });
  });
  return state;
}

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Boundary ${Date.now().toString(36)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2]!;
  return { name, campaignId };
}

const SECTIONS = [
  { slug: "party", fn: "characters:listByCampaign", heading: "The Party", what: "The party failed to load.", ok: (page: Page) => page.getByRole("link", { name: "+ Create character" }) },
  { slug: "codex", fn: "codex:list", heading: "Characters & Locations", what: "The codex failed to load.", ok: (page: Page) => page.getByRole("complementary", { name: "Entries" }) },
  { slug: "world", fn: "maps:get", heading: "World", what: "The world map failed to load.", ok: (page: Page) => page.getByRole("application", { name: /^Map of/ }) },
] as const;

test("a failing query on Party, Codex and World shows the section boundary under the campaign nav; Try again re-renders", async ({ page }) => {
  test.setTimeout(180_000);
  const state = await failQueries(page);
  const { campaignId } = await gmCreatesCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });

  for (const section of SECTIONS) {
    state.fail = section.fn;
    await page.goto(`/campaigns/${campaignId}/${section.slug}`);

    const alert = page.getByRole("alert").filter({ hasText: section.what });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("That no longer exists.");
    await expect(page.getByRole("heading", { level: 1, name: section.heading })).toBeVisible();
    // The campaign chrome stays: the section nav and the way back to the dashboard.
    await expect(nav.getByRole("link", { name: "Party" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", `/campaigns/${campaignId}`);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // The failure clears: Try again re-renders the real section.
    state.fail = null;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(section.ok(page)).toBeVisible();
    await expect(page.getByText(section.what)).toHaveCount(0);
  }
});

test("a malformed campaign id on Party, Codex and World shows 'Campaign not found' with a way back, never a blank page", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  for (const slug of ["party", "codex", "world"]) {
    await page.goto(`/campaigns/not-a-campaign-id/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Campaign not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Load a campaign" })).toHaveAttribute("href", "/campaigns");
  }
});
