/**
 * Breakpoints under the website's root zoom (dcm-1i3z, dcm-jkxa). Plain JS (ESM) so that postcss-zoom-media.mjs (the
 * PostCSS plugin, run by Next on every stylesheet) and the app's TypeScript share one table and one transform.
 *
 * - Mouse and desktop screens render at zoom 0.8 (globals.css), touch screens (`TOUCH_QUERY`) at 1, as before.
 * - At 80% browser zoom a breakpoint written for width W switched at a screen width of W x 0.8. CSS zoom leaves media
 *   queries on the real screen, so every width / height query is rewritten: on touch it stays as written, elsewhere
 *   its lengths are multiplied by `DESKTOP_ZOOM`. The same holds for the few `matchMedia` reads (`screenQuery`).
 * - Text size (0.72 / 0.92, touch 0.9 / 1.15) doesn't move breakpoints; it never did.
 */

/** The root zoom of mouse and desktop screens; touch screens stay at 1. */
export const DESKTOP_ZOOM = 0.8;

/** Touch screens: phones and tablets keep zoom 1 and the breakpoints as written. */
export const TOUCH_QUERY = "(pointer: coarse)";

const NOT_TOUCH = `(not ${TOUCH_QUERY})`;

/** A media feature on the viewport's width or height (`(max-width: 760px)`, `(width >= 40rem)`), not `device-` or ratios. */
const SIZE_FEATURE = /\((?:[^()]*?[\s(:<>=]|)(?:min-|max-)?(?:width|height)\b[^()]*\)/g;
const LENGTH = /(-?\d*\.?\d+)(px|rem|em)\b/g;

/** Splits on commas outside parentheses. */
function splitQueries(params) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < params.length; i += 1) {
    const c = params[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(params.slice(start, i));
      start = i + 1;
    }
  }
  out.push(params.slice(start));
  return out.map((q) => q.trim()).filter((q) => q.length > 0);
}

const round = (n) => Math.round(n * 1000) / 1000;

const toPx = (n, unit) => (unit === "px" ? Number(n) : Number(n) * 16);
const RANGE_ONE = /\(\s*(width|height)\s*(<=|>=|<|>)\s*(-?\d*\.?\d+)(px|rem|em)\s*\)/g;
const RANGE_TWO = /\(\s*(-?\d*\.?\d+)(px|rem|em)\s*(<=|<)\s*(width|height)\s*(<=|<)\s*(-?\d*\.?\d+)(px|rem|em)\s*\)/g;
/** Strict bounds (`<`, `>`) as 0.02 px off, the way Tailwind 3 wrote its max-* breakpoints. */
const STRICT = 0.02;

/**
 * Range syntax (`(width < 40rem)`, Tailwind 4's breakpoints) as `min-` / `max-` features in px. Next's CSS minifier
 * lowers range syntax to `not all and (min-width: …)` and drops any other condition beside it (the pointer branch), so
 * the rewrite never hands it a range.
 */
function legacyRanges(condition) {
  const one = (feature, op, value) => {
    if (op === ">=") return `(min-${feature}: ${round(value)}px)`;
    if (op === ">") return `(min-${feature}: ${round(value + STRICT)}px)`;
    if (op === "<=") return `(max-${feature}: ${round(value)}px)`;
    return `(max-${feature}: ${round(value - STRICT)}px)`;
  };
  return condition
    .replace(RANGE_TWO, (_, a, au, op1, feature, op2, b, bu) => {
      const low = one(feature, op1 === "<" ? ">" : ">=", toPx(a, au));
      return `${low} and ${one(feature, op2, toPx(b, bu))}`;
    })
    .replace(RANGE_ONE, (_, feature, op, n, unit) => one(feature, op, toPx(n, unit)));
}

/** Whether one media query tests the viewport's width or height. */
export function hasSizeFeature(query) {
  return new RegExp(SIZE_FEATURE.source).test(query);
}

/** Whether one media query already chooses between touch and the rest (written by hand, or rewritten already). */
function choosesPointer(query) {
  return query.includes("pointer");
}

/**
 * Rewrites one `@media` prelude (or a `matchMedia` string): each comma-separated query that tests width or height
 * becomes two, `(pointer: coarse) and Q` and `(not (pointer: coarse)) and Q x 0.8`. Other queries are kept as they are,
 * and so is a query that already names `pointer` (so the rewrite is idempotent).
 * @param {string} params
 * @param {number} [factor]
 * @returns {string}
 */
export function scaleMediaParams(params, factor = DESKTOP_ZOOM) {
  const queries = splitQueries(params);
  const out = [];
  for (const query of queries) {
    if (!hasSizeFeature(query) || choosesPointer(query)) {
      out.push(query);
      continue;
    }
    // `not all and C` (Tailwind's max-* variants) is the condition `not (C)`.
    const negated = /^not\s+all\s+and\s+(.*)$/i.exec(query);
    // A media type in front (`screen and (...)`) stays in front.
    const typed = negated ? null : /^((?:only\s+)?(?:screen|print|all)\s+and\s+)(.*)$/i.exec(query);
    const prefix = typed ? typed[1] : "";
    const single = negated && /^\([^()]*\)$/.test(negated[1].trim());
    let condition = negated ? (single ? `not ${negated[1].trim()}` : `not (${negated[1]})`) : typed ? typed[2] : query;
    if ((!negated && /^\s*not\b/i.test(query)) || /^(?:only\s+)?(?:screen|print|all)\s*$/i.test(condition)) {
      // `not screen and ...`: no rewrite; isZoomAware reports it.
      out.push(query);
      continue;
    }
    condition = legacyRanges(condition);
    const scaled = condition.replace(new RegExp(SIZE_FEATURE.source, "g"), (feature) =>
      feature.replace(LENGTH, (_, n, unit) => `${round(Number(n) * factor)}${unit}`),
    );
    const wrap = (c) => (/\bor\b|\bnot\b/i.test(c) ? `(${c})` : c);
    out.push(`${prefix}${TOUCH_QUERY} and ${wrap(condition)}`);
    out.push(`${prefix}${NOT_TOUCH} and ${wrap(scaled)}`);
  }
  return out.join(", ");
}

/**
 * A `matchMedia` string as the stylesheets see it after the rewrite: `window.matchMedia(screenQuery("(max-width:
 * 760px)"))` matches exactly where `@media (max-width: 760px)` applies.
 * @param {string} query
 * @returns {string}
 */
export function screenQuery(query) {
  return scaleMediaParams(query);
}

/**
 * Whether every query in a prelude that tests width or height also chooses between touch and the rest; the guard for
 * unscaled breakpoints (tests/unit/zoom-media.test.ts and the built-stylesheet check in tests/e2e/prefs-applied.spec.ts).
 * @param {string} params
 * @returns {boolean}
 */
export function isZoomAware(params) {
  return splitQueries(params).every((q) => !hasSizeFeature(q) || choosesPointer(q));
}
