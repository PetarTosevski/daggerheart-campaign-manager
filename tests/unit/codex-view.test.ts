import { describe, expect, it } from "vitest";

import { checkGroups, codexEntryDataSchema, codexPatchSchema, emptyEntry, factionsFor, regionsFor } from "@/lib/codex/schema";
import { seedCharacters } from "@/lib/codex/seed";
import {
  allegianceNote,
  coverOf,
  groupBadgeColors,
  groupOf,
  matchesSearch,
  previewForPlayers,
  regionAt,
  regionOf,
  toPlayerEntry,
  unknownGroupLabel,
  type GmEntry,
} from "@/lib/codex/view";
import { PUBLISHED_FRAME_IDS } from "@/lib/frames";

describe("codex schema", () => {
  it("accepts an empty entry and bounds every field", () => {
    expect(codexEntryDataSchema.parse(emptyEntry())).toEqual(emptyEntry());
    expect(codexEntryDataSchema.safeParse(emptyEntry({ name: "x".repeat(121) })).success).toBe(false);
    expect(codexEntryDataSchema.safeParse(emptyEntry({ pdesc: "x".repeat(8001) })).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ storageId: `s${i}`, shown: false }));
    expect(codexEntryDataSchema.safeParse(emptyEntry({ images: nine })).success).toBe(false);
    expect(codexEntryDataSchema.safeParse(emptyEntry({ tokenId: 0 })).success).toBe(false);
  });

  it("patches only editable fields", () => {
    expect(codexPatchSchema.parse({ name: "A", known: true })).toEqual({ name: "A", known: true });
    expect(codexPatchSchema.safeParse({ images: [] }).success).toBe(false);
    expect(codexPatchSchema.safeParse({ tokenId: 1 }).success).toBe(false);
  });

  it("allegiances and regions come from the frame", () => {
    expect(factionsFor("witherwild")).toEqual(["Haven", "Fanewick", "Neutral"]);
    expect(factionsFor("beast-feast")).toEqual(["Allies", "Enemies", "Neutral"]);
    expect(regionsFor("witherwild")).toEqual(["Haven", "Colonies", "Fanewick"]);
    expect(regionsFor("custom")).toEqual([]);
    expect(checkGroups("witherwild", { allegiance: "Haven", allegianceShown: "unknown", region: "" })).toBeNull();
    expect(checkGroups("witherwild", { allegiance: "Allies", allegianceShown: "unknown", region: "" })).toMatch(/allegiance/);
    expect(checkGroups("beast-feast", { allegiance: "", allegianceShown: "Enemies", region: "Haven" })).toMatch(/region/);
  });

  it("seeds characters for every published frame, with valid allegiances", () => {
    for (const frame of PUBLISHED_FRAME_IDS) {
      const seeds = seedCharacters(frame);
      expect(seeds.length).toBeGreaterThan(0);
      for (const s of seeds) expect(checkGroups(frame, { allegiance: s.allegiance ?? "", allegianceShown: "unknown", region: "" })).toBeNull();
    }
    expect(seedCharacters("custom")).toEqual([]);
  });
});

describe("codex regions", () => {
  it("places Witherwild map positions in Haven, the Colonies or Fanewick", () => {
    expect(regionAt("witherwild", 55, 40)).toBe("Haven");
    expect(regionAt("witherwild", 70, 20)).toBe("Colonies");
    expect(regionAt("witherwild", 10, 80)).toBe("Fanewick");
    expect(regionAt("beast-feast", 55, 40)).toBe("");
  });

  it("a pin sets the region automatically; otherwise the hand-picked one", () => {
    expect(regionOf("witherwild", { region: "Fanewick" }, { x: 55, y: 40 })).toEqual({ region: "Haven", auto: true });
    expect(regionOf("witherwild", { region: "Fanewick" }, null)).toEqual({ region: "Fanewick", auto: false });
    expect(regionOf("beast-feast", { region: "" }, { x: 55, y: 40 })).toEqual({ region: "", auto: false });
  });
});

describe("codex player view", () => {
  const images = [
    { storageId: "a", shown: false, url: "u-a" },
    { storageId: "b", shown: true, url: "u-b" },
  ];
  const base = {
    _id: "e1",
    kind: "character" as const,
    createdAt: 1,
    data: { name: "Kreil", known: true, pdesc: "Quiet.", allegianceShown: "Haven", region: "", cover: "a" },
    images,
  };

  it("hides unknown entries", () => {
    expect(toPlayerEntry("witherwild", { ...base, data: { ...base.data, known: false } }, null)).toBeNull();
  });

  it("keeps only public fields and revealed images; the cover falls back to a revealed one", () => {
    const view = toPlayerEntry("witherwild", base, null)!;
    expect(view).toEqual({
      _id: "e1",
      kind: "character",
      name: "Kreil",
      pdesc: "Quiet.",
      allegianceShown: "Haven",
      region: "",
      tokenId: null,
      // Opaque per-entry keys, never storage ids.
      images: [{ key: "0", url: "u-b" }],
      cover: "0",
      createdAt: 1,
    });
  });

  it("locations get a region; the pin only when visible", () => {
    const loc = { ...base, kind: "location" as const, data: { ...base.data, region: "Colonies" } };
    expect(toPlayerEntry("witherwild", loc, { id: 4, x: 55, y: 40 })).toMatchObject({ tokenId: 4, region: "Haven", allegianceShown: "unknown" });
    expect(toPlayerEntry("witherwild", loc, null)).toMatchObject({ tokenId: null, region: "Colonies" });
  });

  it("the GM preview drops hidden pins", () => {
    const gm: GmEntry = {
      _id: "e2",
      kind: "location",
      name: "Gate",
      role: "Ruin",
      known: true,
      pdesc: "",
      gmn: "secret",
      allegiance: "",
      allegianceShown: "unknown",
      region: "Haven",
      regionAuto: true,
      tokenId: 3,
      images: [],
      cover: null,
      createdAt: 0,
    };
    expect(previewForPlayers("witherwild", gm, [{ id: 3, x: 55, y: 40, hidden: true }])).toMatchObject({ tokenId: null, region: "Haven" });
    expect(previewForPlayers("witherwild", gm, [{ id: 3, x: 55, y: 40, hidden: false }])).toMatchObject({ tokenId: 3 });
    expect(JSON.stringify(previewForPlayers("witherwild", gm, []))).not.toContain("secret");
  });
});

describe("codex display helpers", () => {
  it("groups by allegiance (true for the GM, shown for players) or region", () => {
    const c = { kind: "character" as const, region: "", allegiance: "Fanewick", allegianceShown: "Haven" };
    expect(groupOf(c, true)).toBe("Fanewick");
    expect(groupOf(c, false)).toBe("Haven");
    expect(groupOf({ ...c, allegianceShown: "unknown" }, false)).toBe("");
    expect(groupOf({ ...c, kind: "location", region: "Colonies" }, true)).toBe("Colonies");
    expect(unknownGroupLabel("character", true)).toBe("Unassigned");
    expect(unknownGroupLabel("character", false)).toBe("Allegiance unknown");
    expect(unknownGroupLabel("location", true)).toBe("Unsorted");
  });

  it("notes, badges, covers and search", () => {
    expect(allegianceNote("", "unknown")).toBe("");
    expect(allegianceNote("Haven", "Haven")).toBe("Players know the truth.");
    expect(allegianceNote("Haven", "unknown")).toMatch(/don’t know/);
    expect(allegianceNote("Haven", "Fanewick")).toBe("Players believe a cover story.");
    expect(groupBadgeColors("Haven")).toEqual({ background: "#1d2a3f", color: "#a9c6ff" });
    expect(groupBadgeColors("Allies")).toEqual({ background: "#2a1f24", color: "#e0a3b0" });
    expect(coverOf("x", [{ storageId: "a" }])).toBe("a");
    expect(coverOf(null, [])).toBeNull();
    expect(matchesSearch({ name: "Kreil Dirn", role: "Spymaster" }, "spy")).toBe(true);
    expect(matchesSearch({ name: "Kreil Dirn" }, "  ")).toBe(true);
    expect(matchesSearch({ name: "Kreil Dirn" }, "owl")).toBe(false);
  });
});
