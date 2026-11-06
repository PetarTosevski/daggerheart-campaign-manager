/**
 * UI state on the account (plan config U6e, Q15 b): `useUiState(key)` reads `uiState.get` (defaults while loading) and
 * writes `uiState.set({ change: { key, value } })` with `uiStateLocally`; the Names switch, range circles, catalogue
 * sorts and roll-panel folds use it; nothing touches localStorage; a refused write shows a HUD toast.
 */
import { act, renderHook } from "@testing-library/react";
import type { OptimisticLocalStore } from "convex/browser";
import { ConvexError } from "convex/values";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hudToasts } from "@/components/combat-map/hud/toasts/store";
import { useShowNames } from "@/components/combat-map/map-view/controls";
import { toggledRings, useRings } from "@/components/combat-map/tokens/rings";
import { RANGE_RINGS_MAX, UI_STATE_DEFAULTS, UI_STATE_KEYS, type UiState, type UiStateKey } from "@/lib/config/preferences";
import { uiStateLocally, useUiState } from "@/lib/use-ui-state";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const state = vi.hoisted(() => ({
  ui: undefined as unknown,
  calls: [] as { name: string; args: unknown }[],
  optimistic: null as unknown,
  fail: null as unknown,
  queryArgs: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    state.queryArgs.push({ name: functionName(ref), args });
    return state.ui;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: unknown) => {
      state.calls.push({ name, args });
      if (state.fail) throw state.fail;
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (update: unknown) => {
        state.optimistic = update;
        return run;
      },
    });
  },
}));

afterEach(() => {
  state.ui = undefined;
  state.calls.length = 0;
  state.optimistic = null;
  state.fail = null;
  state.queryArgs.length = 0;
  hudToasts.reset();
  vi.restoreAllMocks();
});

const saved = (over: Partial<UiState>): UiState => ({ ...UI_STATE_DEFAULTS, rangeRings: [], ...over });

/** A value per key that differs from its default. */
const OTHER: UiState = {
  tokenNames: true,
  rangeRings: ["t1", "t2"],
  adversarySort: "book",
  environmentSort: "book",
  rollFeedCollapsed: true,
  gmRollFormCollapsed: true,
  freeRollFormOpen: true,
};

function fakeStore(initial: UiState | undefined) {
  let value = initial;
  const store = {
    getQuery: (ref: unknown, args: unknown) => {
      expect(functionName(ref)).toBe("uiState:get");
      expect(args).toEqual({});
      return value;
    },
    setQuery: (ref: unknown, args: unknown, next: UiState) => {
      expect(functionName(ref)).toBe("uiState:get");
      expect(args).toEqual({});
      value = next;
    },
  } as unknown as OptimisticLocalStore;
  return { store, read: () => value };
}

describe("uiStateLocally (set's optimistic update)", () => {
  it("sets only the changed key", () => {
    const s = fakeStore(saved({ adversarySort: "book" }));
    uiStateLocally(s.store, { change: { key: "tokenNames", value: true } });
    expect(s.read()).toEqual(saved({ adversarySort: "book", tokenNames: true }));
  });

  it("does nothing while the state hasn't loaded", () => {
    const s = fakeStore(undefined);
    uiStateLocally(s.store, { change: { key: "tokenNames", value: true } });
    expect(s.read()).toBeUndefined();
  });
});

describe("useUiState, every key", () => {
  it.each(UI_STATE_KEYS)("%s: the default while loading, the account's value once loaded, writes one key", async (key: UiStateKey) => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { result, rerender } = renderHook(() => useUiState(key));
    expect(result.current[0]).toEqual(UI_STATE_DEFAULTS[key]);
    expect(state.queryArgs).toContainEqual({ name: "uiState:get", args: {} });
    state.ui = saved({ [key]: OTHER[key] });
    rerender();
    expect(result.current[0]).toEqual(OTHER[key]);
    await act(async () => result.current[1](UI_STATE_DEFAULTS[key] as never));
    expect(state.calls).toEqual([{ name: "uiState:set", args: { change: { key, value: UI_STATE_DEFAULTS[key] } } }]);
    expect(state.optimistic).toBe(uiStateLocally);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("a refused write shows a HUD toast instead of an unhandled rejection", async () => {
    state.ui = saved({});
    state.fail = new ConvexError({ code: "INVALID" });
    const { result } = renderHook(() => useUiState("tokenNames"));
    await act(async () => {
      result.current[1](true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hudToasts.get()).toHaveLength(1);
  });
});

describe("Names switch (tokenNames)", () => {
  it("reads and writes the account key", async () => {
    state.ui = saved({ tokenNames: true });
    const { result } = renderHook(() => useShowNames());
    expect(result.current[0]).toBe(true);
    await act(async () => result.current[1](false));
    expect(state.calls).toEqual([{ name: "uiState:set", args: { change: { key: "tokenNames", value: false } } }]);
  });
});

describe("range circles (rangeRings)", () => {
  it("toggledRings adds as the newest, removes when on, and keeps at most RANGE_RINGS_MAX (oldest dropped)", () => {
    expect(toggledRings(["a"], "b")).toEqual(["a", "b"]);
    expect(toggledRings(["a", "b"], "a")).toEqual(["b"]);
    const full = Array.from({ length: RANGE_RINGS_MAX }, (_, i) => `t${i}`);
    const next = toggledRings(full, "new");
    expect(next).toHaveLength(RANGE_RINGS_MAX);
    expect(next[0]).toBe("t1");
    expect(next.at(-1)).toBe("new");
  });

  it("useRings reads the account list, toggles and hides all with whole-list writes", async () => {
    state.ui = saved({ rangeRings: ["a", "b"] });
    const { result } = renderHook(() => useRings());
    expect(result.current.on("a")).toBe(true);
    expect(result.current.on("c")).toBe(false);
    await act(async () => result.current.toggle("c"));
    await act(async () => result.current.toggle("a"));
    await act(async () => result.current.hideAll(["a", "b", "z"]));
    expect(state.calls.map((c) => c.args)).toEqual([
      { change: { key: "rangeRings", value: ["a", "b", "c"] } },
      { change: { key: "rangeRings", value: ["b"] } },
      { change: { key: "rangeRings", value: [] } },
    ]);
  });

  it("hideAll writes nothing when none of the tokens shows circles; none while loading", async () => {
    const { result } = renderHook(() => useRings());
    expect(result.current.on("a")).toBe(false);
    await act(async () => result.current.hideAll(["a"]));
    expect(state.calls).toEqual([]);
  });
});

describe("no browser storage is left in the moved files", () => {
  const files = [
    "src/components/combat-map/map-view/controls.ts",
    "src/components/combat-map/tokens/rings.ts",
    "src/components/adversaries/catalogue/index.tsx",
    "src/components/adversaries/environments/index.tsx",
    "src/components/party/dice/roll-feed.tsx",
    "src/lib/use-ui-state.ts",
  ];
  it.each(files)("%s", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});
