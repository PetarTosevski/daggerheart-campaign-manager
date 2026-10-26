/**
 * Players read PC tokens from `combatVision.playerView.pcs` (dcm-bxp.53): `useTokens` picks the source by role and
 * view state, and `patchTokens` (the optimistic token writes) also rewrites the character views' `pcs`.
 */
import { renderHook } from "@testing-library/react";
import type { OptimisticLocalStore } from "convex/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { patchTokens, useTokens, type TokenView } from "@/components/combat-map/tokens/use-tokens";

import type { Id } from "../../convex/_generated/dataModel";

const subscribed: string[] = [];
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = functionName(ref);
    subscribed.push(name);
    return queries[name];
  },
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

afterEach(() => {
  subscribed.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
});

const campaignId = "c1" as Id<"campaigns">;
const mapId = "m1" as Id<"combatMaps">;
const token = (id: string, x = 0): TokenView =>
  ({ _id: id as Id<"combatTokens">, kind: "pc", name: id, side: "pc", x, y: 0, size: 1, face: 0, light: "none", sub: "", portrait: null, canMove: true, mine: false, stats: null }) as TokenView;
const okView = (pcs: TokenView[], map: string = mapId) => ({ state: "ok", mapId: map, pcs, others: [] });

describe("useTokens (dcm-bxp.53)", () => {
  it("gives a player the PC tokens of their character's view, with one subscription", () => {
    const pcs = [token("ash"), token("bryn")];
    queries["combatVision:playerView"] = okView(pcs);
    queries["combatTokens:party"] = [token("stale")];
    const { result } = renderHook(() => useTokens(campaignId, "player", mapId));
    expect(result.current).toBe(pcs);
    expect(new Set(subscribed)).toEqual(new Set(["combatVision:playerView"]));
  });

  it("is loading while the view loads, and reads the party list only when the view has no PC tokens", () => {
    const { result, rerender } = renderHook(() => useTokens(campaignId, "player", mapId));
    expect(result.current).toBeUndefined();
    expect(subscribed).not.toContain("combatTokens:party");

    const party = [token("ash")];
    queries["combatTokens:party"] = party;
    queries["combatVision:playerView"] = { state: "noCharacter", mapId };
    rerender();
    expect(result.current).toBe(party);

    queries["combatVision:playerView"] = okView([token("other")], "m2");
    rerender();
    expect(result.current).toBe(party);
  });

  it("gives the GM every token from combatTokens.list and never the player view", () => {
    const list = [token("ash"), token("goblin")];
    queries["combatTokens:list"] = list;
    const { result } = renderHook(() => useTokens(campaignId, "gm", mapId));
    expect(result.current).toBe(list);
    expect(new Set(subscribed)).toEqual(new Set(["combatTokens:list"]));
  });
});

describe("patchTokens (dcm-bxp.53)", () => {
  it("rewrites the matching token in the token lists and in the character views' pcs", () => {
    const entries: Record<string, { args: Record<string, unknown>; value: unknown }[]> = {
      "combatTokens:list": [{ args: { mapId }, value: [token("ash"), token("goblin")] }],
      "combatTokens:party": [{ args: { mapId }, value: [token("bryn")] }],
      "combatVision:playerView": [{ args: { campaignId }, value: okView([token("ash"), token("bryn")]) }],
      "combatVision:previewAs": [{ args: { characterId: "x" }, value: { state: "noCharacter", mapId } }],
    };
    const set: { name: string; value: unknown }[] = [];
    const store = {
      getAllQueries: (ref: unknown) => entries[functionName(ref)] ?? [],
      setQuery: (ref: unknown, _args: unknown, value: unknown) => set.push({ name: functionName(ref), value }),
    } as unknown as OptimisticLocalStore;

    patchTokens(store, (t) => t._id === "ash", (t) => ({ ...t, x: 7 }));

    expect(set.map((s) => s.name).sort()).toEqual(["combatTokens:list", "combatVision:playerView"]);
    const list = set.find((s) => s.name === "combatTokens:list")!.value as TokenView[];
    expect(list.map((t) => [t._id, t.x])).toEqual([["ash", 7], ["goblin", 0]]);
    const view = set.find((s) => s.name === "combatVision:playerView")!.value as ReturnType<typeof okView>;
    expect(view.pcs.map((t) => [t._id, t.x])).toEqual([["ash", 7], ["bryn", 0]]);
    expect(view.state).toBe("ok");
  });
});
