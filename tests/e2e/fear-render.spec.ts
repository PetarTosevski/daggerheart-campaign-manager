import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

/**
 * PF7: what one GM Fear click on the dashboard costs.
 *
 * - Queries re-sent: the query results the Convex server sends in WebSocket `Transition` frames after the click's
 *   `fear:set` mutation (CDP Network events; the client's `ModifyQuerySet` frames map query ids to functions).
 * - Main-thread time: CDP `Performance.getMetrics` (TaskDuration, ScriptDuration) over a fixed window after the click,
 *   CPU throttled 4x as PF0's cpu4 profile, minus an idle window of the same length just before it. The click is a DOM
 *   `click()` from one `page.evaluate`, and nothing polls the page inside the window, so Playwright's own injected
 *   script (actionability checks, `toHaveText` polling) does not count; the CSS animations are paused for the same reason.
 *
 * Numbers go to the console and the test's annotations; the before/after record is in docs/tasks/TASK-PF-PF7.md.
 */

const CLICKS = 8;
const WINDOW_MS = 2000;
const CPU_THROTTLE = 4;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

type Frame = { dir: "sent" | "received"; data: Record<string, unknown> };

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = `FearRender ${Date.now().toString(36)}`;
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Records every Convex WebSocket frame and keeps the queryId -> function map from the client's ModifyQuerySet frames. */
async function watchConvex(cdp: CDPSession) {
  const frames: Frame[] = [];
  const udf = new Map<number, string>();
  const parse = (payload: string) => {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameSent", ({ response }) => {
    const data = parse(response.payloadData);
    if (!data) return;
    if (data.type === "ModifyQuerySet") {
      for (const m of data.modifications as { type: string; queryId: number; udfPath?: string }[]) {
        if (m.type === "Add" && m.udfPath) udf.set(m.queryId, m.udfPath);
      }
    }
    frames.push({ dir: "sent", data });
  });
  cdp.on("Network.webSocketFrameReceived", ({ response }) => {
    const data = parse(response.payloadData);
    if (data) frames.push({ dir: "received", data });
  });
  /** The functions whose results the server re-sent in Transition frames since frame index `from`. */
  const resent = (from: number) =>
    frames
      .slice(from)
      .filter((f) => f.dir === "received" && f.data.type === "Transition")
      .flatMap((f) => f.data.modifications as { type: string; queryId: number }[])
      .filter((m) => m.type === "QueryUpdated")
      .map((m) => udf.get(m.queryId) ?? `query#${m.queryId}`);
  return { frames, resent };
}

type Metrics = { task: number; script: number };

async function metrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics: all } = await cdp.send("Performance.getMetrics");
  const get = (name: string) => (all.find((m) => m.name === name)?.value ?? 0) * 1000;
  return { task: get("TaskDuration"), script: get("ScriptDuration") };
}

async function windowAfter(cdp: CDPSession, page: Page, action: () => Promise<unknown>): Promise<Metrics> {
  const m0 = await metrics(cdp);
  await action();
  await page.waitForTimeout(WINDOW_MS);
  const m1 = await metrics(cdp);
  return { task: m1.task - m0.task, script: m1.script - m0.script };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

test("PF7: a Fear click re-sends one query result and costs little main-thread time", async ({ page }) => {
  test.setTimeout(180_000);
  // Watch the socket from the start so every ModifyQuerySet (queryId -> function) is seen.
  const cdp = await page.context().newCDPSession(page);
  const convex = await watchConvex(cdp);
  await newCampaign(page);
  const fear = page.getByTestId("fear-value");
  await expect(fear).toHaveText("—");
  await expect(page.getByRole("button", { name: "Fear 1 of 12" })).toBeEnabled();

  await page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused!important}" });
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  // Let the dashboard's first results and art settle.
  await page.waitForTimeout(3000);

  const clicks: { task: number; script: number }[] = [];
  const resentPerClick: string[][] = [];
  for (let i = 0; i < CLICKS; i++) {
    const value = i + 1;
    const idle = await windowAfter(cdp, page, async () => undefined);
    const from = convex.frames.length;
    const busy = await windowAfter(cdp, page, () =>
      page.evaluate((label) => (document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click(), `Fear ${value} of 12`),
    );
    // Checked after the window, so the check's polling is not measured.
    await expect(fear).toHaveText(ROMAN[value - 1]);
    const sent = convex.frames.slice(from).find((f) => f.dir === "sent" && f.data.type === "Mutation");
    expect(sent?.data.udfPath).toBe("fear:set");
    resentPerClick.push(convex.resent(from));
    clicks.push({ task: Math.max(0, busy.task - idle.task), script: Math.max(0, busy.script - idle.script) });
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const result = {
    resentPerClick,
    clickTaskMs: clicks.map((c) => Math.round(c.task)),
    clickScriptMs: clicks.map((c) => Math.round(c.script)),
    medianClickTaskMs: Math.round(median(clicks.map((c) => c.task))),
    medianClickScriptMs: Math.round(median(clicks.map((c) => c.script))),
  };
  console.log(`PF7 fear-render (cpu ${CPU_THROTTLE}x, ${WINDOW_MS} ms windows): ${JSON.stringify(result)}`);
  test.info().annotations.push({ type: "fear-render", description: JSON.stringify(result) });

  // One query result per click, the Fear read itself (baseline: campaigns.get, which every useCampaign() reader re-renders on).
  for (const r of resentPerClick) expect(r, `re-sent: ${r.join(", ")}`).toEqual(["campaigns:fear"]);
});
