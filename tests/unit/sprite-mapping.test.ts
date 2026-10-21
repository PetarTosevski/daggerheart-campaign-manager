import { describe, expect, it } from "vitest";

import { TERRAINS, type Terrain } from "@/lib/domain/combat-map";
import { CATALOG, COMMON_FOLDER, TEXTURE_SQUARES, pickTexture, textureCandidates, type FolderId } from "@/lib/sprite-packs";

// Extra-sheet textures only add variants (TASK-SP-P11Z suggestion, bead dcm-bxp.115): a block that shows a primary
// texture shows the one it showed before any extra sheet existed.

const FOLDERS = Object.keys(CATALOG) as FolderId[];

/** FNV-1a 32-bit, written out here so the expected picks do not come from the code under test. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A folder's primary-sheet texture keys for a terrain, in catalog order. */
function primaryKeys(folder: FolderId, terrain: Terrain): string[] {
  return CATALOG[folder].terrain.filter((e) => e.terrain === terrain && e.extraSheet === undefined).map((e) => e.key);
}

/** The pick before extra sheets: the setting's primary textures, else common's, hashed per block. */
function pickWithoutExtras(terrain: Terrain, setting: FolderId, x: number, y: number, seed: number): string | null {
  const own = primaryKeys(setting, terrain);
  const list = own.length > 0 ? own : primaryKeys(COMMON_FOLDER as FolderId, terrain);
  if (list.length === 0) return null;
  const bx = Math.floor(x / TEXTURE_SQUARES);
  const by = Math.floor(y / TEXTURE_SQUARES);
  return list[fnv(`${terrain}|${bx}|${by}|${seed}`) % list.length] ?? null;
}

const BLOCKS = Array.from({ length: 60 }, (_, i) => [(i % 10) * TEXTURE_SQUARES, Math.floor(i / 10) * TEXTURE_SQUARES] as const);

describe("texture mapping: extra-sheet variants only add choices", () => {
  it("every block showing a primary texture shows its pre-extras pick; the others show a gained variant", () => {
    let pairsWithBoth = 0;
    for (const setting of FOLDERS) {
      for (const terrain of TERRAINS) {
        const candidates = textureCandidates(terrain, setting);
        const gained = new Set(candidates.filter((e) => e.extraSheet !== undefined).map((e) => e.key));
        const hasPrimary = candidates.some((e) => e.extraSheet === undefined);
        if (hasPrimary && gained.size > 0) pairsWithBoth++;
        for (const seed of [1, 9]) {
          for (const [x, y] of BLOCKS) {
            const pick = pickTexture(terrain, setting, x, y, seed);
            const before = pickWithoutExtras(terrain, setting, x, y, seed);
            if (gained.size === 0) {
              expect(pick, `${setting} ${terrain}`).toBe(before);
            } else if (pick === null || gained.has(pick)) {
              expect(pick, `${setting} ${terrain}`).not.toBeNull();
            } else {
              expect(pick, `${setting} ${terrain} (${x}, ${y}) seed ${seed}`).toBe(before);
            }
          }
        }
      }
    }
    // Sanity: the check above covers pools that have both primary textures and gained variants.
    expect(pairsWithBoth).toBeGreaterThan(50);
  });

  it("a pool with gained variants still keeps most primary picks (base / (base + gained) of the blocks)", () => {
    // Forest grass: primary textures plus batch-2 variants (sprite-catalog.test.ts pins the list).
    const candidates = textureCandidates("grass", "forest");
    const base = candidates.filter((e) => e.extraSheet === undefined).length;
    expect(base).toBeGreaterThan(0);
    const blocks = Array.from({ length: 400 }, (_, i) => [i * TEXTURE_SQUARES, 0] as const);
    const kept = blocks.filter(([x, y]) => pickTexture("grass", "forest", x, y, 3) === pickWithoutExtras("grass", "forest", x, y, 3));
    const expected = base / candidates.length;
    expect(kept.length / blocks.length).toBeGreaterThan(expected - 0.1);
    expect(kept.length / blocks.length).toBeLessThan(expected + 0.1);
  });

  it("a setting that fell back to common's primary textures keeps them and gains its own extra-sheet ones", () => {
    // Grassland had no dirt texture of its own before batch 2: common's packed dirt stays, ploughed soil is added.
    const keys = textureCandidates("dirt", "grassland-and-road").map((e) => e.key);
    expect(keys[0]).toBe("common/packed-dirt");
    expect(keys).toContain("grassland-and-road/ploughed-soil");
    expect(keys.filter((k) => k.startsWith("common/"))).toEqual(primaryKeys(COMMON_FOLDER as FolderId, "dirt"));
  });

  it("a terrain with no primary texture anywhere uses its extra-sheet ones", () => {
    expect(textureCandidates("water", "forest").map((e) => e.key)).toEqual(["forest/forest-stream-pebbles"]);
    expect(pickTexture("water", "forest", 0, 0, 1)).toBe("forest/forest-stream-pebbles");
  });

  it("every pick is one of the terrain's candidates", () => {
    for (const setting of FOLDERS)
      for (const terrain of TERRAINS) {
        const keys = new Set(textureCandidates(terrain, setting).map((e) => e.key));
        for (const [x, y] of BLOCKS.slice(0, 20)) {
          const pick = pickTexture(terrain, setting, x, y, 5);
          if (keys.size === 0) expect(pick).toBeNull();
          else expect(keys.has(pick ?? ""), `${setting} ${terrain}`).toBe(true);
        }
      }
  });
});
