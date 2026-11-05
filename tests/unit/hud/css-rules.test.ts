// HUD stylesheet rules that unit tests can read. dcm-bxp.99.32.34: each HUD part styles its own class names (queue.css's
// Resolutions list used to reuse `.hud-res`, H4.1's result panel, so the result card picked up the queue's padding).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = (file: string) => readFileSync(join(process.cwd(), "src/components/combat-map/hud", file), "utf8");

/** The class names a stylesheet defines selectors for. */
function classes(source: string): Set<string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set(Array.from(withoutComments.matchAll(/\.(hud-[a-z0-9-]+)/g), (m) => m[1]));
}

describe("HUD class names", () => {
  it("the queue's Resolutions and the result panel share no class", () => {
    const queue = classes(css("queue/queue.css"));
    const result = classes(css("result/result.css"));
    const shared = [...queue].filter((name) => result.has(name) && (name.startsWith("hud-res") || name.startsWith("hud-q-res")));
    expect(shared).toEqual([]);
    expect(queue.has("hud-q-res")).toBe(true);
    expect(queue.has("hud-res")).toBe(false);
  });
});

describe("make-room selectors (dcm-bxp.99.32.13)", () => {
  it("no HUD stylesheet keys on the old .sh-open (H2.2 renamed it .hud-sh-open)", () => {
    const dir = join(process.cwd(), "src/components/combat-map/hud");
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".css"));
    expect(files.length).toBeGreaterThan(10);
    const dead = files.filter((f) => /\.sh-open\b/.test(css(f).replace(/\/\*[\s\S]*?\*\//g, "")));
    expect(dead).toEqual([]);
  });
});

describe("Spend n Fear? at the GM's phone width (dcm-bxp.99.32.44)", () => {
  it("stays on screen over the full-width stat block instead of moving left by the panel's width", () => {
    const fear = css("fear/fear.css");
    const phone = fear.slice(fear.indexOf("@media (max-width: 760px)"));
    expect(phone).toMatch(/\.hud-root\.hud-sh-open \.hud-fc \{\s*transform: none;\s*z-index: 91;/);
    // Above the panel (ui.css .hud-panel: z 90).
    expect(css("ui/ui.css")).toMatch(/\.hud-panel \{[^}]*z-index: 90;/);
  });
});
