/**
 * The website renders inside a zoomed <html> (dcm-1i3z: base 0.8, Text size 0.72 / 0.92; globals.css). CSS zoom scales
 * viewport units too, so a raw 100dvh paints 80% of the screen. The app writes them through globals.css's per-unit
 * variables instead (`calc(100 * var(--dvh))`, `min-h-page`), which divide by the zoom. This guard keeps new raw
 * units out of the website's sources (the phone app, apps/mobile, has no zoom and isn't scanned).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return /\.(css|tsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** Drops comments, and `sizes="…"` (next/image's hint to the browser, which means the real viewport). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\bsizes="[^"]*"/g, "");
}

const RAW_UNIT = /(?<![\w.#-])\d+(?:\.\d+)?(?:dvh|svh|lvh|vh|vw)\b/;
const SCREEN_CLASS = /(?<![\w-])(?:min-|max-)?[hw]-(?:screen|dvh|svh|lvh)\b/;

describe("viewport units under the root zoom", () => {
  const sources = files(SRC);

  it("scans the website's styles and components", () => {
    expect(sources.some((f) => f.endsWith("globals.css"))).toBe(true);
    expect(sources.length).toBeGreaterThan(100);
  });

  it("writes no raw vw / vh / dvh / svh outside globals.css's zoom-corrected variables", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const lines = code(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        // globals.css defines the variables from the raw units: `--vw: calc(1vw / var(--text-zoom));`.
        if (file.endsWith("globals.css") && /^\s*--(?:vw|vh|dvh|svh):\s*calc\(1(?:vw|vh|dvh|svh) \/ var\(--text-zoom\)\);/.test(line)) return;
        if (RAW_UNIT.test(line) || SCREEN_CLASS.test(line)) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
