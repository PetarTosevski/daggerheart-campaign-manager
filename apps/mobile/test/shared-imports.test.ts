import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const srcLibRoot = path.join(repoRoot, "src", "lib");
const sourceRoots = [path.join(appRoot, "app"), path.join(appRoot, "src")];
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function listSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...listSources(full));
      continue;
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) files.push(full);
  }
  return files;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

type FoundImport = { specifier: string; typeOnly: boolean };

function importsIn(source: string): FoundImport[] {
  const text = stripComments(source);
  const found: FoundImport[] = [];
  const fromPattern =
    /\b(?:import|export)\s+(type\s+)?(?:[^'"\n]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(fromPattern)) {
    const specifier = match[2];
    if (!specifier) continue;
    const clause = match[0];
    const typeOnly =
      Boolean(match[1]) ||
      (/^import\s+\{/.test(clause) &&
        !/\{[^}]*\b(?!type\b)[A-Za-z_$]/.test(clause.replace(/\btype\s+/g, "")));
    found.push({ specifier, typeOnly });
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (specifier) found.push({ specifier, typeOnly: false });
  }
  for (const match of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (specifier) found.push({ specifier, typeOnly: false });
  }
  return found;
}

function resolveFile(base: string): string | null {
  const candidates = [base, ...extensions.map((ext) => base + ext)];
  for (const ext of extensions) candidates.push(path.join(base, `index${ext}`));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = path.join(repoRoot, "src", specifier.slice(2));
  else return null;
  return resolveFile(base);
}

function isForbidden(specifier: string): boolean {
  if (specifier === "react" || specifier.startsWith("react/")) return true;
  if (specifier === "next" || specifier.startsWith("next/")) return true;
  if (specifier === "convex/react" || specifier.startsWith("convex/react/")) return true;
  if (specifier === "@" || specifier.startsWith("@/")) return true;
  return false;
}

function srcLibReached(): string[] {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const queue = listSources(sourceRoots[0]!).concat(listSources(sourceRoots[1]!));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const insideLib = file.startsWith(srcLibRoot + path.sep);
    if (insideLib) reached.add(file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const found of importsIn(text)) {
      if (found.typeOnly) continue;
      const resolved = resolveSpecifier(file, found.specifier);
      if (!resolved || resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const inApp = resolved.startsWith(appRoot + path.sep);
      const inLib = resolved.startsWith(srcLibRoot + path.sep);
      const inRepo = resolved.startsWith(repoRoot + path.sep);
      if ((inApp || inLib || inRepo) && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...reached].sort();
}

test("src/lib modules this app reaches stay free of react, next, convex/react, and @/", () => {
  const violations: string[] = [];
  for (const file of srcLibReached()) {
    const text = fs.readFileSync(file, "utf8");
    for (const found of importsIn(text)) {
      if (!isForbidden(found.specifier)) continue;
      violations.push(`${path.relative(repoRoot, file)} imports ${found.specifier}`);
    }
  }
  expect(violations).toEqual([]);
});
