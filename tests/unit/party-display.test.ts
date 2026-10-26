import { describe, expect, it } from "vitest";

import {
  applyResourceDelta,
  classLines,
  domainBanner,
  fitWithin,
  heritageLine,
  ownerLabel,
  portraitSource,
  resourceTiles,
  segments,
} from "@/components/party/party-display";
import { PORTRAITS } from "@/lib/srd";

const tracks = { hp: 0, hpMax: 6, stress: 0, stressMax: 6, hope: 2, scars: 0 };
const ident = {
  name: "brannoc",
  classId: "warrior",
  subclassId: "call-of-the-brave",
  level: 1,
  ancestry: { kind: "single" as const, id: "dwarf" },
  communityId: "ridgeborne",
};

describe("resource tiles", () => {
  it("shows marked HP and Stress, and Hope out of 6 minus scars", () => {
    const [hp, stress, hope] = resourceTiles({ ...tracks, hp: 2, stress: 6, hope: 5, scars: 2 });
    expect(hp).toMatchObject({ value: 2, max: 6, hint: "marked" });
    expect(stress).toMatchObject({ value: 6, max: 6, hint: "Breaking" });
    expect(hope).toMatchObject({ value: 4, max: 4, broken: 2, hint: "2 scars" });
  });

  it("says Down when every Hit Point is marked", () => {
    expect(resourceTiles({ ...tracks, hp: 6 })[0].hint).toBe("Down");
  });

  it("draws scars as broken segments after the Hope slots", () => {
    expect(segments(2, 4, 2)).toEqual(["on", "on", "off", "off", "broken", "broken"]);
  });
});

describe("applyResourceDelta (mirrors adjustResource)", () => {
  it("clamps HP to its slots", () => {
    expect(applyResourceDelta({ ...tracks, hp: 6 }, "hp", 1).hp).toBe(6);
    expect(applyResourceDelta(tracks, "hp", -1).hp).toBe(0);
  });

  it("marks one Hit Point when Stress overflows", () => {
    expect(applyResourceDelta({ ...tracks, stress: 6 }, "stress", 1)).toMatchObject({ stress: 6, hp: 1 });
  });

  it("caps Hope at 6 minus scars, and a new scar drops excess Hope", () => {
    expect(applyResourceDelta({ ...tracks, hope: 5, scars: 1 }, "hope", 1).hope).toBe(5);
    expect(applyResourceDelta({ ...tracks, hope: 6 }, "scars", 1)).toMatchObject({ scars: 1, hope: 5 });
  });
});

describe("identity lines", () => {
  it("builds the heritage and class lines", () => {
    expect(heritageLine(ident)).toBe("Dwarf · Ridgeborne");
    expect(classLines(ident)).toEqual({ line: "Dwarf Warrior · Level 1", sub: "Call of the Brave · Ridgeborne" });
  });

  it("names a mixed ancestry by its chosen name or both halves", () => {
    expect(heritageLine({ ...ident, ancestry: { kind: "mixed", first: "elf", second: "human", name: "" } })).toBe("Elf/Human · Ridgeborne");
    expect(heritageLine({ ...ident, ancestry: { kind: "mixed", first: "elf", second: "human", name: "Half-elf" } })).toBe("Half-elf · Ridgeborne");
  });

  it("paints the banner in the class's two domain colours", () => {
    expect(domainBanner(["blade", "bone"])).toContain("linear-gradient(100deg, #a3262a 0%, #a3262a 34%, #6b6560 66%");
  });
});

describe("portraitSource", () => {
  it("prefers an upload, then a chosen asset", () => {
    expect(portraitSource({ ...ident, portrait: { kind: "upload", storageId: "s1" } })).toEqual({ kind: "upload", storageId: "s1" });
    expect(portraitSource({ ...ident, portrait: { kind: "asset", asset: "a".repeat(32) } })).toMatchObject({ kind: "asset", asset: "a".repeat(32) });
  });

  it("falls back to the subclass art, then the ancestry art, then the initial", () => {
    const sub = PORTRAITS["sub-call-of-the-brave"];
    if (sub) expect(portraitSource(ident)).toMatchObject({ kind: "asset", asset: sub.asset });
    expect(portraitSource({ ...ident, subclassId: "none" })).toMatchObject({ kind: "asset", asset: PORTRAITS["anc-dwarf"].asset });
    expect(portraitSource({ ...ident, subclassId: "none", ancestry: { kind: "single", id: "none" } })).toEqual({ kind: "initial", letter: "B" });
  });
});

describe("ownerLabel", () => {
  const table = { gm: { userId: "gm", name: "Gail" }, players: [{ userId: "p1", name: "Pia" }] };

  it("labels GM-held characters Unassigned, the viewer's own Yours, others by name", () => {
    expect(ownerLabel({ ownerId: "gm", mine: true }, table)).toBe("Unassigned");
    expect(ownerLabel({ ownerId: "p1", mine: true }, table)).toBe("Yours");
    expect(ownerLabel({ ownerId: "p1", mine: false }, table)).toBe("Pia");
    expect(ownerLabel({ ownerId: "gone", mine: false }, table)).toBe("Former player");
  });
});

describe("fitWithin", () => {
  it("shrinks the longer side to the limit and never enlarges", () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(600, 2048, 1024)).toEqual({ width: 300, height: 1024 });
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });
});
