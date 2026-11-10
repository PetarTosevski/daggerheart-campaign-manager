import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

import { SkiaCanvasContext, SkiaGradient, SkiaMapCanvas } from "../../../src/features/combat-map/canvas/context";

const repoRoot = path.resolve(__dirname, "../../../../..");
const painterRoot = path.join(repoRoot, "src", "lib", "combat-map");
const contextSource = fs.readFileSync(
  path.resolve(__dirname, "../../../src/features/combat-map/canvas/context.ts"),
  "utf8",
);

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function listPainters(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listPainters(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function calls(source: string, pattern: RegExp): string[] {
  return [...strip(source).matchAll(pattern)].map((match) => match[1] ?? "");
}

function prototypeMethods(value: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(value.prototype).filter((name) => {
    if (name === "constructor") return false;
    return typeof (value.prototype as Record<string, unknown>)[name] === "function";
  });
}

function declaredFields(source: string): Set<string> {
  const start = source.indexOf("export class SkiaCanvasContext");
  const body = source.slice(start);
  const fields = new Set<string>();
  for (const match of body.matchAll(/^[ ]{2}([A-Za-z_][A-Za-z0-9_]*)(?:\??\s*:\s*[^=;\n]+)?\s*=/gm)) {
    const name = match[1];
    if (name) fields.add(name);
  }
  return fields;
}

test("fails when a painter calls a canvas method the adapter does not implement", () => {
  const implemented = new Set([
    ...prototypeMethods(SkiaCanvasContext),
    ...prototypeMethods(SkiaMapCanvas),
    ...prototypeMethods(SkiaGradient),
  ]);
  const methods = new Set<string>();
  const properties = new Set<string>();
  for (const file of listPainters(painterRoot)) {
    const text = fs.readFileSync(file, "utf8");
    for (const name of calls(text, /\b(?:ctx|classicCtx)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) methods.add(name);
    for (const name of calls(text, /\b(?:ctx|classicCtx)\.([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g)) properties.add(name);
    for (const name of calls(text, /\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (name === "getContext" || name === "addColorStop") methods.add(name);
    }
  }

  const missingMethods = [...methods].filter((name) => name && !implemented.has(name)).sort();
  const fields = declaredFields(contextSource);
  const missingProperties = [...properties].filter((name) => name && !fields.has(name)).sort();

  expect(methods.size).toBeGreaterThan(10);
  expect(missingMethods).toEqual([]);
  expect(missingProperties).toEqual([]);
});
