/**
 * Reduce motion and text size applied app-wide (plan config U6b, Q12 a / Q13 a; docs/tasks/TASK-CONFIG-U6b.md).
 * PrefsSync writes data-reduce-motion / data-text-size on <html> from preferences.get (Convex mocked), the display
 * cache and its inline script, useReducedMotion() = device OR account, and globals.css's zoom (the base 0.8 on every
 * page, dcm-1i3z, times Text size) and calm rules.
 */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderToStaticMarkup } from "react-dom/server";

import GmLayout from "@/app/(gm)/layout";
import { PrefsSync } from "@/app/(gm)/prefs-sync";
import { TEXT_SIZE_ZOOM } from "@/lib/config/preferences";
import {
  DISPLAY_PREFS_CACHE_KEY,
  REDUCE_MOTION_ATTR,
  TEXT_SIZE_ATTR,
  prefersReducedMotion,
  readCachedDisplayPrefs,
  useReducedMotion,
} from "@/lib/use-reduced-motion";
import { DESKTOP_ZOOM, TOUCH_QUERY } from "@/lib/zoom-media.mjs";

type Prefs = { reduceMotion: boolean; textSize: "small" | "medium" | "large" } | undefined;
const mock: { auth: { isLoading: boolean; isAuthenticated: boolean }; prefs: Prefs; lastArgs: unknown } = {
  auth: { isLoading: false, isAuthenticated: true },
  prefs: undefined,
  lastArgs: undefined,
};

vi.mock("convex/react", () => ({
  useConvexAuth: () => mock.auth,
  useQuery: (_ref: unknown, args: unknown) => {
    mock.lastArgs = args;
    return args === "skip" ? undefined : mock.prefs;
  },
}));

const html = () => document.documentElement;

/** The (gm) layout's inline display-cache script, as the server renders it. */
function layoutScript(): string {
  const markup = renderToStaticMarkup(<GmLayout>page</GmLayout>);
  const match = /<span hidden="">\s*<script>([\s\S]*?)<\/script>\s*<\/span>/.exec(markup);
  expect(match, "the layout renders the script in a hidden span, before the page").toBeTruthy();
  expect(markup.indexOf("<script>")).toBeLessThan(markup.indexOf("page"));
  return match![1]!;
}

/** A matchMedia stub whose reduced-motion answer can be flipped (with a change event). */
function stubDevice(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-reduced-motion: reduce)" && matches;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return (next: boolean) => {
    matches = next;
    listeners.forEach((fn) => fn());
  };
}

beforeEach(() => {
  mock.auth = { isLoading: false, isAuthenticated: true };
  mock.prefs = undefined;
  mock.lastArgs = undefined;
  localStorage.clear();
  html().removeAttribute("data-reduce-motion");
  html().removeAttribute("data-text-size");
  stubDevice(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PrefsSync", () => {
  it("sets the account's text size and reduce motion on <html> and caches them", () => {
    mock.prefs = { reduceMotion: true, textSize: "large" };
    render(<PrefsSync />);
    expect(html().getAttribute("data-text-size")).toBe("large");
    expect(html().hasAttribute("data-reduce-motion")).toBe(true);
    expect(JSON.parse(localStorage.getItem(DISPLAY_PREFS_CACHE_KEY)!)).toEqual({ r: true, t: "large" });
  });

  it("follows a change from another device (the live query) and turns reduce motion back off", () => {
    mock.prefs = { reduceMotion: true, textSize: "small" };
    const { rerender } = render(<PrefsSync />);
    expect(html().getAttribute("data-text-size")).toBe("small");
    mock.prefs = { reduceMotion: false, textSize: "medium" };
    rerender(<PrefsSync />);
    expect(html().getAttribute("data-text-size")).toBe("medium");
    expect(html().hasAttribute("data-reduce-motion")).toBe(false);
  });

  it("keeps the cached values while the query loads (no flash), then applies the account", () => {
    localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({ r: true, t: "large" }));
    const { rerender } = render(<PrefsSync />);
    expect(html().getAttribute("data-text-size")).toBe("large");
    expect(html().hasAttribute("data-reduce-motion")).toBe(true);
    mock.prefs = { reduceMotion: false, textSize: "small" };
    rerender(<PrefsSync />);
    expect(html().getAttribute("data-text-size")).toBe("small");
    expect(html().hasAttribute("data-reduce-motion")).toBe(false);
  });

  it("skips the query while signed out, removes both attributes and forgets the cache", () => {
    mock.auth = { isLoading: false, isAuthenticated: false };
    localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({ r: true, t: "large" }));
    html().setAttribute("data-text-size", "large");
    html().setAttribute("data-reduce-motion", "");
    render(<PrefsSync />);
    expect(mock.lastArgs).toBe("skip");
    expect(html().hasAttribute("data-text-size")).toBe(false);
    expect(html().hasAttribute("data-reduce-motion")).toBe(false);
    expect(localStorage.getItem(DISPLAY_PREFS_CACHE_KEY)).toBeNull();
  });

  it("removes both attributes when the app shell unmounts", () => {
    mock.prefs = { reduceMotion: true, textSize: "large" };
    const { unmount } = render(<PrefsSync />);
    unmount();
    expect(html().hasAttribute("data-text-size")).toBe(false);
    expect(html().hasAttribute("data-reduce-motion")).toBe(false);
  });
});

describe("display cache", () => {
  it("ignores a missing, broken or wrongly shaped cache", () => {
    expect(readCachedDisplayPrefs(localStorage)).toBeNull();
    localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, "{oops");
    expect(readCachedDisplayPrefs(localStorage)).toBeNull();
    localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({ r: "yes", t: "huge" }));
    expect(readCachedDisplayPrefs(localStorage)).toBeNull();
    expect(readCachedDisplayPrefs(undefined)).toBeNull();
  });

  it("the layout's inline script applies the cache before React runs, and ignores a bad one", () => {
    const script = layoutScript();
    // Same key and attributes as the hook module (the layout can't import it: it is a Server Component).
    expect(script).toContain(JSON.stringify(DISPLAY_PREFS_CACHE_KEY));
    expect(script).toContain(JSON.stringify(REDUCE_MOTION_ATTR));
    expect(script).toContain(JSON.stringify(TEXT_SIZE_ATTR));
    localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({ r: true, t: "small" }));
    new Function(script)();
    expect(html().getAttribute("data-text-size")).toBe("small");
    expect(html().hasAttribute("data-reduce-motion")).toBe(true);

    html().removeAttribute("data-text-size");
    html().removeAttribute("data-reduce-motion");
    localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({ r: true, t: "huge" }));
    new Function(script)();
    expect(html().hasAttribute("data-text-size")).toBe(false);
    expect(html().hasAttribute("data-reduce-motion")).toBe(false);
  });
});

describe("useReducedMotion (Q13 a: device OR account)", () => {
  it("is off when neither asks, on when the account asks, on when the device asks, and follows both live", async () => {
    const setDevice = stubDevice(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    // The account's switch (PrefsSync's attribute); the MutationObserver re-renders.
    await act(async () => {
      html().setAttribute("data-reduce-motion", "");
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
    expect(prefersReducedMotion()).toBe(true);

    // Account off, device on: still calm (the app never forces motion on a device that asks for less).
    await act(async () => {
      html().removeAttribute("data-reduce-motion");
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
    act(() => setDevice(true));
    expect(result.current).toBe(true);
    expect(prefersReducedMotion()).toBe(true);

    act(() => setDevice(false));
    expect(result.current).toBe(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("globals.css", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

  it("zooms mouse screens by the base 0.8 and touch screens by 1, and Text size multiplies it (dcm-1i3z, dcm-jkxa, Q12 a)", () => {
    expect(TEXT_SIZE_ZOOM).toEqual({ desktop: { small: 0.72, medium: 0.8, large: 0.92 }, touch: { small: 0.9, medium: 1, large: 1.15 } });
    // One base for the stylesheet zoom and the breakpoint rewrite (src/lib/zoom-media.mjs).
    expect(TEXT_SIZE_ZOOM.desktop.medium).toBe(DESKTOP_ZOOM);
    const touchAt = css.indexOf(`@media ${TOUCH_QUERY} {`);
    expect(touchAt).toBeGreaterThan(0);
    const blocks = { desktop: css.slice(0, touchAt), touch: css.slice(touchAt, css.indexOf("\n}\n", touchAt)) };
    for (const input of ["desktop", "touch"] as const) {
      const zoom = TEXT_SIZE_ZOOM[input];
      // The base needs no attribute and no script: signed out, /signin and the first paint are at it too.
      expect(blocks[input]).toMatch(new RegExp(String.raw`\n\s*html\s*\{\s*zoom:\s*${zoom.medium};\s*--text-zoom:\s*${zoom.medium};`));
      for (const size of ["small", "large"] as const) {
        expect(blocks[input]).toMatch(new RegExp(String.raw`html\[data-text-size="${size}"\]\s*\{\s*zoom:\s*${zoom[size]};\s*--text-zoom:\s*${zoom[size]};`));
      }
    }
    expect(css).not.toMatch(/data-text-size="medium"/);
    // Small and Large replace the base rather than stack on it: no other zoom in the stylesheet.
    expect(css.match(/^\s*zoom:/gm)).toHaveLength(6);
  });

  it("divides every viewport unit by the zoom, always (not only under data-text-size)", () => {
    for (const unit of ["vw", "vh", "dvh", "svh"]) {
      expect(css).toMatch(new RegExp(String.raw`--${unit}:\s*calc\(1${unit} / var\(--text-zoom\)\);`));
    }
    expect(css).not.toMatch(/html\[data-text-size\] \./);
  });

  it("calms every animation and transition under data-reduce-motion, keeping spinners and the hit flash's fade", () => {
    const block = css.slice(css.indexOf("html[data-reduce-motion] *:not("));
    expect(block).toMatch(/^html\[data-reduce-motion\] \*:not\(\.animate-spin, \.cm-spin, \.cmx-flash\)/);
    expect(block).toMatch(/animation: none !important;\s*transition: none !important;/);
    expect(css).toMatch(/html\[data-reduce-motion\] \.cmx-flash \{\s*animation: cmx-fade 1\.8s linear forwards !important;/);
    expect(css).toMatch(/html\[data-reduce-motion\] \.hud-root \{\s*--hud-t-sheet: 0ms;/);
  });
});
