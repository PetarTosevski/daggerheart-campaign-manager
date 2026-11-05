import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const srcRoot = path.resolve(__dirname, "../../src");

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSources(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("unbalanced useAnimatedStyle call");
}

function animatedStyleBodies(source: string): string[] {
  const bodies: string[] = [];
  const needle = "useAnimatedStyle";
  let from = 0;
  while (from < source.length) {
    const found = source.indexOf(needle, from);
    if (found < 0) break;
    const after = found + needle.length;
    const paren = source.indexOf("(", after);
    if (paren < 0 || !/^\s*$/.test(source.slice(after, paren))) {
      from = after;
      continue;
    }
    const end = matchingParen(source, paren);
    bodies.push(source.slice(paren + 1, end));
    from = end + 1;
  }
  return bodies;
}

const forbiddenKey =
  /(?:^|[^A-Za-z0-9_])(minWidth|maxWidth|width|minHeight|maxHeight|height|top|left|margin(?:Horizontal|Vertical|Top|Right|Bottom|Left)?|padding(?:Horizontal|Vertical|Top|Right|Bottom|Left)?)\s*:/g;

export function forbiddenAnimatedKeys(source: string): string[] {
  const found: string[] = [];
  for (const body of animatedStyleBodies(stripNoise(source))) {
    for (const match of body.matchAll(forbiddenKey)) {
      const key = match[1];
      if (key) found.push(key);
    }
  }
  return found;
}

test("the checker flags layout keys inside an animated style only", () => {
  expect(forbiddenAnimatedKeys("useAnimatedStyle(() => ({ width: 10, height: 4, top: 0, left: 0, margin: 1, padding: 2 }))")).toEqual([
    "width",
    "height",
    "top",
    "left",
    "margin",
    "padding",
  ]);
  expect(
    forbiddenAnimatedKeys("useAnimatedStyle(() => ({ opacity: 1, transform: [{ translateY: 4 }, { scale: 0.98 }] }))"),
  ).toEqual([]);
  expect(
    forbiddenAnimatedKeys("const box = { width: 10, height: 20, top: 0, left: 0, margin: 4, padding: 8 };"),
  ).toEqual([]);
});

test("phone animated styles change transform and opacity only", () => {
  const files = listSources(srcRoot);
  const animated = files.filter((file) => fs.readFileSync(file, "utf8").includes("useAnimatedStyle"));
  expect(animated.length).toBeGreaterThan(0);
  const violations: string[] = [];
  for (const file of files) {
    const keys = forbiddenAnimatedKeys(fs.readFileSync(file, "utf8"));
    for (const key of keys) violations.push(`${path.relative(srcRoot, file)} animates ${key}`);
  }
  expect(violations).toEqual([]);
});
