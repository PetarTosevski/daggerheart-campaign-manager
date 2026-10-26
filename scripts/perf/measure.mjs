// Navigation perf harness (PF0, docs/performance.md). Runs against the e2e stack (local Convex backend +
// production e2e Next server from scripts/e2e-next.mjs) on E2E_PORT / E2E_CONVEX_PORT:
//
//   node scripts/perf/measure.mjs --profile local|wan|cpu4 [--runs 3] [--out test-results/perf] [--verbose]
//
// Flow per run (fresh browser context, empty HTTP cache, signed in as the e2e GM):
//   title menu cold load -> Load Campaign -> Resume (dashboard) -> every campaign tab (first visit) ->
//   every tab again (revisit) -> hard load of the dashboard in a new context.
// Per step it records: url (URL changed = RSC round trip done), firstAdd (first Convex query sent), lastData (the
// last of the step's queries got its first result), quiet (no query or network change for 600 ms), q (queries
// subscribed), auth (Authenticate frames on the Convex WebSocket), authPost (POST /api/auth), srv (requests to the
// Next server outside /_next/static: documents, RSC and prefetches, each one a pass through src/proxy.ts), JS
// files and bytes fetched, and CDP main-thread task / script time.
// Profiles: local = no throttling; wan = 80 ms RTT HTTP (CDP, 10/5 Mbit) + 40 ms each way on the Convex WebSocket;
// cpu4 = 4x CPU throttling. Prints the per-step medians over the runs and writes all runs to <out>/measure-<profile>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { BASE, chromium, environment, ensureBench, kb, median, ports, signIn } from "./lib.mjs";

const { values: opts } = parseArgs({
  options: {
    profile: { type: "string", default: "local" },
    runs: { type: "string", default: "3" },
    out: { type: "string", default: "test-results/perf" },
    verbose: { type: "boolean", default: false },
  },
});
const PROFILE = opts.profile;
if (!["local", "wan", "cpu4"].includes(PROFILE)) throw new Error(`--profile must be local, wan or cpu4; got ${PROFILE}`);
const WAN = PROFILE === "wan";
const CPU = PROFILE === "cpu4";
const RUNS = Number(opts.runs);
const WS_DELAY = 40; // ms each way: 80 ms RTT on the Convex WebSocket
const CONVEX_WS = new RegExp(`:${ports.convex}/`);

const now = () => performance.now();

/** Records Convex frames, Next requests and CDP metrics for one page. */
class Recorder {
  queries = new Map(); // queryId -> { udf, addT, firstT, removedT, bytes }
  auths = []; // send times of Authenticate frames
  net = []; // finished requests to the Next server
  authPosts = []; // POST /api/auth start times
  wsOpen = null;
  cdp = null;

  async attach(context, page) {
    const sent = (payload) => {
      try {
        const m = JSON.parse(payload);
        if (m.type === "Authenticate") this.auths.push(now());
        if (m.type !== "ModifyQuerySet") return;
        for (const mod of m.modifications) {
          if (mod.type === "Add") this.queries.set(mod.queryId, { udf: mod.udfPath, addT: now(), firstT: null, bytes: 0 });
          if (mod.type === "Remove" && this.queries.has(mod.queryId)) this.queries.get(mod.queryId).removedT = now();
        }
      } catch {}
    };
    const received = (payload) => {
      try {
        const m = JSON.parse(payload);
        if (m.type !== "Transition") return;
        for (const mod of m.modifications) {
          const q = this.queries.get(mod.queryId);
          if (!q) continue;
          q.bytes = JSON.stringify(mod.value ?? mod.errorMessage ?? "").length;
          q.lastT = now();
          if (q.firstT === null) q.firstT = q.lastT;
        }
      } catch {}
    };
    if (WAN) {
      await page.routeWebSocket(CONVEX_WS, (ws) => {
        this.wsOpen ??= now();
        const server = ws.connectToServer();
        ws.onMessage((m) => {
          sent(m);
          setTimeout(() => server.send(m), WS_DELAY);
        });
        server.onMessage((m) =>
          setTimeout(() => {
            received(m);
            ws.send(m);
          }, WS_DELAY),
        );
      });
    } else {
      page.on("websocket", (ws) => {
        if (!CONVEX_WS.test(ws.url())) return;
        this.wsOpen ??= now();
        ws.on("framesent", (f) => sent(f.payload));
        ws.on("framereceived", (f) => received(f.payload));
      });
    }
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().startsWith(`${BASE}/api/auth`)) this.authPosts.push(now());
    });
    page.on("requestfinished", async (req) => {
      const url = req.url();
      if (!url.startsWith(BASE)) return;
      const t = now();
      let size = 0;
      try {
        size = (await req.sizes()).responseBodySize;
      } catch {}
      this.net.push({ t, url: url.slice(BASE.length), type: req.resourceType(), size });
    });
    this.cdp = await context.newCDPSession(page);
    await this.cdp.send("Network.enable");
    await this.cdp.send("Performance.enable");
    if (WAN) {
      await this.cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 80,
        downloadThroughput: (10 * 1024 * 1024) / 8,
        uploadThroughput: (5 * 1024 * 1024) / 8,
      });
    }
    if (CPU) await this.cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  async metrics() {
    const { metrics } = await this.cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  }

  /** Waits until every query added since t0 has data and nothing changed for `quiet` ms. Returns the last change time. */
  async quiesce(page, t0, { quiet = 600, max = 30000 } = {}) {
    const start = now();
    let lastChange = now();
    let lastSig = "";
    while (now() - start < max) {
      const qs = [...this.queries.values()];
      const pending = qs.filter((q) => q.addT >= t0 && q.firstT === null && !q.removedT).length;
      const sig = qs.map((q) => `${q.firstT}|${q.bytes}`).join(",") + `|${this.net.length}|${this.auths.length}`;
      if (sig !== lastSig) {
        lastSig = sig;
        lastChange = now();
      }
      if (pending === 0 && now() - lastChange > quiet) break;
      await page.waitForTimeout(50);
    }
    return lastChange;
  }

  /** Everything recorded since t0, relative to t0. */
  since(t0) {
    const rel = (t) => (t === null || t === undefined ? null : Math.round(t - t0));
    const queries = [...this.queries.values()]
      .filter((q) => q.addT >= t0)
      .map((q) => ({ udf: q.udf, add: rel(q.addT), first: rel(q.firstT), last: rel(q.lastT), bytes: q.bytes }));
    const reqs = this.net.filter((r) => r.t >= t0);
    const js = reqs.filter((r) => r.type === "script");
    const firsts = queries.map((q) => q.first).filter((x) => x !== null);
    const lasts = queries.map((q) => q.last).filter((x) => x !== null);
    const srv = reqs.filter((r) => !r.url.startsWith("/_next/static") && r.type !== "image" && r.type !== "font");
    return {
      queries,
      q: queries.length,
      firstAdd: queries.length ? Math.min(...queries.map((q) => q.add)) : null,
      firstData: firsts.length ? Math.min(...firsts) : null,
      lastData: firsts.length ? Math.max(...firsts) : null,
      lastUpd: lasts.length ? Math.max(...lasts) : null,
      auth: this.auths.filter((t) => t >= t0).length,
      authTimes: this.auths.filter((t) => t >= t0).map(rel),
      auth2: rel(this.auths.filter((t) => t >= t0)[1]),
      authPost: this.authPosts.filter((t) => t >= t0).length,
      authPostTimes: this.authPosts.filter((t) => t >= t0).map(rel),
      srv: srv.length,
      srvUrls: srv.map((r) => `${r.type} ${r.url.slice(0, 100)}`),
      jsFiles: js.length,
      jsKB: kb(js.reduce((a, r) => a + r.size, 0)),
    };
  }
}

async function cpuDelta(rec, m0) {
  const m1 = await rec.metrics();
  const d = (k) => Math.round(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000);
  return { taskMs: d("TaskDuration"), scriptMs: d("ScriptDuration"), layoutMs: d("LayoutDuration"), nodes: m1.Nodes };
}

/** One client-side navigation step: click, wait for the URL, then for the step's queries to settle. */
async function step(page, rec, name, click) {
  await page.waitForTimeout(800);
  const m0 = await rec.metrics();
  const before = page.url();
  const t0 = now();
  await click();
  await page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => {});
  const url = Math.round(now() - t0);
  const last = await rec.quiesce(page, t0);
  return { name, url, ...rec.since(t0), quiet: Math.round(last - t0), ...(await cpuDelta(rec, m0)) };
}

/** A full page load in a new context (cold HTTP cache): timeline of HTML, DCL, WebSocket, auth and query data. */
async function hardLoad(browser, state, name, path) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
  const page = await context.newPage();
  const rec = new Recorder();
  await rec.attach(context, page);
  let html = null;
  page.on("requestfinished", (r) => {
    if (r.resourceType() === "document" && html === null) html = now();
  });
  const m0 = await rec.metrics();
  const t0 = now();
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  const dcl = Math.round(now() - t0);
  const last = await rec.quiesce(page, t0, { quiet: 1000 });
  const r = {
    name,
    html: html === null ? null : Math.round(html - t0),
    dcl,
    wsOpen: rec.wsOpen === null ? null : Math.round(rec.wsOpen - t0),
    ...rec.since(t0),
    quiet: Math.round(last - t0),
    ...(await cpuDelta(rec, m0)),
  };
  await context.close();
  return r;
}

async function run(browser, state, campaignId, index) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
  const page = await context.newPage();
  const rec = new Recorder();
  await rec.attach(context, page);
  const steps = [];

  // Title menu, cold (empty HTTP cache in this context).
  {
    const m0 = await rec.metrics();
    const t0 = now();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const dcl = Math.round(now() - t0);
    await page.getByText(/saved campaign/).waitFor({ timeout: 30000 });
    const menuData = Math.round(now() - t0);
    const last = await rec.quiesce(page, t0);
    steps.push({ name: "title menu (cold load)", url: dcl, menuData, ...rec.since(t0), quiet: Math.round(last - t0), ...(await cpuDelta(rec, m0)) });
  }

  steps.push(await step(page, rec, "title -> Load Campaign", () => page.getByRole("link", { name: /Load Campaign/ }).click()));
  const resume = page.getByRole("link", { name: "Resume Campaign" });
  if (!(await resume.isVisible())) await page.getByRole("button", { name: /Perf 3/ }).first().click();
  await resume.waitFor();
  if (!(await resume.getAttribute("href")).includes(campaignId)) throw new Error("Load Campaign did not expand the bench campaign.");
  steps.push(await step(page, rec, "Load -> Dashboard", () => resume.click()));

  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  const tabs = (await nav.getByRole("link").allTextContents()).map((t) => t.trim()).filter((t) => t !== "Dashboard");
  for (const pass of ["first", "revisit"]) {
    for (const tab of [...tabs, "Dashboard"]) {
      steps.push(await step(page, rec, `${pass}: ${tab}`, () => nav.getByRole("link", { name: tab, exact: true }).click()));
    }
  }
  await context.close();

  steps.push(await hardLoad(browser, state, "hard load: Dashboard", `/campaigns/${campaignId}`));
  console.error(`run ${index + 1}/${RUNS} done`);
  return steps;
}

const COLUMNS = [
  ["url", "url"],
  ["firstAdd", "firstAdd"],
  ["lastData", "lastData"],
  ["lastUpd", "lastUpd"],
  ["quiet", "quiet"],
  ["q", "q"],
  ["auth", "auth"],
  ["authPost", "authPOST"],
  ["srv", "srv"],
  ["jsFiles", "jsN"],
  ["jsKB", "jsKB"],
  ["taskMs", "taskMs"],
  ["scriptMs", "scriptMs"],
];

function summarize(runs) {
  return runs[0].map((s, i) => {
    const row = { name: s.name };
    for (const [key] of COLUMNS) row[key] = median(runs.map((r) => r[i]?.[key]));
    for (const key of ["html", "dcl", "wsOpen", "menuData", "auth2"]) if (key in s) row[key] = median(runs.map((r) => r[i]?.[key]));
    return row;
  });
}

function printTable(rows) {
  const head = ["step".padEnd(34), ...COLUMNS.map(([, h]) => h.padStart(8))].join(" ");
  console.log(head);
  for (const row of rows) {
    console.log([row.name.padEnd(34), ...COLUMNS.map(([k]) => String(row[k] ?? "-").padStart(8))].join(" "));
  }
  const hard = rows.find((r) => r.name.startsWith("hard load"));
  if (hard) console.log(`hard load timeline (median): html=${hard.html} dcl=${hard.dcl} wsOpen=${hard.wsOpen} firstAdd=${hard.firstAdd} lastData=${hard.lastData} lastUpd=${hard.lastUpd} auth=${hard.auth} auth2=${hard.auth2} quiet=${hard.quiet}`);
  const title = rows[0];
  if (title.menuData !== undefined) console.log(`title menu (median): dcl=${title.url} menuData=${title.menuData}`);
}

const env0 = environment();
console.log(`# measure.mjs profile=${PROFILE} runs=${RUNS} commit=${env0.commit} base=${BASE} cores=${env0.cores} loadavg(start)=${env0.loadavg.join(" ")}`);
const browser = await chromium.launch();
const { state, token } = await signIn(browser);
const campaignId = await ensureBench(token);

// Warm the server: load every route module once, so the first measured run does not pay Next's lazy route loading.
{
  const warm = await browser.newContext({ storageState: state });
  const sections = ["", "/party", "/world", "/codex", "/sessions", "/combat-map", "/adversaries", "/notes", "/lorekeeper"];
  for (const url of [`${BASE}/`, `${BASE}/campaigns`, ...sections.map((s) => `${BASE}/campaigns/${campaignId}${s}`)]) {
    await warm.request.get(url).catch(() => {});
  }
  await warm.close();
}

const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await run(browser, state, campaignId, i));
await browser.close();

const rows = summarize(runs);
const env1 = environment();
printTable(rows);
console.log(`loadavg(end)=${env1.loadavg.join(" ")}`);

// Queries per page, from the first run's first visits (and the hard load).
console.log("\n# Convex queries subscribed per step (run 1)");
for (const s of runs[0]) {
  if (s.name.startsWith("revisit")) continue;
  const names = s.queries.map((q) => q.udf.replace(/\.js:|:/, "."));
  console.log(`${s.name}: ${s.q} ${opts.verbose ? JSON.stringify(s.queries) : names.join(", ")}`);
}
if (opts.verbose) {
  const hard = runs.map((r) => r.at(-1));
  console.log("\n# hard load auth timeline per run", JSON.stringify(hard.map((h) => ({ auth: h.authTimes, authPost: h.authPostTimes, lastData: h.lastData }))));
}

mkdirSync(opts.out, { recursive: true });
const file = `${opts.out}/measure-${PROFILE}.json`;
writeFileSync(file, JSON.stringify({ profile: PROFILE, runs: RUNS, env: { start: env0, end: env1 }, medians: rows, raw: runs }, null, 1));
console.log(`\nwrote ${file}`);
