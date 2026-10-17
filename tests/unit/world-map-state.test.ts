import { describe, expect, it } from "vitest";

import { MAX_MAP_JSON_BYTES, checkMapState, initialMapState, playerMapView, type MapToken } from "@/lib/world/map-state";

const token = (id: number, over: Partial<MapToken> = {}): MapToken => ({ id, type: "village", x: 1, y: 1, name: "", notes: "", hidden: false, location: false, ...over });

describe("map size budget", () => {
  it("counts UTF-8 bytes, not characters", () => {
    // 200 markers × 2000 three-byte characters: 400 000 characters, but 1.2 MB of UTF-8.
    const tokens = Array.from({ length: 200 }, (_, i) => token(i + 1, { notes: "€".repeat(2000) }));
    const state = { ...initialMapState("witherwild"), tokens, nextId: 201 };
    expect(JSON.stringify(state).length).toBeLessThan(MAX_MAP_JSON_BYTES);
    expect(checkMapState(state)).toEqual({ ok: false, message: "The map is too large. Shorten some notes or remove markers." });

    const ascii = { ...state, tokens: tokens.map((t) => ({ ...t, notes: "e".repeat(2000) })) };
    expect(checkMapState(ascii).ok).toBe(true);
  });

  it("reports schema problems without throwing", () => {
    expect(checkMapState({ ...initialMapState("witherwild"), terrain: "xyz" }).ok).toBe(false);
  });
});

describe("player map view", () => {
  it("drops the upload's storage id, the marker counter and types or labels no visible marker uses", () => {
    const state = {
      ...initialMapState("witherwild"),
      tokens: [token(1, { type: "c1" }), token(2, { type: "c2", hidden: true }), token(3, { type: "cave" })],
      nextId: 9,
      customTypes: [
        { id: "c1", label: "Shrine", icon: "temple", color: "#5a2a6a" },
        { id: "c2", label: "Dragon nest", icon: "cave", color: "#5a2a6a" },
      ],
      typeLabels: { cave: "Grotto", city: "Secret capital", c2: "Lair" },
      customMap: { storageId: "kg2abc", width: 800, height: 600 },
    };
    const view = playerMapView(state);
    expect(view.customMap).toEqual({ width: 800, height: 600 });
    expect(view.nextId).toBe(1);
    expect(view.customTypes.map((c) => c.id)).toEqual(["c1"]);
    expect(view.typeLabels).toEqual({ cave: "Grotto" });
    expect(view.options).toEqual(state.options);
    expect(JSON.stringify(view)).not.toMatch(/kg2abc|Dragon nest|Secret capital|Lair/);
  });
});
