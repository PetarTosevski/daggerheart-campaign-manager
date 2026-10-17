import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseOrCorrupt, readVersioned } from "../../convex/lib/blobs";

function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { code: string }).code;
    throw error;
  }
  return "no error";
}

const v1 = z.object({ name: z.string() });
const v2 = z.object({ schemaVersion: z.literal(2), name: z.string(), tags: z.array(z.string()) });
const v3 = z.object({ schemaVersion: z.literal(3), title: z.string(), tags: z.array(z.string()) });

const versions = {
  1: { schema: v1, upgrade: (old: z.output<typeof v1>) => ({ schemaVersion: 2, name: old.name, tags: [] }) },
  2: { schema: v2, upgrade: (old: z.output<typeof v2>) => ({ schemaVersion: 3, title: old.name, tags: old.tags }) },
  3: { schema: v3 },
};

describe("parseOrCorrupt", () => {
  it("returns the parsed value", () => {
    expect(parseOrCorrupt(v1, { name: "Ash" }, "MAP_CORRUPT")).toEqual({ name: "Ash" });
  });

  it("throws the given code instead of a ZodError", () => {
    expect(codeOf(() => parseOrCorrupt(v1, { name: 7 }, "MAP_CORRUPT"))).toBe("MAP_CORRUPT");
  });
});

describe("readVersioned", () => {
  it("reads the latest shape as is", () => {
    const doc: { title: string; tags: string[] } = readVersioned(versions, { schemaVersion: 3, title: "Ash", tags: ["a"] }, "CODEX_CORRUPT");
    expect(doc).toEqual({ schemaVersion: 3, title: "Ash", tags: ["a"] });
  });

  it("upgrades an unversioned (version 1) document through every step", () => {
    expect(readVersioned(versions, { name: "Ash" }, "CODEX_CORRUPT")).toEqual({ schemaVersion: 3, title: "Ash", tags: [] });
  });

  it("upgrades a version 2 document", () => {
    expect(readVersioned(versions, { schemaVersion: 2, name: "Ash", tags: ["b"] }, "CODEX_CORRUPT")).toEqual({ schemaVersion: 3, title: "Ash", tags: ["b"] });
  });

  it("throws *_CORRUPT on a bad document of a known version", () => {
    expect(codeOf(() => readVersioned(versions, { schemaVersion: 2, name: "Ash" }, "CODEX_CORRUPT"))).toBe("CODEX_CORRUPT");
    expect(codeOf(() => readVersioned(versions, null, "CODEX_CORRUPT"))).toBe("CODEX_CORRUPT");
  });

  it("throws *_CORRUPT on an unknown version", () => {
    expect(codeOf(() => readVersioned(versions, { schemaVersion: 4, title: "Ash", tags: [] }, "MAP_CORRUPT"))).toBe("MAP_CORRUPT");
    expect(codeOf(() => readVersioned(versions, { schemaVersion: "3", title: "Ash", tags: [] }, "MAP_CORRUPT"))).toBe("MAP_CORRUPT");
  });

  it("throws *_CORRUPT when an upgrade produces a bad shape", () => {
    const broken = { 1: { schema: v1, upgrade: () => ({ schemaVersion: 2 }) }, 2: { schema: v2 } };
    expect(codeOf(() => readVersioned(broken, { name: "Ash" }, "MAP_CORRUPT"))).toBe("MAP_CORRUPT");
  });
});
