// NB3 (CL8, CL9): the campaign shell, the Party roster, the Adversaries tabs and the Combat Map's Edit mode keep the
// rules engine, the domain card list and the tab-only panels off their initial JS. A static import added back to any
// of these files puts tens to hundreds of KB on the route again (docs/performance.md, "NB3").
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as display from "@/components/party/party-display";
import * as levelUp from "@/components/party/level-up";
import { PartyLevelUpButton } from "@/components/party/level-up/party-button";
import * as portraitSource from "@/components/party/portrait-source";
import { PORTRAITS } from "@/lib/party/portraits";
import * as art from "@/lib/srd/art";

const ROOT = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** The module specifiers of every static (non-type) import or re-export in a source file. */
const staticImports = (source: string) => [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
const APP = "src/app/(gm)/campaigns/[campaignId]";

describe("the campaign shell's portrait helpers (NB3)", () => {
  it("portrait-source reads only the portraits and the class list", () => {
    expect(staticImports(read("src/components/party/portrait-source.ts"))).toEqual(["@/lib/party/portraits", "@/lib/srd/classes"]);
  });

  it("the shell's avatar and the players roster take portraitSource from portrait-source, not party-display", () => {
    for (const file of ["src/components/config/shell/avatar.tsx", "src/components/config/sections/players/roster.tsx", "src/components/party/portrait.tsx"]) {
      const imports = staticImports(read(file));
      expect(imports.some((s) => s.endsWith("portrait-source")), file).toBe(true);
      expect(imports.some((s) => s.endsWith("party-display")), file).toBe(false);
    }
  });

  it("lib/party/portraits holds the art that srd/art re-exports, without the domain cards", () => {
    expect(art.PORTRAITS).toBe(PORTRAITS);
    expect(staticImports(read("src/lib/party/portraits.ts"))).toEqual([]);
  });

  it("party-display still exports the portrait helpers for its importers", () => {
    expect(display.portraitSource).toBe(portraitSource.portraitSource);
    expect(display.fitWithin).toBe(portraitSource.fitWithin);
    expect(display.portraitAncestryId).toBe(portraitSource.portraitAncestryId);
  });
});

describe("the Party roster (NB3)", () => {
  it("takes the level-up button and badge without the level-up index", () => {
    expect(staticImports(read(`${APP}/party/page.tsx`))).toContain("@/components/party/level-up/party-button");
    const roster = staticImports(read(`${APP}/party/roster.tsx`));
    expect(roster).toContain("@/components/party/level-up/badge");
    expect(roster).not.toContain("@/components/party/level-up");
    expect(levelUp.PartyLevelUpButton).toBe(PartyLevelUpButton);
  });

  it("loads Evasion's rules engine with next/dynamic and never imports the srd barrel or zod's extras", () => {
    const source = read(`${APP}/party/roster.tsx`);
    const imports = staticImports(source);
    expect(imports).not.toContain("@/lib/domain/characters/derived");
    expect(imports).not.toContain("@/lib/srd");
    expect(imports).not.toContain("@/lib/frames/extras/common");
    expect(source).toMatch(/import\("\.\/roster-evasion"\)/);
  });
});

describe("tab and mode panels behind next/dynamic (NB3)", () => {
  it("Adversaries: the encounter tracker and the environments load with their tab", () => {
    const source = read(`${APP}/adversaries/page.tsx`);
    const imports = staticImports(source);
    for (const lazy of ["@/components/adversaries/tracker", "@/components/adversaries/environments", "@/components/adversaries/environments/opened-adversary"]) {
      expect(imports).not.toContain(lazy);
      expect(source).toContain(`import("${lazy}")`);
    }
    // Error boundaries stay (CL1).
    expect(source).toMatch(/<SlotBoundary label="The encounter tracker">/);
    expect(source).toMatch(/<SlotBoundary label="Environments">/);
  });

  it("Combat Map: the editor and the Scene card load with Edit mode; the provider stays static", () => {
    const source = read(`${APP}/combat-map/page.tsx`);
    const imports = staticImports(source);
    expect(imports).not.toContain("@/components/combat-map/editor");
    expect(imports).not.toContain("@/components/combat-map/generate");
    expect(imports).toContain("@/components/combat-map/editor/editor-state");
    expect(source).toContain('import("@/components/combat-map/editor")');
    expect(source).toContain('import("@/components/combat-map/generate")');
  });

  it("Load Campaign fully prefetches the dashboard behind Resume Campaign", () => {
    expect(read("src/app/(gm)/campaigns/chronicle.tsx")).toMatch(/<Link href=\{`\/campaigns\/\$\{campaign\._id\}`\} prefetch /);
  });
});
