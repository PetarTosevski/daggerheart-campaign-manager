/**
 * Plan lanes-2 wave 10, tracer E4.4 (docs/tasks/TASK-LN4-E4.md): the sheet drawer picks two squares for a wall and N for
 * a `count` area (AO follow-up; Wall of Flame, CB p.332: a wall; Forest Sprites, CB p.339: "appear at points you
 * choose"), and the sprite painter's glow follows a sprite object's light override (dcm-bxp.84).
 */
import { describe, expect, it, vi } from "vitest";

import { MAX_AREA_COUNT } from "../../convex/lib/combatAreas";
import { pickSquaresInTurn } from "../../src/components/combat-map/drawer/use";
import { areaUseArgs, MAX_PICKED_SQUARES, pickAreaOf, pickPrompt, squaresToPick } from "../../src/components/combat-map/drawer/use/model";
import { finishAreaPick, useAreaPick } from "../../src/components/combat-map/map-view/area-pick";
import { placeObject } from "../../src/lib/combat-map/sprites/objects";
import type { AreaSpec, CardUse } from "../../src/lib/domain/card-effects/types";
import { renderHook } from "@testing-library/react";

const spec = (a: Partial<AreaSpec>): AreaSpec => ({ label: "X", centre: "point", radius: "veryClose", side: "all", duration: "scene", ...a });
const useOf = (a: Partial<AreaSpec>, extra: Partial<CardUse> = {}): CardUse => ({ id: "main", name: "Use", activation: { kind: "action" }, steps: [{ kind: "area", to: "self", area: spec(a) }], ...extra }) as CardUse;

describe("pickAreaOf: how many squares an area use picks", () => {
  it("one square for a point circle, two for a wall, N for a count area", () => {
    expect(pickAreaOf(useOf({}))?.picks).toEqual({ kind: "one" });
    expect(pickAreaOf(useOf({ shape: "wall", label: "Wall of Flame" }))).toMatchObject({ area: { label: "Wall of Flame" }, picks: { kind: "wall" } });
    expect(pickAreaOf(useOf({ count: { kind: "fixed", value: 3 } }))?.picks).toEqual({ kind: "count", fixed: 3, choice: null });
    expect(pickAreaOf(useOf({ count: { kind: "chosen", choice: "hope" } }))?.picks).toEqual({ kind: "count", fixed: null, choice: "hope" });
    expect(pickAreaOf(useOf({ count: { kind: "fixed", value: 50 } }))?.picks).toEqual({ kind: "count", fixed: MAX_PICKED_SQUARES, choice: null });
  });

  it("nothing for a self-centred area or a targeted use", () => {
    expect(pickAreaOf(useOf({ centre: "self" }))).toBeNull();
    expect(pickAreaOf(useOf({}, { targets: { side: "enemy", range: "close", count: { kind: "one" } } } as Partial<CardUse>))).toBeNull();
  });

  it("the drawer's cap is the server's", () => {
    expect(MAX_PICKED_SQUARES).toBe(MAX_AREA_COUNT);
  });
});

describe("squares, prompts and the useFeature args", () => {
  it("counts the squares to pick", () => {
    expect(squaresToPick({ kind: "one" }, 5)).toBe(1);
    expect(squaresToPick({ kind: "wall" }, 5)).toBe(2);
    expect(squaresToPick({ kind: "count", fixed: 3, choice: null }, 5)).toBe(3);
    expect(squaresToPick({ kind: "count", fixed: null, choice: "hope" }, 4)).toBe(4);
    expect(squaresToPick({ kind: "count", fixed: null, choice: "hope" }, 99)).toBe(MAX_PICKED_SQUARES);
    expect(squaresToPick({ kind: "count", fixed: null, choice: "hope" }, 0)).toBe(1);
  });

  it("names each pick in the banner", () => {
    const wall = spec({ label: "Wall of Flame", shape: "wall" });
    expect(pickPrompt(wall, { kind: "wall" }, 0, 2, " within Far range")).toBe("Pick one end of Wall of Flame within Far range");
    expect(pickPrompt(wall, { kind: "wall" }, 1, 2, "")).toBe("Pick the other end of Wall of Flame");
    expect(pickPrompt(spec({ label: "Sprite" }), { kind: "count", fixed: null, choice: "hope" }, 1, 3, "")).toBe("Pick square 2 of 3 for Sprite");
    expect(pickPrompt(spec({ label: "Dark Cloud" }), { kind: "one" }, 0, 1, "")).toBe("Pick the centre of Dark Cloud");
  });

  it("sends the first square as point, the rest as points, and a chosen count as n:<choice>", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 5, y: 2 };
    const c = { x: 7, y: 9 };
    expect(areaUseArgs({ kind: "one" }, [a])).toEqual({ point: a, choices: [] });
    expect(areaUseArgs({ kind: "wall" }, [a, b])).toEqual({ point: a, points: [b], choices: [] });
    expect(areaUseArgs({ kind: "count", fixed: null, choice: "hope" }, [a, b, c])).toEqual({ point: a, points: [b, c], choices: [{ id: "n:hope", value: 3 }] });
    expect(() => areaUseArgs({ kind: "one" }, [])).toThrow();
  });
});

describe("pickSquaresInTurn: one banner pick after another", () => {
  it("collects the squares in order and sends once, after the last", async () => {
    const onDone = vi.fn(async () => "Wall of Flame is on the map.");
    const { result, rerender } = renderHook(() => useAreaPick());
    pickSquaresInTurn({ mapId: "m", total: 2, prompt: (i) => `pick ${i}`, onDone });
    rerender();
    expect(result.current.request?.prompt).toBe("pick 0");
    await finishAreaPick({ x: 1, y: 1 });
    rerender();
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.request?.prompt).toBe("pick 1");
    await finishAreaPick({ x: 4, y: 1 });
    rerender();
    expect(onDone).toHaveBeenCalledWith([{ x: 1, y: 1 }, { x: 4, y: 1 }]);
    expect(result.current.request).toBeNull();
    expect(result.current.line).toEqual({ text: "Wall of Flame is on the map.", error: false });
  });
});

describe("the sprite painter's glow follows the light override (dcm-bxp.84)", () => {
  const base = { id: "o1", kind: "rock" as const, x: 3, y: 3, r: 0.5, rot: 0, sprite: { builtin: "cave/underground-pool" } };
  it("a dark sprite set to torch glows; a candle cluster set to none does not", () => {
    const uploaded = new Map();
    expect(placeObject(base, "cave", 1, uploaded).art?.light).toBe("none");
    expect(placeObject({ ...base, light: "torch" }, "cave", 1, uploaded).art?.light).toBe("torch");
    const candles = { ...base, kind: "crystal" as const, sprite: { builtin: "dungeon/candle-cluster" } };
    expect(placeObject(candles, "dungeon", 1, uploaded).art?.light).toBe("faintglow");
    expect(placeObject({ ...candles, light: "none" }, "dungeon", 1, uploaded).art?.light).toBe("none");
  });
});
