import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADVERSARIES } from "@/lib/srd/adversaries";
import { ADVERSARY_ART, ADVERSARY_ART_COUNT, adversaryArt } from "@/lib/srd/adversary-art";

// AA1: the generated adversary id -> rulebook illustration map and the WebP files in public/adversary-art/.
const PUBLIC = join(__dirname, "../../public");
const DIR = join(PUBLIC, "adversary-art");
const BY_ID = new Map(ADVERSARIES.map((a) => [a.id, a]));

describe("adversary art", () => {
  const entries = Object.entries(ADVERSARY_ART);

  it("maps only real adversary ids, each to its own file", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, art] of entries) {
      expect(BY_ID.has(id), id).toBe(true);
      expect(art.src).toBe(`/adversary-art/${id}.webp`);
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
    expect(perBook).toEqual(ADVERSARY_ART_COUNT);
  });

  it("credits the book page the art came from", () => {
    for (const [id, art] of entries) {
      const prefix = BY_ID.get(id)!.source === "core" ? "CB" : "HF";
      expect(art.credit, id).toMatch(new RegExp(`^${prefix} p\\.\\d+$`));
    }
  });

  it("keeps the total image weight under 15 MB", () => {
    const total = entries.reduce((sum, [, art]) => sum + statSync(join(PUBLIC, art.src)).size, 0);
    expect(total).toBeLessThan(15 * 1024 * 1024);
  });

  it("adversaryArt returns the entry, or undefined for no art and no id", () => {
    expect(adversaryArt("acid-burrower")).toBe(ADVERSARY_ART["acid-burrower"]);
    expect(adversaryArt("bear")).toBeUndefined();
    expect(adversaryArt(undefined)).toBeUndefined();
  });
});
