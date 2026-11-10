import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportDirs = ["dist-android", "dist-ios"].map((dir) => path.join(appRoot, dir));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function sourceMapPayloads(files) {
  const maps = [];
  for (const file of files) {
    if (file.endsWith(".map")) {
      maps.push(JSON.parse(fs.readFileSync(file, "utf8")));
      continue;
    }
    if (!file.endsWith(".js") && !file.endsWith(".hbc")) continue;
    const text = fs.readFileSync(file, "utf8");
    const marker = "sourceMappingURL=";
    const inline = text.lastIndexOf(marker);
    if (inline === -1) continue;
    const url = text.slice(inline + marker.length).trim();
    if (url.startsWith("data:application/json")) {
      const comma = url.indexOf(",");
      const body = url.slice(comma + 1);
      const json = url.includes(";base64,")
        ? Buffer.from(body, "base64").toString("utf8")
        : decodeURIComponent(body);
      maps.push(JSON.parse(json));
    }
  }
  return maps;
}

function packageRoots(sources, packageName) {
  const needle = `${path.sep}node_modules${path.sep}${packageName}${path.sep}`;
  const roots = new Set();
  for (const source of sources) {
    const normalized = source.split("/").join(path.sep);
    const at = normalized.lastIndexOf(needle);
    if (at === -1) continue;
    const root = normalized.slice(0, at + needle.length - 1);
    let real = root;
    try {
      real = fs.realpathSync(root);
    } catch {
      // The source map names a file Metro served. Keep the path we have.
    }
    roots.add(real);
  }
  return roots;
}

const files = exportDirs.flatMap((dir) => walk(dir));
const maps = sourceMapPayloads(files);
if (maps.length === 0) {
  console.error("check-bundle: no export source map under dist-android or dist-ios");
  process.exit(1);
}

const sources = maps.flatMap((map) => (Array.isArray(map.sources) ? map.sources : []));
const failures = [];

for (const packageName of ["convex", "react"]) {
  const copies = packageRoots(sources, packageName);
  if (copies.size > 1) {
    failures.push(
      `${packageName} has ${copies.size} copies:\n${[...copies].map((copy) => `  ${copy}`).join("\n")}`,
    );
  }
}

const srd = sources.filter((source) => source.includes("src/lib/srd/index"));
if (srd.length > 0) {
  failures.push(`src/lib/srd/index is in the bundle:\n${srd.map((source) => `  ${source}`).join("\n")}`);
}

if (failures.length > 0) {
  console.error(`check-bundle failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(
  `check-bundle: ${maps.length} source map(s), ${sources.length} source(s), one copy of convex and react at most, no src/lib/srd/index`,
);
