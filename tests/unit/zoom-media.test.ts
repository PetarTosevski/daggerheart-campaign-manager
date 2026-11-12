/**
 * Breakpoints follow the root zoom on mouse screens and stay as written on touch (dcm-jkxa; src/lib/zoom-media.mjs).
 * The transform itself, the PostCSS wiring, every stylesheet in src run through Tailwind and the plugin (no width /
 * height query left unscaled, Tailwind's breakpoints included), and the matchMedia reads.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DESKTOP_ZOOM, TOUCH_QUERY, isZoomAware, scaleMediaParams, screenQuery } from "@/lib/zoom-media.mjs";

import zoomMedia from "../../postcss-zoom-media.mjs";
import postcssConfig from "../../postcss.config.mjs";

/** The slice of PostCSS this test uses (PostCSS isn't a direct dependency of the app; Tailwind's plugin brings it). */
type MediaRule = { params: string };
type Plugin = unknown;
type Postcss = (plugins: Plugin[]) => {
  process: (css: string, opts: { from: string }) => Promise<{ root: { walkAtRules: (name: string, fn: (rule: MediaRule) => void) => void } }>;
};

describe("scaleMediaParams", () => {
  it("splits a width query into touch (as written) and the rest (x 0.8)", () => {
    expect(DESKTOP_ZOOM).toBe(0.8);
    expect(TOUCH_QUERY).toBe("(pointer: coarse)");
    expect(scaleMediaParams("(max-width: 760px)")).toBe("(pointer: coarse) and (max-width: 760px), (not (pointer: coarse)) and (max-width: 608px)");
    expect(scaleMediaParams("(min-width: 761px) and (max-width: 1180px)")).toBe(
      "(pointer: coarse) and (min-width: 761px) and (max-width: 1180px), (not (pointer: coarse)) and (min-width: 608.8px) and (max-width: 944px)",
    );
    expect(scaleMediaParams("(max-width:640px)")).toBe("(pointer: coarse) and (max-width:640px), (not (pointer: coarse)) and (max-width:512px)");
  });

  it("scales Tailwind's range syntax (as min- / max- px, which Next's minifier keeps) and keeps a media type in front", () => {
    expect(scaleMediaParams("(width >= 40rem)")).toBe("(pointer: coarse) and (min-width: 640px), (not (pointer: coarse)) and (min-width: 512px)");
    expect(scaleMediaParams("(width < 40rem)")).toBe("(pointer: coarse) and (max-width: 639.98px), (not (pointer: coarse)) and (max-width: 511.984px)");
    expect(scaleMediaParams("(40rem <= width < 48rem)")).toBe(
      "(pointer: coarse) and (min-width: 640px) and (max-width: 767.98px), (not (pointer: coarse)) and (min-width: 512px) and (max-width: 614.384px)",
    );
    expect(scaleMediaParams("screen and (max-width: 600px)")).toBe("screen and (pointer: coarse) and (max-width: 600px), screen and (not (pointer: coarse)) and (max-width: 480px)");
    expect(scaleMediaParams("(max-width: 1599.98px)")).toContain("(max-width: 1279.984px)");
    // Tailwind's max-* variants.
    expect(scaleMediaParams("not all and (min-width: 40rem)")).toBe(
      "(pointer: coarse) and (not (min-width: 40rem)), (not (pointer: coarse)) and (not (min-width: 32rem))",
    );
  });

  it("keeps queries without a size, and is idempotent", () => {
    expect(scaleMediaParams("(prefers-reduced-motion: reduce)")).toBe("(prefers-reduced-motion: reduce)");
    expect(scaleMediaParams("(max-width: 1100px), (pointer: coarse)")).toBe(
      "(pointer: coarse) and (max-width: 1100px), (not (pointer: coarse)) and (max-width: 880px), (pointer: coarse)",
    );
    const once = scaleMediaParams("(max-width: 720px) and (hover: hover)");
    expect(scaleMediaParams(once)).toBe(once);
    expect(isZoomAware(once)).toBe(true);
    expect(isZoomAware("(max-width: 720px)")).toBe(false);
    expect(isZoomAware("(min-aspect-ratio: 1/1), (hover: none)")).toBe(true);
  });

  it("gives matchMedia the same query the stylesheets get", () => {
    expect(screenQuery("(max-width: 980px)")).toBe(scaleMediaParams("(max-width: 980px)"));
  });
});

describe("the PostCSS pipeline", () => {
  it("runs the plugin after Tailwind", () => {
    expect(Object.keys(postcssConfig.plugins)).toEqual(["@tailwindcss/postcss", path.join(process.cwd(), "postcss-zoom-media.mjs")]);
  });

  it("leaves no width / height @media query unscaled in any stylesheet, Tailwind's breakpoints included", async () => {
    // PostCSS as Tailwind's own PostCSS plugin loads it (not a direct dependency of the app).
    const require = createRequire(import.meta.url);
    const tailwindPath = require.resolve("@tailwindcss/postcss");
    const postcss = createRequire(tailwindPath)("postcss") as Postcss;
    const tailwind = require(tailwindPath) as (opts: { base: string }) => Plugin;
    const root = path.join(process.cwd(), "src");
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".css") ? [path.join(dir, e.name)] : []));
    })(root);
    expect(files.length).toBeGreaterThan(30);
    const offenders: string[] = [];
    let sized = 0;
    let tailwindBreakpoints = 0;
    for (const file of files) {
      const plugins: Plugin[] = file.endsWith("globals.css") ? [tailwind({ base: process.cwd() }), zoomMedia()] : [zoomMedia()];
      const result = await postcss(plugins).process(readFileSync(file, "utf8"), { from: file });
      result.root.walkAtRules("media", (rule) => {
        // Unscaled, or range syntax left for Next's minifier (which drops the pointer branch when it lowers it).
        if (scaleMediaParams(rule.params) !== rule.params || !isZoomAware(rule.params) || /\b(width|height)\s*[<>]/.test(rule.params)) {
          offenders.push(`${path.relative(process.cwd(), file)}: @media ${rule.params}`);
        }
        if (file.endsWith("globals.css") && rule.params.includes("(min-width: 512px)")) tailwindBreakpoints += 1;
        if (rule.params.includes("width") || rule.params.includes("height")) sized += 1;
      });
    }
    expect(offenders).toEqual([]);
    // Real coverage: the app's own breakpoints and Tailwind's (sm, md, lg) came through the pipeline.
    expect(sized).toBeGreaterThan(150);
    // Tailwind's sm (40rem) came out as 640 px on touch and 512 px elsewhere.
    expect(tailwindBreakpoints).toBeGreaterThan(0);
  }, 60_000);
});

describe("matchMedia reads", () => {
  it("go through screenQuery whenever they test a width or height", () => {
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    for (const file of walk(path.join(process.cwd(), "src"))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!/^\s*(\*|\/\/)/.test(line) && /matchMedia\(/.test(line) && !/matchMedia\((?:screenQuery\(|DEVICE_QUERY|query\b)/.test(line)) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
