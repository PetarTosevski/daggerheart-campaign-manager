import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

import { colorScheme, colorToken, colors, type ColorName } from "../../src/theme/colors";

const cssPath = path.resolve(__dirname, "../../../../src/app/globals.css");
const colorsPath = path.resolve(__dirname, "../../src/theme/colors.ts");

function parseRootHex(css: string): Map<string, string> {
  const marker = ":root {";
  const start = css.indexOf(marker);
  if (start < 0) throw new Error("globals.css has no :root block");
  const open = start + marker.length - 1;
  let depth = 0;
  let end = -1;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) throw new Error("globals.css :root block does not close");
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const parsed = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const name = match[1];
    const value = match[2];
    if (!name || !value) continue;
    parsed.set(name, value.toLowerCase());
  }
  return parsed;
}

test("phone colors match the hex tokens on :root", () => {
  const parsed = parseRootHex(fs.readFileSync(cssPath, "utf8"));

  expect(parsed.get("--brand")).toBe("#e3b45a");
  expect(parsed.get("--brand-ink")).toBe("#1a1408");
  expect(parsed.get("--parchment")).toBe("#ece6d6");

  const names = Object.keys(colors) as ColorName[];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const token = colorToken[name];
    expect(parsed.get(token)).toBe(colors[name]);
  }

  for (const token of [
    "--ink",
    "--ink-2",
    "--panel",
    "--panel-2",
    "--line",
    "--line-2",
    "--body",
    "--label",
    "--muted-text",
    "--subtle",
    "--faint",
    "--hope",
    "--hope-bg",
    "--fear",
    "--fear-bg",
    "--danger",
    "--danger-line",
    "--danger-bg",
    "--danger-solid",
    "--ok",
    "--ok-line",
    "--ok-bg",
  ]) {
    expect(parsed.has(token)).toBe(true);
    expect(Object.values(colorToken)).toContain(token);
  }
});

test("the palette is dark only", () => {
  const source = fs.readFileSync(colorsPath, "utf8");
  expect(colorScheme).toBe("dark");
  expect(source).not.toMatch(/prefers-color-scheme/);
  expect(source).not.toMatch(/export const light/);
});
