// PF5 (CL8, CL9): the tome book, the frame trackers and the rest picker stay behind next/dynamic, and the
// class-feature modules (bundled into the dice box and Convex) import SRD leaf modules, never the srd barrel.
// A static import added back to any of these files puts per-frame or SRD data on every campaign route again.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** The module specifiers of every static (non-type) import in a source file. */
const staticImports = (source: string) =>
  [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);

const CAMPAIGN = "src/app/(gm)/campaigns/[campaignId]";

describe("lazy boundaries (CL8)", () => {
  it("the campaign tome loads its book and the frame lore with next/dynamic", () => {
    const source = read(`${CAMPAIGN}/campaign-tome.tsx`);
    expect(staticImports(source)).not.toContain("./campaign-tome-book");
    expect(staticImports(source)).not.toContain("@/lib/frames/tomes");
    expect(staticImports(source)).not.toContain("@/components/tome/tome-book");
    expect(source).toMatch(/dynamic\(\(\) => import\("\.\/campaign-tome-book"\)/);
  });

  it("each frame tracker is its own dynamic chunk", () => {
    const source = read(`${CAMPAIGN}/trackers/index.tsx`);
    const trackers = readdirSync(join(ROOT, CAMPAIGN, "trackers"))
      .filter((f) => f.endsWith(".tsx") && f !== "index.tsx" && f !== "tracker-card.tsx")
      .map((f) => `./${f.replace(/\.tsx$/, "")}`);
    expect(trackers.length).toBeGreaterThanOrEqual(6);
    for (const tracker of trackers) {
      expect(staticImports(source)).not.toContain(tracker);
      expect(source).toContain(`import("${tracker}")`);
    }
  });

  it("the rest picker loads with next/dynamic, the launcher stays static", () => {
    const source = read("src/components/party/rest/index.tsx");
    expect(staticImports(source)).not.toContain("./picker");
    expect(source).toContain('import("./picker")');
    expect(staticImports(source)).toContain("./launcher");
    // Error boundaries stay (CL1).
    expect(source.match(/<RestBoundary>/g)).toHaveLength(2);
  });
});

describe("SRD leaf imports (CL9)", () => {
  const dir = "src/lib/domain/class-features";
  const files = [
    ...readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f}`),
    ...readdirSync(join(ROOT, dir, "classes")).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/classes/${f}`),
  ];

  it.each(files)("%s never imports the srd barrel", (file) => {
    const barrel = staticImports(read(file)).filter((s) => s === "@/lib/srd" || /(^|\/)srd(\/index)?$/.test(s));
    expect(barrel).toEqual([]);
  });
});
