/**
 * Plan lanes-2 wave 9, AO (dcm-lqnt): the area-effect kind table (label -> kind, draw mode), the generated manifest
 * against the files under public/area-effects, the overlay's geometry, the point-area detection of the drawer's Use and
 * the pick store. Expected kinds come from .omc/plans/aoe-sprites.md; ranges from CB p.103 (Melee 1, Very Close 3,
 * Close 6, Far 12 squares).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { areaArt, AREA_FILE, AREA_KINDS, AREA_MANIFEST, areaKindOf, kindStyle, type AreaManifest } from "../../src/lib/combat-map/area-effects";
import { areaGeometry } from "../../src/components/combat-map/map-view/area-overlay";
import { cancelAreaPick, finishAreaPick, squareAt, startAreaPick, useAreaPick } from "../../src/components/combat-map/map-view/area-pick";
import { areaUseLine, pointAreaOf, serverUseOf } from "../../src/components/combat-map/drawer/use/model";
import type { CardUse } from "../../src/lib/domain/card-effects/types";
import { featureId } from "../../src/lib/domain/feature-effects/ids";

const ROOT = resolve(__dirname, "../..");
const PUBLIC = join(ROOT, "public/area-effects");

describe("area kinds (kinds.ts)", () => {
  it("maps the book's effect labels to their art", () => {
    expect(areaKindOf("Dark Cloud", "circle")).toBe("darkness");
    expect(areaKindOf("Cloud of darkness", "circle")).toBe("darkness");
    expect(areaKindOf("Mysterious Mist", "circle")).toBe("fog");
    expect(areaKindOf("Ink", "circle")).toBe("ink");
    expect(areaKindOf("Hush", "circle")).toBe("silence");
    expect(areaKindOf("Circle of Power", "circle")).toBe("radiant-circle");
    expect(areaKindOf("Moonbeam", "circle")).toBe("moonlight");
    expect(areaKindOf("Rejuvenation Barrier", "circle")).toBe("healing-barrier");
    expect(areaKindOf("Rune Circle", "circle")).toBe("rune-circle");
    expect(areaKindOf("Elemental Aura (Fire)", "circle")).toBe("aura-fire");
    expect(areaKindOf("Elemental Aura (Air)", "circle")).toBe("aura-air");
    expect(areaKindOf("Acidic blood", "circle")).toBe("acid");
    expect(areaKindOf("Suppressing Fire", "circle")).toBe("suppressing-fire");
    expect(areaKindOf("Tangle Bramble Swarm", "circle")).toBe("brambles");
    expect(areaKindOf("Wild Fortress", "circle")).toBe("fortress");
    expect(areaKindOf("Hurricane", "circle")).toBe("storm-hurricane");
    expect(areaKindOf("Wall of Flame", "wall")).toBe("fire-wall");
    expect(areaKindOf("Manifest Wall", "wall")).toBe("force-wall");
    expect(areaKindOf("Wall of Hunger", "wall")).toBe("hunger-wall");
  });

  it("only gives a wall a wall kind and a circle a circle kind; anything else is generic", () => {
    expect(areaKindOf("Veil of Night", "wall")).toBe("shadow-line");
    expect(areaKindOf("Veil of Night", "circle")).toBe("darkness");
    expect(areaKindOf("Wall of Flame", "circle")).toBe("generic");
    expect(areaKindOf("Dark Cloud", "wall")).toBe("generic");
    expect(areaKindOf("Something new", "circle")).toBe("generic");
  });

  it("draws fills tiled and see-through, the swirl fills scaled, moonlight and silence faint, walls along the line", () => {
    expect(kindStyle("darkness")).toEqual({ mode: "tile", opacity: 0.6 });
    for (const k of ["aura-earth", "aura-air", "ink"] as const) expect(kindStyle(k).mode).toBe("scale");
    expect(kindStyle("moonlight")).toEqual({ mode: "decal", opacity: 0.45 });
    expect(kindStyle("silence")).toEqual({ mode: "decal", opacity: 0.45 });
    expect(kindStyle("rune-circle")).toEqual({ mode: "decal", opacity: 1 });
    expect(kindStyle("fire-wall").mode).toBe("wall");
  });

  it("falls back to generic art for a kind without a file, and to no image for a wall without art", () => {
    const manifest: AreaManifest = { schemaVersion: 1, kinds: { generic: { file: "generic.0123abcd.webp", px: { w: 512, h: 512 } } } };
    expect(areaArt("Dark Cloud", "circle", manifest)).toMatchObject({ kind: "darkness", drawn: "generic", url: "/area-effects/generic.0123abcd.webp", mode: "tile" });
    expect(areaArt("Rope bridge", "wall", manifest)).toMatchObject({ drawn: "generic", url: null, mode: "wall" });
    expect(areaArt("Fog", "circle", { schemaVersion: 1, kinds: {} })).toMatchObject({ url: null });
  });
});

describe("the generated manifest (pnpm sprites:areas)", () => {
  it("has every kind, each a hashed file under public/area-effects within its budget", () => {
    for (const kind of AREA_KINDS) {
      const e = AREA_MANIFEST.kinds[kind];
      expect(e, kind).toBeDefined();
      expect(e!.file).toMatch(AREA_FILE);
      expect(e!.file.startsWith(`${kind}.`)).toBe(true);
      const path = join(PUBLIC, e!.file);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeLessThanOrEqual(200 * 1024);
    }
  });

  it("public/area-effects holds no file the manifest does not name", () => {
    const named = new Set(Object.values(AREA_MANIFEST.kinds).map((e) => e.file));
    expect(readdirSync(PUBLIC).filter((f) => !named.has(f))).toEqual([]);
  });

  it("no raw sheet is tracked", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
    expect(tracked.filter((f) => /(^|\/)(fills-\d|decals|walls)\.(jpe?g|png)$/.test(f))).toEqual([]);
  });
});

describe("area geometry on the board (area-overlay.tsx)", () => {
  it("a square-centred circle reaches its range plus half a square (CB p.103: Close = 6)", () => {
    expect(areaGeometry({ shape: "circle", centre: { kind: "square", x: 6, y: 10 }, radius: "close" }, [], 30)).toEqual({ shape: "circle", cx: 6.5, cy: 10.5, r: 6.5 });
  });

  it("a token-centred circle follows its token's footprint; a token out of view draws nothing", () => {
    const tokens = [{ _id: "t1" as never, x: 2, y: 3, size: 2 }];
    expect(areaGeometry({ shape: "circle", centre: { kind: "token", tokenId: "t1" as never }, radius: "veryClose" }, tokens, 30)).toEqual({ shape: "circle", cx: 3, cy: 4, r: 4 });
    expect(areaGeometry({ shape: "circle", centre: { kind: "token", tokenId: "t2" as never }, radius: "veryClose" }, tokens, 30)).toBeNull();
  });

  it("a wall runs between its end squares' centres; Very Far covers the map", () => {
    expect(areaGeometry({ shape: "wall", centre: { kind: "square", x: 4, y: 4 }, radius: "melee", wall: { a: [4, 4], b: [4, 8] } }, [], 30)).toEqual({ shape: "wall", ax: 4.5, ay: 4.5, bx: 4.5, by: 8.5 });
    expect(areaGeometry({ shape: "circle", centre: { kind: "square", x: 0, y: 0 }, radius: "veryFar" }, [], 30)).toMatchObject({ r: 30.5 });
  });
});

describe("point areas in the drawer (drawer/use/model.ts)", () => {
  it("Dark Cloud is a point area to pick (CB p.42: a point within Close range)", () => {
    const server = serverUseOf(featureId("subclass", "nightwalker", "Dark Cloud"), "main");
    expect(server).toMatchObject({ kind: "area", name: "Dark Cloud", area: { label: "Dark Cloud", centre: "point", placeWithin: "close" } });
  });

  it("a targeted use, a self-centred area and a wall are not", () => {
    const area = (a: object): CardUse => ({ id: "main", name: "X", activation: { kind: "action" }, steps: [{ kind: "area", to: "self", area: { label: "X", radius: "close", side: "all", duration: "scene", ...a } }] }) as unknown as CardUse;
    expect(pointAreaOf(area({ centre: "self" }))).toBeNull();
    expect(pointAreaOf(area({ centre: "point", shape: "wall" }))).toBeNull();
    expect(pointAreaOf({ ...area({ centre: "point" }), targets: { side: "enemies", range: "close", count: { kind: "exactly", n: 1 } } } as unknown as CardUse)).toBeNull();
    expect(pointAreaOf(area({ centre: "point" }))).toMatchObject({ label: "X" });
  });

  it("says what the use did", () => {
    expect(areaUseLine("Dark Cloud", "Dark Cloud", { status: "resolved", roll: { total: 17 }, success: true, notes: [] })).toBe("Rolled 17: Dark Cloud is on the map.");
    expect(areaUseLine("Dark Cloud", "Dark Cloud", { status: "resolved", roll: { total: 9 }, success: false, notes: [] })).toBe("Rolled 9: Dark Cloud failed.");
    expect(areaUseLine("Dark Cloud", "Dark Cloud", { status: "pending" })).toMatch(/waiting for the GM/);
  });
});

describe("the pick store (area-pick.tsx)", () => {
  it("rounds a stage position down to its square; off the map is null", () => {
    expect(squareAt({ x: 3.7, y: 0.2 }, 10, 10)).toEqual({ x: 3, y: 0 });
    expect(squareAt({ x: -0.1, y: 2 }, 10, 10)).toBeNull();
    expect(squareAt({ x: 10, y: 2 }, 10, 10)).toBeNull();
  });

  it("hands the square to onPick, shows its line and ends; a chained pick keeps running; Cancel ends it", async () => {
    const { act, renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => useAreaPick());
    const onPick = vi.fn(async () => "Dark Cloud is on the map.");
    startAreaPick({ prompt: "Pick", mapId: "m", onPick });
    await act(() => finishAreaPick({ x: 2, y: 3 }));
    expect(onPick).toHaveBeenCalledWith({ x: 2, y: 3 });
    expect(result.current.request).toBeNull();
    expect(result.current.line).toEqual({ text: "Dark Cloud is on the map.", error: false });

    const second = vi.fn(async () => "done");
    startAreaPick({ prompt: "First end", mapId: "m", onPick: async () => (startAreaPick({ prompt: "Second end", mapId: "m", onPick: second }), null) });
    await act(() => finishAreaPick({ x: 1, y: 1 }));
    expect(result.current.request?.prompt).toBe("Second end");
    act(() => cancelAreaPick());
    expect(result.current.request).toBeNull();

    startAreaPick({ prompt: "Pick", mapId: "m", onPick: async () => Promise.reject(new Error("too far")) });
    await act(() => finishAreaPick({ x: 0, y: 0 }));
    expect(result.current.line?.error).toBe(true);
  });
});
