// Accessibility and tablet helpers for the D12 pass (.omc/plans/d12-hardening.yaml, H1; used by H20-H22).
// The bar (user, 2026-10-21): zero serious or critical axe findings under WCAG 2.2 AA rules; tablets at 768x1024
// and 1024x768 with no sideways page scroll; primary controls at least 44x44 px (the boards' min-height: 44px).
// Usage and examples: docs/tasks/TASK-D12-H1.md.

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

/** The axe rule tags every check runs with: WCAG 2.0, 2.1 and 2.2, levels A and AA. */
export const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/** The two tablet sizes every route is checked at: upright and sideways. */
export const TABLET_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
] as const;

/** The boards' touch-target size in CSS pixels. */
export const TOUCH_TARGET_PX = 44;

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
export type AxeViolation = AxeResults["violations"][number];

export type A11yOptions = {
  /** CSS selector(s) to limit the scan to; default the whole page. */
  include?: string | string[];
  /** CSS selector(s) to leave out. Needs `reason`. */
  exclude?: string | string[];
  /** Why `exclude` is there (for example "WebGL dice canvas: no DOM to check"). Required with `exclude`. */
  reason?: string;
};

const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function describe(violations: AxeViolation[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.slice(0, 5).map((n) => `    ${n.target.join(" ")}`);
      const more = v.nodes.length > 5 ? [`    ... and ${v.nodes.length - 5} more`] : [];
      return [`  [${v.impact}] ${v.id}: ${v.help} (${v.helpUrl})`, ...nodes, ...more].join("\n");
    })
    .join("\n");
}

/**
 * Runs axe on the page (or `include`) with `A11Y_TAGS` and fails on any serious or critical violation, listing each
 * rule with up to five offending selectors. `exclude` without a non-empty `reason` throws before scanning.
 * Returns the remaining moderate and minor violations so the caller can list them in its task doc.
 */
export async function expectNoSeriousA11yViolations(page: Page, options: A11yOptions = {}): Promise<AxeViolation[]> {
  const exclude = list(options.exclude);
  if (exclude.length > 0 && !options.reason?.trim()) {
    throw new Error(`expectNoSeriousA11yViolations: exclude (${exclude.join(", ")}) needs a written reason.`);
  }
  let builder = new AxeBuilder({ page }).withTags([...A11Y_TAGS]);
  for (const selector of list(options.include)) builder = builder.include(selector);
  for (const selector of exclude) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  // Compare one-line summaries, not the raw results: a failure then reads as a short list of rules and selectors.
  expect(serious.map((v) => `[${v.impact}] ${v.id}`), `serious or critical axe violations on ${page.url()}:\n${describe(serious)}`).toEqual([]);
  return violations.filter((v) => !serious.includes(v));
}

/** One line per violation (`[impact] rule-id: help (n nodes)`), for logging the moderate and minor ones. */
export function summarizeViolations(violations: AxeViolation[]): string[] {
  return violations.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
}

/**
 * The page does not scroll sideways at the current viewport: the document is no wider than its visible width.
 * Polls (layout settles after fonts and live data); on failure names up to five elements that stick out.
 */
export async function expectFitsViewport(page: Page) {
  const measure = () =>
    page.evaluate(() => {
      const root = document.documentElement;
      const width = root.clientWidth;
      const overflow = root.scrollWidth - width;
      const culprits =
        overflow > 0
          ? [...document.body.querySelectorAll<HTMLElement>("*")]
              .filter((el) => el.getBoundingClientRect().right > width + 1)
              .slice(0, 5)
              .map((el) => {
                const id = el.id ? `#${el.id}` : "";
                const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
                return `${el.tagName.toLowerCase()}${id}${cls} (right ${Math.round(el.getBoundingClientRect().right)})`;
              })
          : [];
      return { overflow, width, culprits };
    });
  let last = await measure();
  await expect
    .poll(async () => {
      last = await measure();
      return last.overflow;
    }, { message: "horizontal page scroll" })
    .toBeLessThanOrEqual(0)
    .catch((error: Error) => {
      throw new Error(`Page scrolls sideways by ${last.overflow}px at width ${last.width}; wide elements:\n  ${last.culprits.join("\n  ")}\n${error.message}`);
    });
}

/**
 * Every visible element the locator matches is at least `min` x `min` CSS pixels (default 44). Hidden matches
 * (zero size) are skipped, but at least one must be visible. On failure lists each small target with its size.
 */
export async function expectTouchTargets(locator: Locator, min: number = TOUCH_TARGET_PX) {
  await expect(locator.first()).toBeVisible();
  const targets = await locator.evaluateAll((elements) =>
    elements.map((el) => {
      const box = el.getBoundingClientRect();
      const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      return { label: `<${el.tagName.toLowerCase()}> "${label}"`, width: box.width, height: box.height };
    }),
  );
  const visible = targets.filter((t) => t.width > 0 && t.height > 0);
  expect(visible.length, "visible touch targets").toBeGreaterThan(0);
  const small = visible.filter((t) => t.width < min || t.height < min);
  expect(
    small.map((t) => `${t.label} ${Math.round(t.width)}x${Math.round(t.height)}`),
    `touch targets smaller than ${min}x${min} px`,
  ).toEqual([]);
}
