import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENVIRONMENT_ART, ENVIRONMENT_ART_COUNT, environmentArt } from "@/lib/srd/environment-art";
import { ENVIRONMENTS } from "@/lib/srd/environments";

// EA1: the generated environment id -> rulebook illustration map and the WebP files in public/environment-art/.
const PUBLIC = join(__dirname, "../../public");
const DIR = join(PUBLIC, "environment-art");
const BY_ID = new Map(ENVIRONMENTS.map((e) => [e.id, e]));

describe("environment art", () => {
  const entries = Object.entries(ENVIRONMENT_ART);

  it("maps only real environment ids, each to its own file", () => {
    expect(entries.length).toBe(29);
    for (const [id, art] of entries) {
      expect(BY_ID.has(id), id).toBe(true);
      expect(art.src).toBe(`/environment-art/${id}.webp`);
    }
  });

  it("has every mapped file on disk and no file without a mapping", () => {
    for (const [, art] of entries) expect(existsSync(join(PUBLIC, art.src)), art.src).toBe(true);
    const files = readdirSync(DIR).filter((f) => f.endsWith(".webp"));
    expect(files.sort()).toEqual(entries.map(([id]) => `${id}.webp`).sort());
  });

  it("records sizes for layout (at most 900 px wide) and the count per book", () => {
    for (const [id, art] of entries) {
      expect(art.width, id).toBeGreaterThan(0);
      expect(art.width, id).toBeLessThanOrEqual(900);
      expect(art.height, id).toBeGreaterThan(0);
    }
    const perBook = { core: 0, "hope-and-fear": 0 };
    for (const [id] of entries) perBook[BY_ID.get(id)!.source] += 1;
    expect(perBook).toEqual(ENVIRONMENT_ART_COUNT);
  });

  it("credits the book page the art came from: the block's page, or the list page just before it", () => {
    for (const [id, art] of entries) {
      const env = BY_ID.get(id)!;
      const prefix = env.source === "core" ? "CB" : "HF";
      const match = art.credit?.match(new RegExp(`^${prefix} p\\.(\\d+)$`));
      expect(match, id).toBeTruthy();
      // The Abandoned Mine's art is on the HF list page (p.98), its block on p.99.
      expect([env.page, env.page - 1], id).toContain(Number(match![1]));
    }
  });

  it("keeps the total image weight under 5 MB", () => {
    const total = entries.reduce((sum, [, art]) => sum + statSync(join(PUBLIC, art.src)).size, 0);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });

  it("environmentArt returns the entry, or undefined for no art and no id", () => {
    expect(environmentArt("cult-ritual")).toBe(ENVIRONMENT_ART["cult-ritual"]);
    expect(environmentArt("abandoned-grove")).toBeUndefined();
    expect(environmentArt(undefined)).toBeUndefined();
  });
});
