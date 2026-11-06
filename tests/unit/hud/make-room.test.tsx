/**
 * Make room (plan combat-hud H2.2; docs/tasks/TASK-HUD-H2.2.md): while a sheet is open the HUD root carries
 * `hud-sh-open` (never the party sheet's global `.sh-open`, dcm-bxp.99.32.11), the map's viewport shifts and
 * scales, and the pointer maths (`viewport.toSquares`, the token drag) stays exact under that transform.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import { HudProvider, hudRootClasses, useHud, type HudSheetTarget } from "@/components/combat-map/hud/state";
import { stageToSquares } from "@/components/combat-map/map-view/map-board";
import { anchorAt, anchorScroll, cssScale } from "@/components/combat-map/map-view/use-map-zoom";
import { screenScale } from "@/components/combat-map/tokens/tokens-layer";

const moss: HudSheetTarget = { kind: "pc", characterId: "moss" as Id<"characters"> };
const brannoc: HudSheetTarget = { kind: "pc", characterId: "brannoc" as Id<"characters"> };

/** An element whose layout width is `layoutWidth` and whose on-screen box is `rect` (jsdom lays nothing out). */
function laidOut(el: HTMLElement, layoutWidth: number, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  Object.defineProperty(el, "offsetWidth", { configurable: true, value: layoutWidth });
  el.getBoundingClientRect = () =>
    ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => rect }) as DOMRect;
  return el;
}

describe("the HUD root's classes", () => {
  it("carry the hud- prefix and never the party sheet's global .sh-open", () => {
    for (const state of [
      { sheet: moss, pick: null, toolsOpen: false },
      { sheet: moss, pick: { id: "card:x", anchorTokenId: null }, toolsOpen: true },
    ]) {
      const classes = hudRootClasses(state).split(" ");
      expect(classes).toContain("hud-sh-open");
      expect(classes).toContain("hud-sh-moss");
      for (const c of classes) expect(c).toMatch(/^hud-/);
      expect(classes).not.toContain("sh-open");
    }
    expect(hudRootClasses({ sheet: null, pick: { id: "p", anchorTokenId: null }, toolsOpen: true })).toBe("hud-pk-open hud-tl-open");
  });

  it("swaps the sheet on another banner or token and closes it on the same one or the close button", () => {
    function Probe() {
      const hud = useHud();
      return (
        <>
          <span data-testid="classes">{hudRootClasses(hud)}</span>
          <button type="button" onClick={() => hud.toggleSheet(moss)}>
            Moss
          </button>
          <button type="button" onClick={() => hud.toggleSheet(brannoc)}>
            Brannoc
          </button>
          <button type="button" onClick={hud.closeSheet}>
            Close
          </button>
        </>
      );
    }
    render(
      <HudProvider>
        <Probe />
      </HudProvider>,
    );
    const classes = screen.getByTestId("classes");
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    expect(classes.textContent).toBe("hud-sh-open hud-sh-moss");
    fireEvent.click(screen.getByRole("button", { name: "Brannoc" }));
    expect(classes.textContent).toBe("hud-sh-open hud-sh-brannoc");
    fireEvent.click(screen.getByRole("button", { name: "Brannoc" }));
    expect(classes.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(classes.textContent).toBe("");
  });
});

describe("pointer maths under the make-room transform", () => {
  // A 30 × 20 map at zoom 1 (48 px squares): the stage is 1440 px wide in layout.
  const step = 48;

  it("toSquares is the classic maths without a transform", () => {
    const stage = laidOut(document.createElement("div"), 1440, { left: 10, top: 20, width: 1440, height: 960 });
    expect(stageToSquares(stage, step, 0, 10 + 5.5 * step, 20 + 10.5 * step)).toEqual({ x: 5.5, y: 10.5 });
    // A player's stage carries fog padding.
    expect(stageToSquares(stage, step, 3, 10 + 8.5 * step, 20 + 13.5 * step)).toEqual({ x: 5.5, y: 10.5 });
  });

  it("toSquares stays exact while the map is shifted -125 px and scaled to 94 %", () => {
    // translateX(-125px) scale(.94) from the viewport's top-left corner: the stage is 94 % wide and 125 px further left.
    const s = 0.94;
    const stage = laidOut(document.createElement("div"), 1440, { left: 10 * s - 125, top: 20 * s, width: 1440 * s, height: 960 * s });
    const at = (x: number, y: number) => ({ cx: 10 * s - 125 + x * step * s, cy: 20 * s + y * step * s });
    const p = at(5.5, 10.5);
    const q = stageToSquares(stage, step, 0, p.cx, p.cy);
    expect(q.x).toBeCloseTo(5.5, 9);
    expect(q.y).toBeCloseTo(10.5, 9);
    // The far corner too (the error of the old maths grows with the distance from the stage's corner).
    const r = at(29.5, 19.5);
    const far = stageToSquares(stage, step, 0, r.cx, r.cy);
    expect(far.x).toBeCloseTo(29.5, 9);
    expect(far.y).toBeCloseTo(19.5, 9);
    // Tablet: -60 px, 92 %, zoomed in to 1.2.
    const t = 0.92;
    const zoomed = laidOut(document.createElement("div"), 1440 * 1.2, { left: -60, top: 0, width: 1440 * 1.2 * t, height: 960 * 1.2 * t });
    const z = stageToSquares(zoomed, step * 1.2, 0, -60 + 12.25 * step * 1.2 * t, 7.75 * step * 1.2 * t);
    expect(z.x).toBeCloseTo(12.25, 9);
    expect(z.y).toBeCloseTo(7.75, 9);
  });

  it("the token drag divides by the zoom times the make-room scale", () => {
    const layer = document.createElement("div");
    layer.setAttribute("data-testid", "combat-tokens");
    const token = document.createElement("button");
    layer.append(token);
    // Zoom 1.2 (the layer's own scale) under the 94 % make-room scale.
    laidOut(layer, 1440, { left: 0, top: 0, width: 1440 * 1.2 * 0.94, height: 960 * 1.2 * 0.94 });
    expect(screenScale(token, 1.2)).toBeCloseTo(1.2 * 0.94, 9);
    // A drag of 3 squares on screen moves the token 3 squares.
    const dx = 3 * 48 * 1.2 * 0.94;
    expect(Math.round(dx / screenScale(token, 1.2) / 48)).toBe(3);
    // No layer laid out (or none at all): the zoom.
    expect(screenScale(document.createElement("button"), 1.2)).toBe(1.2);
  });

  it("Ctrl + scroll keeps the point under the cursor under the make-room scale (dcm-bxp.99.32.14)", () => {
    for (const scale of [1, 0.94, 0.92]) {
      const vp = laidOut(document.createElement("div"), 1000, { left: 0, top: 0, width: 1000 * scale, height: 700 * scale });
      expect(cssScale(vp)).toBeCloseTo(scale, 9);
      // The stage's corner at (100, 40) on screen; the cursor at (500, 300); zoom 1 -> 1.12.
      const stage = { left: 100, top: 40 };
      const a = anchorAt(stage, 1, scale, 500, 300);
      const by = anchorScroll(stage, a, 1.12, scale);
      // A scroll of `by` layout px moves the stage by `by * scale` client px; the anchored point is back under the cursor.
      const left = stage.left - by.x * scale;
      const top = stage.top - by.y * scale;
      expect(left + a.px * 1.12 * scale).toBeCloseTo(500, 9);
      expect(top + a.py * 1.12 * scale).toBeCloseTo(300, 9);
    }
    // No layout size (jsdom): no scale.
    expect(cssScale(document.createElement("div"))).toBe(1);
  });
});

describe("the make-room styles (CmpTokensDesign 'Motion')", () => {
  const css = (file: string) => readFileSync(join(process.cwd(), "src/components/combat-map/hud", file), "utf8");
  const shell = css("shell.css");
  const tokens = css("hud.css");

  it("key on .hud-sh-open, never on .sh-open", () => {
    expect(shell).toMatch(/\.hud-sh-open \.hud-map \.cm-vp \{\s*transform: translateX\(var\(--hud-map-shift\)\) scale\(var\(--hud-map-scale\)\);/);
    // Comments may name the boards' class; no rule may key on it.
    expect(shell.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.sh-open\b/);
  });

  it("move the map over 350 ms from its top-left corner, the Fear banner by the panel's width, the hand to 330", () => {
    expect(shell).toMatch(/\.hud-map \.cm-vp \{\s*transform-origin: 0 0;\s*transition: transform var\(--hud-t-map\) var\(--hud-ease-out\);/);
    expect(shell).toMatch(/\.hud-root\.hud-sh-open \.hud-fear \{\s*transform: translateX\(calc\(-1 \* var\(--hud-sheet-w\)\)\);/);
    expect(shell).toMatch(/\.hud-sh-open \.hud-r-hand \{\s*left: 330px;/);
    expect(shell).toMatch(/\.hud-root\.hud-sh-open \.hud-sun \{\s*opacity: 0;/);
    expect(tokens).toMatch(/--hud-t-map: 350ms;/);
    expect(tokens).toMatch(/--hud-map-shift: -125px;/);
    expect(tokens).toMatch(/--hud-map-scale: 0\.94;/);
  });

  it("stop every motion under prefers-reduced-motion", () => {
    const reduced = tokens.slice(tokens.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/--hud-t-map: 0ms;/);
    expect(reduced).toMatch(/transition: none !important;/);
  });
});
