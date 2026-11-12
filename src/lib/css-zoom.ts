/**
 * Client pixels versus CSS pixels under the website's root zoom (dcm-1i3z; globals.css, "Website scale").
 *
 * `<html>` carries CSS `zoom` (0.8 by default, Text size 0.72 / 0.92). Client coordinates (`getBoundingClientRect`,
 * `clientX`, `innerWidth`, `window.scrollY`) are screen pixels, while a CSS length (`style.left`, `offsetWidth`, an
 * element's `scrollLeft`, a transform's px) is painted at the zoom. Code that turns a client measurement into a CSS
 * length divides by the scale; ratios of two client measurements need nothing.
 */

/**
 * Client pixels per CSS pixel of `el`: its on-screen width over its layout width. Includes the root zoom and any CSS
 * transform scale on its ancestors (the Combat HUD scales the map while a sheet is open). 1 when it has no size (jsdom,
 * `display: none`).
 */
export function cssScale(el: Element): number {
  const width = el.getBoundingClientRect().width;
  const layout = el instanceof HTMLElement ? el.offsetWidth : 0;
  return layout > 0 && width > 0 ? width / layout : 1;
}

/**
 * The root's zoom as client pixels per CSS pixel, for elements with no transform of their own (fixed popovers and
 * overlays placed from a client rect). Measured, not read from the CSS, so a browser whose zoom reports rects in CSS
 * pixels gets 1 and keeps working.
 */
export function rootScale(): number {
  return typeof document === "undefined" ? 1 : cssScale(document.documentElement);
}
