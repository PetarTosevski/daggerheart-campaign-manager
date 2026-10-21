// Client JS per route (PF0, docs/performance.md), from Turbopack's bundle analyzer:
//
//   node scripts/perf/bundle.mjs                    # analyze (about 1-3 min), then print every route
//   node scripts/perf/bundle.mjs --skip-analyze     # reuse the last analysis
//   node scripts/perf/bundle.mjs --route "/campaigns/[campaignId]"         # one route, its 30 largest modules
//   node scripts/perf/bundle.mjs --why src/lib/frames/tomes.ts --entry campaign-shell.tsx  # shortest import chain
//
// Runs `next experimental-analyze -o` into .next-e2e-analyze (git-ignored; Next would otherwise add its type globs to
// tsconfig.json, which this script undoes), streams `next experimental-analyze export` to
// .next-e2e-analyze/graph.jsonl and sums, per route, the initial client JS chunks (raw and gzip; fonts and media
// excluded), the async (lazy) chunks and CSS, with the largest modules on the initial chunks. Writes the summary to
// <out>/bundle.json (default test-results/perf).
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";

import { environment } from "./lib.mjs";

const { values: opts } = parseArgs({
  options: {
    "skip-analyze": { type: "boolean", default: false },
    route: { type: "string" },
    why: { type: "string" },
    entry: { type: "string" },
    out: { type: "string", default: "test-results/perf" },
  },
});
const DIST = ".next-e2e-analyze";
const GRAPH = `${DIST}/graph.jsonl`;
/** Modules whose presence on a route's initial JS the perf tracers track (CL8 / CL9). */
const WATCH = [
  "src/lib/frames/tomes.ts",
  "src/lib/srd/domain-cards.ts",
  "src/lib/srd/equipment-tiers.ts",
  "src/lib/srd/adversaries.ts",
  "src/lib/srd/environments.ts",
  "pkg:zod",
  "pkg:three",
  "pkg:cannon-es",
];

function analyze() {
  const tsconfig = readFileSync("tsconfig.json", "utf8");
  const started = Date.now();
  const result = spawnSync("pnpm", ["exec", "next", "experimental-analyze", "-o"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_DIST_DIR: DIST },
  });
  if (readFileSync("tsconfig.json", "utf8") !== tsconfig) writeFileSync("tsconfig.json", tsconfig);
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.error(`analyze took ${Math.round((Date.now() - started) / 1000)} s`);
}

async function exportGraph() {
  const child = spawn("pnpm", ["exec", "next", "experimental-analyze", "export", "--dist-dir", DIST], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((resolve) => child.on("close", resolve));
  await pipeline(child.stdout, createWriteStream(GRAPH));
  const code = await exited;
  if (code !== 0) throw new Error(`next experimental-analyze export exited ${code}`);
}

async function readGraph({ modules }) {
  const parts = [];
  const asyncOut = new Map();
  const mods = new Map();
  const lines = createInterface({ input: createReadStream(GRAPH), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.type === "part") parts.push(o);
    else if (o.type === "group" && o.kind === "async") {
      if (!asyncOut.has(o.route)) asyncOut.set(o.route, new Set());
      for (const f of o.outputs) asyncOut.get(o.route).add(f);
    } else if (modules && o.type === "module" && o.ident.includes("[app-client]")) mods.set(o.ident, o);
  }
  return { parts, asyncOut, mods };
}

/** `src/...` for project files, `pkg:<name>` for packages. */
function norm(path) {
  const p = path.replace("[project]/", "");
  const m = p.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((@[^/]+\/)?[^/]+)/);
  return m ? `pkg:${m[1]}` : p;
}

/** Groups small files by directory so the top list stays readable; SRD data files stay separate. */
function bucket(path) {
  const n = norm(path);
  if (n.startsWith("pkg:") || n.startsWith("src/lib/srd/") || n === "src/lib/frames/tomes.ts") return n;
  const s = n.split("/");
  if (n.startsWith("src/lib/") || n.startsWith("src/components/")) return s.slice(0, 3).join("/");
  if (n.startsWith("src/app/")) return s.slice(0, 5).join("/");
  return s.slice(0, 2).join("/");
}

const KB = (b) => (b / 1024).toFixed(0);

function summarize({ parts, asyncOut }) {
  const routes = [...new Set(parts.map((p) => p.route))].sort();
  const out = {};
  for (const route of routes) {
    const mine = parts.filter((p) => p.route === route && p.filename.includes("/static/"));
    const js = mine.filter((p) => p.filename.endsWith(".js"));
    const css = mine.filter((p) => p.filename.endsWith(".css"));
    const lazy = asyncOut.get(route) ?? new Set();
    const initial = js.filter((p) => !lazy.has(p.filename));
    const asyncParts = js.filter((p) => lazy.has(p.filename));
    const sum = (a, k = "size") => a.reduce((s, p) => s + (p[k] || 0), 0);
    const by = (list, key) => {
      const b = {};
      for (const p of list) {
        const k = key(p.source_path);
        b[k] ??= [0, 0];
        b[k][0] += p.size;
        b[k][1] += p.compressed_size || 0;
      }
      return Object.entries(b).sort((a, c) => c[1][0] - a[1][0]);
    };
    const modules = by(initial, norm);
    out[route] = {
      initialRaw: sum(initial),
      initialGzip: sum(initial, "compressed_size"),
      asyncRaw: sum(asyncParts),
      cssRaw: sum(css),
      top: by(initial, bucket).slice(0, 14),
      modules: modules.slice(0, 30),
      watched: WATCH.filter((w) => modules.some(([m]) => m === w || m.startsWith(`${w}/`))),
    };
  }
  return out;
}

function why(mods, target, entry) {
  const short = (s) => s.replace("[project]/", "").replace(/ \[app-client\].*/, "").replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "");
  const starts = [...mods.keys()].filter((k) => k.includes(entry));
  const seen = new Map(starts.map((s) => [s, null]));
  const queue = [...starts];
  let found = null;
  while (queue.length) {
    const cur = queue.shift();
    if (cur.includes(target) && !starts.includes(cur)) {
      found = cur;
      break;
    }
    for (const d of mods.get(cur)?.dependencies?.sync ?? []) {
      if (!mods.has(d) || seen.has(d)) continue;
      seen.set(d, cur);
      queue.push(d);
    }
  }
  if (!found) return console.log(`no static import path from "${entry}" (${starts.length} start modules) to "${target}"`);
  const chain = [];
  for (let c = found; c; c = seen.get(c)) chain.unshift(short(c));
  console.log(chain.join("\n  -> "));
}

if (!opts["skip-analyze"] || !existsSync(GRAPH)) {
  if (!opts["skip-analyze"]) analyze();
  await exportGraph();
}
const graph = await readGraph({ modules: Boolean(opts.why) });
if (opts.why) {
  why(graph.mods, opts.why, opts.entry ?? "src/app/");
  process.exit(0);
}

const summary = summarize(graph);
const env = environment();
console.log(`# bundle.mjs commit=${env.commit} (initial = JS chunks loaded with the route; fonts and media excluded)`);
if (opts.route) {
  const r = summary[opts.route];
  if (!r) throw new Error(`No route ${opts.route}; routes: ${Object.keys(summary).join(", ")}`);
  console.log(`\n## ${opts.route}  initial JS ${KB(r.initialRaw)} KB raw / ${KB(r.initialGzip)} KB gzip, async ${KB(r.asyncRaw)} KB, CSS ${KB(r.cssRaw)} KB`);
  for (const [m, [s, g]] of r.modules) console.log(`${KB(s).padStart(7)} KB ${KB(g).padStart(6)} gz  ${m}`);
} else {
  console.log(`\n${"route".padEnd(46)} ${"raw KB".padStart(7)} ${"gzip KB".padStart(7)} ${"async KB".padStart(8)} ${"css KB".padStart(6)}  watched modules on initial JS`);
  for (const [route, r] of Object.entries(summary)) {
    console.log(`${route.padEnd(46)} ${KB(r.initialRaw).padStart(7)} ${KB(r.initialGzip).padStart(7)} ${KB(r.asyncRaw).padStart(8)} ${KB(r.cssRaw).padStart(6)}  ${r.watched.join(", ")}`);
  }
  for (const [route, r] of Object.entries(summary)) {
    if (!route.startsWith("/campaigns") && route !== "/") continue;
    console.log(`\n## ${route}  largest initial-JS groups`);
    for (const [m, [s, g]] of r.top) console.log(`${KB(s).padStart(7)} KB ${KB(g).padStart(6)} gz  ${m}`);
  }
}
mkdirSync(opts.out, { recursive: true });
writeFileSync(`${opts.out}/bundle.json`, JSON.stringify({ env, routes: summary }, null, 1));
console.log(`\nwrote ${opts.out}/bundle.json`);
