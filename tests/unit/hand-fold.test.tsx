/**
 * "Hide cards" on the account (plan config U6c, Q15 b): `useHandFold` reads `preferences.folds` and writes
 * `preferences.setFold` with an optimistic update (`foldLocally`); nothing touches localStorage; a refused write shows
 * a HUD toast.
 */
import { act, renderHook } from "@testing-library/react";
import type { OptimisticLocalStore } from "convex/browser";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hudToasts } from "@/components/combat-map/hud/blocked";
import { foldLocally, useHandFold } from "@/components/combat-map/hud/hand/use-fold";

import type { Id } from "../../convex/_generated/dataModel";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const state = vi.hoisted(() => ({
  folds: undefined as unknown,
  calls: [] as { name: string; args: unknown }[],
  optimistic: null as unknown,
  fail: null as unknown,
  queryArgs: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    state.queryArgs.push({ name: functionName(ref), args });
    return state.folds;
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

const CAMPAIGN = "c1" as Id<"campaigns">;
const MOSS = "ch-moss" as Id<"characters">;
const ASH = "ch-ash" as Id<"characters">;

afterEach(() => {
  state.folds = undefined;
  state.calls.length = 0;
  state.optimistic = null;
  state.fail = null;
  state.queryArgs.length = 0;
  for (const t of hudToasts.get()) hudToasts.dismiss(t.id);
  window.localStorage.clear();
});

/** A one-query optimistic store holding `preferences.folds` for CAMPAIGN. */
function fakeStore(initial: Id<"characters">[] | undefined) {
  let value = initial;
  const store = {
    getQuery: (ref: unknown, args: unknown) => {
      expect(functionName(ref)).toBe("preferences:folds");
      expect(args).toEqual({ campaignId: CAMPAIGN });
      return value;
    },
    setQuery: (ref: unknown, args: unknown, next: Id<"characters">[]) => {
      expect(functionName(ref)).toBe("preferences:folds");
      expect(args).toEqual({ campaignId: CAMPAIGN });
      value = next;
    },
  } as unknown as OptimisticLocalStore;
  return { store, read: () => value };
}

describe("foldLocally (setFold's optimistic update)", () => {
  it("adds the character on fold, once", () => {
    const s = fakeStore([ASH]);
    foldLocally(s.store, { campaignId: CAMPAIGN, characterId: MOSS, folded: true });
    expect(s.read()).toEqual([ASH, MOSS]);
    foldLocally(s.store, { campaignId: CAMPAIGN, characterId: MOSS, folded: true });
    expect(s.read()).toEqual([ASH, MOSS]);
  });

  it("removes the character on unfold and leaves the others", () => {
    const s = fakeStore([MOSS, ASH]);
    foldLocally(s.store, { campaignId: CAMPAIGN, characterId: MOSS, folded: false });
    expect(s.read()).toEqual([ASH]);
  });

  it("does nothing while the list hasn't loaded", () => {
    const s = fakeStore(undefined);
    foldLocally(s.store, { campaignId: CAMPAIGN, characterId: MOSS, folded: true });
    expect(s.read()).toBeUndefined();
  });
});

describe("useHandFold", () => {
  it("is unfolded while loading and reads this campaign's folds from the account", () => {
    const { result, rerender } = renderHook(() => useHandFold(CAMPAIGN, MOSS));
    expect(result.current[0]).toBe(false);
    expect(state.queryArgs).toContainEqual({ name: "preferences:folds", args: { campaignId: CAMPAIGN } });
    state.folds = [ASH];
    rerender();
    expect(result.current[0]).toBe(false);
    state.folds = [ASH, MOSS];
    rerender();
    expect(result.current[0]).toBe(true);
  });

  it("writes setFold (an intent: campaign, character, folded) with the optimistic update, and no localStorage", async () => {
    state.folds = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { result } = renderHook(() => useHandFold(CAMPAIGN, MOSS));
    await act(async () => result.current[1](true));
    expect(state.calls).toEqual([{ name: "preferences:setFold", args: { campaignId: CAMPAIGN, characterId: MOSS, folded: true } }]);
    expect(state.optimistic).toBe(foldLocally);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("a refused write shows a HUD toast instead of an unhandled rejection", async () => {
    state.folds = [];
    state.fail = new ConvexError({ code: "NOT_FOUND" });
    const { result } = renderHook(() => useHandFold(CAMPAIGN, MOSS));
    await act(async () => {
      result.current[1](true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hudToasts.get()).toHaveLength(1);
  });
});
