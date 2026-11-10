// Convex module-load cost (dcm-uh6r): bundles Convex function entries the way `convex deploy` does (esbuild settings
// from convex/dist/esm/bundler/debugBundle.js, one entry at a time, no chunk splitting so each file holds everything
// that entry loads), prints the size, and optionally times a cold `import()` of each bundle in a fresh node process.
//
//   node scripts/perf/convex-bundles.mjs                         # every convex/*.ts entry, sizes only
//   node scripts/perf/convex-bundles.mjs --hot                   # the hot HUD reads only
//   node scripts/perf/convex-bundles.mjs --hot --runs 9          # plus the median of 9 cold node imports each
//   node scripts/perf/convex-bundles.mjs --hot --runs 9 --baseline node_modules/.cache/convex-bundles-before   # paired A/B
//   node scripts/perf/convex-bundles.mjs --entry combatHud --top 25   # one entry and its 25 largest inputs
//   node scripts/perf/convex-bundles.mjs --entry combatHud --why src/lib/srd/adversaries.ts   # shortest import chain
//
// Writes the bundles to <out>/<entry>.mjs and a summary to <out>/convex-bundles.json (default
// node_modules/.cache/convex-bundles: outside ESLint and git, whose minified output would flood the lint run).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

// esbuild is not a direct dependency; use the copy the Convex CLI bundles with.
const esbuild = createRequire(createRequire(import.meta.url).resolve("convex/package.json"))("esbuild");

const { values: opts } = parseArgs({
  options: {
    hot: { type: "boolean", default: false },
    entry: { type: "string", multiple: true },
    runs: { type: "string", default: "0" },
    top: { type: "string", default: "0" },
    why: { type: "string" },
    baseline: { type: "string" },
    out: { type: "string", default: "node_modules/.cache/convex-bundles" },
  },
});

/** The modules the combat HUD subscribes to on every screen (pass 3's list of 20 hot modules). */
const HOT = [
  "combatHud",
  "combatVision",
  "combatTokensReads",
  "combatRequestsReads",
  "combatCardsReads",
  "combatFeaturesReads",
  "charactersReads",
  "restsReads",
  "combatActionsReads",
  "combatRidersReads",
  "adversaryActionsReads",
  "featurePromptsReads",
  "hitKeywordsReads",
  "cloakPromptsReads",
  "allyPicksReads",
  "combatAreas",
  "combatMaps",
  "combatSpotlight",
  "ruleSettings",
  "feed",
  "deathMoves",
  "combatEffects",
  "combatMapStyle",
  "combatScenes",
];

const all = readdirSync("convex")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !["schema.ts", "auth.config.ts", "convex.config.ts"].includes(f))
  .map((f) => f.slice(0, -3));
const entries = opts.entry ?? (opts.hot ? HOT : all);
mkdirSync(opts.out, { recursive: true });

const serverOnly = {
  name: "server-only",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "server-only-stub" }));
    build.onLoad({ filter: /.*/, namespace: "server-only-stub" }, () => ({ contents: "", loader: "js" }));
  },
};

async function bundle(name) {
  const result = await esbuild.build({
    entryPoints: [`convex/${name}.ts`],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "esnext",
    jsx: "automatic",
    outfile: path.join(opts.out, `${name}.mjs`),
    conditions: ["convex", "module"],
    plugins: [serverOnly],
    write: true,
    treeShaking: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: false,
    keepNames: true,
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
    logLevel: "error",
  });
  const output = Object.values(result.metafile.outputs)[0];
  return { bytes: output.bytes, inputs: output.inputs, graph: result.metafile.inputs };
}

function importMs(file) {
  const script = `const t=performance.now();await import(${JSON.stringify(path.resolve(file))});console.log(performance.now()-t)`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`import ${file} failed: ${r.stderr.slice(0, 500)}`);
  return Number(r.stdout.trim());
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const rows = [];
for (const name of entries) {
  const { bytes, inputs, graph } = await bundle(name);
  rows.push({ name, mb: bytes / 1e6, inputs, graph });
}
const runs = Number(opts.runs);
if (runs > 0) {
  // Interleave the entries so host-load drift spreads evenly over them.
  // With --baseline, each run imports the baseline bundle of the same name right before this one (paired A/B).
  const times = new Map(rows.map((r) => [r.name, []]));
  const before = new Map(rows.map((r) => [r.name, []]));
  for (let i = 0; i < runs; i++)
    for (const r of rows) {
      if (opts.baseline && existsSync(path.join(opts.baseline, `${r.name}.mjs`))) before.get(r.name).push(importMs(path.join(opts.baseline, `${r.name}.mjs`)));
      times.get(r.name).push(importMs(path.join(opts.out, `${r.name}.mjs`)));
    }
  for (const r of rows) {
    r.importMs = median(times.get(r.name));
    if (before.get(r.name).length > 0) r.baselineMs = median(before.get(r.name));
  }
}

const top = Number(opts.top);
for (const r of rows) {
  const ms = r.importMs === undefined ? "" : `  ${r.baselineMs !== undefined ? `${r.baselineMs.toFixed(0).padStart(4)} -> ` : ""}${r.importMs.toFixed(0).padStart(4)} ms`;
  console.log(`${r.name.padEnd(28)} ${r.mb.toFixed(2).padStart(6)} MB${ms}`);
  if (top > 0) {
    const largest = Object.entries(r.inputs)
      .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
      .slice(0, top);
    for (const [file, { bytesInOutput }] of largest) console.log(`    ${(bytesInOutput / 1e3).toFixed(0).padStart(6)} KB  ${file}`);
  }
}
/** Shortest import chain from the entry to `target` (breadth first over esbuild's input graph). */
function why(graph, from, target) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === target) {
      const chain = [];
      for (let f = file; f !== null; f = prev.get(f)) chain.unshift(f);
      return chain;
    }
    for (const { path: next } of graph[file]?.imports ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, file);
      queue.push(next);
    }
  }
  return null;
}
if (opts.why) for (const r of rows) console.log(`${r.name}: ${why(r.graph, `convex/${r.name}.ts`, opts.why)?.join("\n  -> ") ?? "not imported"}`);

const total = rows.reduce((s, r) => s + r.mb, 0);
console.log(`total ${total.toFixed(2)} MB over ${rows.length} entries`);
if (runs > 0) {
  const base = rows.every((r) => r.baselineMs !== undefined) ? `${rows.reduce((s, r) => s + r.baselineMs, 0).toFixed(0)} -> ` : "";
  console.log(`sum of import medians ${base}${rows.reduce((s, r) => s + r.importMs, 0).toFixed(0)} ms`);
}
writeFileSync(
  path.join(opts.out, "convex-bundles.json"),
  JSON.stringify(rows.map(({ name, mb, importMs, baselineMs }) => ({ name, mb, importMs, baselineMs })), null, 2),
);
