// PF11 (CL8, CL9): the dashboard keeps the dice box, the level-up history and the SRD lists off its initial JS.
// A static import added back to any of these files puts the class-feature registry, the tier pickers, the domain
// card list, the Tier 2-4 equipment or zod on the dashboard again.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as levelUp from "@/components/party/level-up";
import * as badge from "@/components/party/level-up/badge";
import { DOMAINS as CARD_DOMAINS } from "@/lib/srd/domain-cards";
import { DOMAINS } from "@/lib/srd/domains";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** The module specifiers of every static (non-type) import in a source file. */
const staticImports = (source: string) => [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
const isBarrel = (specifier: string) => specifier === "@/lib/srd" || /(^|\/)srd(\/index)?$/.test(specifier);

describe("lazy boundaries (CL8)", () => {
  it("the dice box loads with next/dynamic, the roll feed stays static", () => {
    const source = read("src/components/party/dice/index.tsx");
    expect(staticImports(source)).not.toContain("./dice-box");
    expect(source).toMatch(/dynamic\(\(\) => import\("\.\/dice-box"\)/);
    expect(staticImports(source)).toContain("./roll-feed");
    // Error boundaries stay (CL1).
    expect(source.match(/<DiceBoundary /g)).toHaveLength(2);
  });

  it("the party card takes the level-up badge without the history and its pickers", () => {
    const card = staticImports(read("src/components/party/party-card.tsx"));
    expect(card).toContain("./level-up/badge");
    expect(card).not.toContain("./level-up");
    expect(staticImports(read("src/components/party/level-up/badge.tsx"))).toEqual([]);
  });

  it("the level-up index still exports the badges from the badge module", () => {
    expect(levelUp.LevelUpCardBadge).toBe(badge.LevelUpCardBadge);
    expect(levelUp.LevelUpRosterBadge).toBe(badge.LevelUpRosterBadge);
  });
});

describe("SRD leaf imports (CL9)", () => {
  it.each(["src/components/party/party-display.ts", "src/lib/domain/characters/spellcast.ts", "src/lib/domain/session-features/holders.ts"])(
    "%s never imports the srd barrel",
    (file) => {
      expect(staticImports(read(file)).filter(isBarrel)).toEqual([]);
    },
  );

  it("party-display takes domain colours from srd/domains, not the domain card list", () => {
    const imports = staticImports(read("src/components/party/party-display.ts"));
    expect(imports).toContain("@/lib/srd/domains");
    expect(imports).not.toContain("@/lib/srd/domain-cards");
  });

  it("srd/domains holds the same domains as srd/domain-cards", () => {
    expect(DOMAINS).toEqual(CARD_DOMAINS);
  });
});
